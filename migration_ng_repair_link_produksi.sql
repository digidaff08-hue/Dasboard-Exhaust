-- =========================================================
-- MIGRATION: Link NG Inline & Repair ke baris Produksi
-- Jalankan sekali di Supabase SQL Editor, setelah schema_ng_inline.sql
-- dan migration_repair_v1.sql (dst) sudah jalan.
-- Aman dijalankan berulang (idempotent).
--
-- KENAPA: Sebelumnya NG Inline & Repair cuma catat TANGGAL, jadi kalau
-- 1 Part Number diproduksi 2x dalam sehari (misal shift 1 & shift 2),
-- tidak bisa dibedakan NG Inline/Repair-nya masuk ke sesi produksi yang
-- mana. Sekarang ditambah JAM kejadian, lalu sistem otomatis mencari
-- baris produksi (production_log) yang jamnya pas menampung waktu itu
-- -- SAMA PERSIS seperti cara Downtime sudah dicocokkan otomatis ke
-- production_log_id.
--
-- BEDA DENGAN DOWNTIME: kalau tidak ketemu baris produksi yang pas,
-- NG Inline/Repair TETAP BOLEH TERSIMPAN (production_log_id dikosongkan
-- saja) -- tidak diblokir seperti Downtime, karena NG Inline/Repair
-- kadang memang dicatat di luar jam produksi resmi (misal ketemu pas
-- inspeksi stock lama).
--
-- Data NG Inline / Repair LAMA (sebelum migrasi ini) otomatis
-- production_log_id-nya NULL -- akan tampil 0 di kolom breakdown
-- per-baris produksi, tapi tetap ada & aman di riwayat.
-- =========================================================

-- 1. Tambah kolom jam + waktu_kejadian (gabungan tanggal+jam, dipakai
--    buat pencarian baris produksi) + production_log_id di ng_inline_log
alter table public.ng_inline_log add column if not exists jam time;
alter table public.ng_inline_log add column if not exists waktu_kejadian timestamptz;
alter table public.ng_inline_log
  add column if not exists production_log_id uuid references public.production_log(id) on delete set null;
create index if not exists idx_ng_inline_log_production_log_id on public.ng_inline_log (production_log_id);

-- 2. Sama untuk repair_log
alter table public.repair_log add column if not exists jam time;
alter table public.repair_log add column if not exists waktu_kejadian timestamptz;
alter table public.repair_log
  add column if not exists production_log_id uuid references public.production_log(id) on delete set null;
create index if not exists idx_repair_log_production_log_id on public.repair_log (production_log_id);

-- 3. Trigger auto-link NG Inline -> production_log (soft, tidak menolak insert)
create or replace function public.link_ng_inline_to_produksi()
returns trigger as $$
declare
  match_id uuid;
begin
  if new.waktu_kejadian is null then
    new.production_log_id := null;
    return new;
  end if;

  select id into match_id
  from public.production_log
  where mesin = new.mesin
    and waktu_awal <= new.waktu_kejadian
    and waktu_akhir >= new.waktu_kejadian
  order by waktu_awal desc
  limit 1;

  new.production_log_id := match_id; -- NULL kalau tidak ketemu, tidak error
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_link_ng_inline_produksi on public.ng_inline_log;
create trigger trg_link_ng_inline_produksi
  before insert or update on public.ng_inline_log
  for each row execute procedure public.link_ng_inline_to_produksi();

-- 4. Trigger auto-link Repair -> production_log (soft, sama seperti di atas)
create or replace function public.link_repair_to_produksi()
returns trigger as $$
declare
  match_id uuid;
begin
  if new.waktu_kejadian is null then
    new.production_log_id := null;
    return new;
  end if;

  select id into match_id
  from public.production_log
  where mesin = new.mesin
    and waktu_awal <= new.waktu_kejadian
    and waktu_akhir >= new.waktu_kejadian
  order by waktu_awal desc
  limit 1;

  new.production_log_id := match_id;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_link_repair_produksi on public.repair_log;
create trigger trg_link_repair_produksi
  before insert or update on public.repair_log
  for each row execute procedure public.link_repair_to_produksi();

-- 5. Extend performance_aggregate: tambah total Qty Repair per periode
--    (dipakai kartu "Repair" pengganti "GSPH Target" di tab Performance)
create or replace function public.performance_aggregate(
  p_mesin machine_type,
  p_stasiun_list text[],
  p_start timestamptz,
  p_end timestamptz
)
returns table (
  stroke numeric,
  ng numeric,
  ng_value numeric,
  dandori_menit numeric,
  downtime_menit numeric,
  break_menit numeric,
  wh_menit numeric,
  jumlah_baris bigint,
  target_std_menit numeric,
  repair_qty numeric
)
language sql stable
as $$
  with rows_with_ratio as (
    select pl.*, coalesce(pn.stroke_ratio, 1) as ratio, pn.std_ct, pn.harga_pcs
    from public.production_log pl
    left join public.part_numbers pn
      on pn.mesin = pl.mesin and pn.value = pl.part_number
    where pl.mesin = p_mesin
      and (p_stasiun_list is null or pl.stasiun = any(p_stasiun_list))
      and pl.waktu_awal >= p_start
      and pl.waktu_awal < p_end
  ),
  batched_time as (
    select
      stasiun, waktu_awal, waktu_akhir,
      max(coalesce(break_menit, 0)) as break_menit,
      max(coalesce(dandori_menit, 0)) as dandori_menit,
      sum(coalesce(downtime_menit, 0)) as downtime_menit
    from rows_with_ratio
    group by stasiun, waktu_awal, waktu_akhir
  )
  select
    (select coalesce(sum(coalesce(qty, 0) * ratio), 0) from rows_with_ratio),
    (select coalesce(sum(ng), 0) from rows_with_ratio),
    (select coalesce(sum(coalesce(ng,0) * coalesce(harga_pcs,0)), 0) from rows_with_ratio),
    (select coalesce(sum(dandori_menit), 0) from batched_time),
    (select coalesce(sum(downtime_menit), 0) from batched_time),
    (select coalesce(sum(break_menit), 0) from batched_time),
    (select coalesce(sum(extract(epoch from (waktu_akhir - waktu_awal)) / 60), 0)
       - (select coalesce(sum(break_menit), 0) from batched_time)
     from batched_time),
    (select count(*) from rows_with_ratio),
    (select coalesce(sum(coalesce(qty, 0) * ratio * std_ct), 0) from rows_with_ratio where std_ct is not null and std_ct > 0),
    (select coalesce(sum(rl.qty), 0) from public.repair_log rl
       where rl.mesin = p_mesin and rl.tanggal >= p_start::date and rl.tanggal < p_end::date);
$$;
grant execute on function public.performance_aggregate(machine_type, text[], timestamptz, timestamptz) to authenticated;

-- =========================================================
-- SELESAI.
-- Kalau ada error "cannot change return type of existing function",
-- jalankan dulu:
--   drop function if exists public.performance_aggregate(machine_type, text[], timestamptz, timestamptz) cascade;
-- lalu jalankan ulang bagian 5 di atas.
-- =========================================================
