-- =====================================================================
-- Filter "Supporting" (PIC) untuk tab Kontrol Downtime (Dashboard Exhaust)
-- =====================================================================
-- Semua fungsi di bawah ini BARU (nama baru). Tidak ada satu pun fungsi
-- lama yang ditimpa atau diubah, jadi tampilan/angka yang sekarang
-- dijamin tidak terganggu sama sekali.
--
-- Aturan tanggal & jam PERSIS meniru fungsi aslinya:
--   - rentang  : waktu_awal >= p_start + 7 jam  dan  < p_end + 7 jam
--   - hari     : (waktu_awal di zona Asia/Jakarta) dikurangi 7 jam
--                -> hari produksi 07:00 s/d 07:00 besoknya
--   - p_pic NULL = semua PIC (hasilnya sama persis dengan fungsi lama)
--   - PIC kosong di data disamakan jadi '(kosong)', sama seperti
--     dashboard_harian_downtime_by_pic.
-- =====================================================================

-- 1) Downtime per TANGGAL -- dipakai grafik "Downtime Harian" dan
--    grafik "Downtime Exhaust" (12 bulan FY, dijumlahkan per bulan di sisi
--    aplikasi). SENGAJA dipisah dari dashboard_harian_produksi supaya
--    Productivity & Availability TIDAK ikut berubah saat PIC dipilih.
CREATE OR REPLACE FUNCTION public.dashboard_downtime_harian_pic(
  p_start timestamp with time zone,
  p_end   timestamp with time zone,
  p_mesin machine_type DEFAULT NULL::machine_type,
  p_pic   text DEFAULT NULL
)
RETURNS TABLE(tanggal date, downtime_menit numeric)
LANGUAGE sql
STABLE
AS $function$
  select
    (date_trunc('day', (dl.waktu_awal at time zone 'Asia/Jakarta') - interval '7 hours'))::date as tanggal,
    sum(extract(epoch from (dl.waktu_akhir - dl.waktu_awal)) / 60) as downtime_menit
  from public.downtime_log dl
  where dl.waktu_awal >= p_start + interval '7 hours'
    and dl.waktu_awal <  p_end + interval '7 hours'
    and (p_mesin is null or dl.mesin = p_mesin)
    and (p_pic is null or coalesce(dl.pic, '(kosong)') = p_pic)
  group by 1
  order by 1;
$function$;

-- 2) Downtime per LINE (donut "Downtime Line")
CREATE OR REPLACE FUNCTION public.dashboard_downtime_by_line_pic(
  p_start timestamp with time zone,
  p_end   timestamp with time zone,
  p_pic   text DEFAULT NULL
)
RETURNS TABLE(mesin machine_type, act_menit numeric)
LANGUAGE sql
STABLE
AS $function$
  select
    dl.mesin,
    sum(extract(epoch from (dl.waktu_akhir - dl.waktu_awal)) / 60) as act_menit
  from public.downtime_log dl
  where dl.waktu_awal >= p_start + interval '7 hours'
    and dl.waktu_awal <  p_end + interval '7 hours'
    and (p_pic is null or coalesce(dl.pic, '(kosong)') = p_pic)
  group by 1
  order by 1;
$function$;

-- 3) Weekly (grafik WEEK 1 - WEEK 5)
CREATE OR REPLACE FUNCTION public.dashboard_bulanan_weekly_pic(
  p_start timestamp with time zone,
  p_end   timestamp with time zone,
  p_pic   text DEFAULT NULL
)
RETURNS TABLE(minggu_mulai date, mesin machine_type, downtime_menit numeric)
LANGUAGE sql
STABLE
AS $function$
  select
    date_trunc('week', (dl.waktu_awal at time zone 'Asia/Jakarta') - interval '7 hours')::date as minggu_mulai,
    dl.mesin,
    sum(extract(epoch from (dl.waktu_akhir - dl.waktu_awal)) / 60) as downtime_menit
  from public.downtime_log dl
  where dl.waktu_awal >= p_start + interval '7 hours'
    and dl.waktu_awal <  p_end + interval '7 hours'
    and (p_pic is null or coalesce(dl.pic, '(kosong)') = p_pic)
  group by 1, 2
  order by 1, 2;
