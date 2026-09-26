-- =====================================================================
-- migration_andon_ulang.sql -- Notifikasi diulang sampai diterima + eskalasi
-- Jalankan SEKALI di Supabase > SQL Editor (klik Run). Aman diulang.
-- Butuh: migration_andon.sql, migration_andon_setting.sql, migration_andon_push.sql
--
-- Cara kerja:
--   * Jadwal pg_cron menjalankan andon_cron() tiap 30 detik.
--   * Panggilan yang masih "memanggil" -> tiap N detik (setting admin)
--     ditulis 1 baris "ping" ke tabel andon_ping.
--   * Webhook andon_ping (INSERT) memanggil Edge Function andon-push, yang
--     mengirim ulang notifikasi ke tim / eskalasi ke leader & foreman.
-- =====================================================================
begin;

create extension if not exists pg_cron;

-- Pengaturan admin (ditambahkan ke tabel pengaturan yang sudah ada)
alter table public.andon_setting add column if not exists push_ulang     int not null default 60;  -- detik; 0 = tidak diulang
alter table public.andon_setting add column if not exists push_ulang_max int not null default 15;  -- maksimal pengulangan
alter table public.andon_setting add column if not exists eskalasi_menit int not null default 5;   -- menit; 0 = tanpa eskalasi

-- Catatan pengiriman per panggilan
alter table public.andon_call add column if not exists notif_terakhir  timestamptz;
alter table public.andon_call add column if not exists notif_ulang_ke  int not null default 0;
alter table public.andon_call add column if not exists eskalasi_at     timestamptz;

-- Antrian "ping" (hanya ditulis oleh andon_cron, dibaca Edge Function)
create table if not exists public.andon_ping (
  id         bigserial primary key,
  call_id    uuid not null,
  jenis      text not null check (jenis in ('ulang', 'eskalasi')),
  ke         int,
  created_at timestamptz not null default now()
);
alter table public.andon_ping enable row level security;       -- tanpa policy = tidak bisa diakses user
revoke all on public.andon_ping from anon, authenticated;

create or replace function public.andon_cron()
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  s   public.andon_setting%rowtype;
  c   record;
  n   int := 0;
begin
  select * into s from public.andon_setting where id = 1;
  if not found then return 0; end if;

  for c in
    select * from public.andon_call
     where status = 'memanggil'
       and dipanggil_at > now() - interval '12 hours'
     for update skip locked
  loop
    -- 1) ulangi notifikasi ke tim
    if coalesce(s.push_ulang, 0) > 0
       and c.notif_ulang_ke < coalesce(s.push_ulang_max, 15)
       and now() - coalesce(c.notif_terakhir, c.dipanggil_at) >= make_interval(secs => s.push_ulang) then
      insert into public.andon_ping (call_id, jenis, ke) values (c.id, 'ulang', c.notif_ulang_ke + 1);
      update public.andon_call set notif_terakhir = now(), notif_ulang_ke = notif_ulang_ke + 1 where id = c.id;
      n := n + 1;
    end if;
    -- 2) eskalasi ke leader / foreman / supervisor (sekali saja)
    if coalesce(s.eskalasi_menit, 0) > 0 and c.eskalasi_at is null
       and now() - c.dipanggil_at >= make_interval(mins => s.eskalasi_menit) then
      insert into public.andon_ping (call_id, jenis, ke) values (c.id, 'eskalasi', null);
      update public.andon_call set eskalasi_at = now() where id = c.id;
      n := n + 1;
    end if;
  end loop;

  delete from public.andon_ping where created_at < now() - interval '2 days';   -- bersih-bersih
  return n;
end $$;
revoke all on function public.andon_cron() from public, anon, authenticated;

-- Tujuan eskalasi: admin, leader, FOREMAN, SUPERVISOR yang sudah mengaktifkan notifikasi
create or replace function public.andon_push_eskalasi()
returns table (id uuid, endpoint text, p256dh text, auth text, user_id uuid)
language sql stable security definer set search_path = public as $$
  select s.id, s.endpoint, s.p256dh, s.auth, s.user_id
    from public.push_subscriptions s
    join public.profiles p on p.id = s.user_id
   where lower(coalesce(p.role, '')) in ('admin', 'leader')
      or upper(coalesce(p.jabatan, '')) in ('FOREMAN', 'SUPERVISOR');
$$;
revoke all on function public.andon_push_eskalasi() from public, anon, authenticated;
grant execute on function public.andon_push_eskalasi() to service_role;

commit;

-- Jadwal tiap 30 detik (dibuat ulang kalau sudah ada)
select cron.unschedule(jobid) from cron.job where jobname = 'andon-ulang';
select cron.schedule('andon-ulang', '30 seconds', $$select public.andon_cron()$$);

notify pgrst, 'reload schema';

select (select count(*) from cron.job where jobname = 'andon-ulang') = 1 as jadwal_ok,
       to_regclass('public.andon_ping') is not null                   as tabel_ok,
       s.push_ulang, s.eskalasi_menit
  from public.andon_setting s;
