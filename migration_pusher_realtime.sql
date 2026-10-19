-- =========================================================
-- MIGRATION: Sinyal Pusher dari database (SIAP PAKAI, TIDAK AKTIF dulu)
-- Jalankan SEKALI di Supabase SQL Editor. Aman diulang (idempotent).
--
-- Alur:  perubahan data -> trigger (per PERNYATAAN, bukan per baris)
--        -> pg_net -> https://<situs-kamu>/api/pusher-notify
--        -> Pusher -> semua layar yang membuka line/dashboard itu.
--
-- Yang dikirim hanya sinyal kecil: tabel apa, operasi apa, line mana.
-- Bukan isi baris, jadi ukuran tiap pesan sekitar 100 byte.
--
-- KENAPA PER PERNYATAAN: sinkronisasi Google Sheets mengirim 200 baris
-- dalam SATU upsert. Trigger per baris akan menembak 200 sinyal; trigger
-- per pernyataan menembak 1 sinyal berisi daftar line yang tersentuh.
-- UPDATE yang dibatalkan oleh zz_skip_unchanged_update (lihat
-- migration_hemat_realtime_sheet_sync.sql) tidak menyentuh baris sama
-- sekali, jadi tidak menghasilkan sinyal.
--
-- TIDAK AKTIF SAMPAI DISALAKAN: kolom enabled di private.pusher_config
-- bernilai false sampai kamu mengisinya (langkah di bawah / PUSHER.md).
-- Selama false, trigger langsung keluar tanpa melakukan apa pun.
--
-- Tabel absensi/cuti sengaja TIDAK dipasang (tetap Supabase Realtime,
-- lihat REALTIME_TETAP_SUPABASE di assets/realtime.js).
-- =========================================================

-- 1) Ekstensi pengirim HTTP asinkron (sudah ada di Supabase)
create extension if not exists pg_net with schema extensions;

-- 2) Konfigurasi di schema privat (tidak terbuka lewat API)
create schema if not exists private;

create table if not exists private.pusher_config (
  id       int primary key default 1 check (id = 1),
  enabled  boolean not null default false,
  url      text,      -- https://<situs-kamu>.vercel.app/api/pusher-notify
  secret   text       -- sama dengan NOTIFY_SECRET di Vercel
);
alter table private.pusher_config enable row level security;  -- tanpa policy = tertutup
revoke all on private.pusher_config from anon, authenticated;
insert into private.pusher_config (id) values (1) on conflict (id) do nothing;

-- 3) Fungsi trigger: kumpulkan line (mesin) & view_id dari baris yang
--    tersentuh, lalu kirim SATU sinyal.
create or replace function private.notify_pusher()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg record;
  sig jsonb;
begin
  select c.enabled, c.url, c.secret into cfg from private.pusher_config c where c.id = 1;
  if not found or not cfg.enabled or cfg.url is null or cfg.secret is null then
    return null;
  end if;

  if TG_OP = 'INSERT' then
    select jsonb_build_object(
             'n', count(*),
             'm', coalesce(jsonb_agg(distinct s.j ->> 'mesin')   filter (where s.j ->> 'mesin'   is not null), '[]'::jsonb),
             'v', coalesce(jsonb_agg(distinct s.j ->> 'view_id') filter (where s.j ->> 'view_id' is not null), '[]'::jsonb))
      into sig
      from (select to_jsonb(r) as j from new_rows r) s;
  elsif TG_OP = 'DELETE' then
    select jsonb_build_object(
             'n', count(*),
             'm', coalesce(jsonb_agg(distinct s.j ->> 'mesin')   filter (where s.j ->> 'mesin'   is not null), '[]'::jsonb),
             'v', coalesce(jsonb_agg(distinct s.j ->> 'view_id') filter (where s.j ->> 'view_id' is not null), '[]'::jsonb))
      into sig
      from (select to_jsonb(r) as j from old_rows r) s;
  else
    -- UPDATE: gabungan baris lama & baru (line/view bisa saja berpindah)
    select jsonb_build_object(
             'n', count(*),
             'm', coalesce(jsonb_agg(distinct s.j ->> 'mesin')   filter (where s.j ->> 'mesin'   is not null), '[]'::jsonb),
             'v', coalesce(jsonb_agg(distinct s.j ->> 'view_id') filter (where s.j ->> 'view_id' is not null), '[]'::jsonb))
      into sig
      from (select to_jsonb(o) as j from old_rows o
            union all
            select to_jsonb(n) as j from new_rows n) s;
  end if;

  if (sig ->> 'n')::int = 0 then
    return null;   -- tidak ada baris yang benar-benar berubah
  end if;

  perform net.http_post(
    url     := cfg.url,
    body    := jsonb_build_object('t', TG_TABLE_NAME, 'op', TG_OP, 'm', sig -> 'm', 'v', sig -> 'v'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', cfg.secret)
  );
  return null;
end;
$$;

-- 4) Pasang 3 trigger (INSERT / UPDATE / DELETE) di tiap tabel.
--    Tabel yang belum ada dilewati dengan pemberitahuan.
do $$
declare
  t text;
  tables text[] := array[
    'production_log', 'production_log_new', 'downtime_log', 'dandori_log',
    'ng_inline_log', 'repair_log', 'repair_views', 'repair_points',
    'andon_call', 'andon_setting'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is null then
      raise notice 'Tabel public.% tidak ada, dilewati.', t;
      continue;
    end if;
    execute format('drop trigger if exists zz_pusher_ins on public.%I', t);
    execute format('drop trigger if exists zz_pusher_upd on public.%I', t);
    execute format('drop trigger if exists zz_pusher_del on public.%I', t);
    execute format('create trigger zz_pusher_ins after insert on public.%I
                      referencing new table as new_rows
                      for each statement execute function private.notify_pusher()', t);
    execute format('create trigger zz_pusher_upd after update on public.%I
                      referencing old table as old_rows new table as new_rows
                      for each statement execute function private.notify_pusher()', t);
    execute format('create trigger zz_pusher_del after delete on public.%I
                      referencing old table as old_rows
                      for each statement execute function private.notify_pusher()', t);
  end loop;
end $$;

-- =========================================================
-- MENYALAKAN (nanti, setelah Vercel & Pusher siap, lihat PUSHER.md):
--
--   update private.pusher_config
--      set url     = 'https://NAMA-SITUS.vercel.app/api/pusher-notify',
--          secret  = 'ISI-DENGAN-NOTIFY_SECRET-DARI-VERCEL',
--          enabled = true
--    where id = 1;
--
-- MEMATIKAN KEMBALI (kapan saja, langsung berlaku):
--
--   update private.pusher_config set enabled = false where id = 1;
--
-- MENGECEK pengiriman (pg_net menyimpan hasil beberapa jam terakhir):
--
--   select id, status_code, error_msg, created
--     from net._http_response order by created desc limit 20;
--
-- MENGHAPUS SEMUA (kalau Pusher dibatalkan):
--
--   do $$ declare t text; begin
--     foreach t in array array['production_log','production_log_new','downtime_log','dandori_log',
--       'ng_inline_log','repair_log','repair_views','repair_points','andon_call','andon_setting'] loop
--       execute format('drop trigger if exists zz_pusher_ins on public.%I', t);
--       execute format('drop trigger if exists zz_pusher_upd on public.%I', t);
--       execute format('drop trigger if exists zz_pusher_del on public.%I', t);
--     end loop; end $$;
-- =========================================================
