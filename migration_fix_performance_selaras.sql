-- =====================================================================
-- FIX: menyelaraskan KARTU di tab Performance dengan TABEL di bawahnya.
--
-- Gejala yang dilaporkan (E-03, 01/10/2026):
--   1. Kartu "Repair" = 20, padahal kolom Repair di tabel "Produksi Hari
--      Itu" isinya 6 + 8 = 14.
--   2. Kartu "Downtime" = 0 menit, padahal tabel "Rekap Downtime"
--      menunjukkan 1 baris, 22 menit.
--
-- Sebabnya ada 3, dan semuanya di fungsi performance_aggregate:
--
--  (a) REPAIR salah sumber.
--      migration_fix_performance_repair_source.sql dulu sudah
--      memindahkan sumber Repair ke kolom production_log.repair (yang
--      diisi di form Input Produksi, dan itulah yang ditampilkan tabel
--      "Produksi Hari Itu"). Tapi migration_fix_performance_shift.sql
--      (perbaikan "hari produksi mulai 07:00") menulis ulang fungsi ini
--      dari versi yang lebih lama, sehingga sumbernya BALIK LAGI ke
--      tabel repair_log -- yaitu menu "Repair 3D" yang isinya beda.
--      Di sini dikembalikan ke production_log.repair.
--
--  (b) NG juga ikut terbawa balik ke versi lama (production_log.ng),
--      padahal migration_fix_performance_ng_inline.sql +
--      migration_fix_performance_ng_timezone.sql sudah memindahkannya ke
--      tabel ng_inline_log. Belum kelihatan salah karena NG hari itu
--      kebetulan 0, tapi tetap dikembalikan supaya tidak salah nanti.
--
--  (c) DOWNTIME memang tidak akan pernah terisi.
--      Fungsi ini menjumlah kolom production_log.downtime_menit, padahal
--      kolom itu SELALU ditulis 0 oleh form Input Produksi dan tidak
--      pernah di-update. Lihat catatan tegas di
--      migration_downtime_link_produksi_new.sql: "Tabel production_log
--      (lama) & downtime_menit-nya TIDAK disentuh" -- downtime yang
--      sebenarnya hidup di tabel downtime_log.
--      Jadi sumbernya dipindah ke downtime_log, memakai filter mesin,
--      stasiun, dan jendela waktu yang SAMA PERSIS dengan
--      performance_downtime_rows (yang mengisi tabel "Rekap Downtime"),
--      supaya kartu dan tabelnya dijamin cocok.
--      Efek sampingan yang disengaja: nilai Availability & OEE sekarang
--      ikut benar -- sebelumnya selalu 100% karena downtime terbaca 0.
--
-- Konvensi jendela waktu TIDAK diubah (lihat
-- migration_fix_hari_produksi_shift.sql): p_start/p_end dikirim sebagai
-- 00:00 WIB, lalu digeser +7 jam di dalam fungsi untuk kolom timestamptz
-- (production_log.waktu_awal, downtime_log.waktu_awal). Kolom tanggal
-- murni (ng_inline_log.tanggal) TIDAK digeser, cuma di-cast ke tanggal
-- WIB -- sama seperti sebelumnya.
-- =====================================================================

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
      and pl.waktu_awal <  p_end   + interval '7 hours'
  ),
  batched_time as (
    select
      stasiun, waktu_awal, waktu_akhir,
      max(coalesce(break_menit, 0))   as break_menit,
      max(coalesce(dandori_menit, 0)) as dandori_menit
    from rows_with_ratio
    group by stasiun, waktu_awal, waktu_akhir
  )
  select
    -- Stroke = qty x stroke_ratio
    (select coalesce(sum(coalesce(qty, 0) * ratio), 0) from rows_with_ratio),
    -- NG & nilai NG: dari ng_inline_log (bukan production_log.ng)
    (select coalesce(sum(nil.qty), 0) from public.ng_inline_log nil
       where nil.mesin = p_mesin
         and nil.tanggal >= (p_start at time zone 'Asia/Jakarta')::date
         and nil.tanggal <  (p_end   at time zone 'Asia/Jakarta')::date),
    (select coalesce(sum(nil.value), 0) from public.ng_inline_log nil
       where nil.mesin = p_mesin
         and nil.tanggal >= (p_start at time zone 'Asia/Jakarta')::date
         and nil.tanggal <  (p_end   at time zone 'Asia/Jakarta')::date),
    -- Dandori: max per jendela waktu, lalu dijumlah
    (select coalesce(sum(dandori_menit), 0) from batched_time),
    -- Downtime: dari downtime_log -- sumber & filter sama persis dengan
    -- performance_downtime_rows yang mengisi tabel "Rekap Downtime".
    (select coalesce(sum(extract(epoch from (dl.waktu_akhir - dl.waktu_awal)) / 60), 0)
       from public.downtime_log dl
      where dl.mesin = p_mesin
        and (p_stasiun_list is null or dl.stasiun = any(p_stasiun_list))
        and dl.waktu_awal >= p_start + interval '7 hours'
        and dl.waktu_awal <  p_end   + interval '7 hours'),
    -- Break: max per jendela waktu, lalu dijumlah
    (select coalesce(sum(break_menit), 0) from batched_time),
    -- Jam kerja (menit) = total durasi baris produksi - break
    (select coalesce(sum(extract(epoch from (waktu_akhir - waktu_awal)) / 60), 0)
       - (select coalesce(sum(break_menit), 0) from batched_time)
     from batched_time),
    (select count(*) from rows_with_ratio),
    (select coalesce(sum(coalesce(qty, 0) * ratio * std_ct), 0)
       from rows_with_ratio where std_ct is not null and std_ct > 0),
    -- Repair: dari kolom production_log.repair (yang tampil di tabel
    -- "Produksi Hari Itu"), BUKAN dari tabel repair_log (menu Repair 3D).
    (select coalesce(sum(coalesce(repair, 0)), 0) from rows_with_ratio);
