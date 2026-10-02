-- =========================================================
-- FIX: tab "Performance" (di halaman tiap line, dan yang ditampilkan
-- lewat iframe di Dashboard Exhaust) belum pakai konvensi "hari
-- produksi" (batas hari jam 07:00 WIB, bukan 00:00) -- beda dari
-- semua RPC dashboard_* yang SUDAH dibenarkan di
-- migration_fix_hari_produksi_shift.sql.
--
-- Akibatnya: baris produksi shift 2 yang waktu_awal-nya sudah lewat
-- tengah malam (00:00-06:59 WIB) salah masuk ke "hari ini" padahal
-- itu masih bagian shift semalam -- kelihatan di tabel "Produksi Hari
-- Itu", kartu OEE/Qty/NG/Repair, "5 Downtime Terburuk", & pie
-- "Downtime per Kategori" di Performance Harian (dan ikut kebawa ke
-- rekap Bulanan/Tahunan juga, krn sama-sama pakai fungsi ini per hari).
--
-- Fix-nya SAMA PERSIS pola yang sudah dipakai di semua fungsi
-- dashboard_* lain: filter waktu_awal digeser "+ interval '7 hours'".
-- Client (assets/machine-page.js) tetap kirim batas KALENDER biasa
-- (00:00 WIB tgl terpilih s/d 00:00 WIB hari berikutnya) -- TIDAK
-- perlu diubah di sisi client utk 3 fungsi ini, pas sama konvensi yang
-- sudah ada.
--
-- Kolom "tanggal" (date murni, dipakai repair_log) SENGAJA TIDAK
-- disentuh -- sama seperti catatan di migration_fix_hari_produksi_shift.sql,
-- kolom date tidak kena masalah pergeseran jam ini.
-- =========================================================

-- ============ 1) performance_aggregate ============
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
      and pl.waktu_awal >= p_start + interval '7 hours'
      and pl.waktu_awal <  p_end + interval '7 hours'
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
    -- repair_log pakai kolom "tanggal" (date murni) -- TIDAK digeser,
    -- sama seperti konvensi yang sudah ada.
    (select coalesce(sum(rl.qty), 0) from public.repair_log rl
       where rl.mesin = p_mesin and rl.tanggal >= p_start::date and rl.tanggal < p_end::date);
$$;
grant execute on function public.performance_aggregate(machine_type, text[], timestamptz, timestamptz) to authenticated;

-- ============ 2) downtime_top_problems ============
create or replace function public.downtime_top_problems(
  p_mesin machine_type,
  p_stasiun_list text[],
  p_start timestamptz,
  p_end timestamptz,
  p_limit int default 5
)
returns table (kategori text, problem text, total_menit numeric)
language sql stable
as $$
  select kategori, coalesce(problem, '(tanpa keterangan)') as problem,
         sum(extract(epoch from (waktu_akhir - waktu_awal)) / 60) as total_menit
  from public.downtime_log
  where mesin = p_mesin
    and (p_stasiun_list is null or stasiun = any(p_stasiun_list))
    and waktu_awal >= p_start + interval '7 hours'
    and waktu_awal <  p_end + interval '7 hours'
  group by kategori, problem
  order by total_menit desc
  limit p_limit;
$$;
grant execute on function public.downtime_top_problems(machine_type, text[], timestamptz, timestamptz, int) to authenticated;

-- ============ 3) downtime_by_category ============
create or replace function public.downtime_by_category(
  p_mesin machine_type,
  p_stasiun_list text[],
  p_start timestamptz,
  p_end timestamptz
)
returns table (kategori text, total_menit numeric)
language sql stable
as $$
  select kategori, sum(extract(epoch from (waktu_akhir - waktu_awal)) / 60) as total_menit
  from public.downtime_log
  where mesin = p_mesin
    and (p_stasiun_list is null or stasiun = any(p_stasiun_list))
    and waktu_awal >= p_start + interval '7 hours'
    and waktu_awal <  p_end + interval '7 hours'
  group by kategori
  order by total_menit desc;
$$;
grant execute on function public.downtime_by_category(machine_type, text[], timestamptz, timestamptz) to authenticated;

-- =========================================================
-- SELESAI. Tidak perlu redeploy file apa pun utk perubahan SQL ini --
-- cukup jalankan di Supabase SQL Editor. File assets/machine-page.js
-- tetap perlu di-update (1 query langsung ke production_log di
-- fetchPerfDayRows() tidak lewat RPC, jadi digeser +7 jam di sisi JS)
-- -- sudah termasuk di paket zip yang dikirim bersama migration ini.
-- =========================================================