$function$;

-- 4) Tabel "Downtime Terbesar" (ringkasan problem sebulan).
--    PENTING: filter PIC harus dikerjakan di SINI, bukan di aplikasi --
--    karena ada "limit p_limit" (ambil 10 terbesar). Kalau difilter
--    belakangan, hasilnya bisa kurang dari 10 baris atau malah kosong.
CREATE OR REPLACE FUNCTION public.dashboard_bulanan_top_problems_summary_pic(
  p_start timestamp with time zone,
  p_end   timestamp with time zone,
  p_limit integer DEFAULT 10,
  p_mesin machine_type DEFAULT NULL::machine_type,
  p_pic   text DEFAULT NULL
)
RETURNS TABLE(problem text, total_menit numeric, frekuensi bigint)
LANGUAGE sql
STABLE
AS $function$
  select
    coalesce(problem, '(tanpa keterangan)') as problem,
    sum(extract(epoch from (waktu_akhir - waktu_awal)) / 60) as total_menit,
    count(*) as frekuensi
  from public.downtime_log
  where waktu_awal >= p_start + interval '7 hours'
    and waktu_awal <  p_end + interval '7 hours'
    and (p_mesin is null or mesin = p_mesin)
    and (p_pic is null or coalesce(pic, '(kosong)') = p_pic)
  group by 1
  order by total_menit desc
  limit p_limit;
$function$;

-- 5) Tabel "Downtime Line" (rincian per baris, per line)
CREATE OR REPLACE FUNCTION public.dashboard_harian_top_problems_pic(
  p_mesin machine_type,
  p_start timestamp with time zone,
  p_end   timestamp with time zone,
  p_limit integer DEFAULT 5,
  p_pic   text DEFAULT NULL
)
RETURNS TABLE(pic text, problem text, area text, countermeasure text, status text, shift text, total_menit numeric)
LANGUAGE sql
STABLE
AS $function$
  select
    coalesce(dl.pic, '(kosong)') as pic,
    coalesce(dl.problem, '(tanpa keterangan)') as problem,
    coalesce(dl.area, '(kosong)') as area,
    coalesce(dl.countermeasure, '(kosong)') as countermeasure,
    coalesce(dl.status, '(kosong)') as status,
    case
      when (dl.waktu_awal at time zone 'Asia/Jakarta')::time >= time '07:00'
       and (dl.waktu_awal at time zone 'Asia/Jakarta')::time <  time '19:30'
      then 'Shift 1'
      else 'Shift 2'
    end as shift,
    extract(epoch from (dl.waktu_akhir - dl.waktu_awal)) / 60 as total_menit
  from public.downtime_log dl
  where dl.mesin = p_mesin
    and dl.waktu_awal >= p_start + interval '7 hours'
    and dl.waktu_awal <  p_end + interval '7 hours'
    and (p_pic is null or coalesce(dl.pic, '(kosong)') = p_pic)
  order by total_menit desc nulls last
  limit p_limit;
$function$;

-- Hak akses: samakan dengan fungsi dashboard lain supaya bisa dipanggil
-- dari aplikasi (anon/authenticated).
GRANT EXECUTE ON FUNCTION public.dashboard_downtime_harian_pic(timestamptz, timestamptz, machine_type, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_downtime_by_line_pic(timestamptz, timestamptz, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_bulanan_weekly_pic(timestamptz, timestamptz, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_bulanan_top_problems_summary_pic(timestamptz, timestamptz, integer, machine_type, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_harian_top_problems_pic(machine_type, timestamptz, timestamptz, integer, text) TO anon, authenticated;