$$;

grant execute on function public.performance_aggregate(machine_type, text[], timestamptz, timestamptz) to authenticated;

-- =====================================================================
-- SELESAI. Buka ulang tab Performance (Ctrl+Shift+R).
-- Setelah ini, untuk 1 line + 1 tanggal yang sama:
--   Kartu Repair   = jumlah kolom Repair di tabel "Produksi Hari Itu"
--   Kartu Downtime = jumlah Total Losstime di tabel "Rekap Downtime"
--   Kartu NG       = jumlah NG Inline hari itu
-- =====================================================================


-- =====================================================================
-- BAGIAN 2 (opsional, tapi dianjurkan): masalah yang SAMA di KPI
-- dashboard bulanan.
--
-- dashboard_bulanan_produksi juga masih menjumlah kolom mati
-- production_log.downtime_menit, jadi Downtime-nya selalu 0 dan kartu
-- Availability-nya selalu 100%. Fungsi "saudara"-nya (tahunan & harian)
-- sudah lama memakai downtime_log -- jadi yang ini memang ketinggalan.
--
-- PERHATIAN: setelah menjalankan bagian ini, angka Availability di tab
-- Bulanan TIDAK lagi 100% -- dia jadi nilai sebenarnya. Itu bukan
-- kerusakan, tapi memang angka yang selama ini tidak pernah terhitung.
-- Kalau mau memeriksanya dulu, bagian ini boleh dijalankan belakangan.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.dashboard_bulanan_produksi(p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(bulan date, mesin machine_type, stroke numeric, ng numeric, wh_menit numeric, downtime_menit numeric, target_std_menit numeric)
 LANGUAGE sql
 STABLE
AS $function$
  with rows_with_ratio as (
    select
      (date_trunc('month', (pl.waktu_awal at time zone 'Asia/Jakarta') - interval '7 hours'))::date as bulan,
      pl.mesin, pl.stasiun, pl.waktu_awal, pl.waktu_akhir,
      coalesce(pl.qty, 0) * coalesce(pn.stroke_ratio, 1) as stroke,
      coalesce(pl.ng, 0) as ng,
      coalesce(pl.break_menit, 0) as break_menit,
      coalesce(pl.qty, 0) * coalesce(pn.stroke_ratio, 1) * coalesce(pn.std_ct, 0) as std_menit
    from public.production_log pl
    left join public.part_numbers pn
      on pn.mesin = pl.mesin and pn.value = pl.part_number
    where pl.waktu_awal >= p_start + interval '7 hours'
      and pl.waktu_awal <  p_end + interval '7 hours'
  ),
  batched_time as (
    select bulan, mesin, stasiun, waktu_awal, waktu_akhir,
           max(break_menit) as break_menit
    from rows_with_ratio
    group by bulan, mesin, stasiun, waktu_awal, waktu_akhir
  )
  select
    r.bulan,
    r.mesin,
    sum(r.stroke) as stroke,
    sum(r.ng) as ng,
    (select coalesce(sum(extract(epoch from (waktu_akhir - waktu_awal)) / 60), 0)
       - coalesce(sum(break_menit), 0)
     from batched_time bt where bt.bulan = r.bulan and bt.mesin = r.mesin) as wh_menit,
    -- Downtime: dari downtime_log, bucket bulannya memakai rumus yang
    -- sama persis dengan baris produksi di atas.
    (select coalesce(sum(extract(epoch from (dl.waktu_akhir - dl.waktu_awal)) / 60), 0)
       from public.downtime_log dl
      where dl.mesin = r.mesin
        and (date_trunc('month', (dl.waktu_awal at time zone 'Asia/Jakarta') - interval '7 hours'))::date = r.bulan
        and dl.waktu_awal >= p_start + interval '7 hours'
        and dl.waktu_awal <  p_end + interval '7 hours') as downtime_menit,
    sum(r.std_menit) as target_std_menit
  from rows_with_ratio r
  group by r.bulan, r.mesin
  order by r.bulan, r.mesin;
$function$;

grant execute on function public.dashboard_bulanan_produksi(timestamptz, timestamptz) to authenticated;
