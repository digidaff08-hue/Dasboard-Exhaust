-- =====================================================================
-- Migration: dukungan tab "Dekidaka" (papan kontrol produksi per line)
-- di Dashboard Exhaust.
--
-- 2 fungsi baru, mengikuti konvensi yang sama persis dengan fungsi
-- dashboard_* lain yang sudah ada (filter waktu di-shift +7 jam supaya
-- "hari produksi" dihitung mulai jam 07:00 WIB, bukan tengah malam --
-- lihat migration_fix_hari_produksi_shift.sql).
--
-- p_start / p_end dikirim oleh dashboard sebagai jam 00:00 WIB tanggal
-- terpilih s/d 00:00 WIB hari berikutnya (sama seperti semua fungsi
-- dashboard_* lain), lalu di dalam fungsi ini di-geser +7 jam supaya
-- jendela yang sebenarnya dipakai = 07:00 WIB tanggal terpilih s/d
-- 07:00 WIB hari berikutnya (1 hari produksi penuh, Shift 1 + Shift 2).
-- =====================================================================

-- 1) Daftar downtime (per baris, lengkap dgn jam mulai) utk 1 line + 1 hari
--    produksi -- dipakai papan Dekidaka utk mencocokkan tiap problem ke
--    blok waktu yang sesuai (persis seperti getDowntimeRows() di script
--    lama, versi Supabase).
CREATE OR REPLACE FUNCTION public.dashboard_dekidaka_downtime_rows(
  p_mesin machine_type,
  p_start timestamp with time zone,
  p_end timestamp with time zone
)
 RETURNS TABLE(jam text, masalah text, penanganan text, pic text, durasi_menit numeric)
 LANGUAGE sql
 STABLE
AS $function$
  select
    to_char(waktu_awal at time zone 'Asia/Jakarta', 'HH24:MI') as jam,
    coalesce(problem, area, '(tanpa keterangan)') as masalah,
    coalesce(countermeasure, '(kosong)') as penanganan,
    coalesce(pic, '(kosong)') as pic,
    round(extract(epoch from (waktu_akhir - waktu_awal)) / 60) as durasi_menit
  from public.downtime_log
  where mesin = p_mesin
    and waktu_awal >= p_start + interval '7 hours'
    and waktu_awal <  p_end + interval '7 hours'
  order by waktu_awal;
$function$;

-- 2) Total Repair Qty utk 1 line + 1 hari produksi + 1 shift tertentu
--    (p_shift = '1' atau '2') -- dipakai kartu "Repair Qty" di papan
--    Dekidaka (persis seperti getRepairQty() di script lama, versi
--    Supabase). Sama seperti dashboard_qc_repair_perline, sumbernya
--    kolom production_log.repair (bukan tabel terpisah).
CREATE OR REPLACE FUNCTION public.dashboard_dekidaka_repair_qty(
  p_mesin machine_type,
  p_start timestamp with time zone,
  p_end timestamp with time zone,
  p_shift text
)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce(sum(repair), 0)
  from public.production_log
  where mesin = p_mesin
    and waktu_awal >= p_start + interval '7 hours'
    and waktu_awal <  p_end + interval '7 hours'
    and (
      case
        when (waktu_awal at time zone 'Asia/Jakarta')::time >= time '07:00'
         and (waktu_awal at time zone 'Asia/Jakarta')::time <  time '19:30'
        then '1'
        else '2'
      end
    ) = p_shift;
$function$;
