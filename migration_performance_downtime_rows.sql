-- =========================================================
-- Fungsi baru: performance_downtime_rows
-- Dipakai tabel "Rekap Downtime" di tab Performance > Harian
-- (machines/e-0X.html, panel Performance Harian) -- GANTI dari
-- sebelumnya "5 Downtime Terburuk" (ringkasan kategori+problem,
-- dibatasi 5 baris) menjadi daftar MENTAH per baris downtime hari
-- itu, kolom: PIC, Problem Kategori, Problem Detail, Area,
-- Countermeasure, Total Losstime.
--
-- "Problem Kategori" = kolom downtime_log.problem (dropdown level 1)
-- "Problem Detail"   = kolom downtime_log.penyebab (dropdown level 2)
-- (lihat form "Catat Downtime" di machines/e-0X.html -- field "Kategori"
-- yg terpisah, MESIN/DIES/OTHER, SENGAJA tidak dimasukkan di sini krn
-- user cuma minta 6 kolom ini).
--
-- Sama seperti performance_aggregate/downtime_top_problems/
-- downtime_by_category (lihat migration_fix_performance_shift.sql):
-- filter waktu_awal digeser "+ interval '7 hours'" supaya pakai
-- konvensi "hari produksi mulai jam 07:00 WIB", bukan tengah malam.
-- =========================================================
create or replace function public.performance_downtime_rows(
  p_mesin machine_type,
  p_stasiun_list text[],
  p_start timestamptz,
  p_end timestamptz
)
returns table (
  pic text,
  problem text,
  penyebab text,
  area text,
  countermeasure text,
  durasi_menit numeric
)
language sql stable
as $$
  select
    coalesce(pic, '(kosong)') as pic,
    coalesce(problem, '(kosong)') as problem,
    coalesce(penyebab, '(kosong)') as penyebab,
    coalesce(area, '(kosong)') as area,
    coalesce(countermeasure, '(kosong)') as countermeasure,
    round(extract(epoch from (waktu_akhir - waktu_awal)) / 60) as durasi_menit
  from public.downtime_log
  where mesin = p_mesin
    and (p_stasiun_list is null or stasiun = any(p_stasiun_list))
    and waktu_awal >= p_start + interval '7 hours'
    and waktu_awal <  p_end + interval '7 hours'
  order by waktu_awal;
$$;
grant execute on function public.performance_downtime_rows(machine_type, text[], timestamptz, timestamptz) to authenticated;

-- =========================================================
-- SELESAI. Jalankan di Supabase SQL Editor (tidak perlu redeploy file
-- apa pun utk perubahan SQL ini sendiri -- tapi paket zip yang
-- dikirim bersama migration ini SUDAH termasuk perubahan tampilan
-- yang makai fungsi ini).
-- =========================================================
