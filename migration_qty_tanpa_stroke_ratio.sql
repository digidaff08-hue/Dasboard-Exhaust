-- =========================================================
-- Qty di tab Performance = jumlah pcs mentah, TANPA dikali stroke_ratio
-- supaya sama dengan angka Aktual di tab Plan Harian.
--
-- Jalankan sekali di Supabase SQL Editor. Aman diulang (replace function).
--
-- CARA FILE INI DIBUAT -- penting:
-- Isi fungsi di bawah BUKAN salinan dari file migration lama mana pun.
-- Definisi yang hidup di database ternyata LEBIH BARU dari semua file di
-- repo (NG sudah dari ng_inline_log + ng_waktu_kejadian, downtime sudah
-- dari downtime_log, repair sudah dari production_log.repair). Jadi
-- definisi hidup itu disalin apa adanya, lalu HANYA dua baris yang
-- diubah. Kalau ditimpa pakai file lama, perbaikan NG/downtime/repair
-- itu semua hilang.
--
-- YANG BERUBAH -- cuma 2 baris, ditandai "<-- DIUBAH" di bawah:
--   1. stroke           : sum(qty * ratio)           -> sum(qty)
--   2. target_std_menit : sum(qty * ratio * std_ct)  -> sum(qty * std_ct)
--
-- target_std_menit IKUT dicabut ratio-nya. Ini wajib, bukan pilihan:
-- target Perjam mode "per_part" dihitung stroke / (target_std_menit/60).
-- Kalau cuma stroke yang dicabut, pembilang jadi pcs sedangkan penyebut
-- masih stroke -- target Perjam, Performance factor, dan OEE jadi salah.
--
-- YANG TIDAK DISENTUH: NG, nilai NG, dandori, downtime, break, jam kerja,
-- jumlah baris, repair. Semua dibiarkan persis seperti sekarang.
--
-- EFEK SAMPING YANG PERLU DICEK SETELAH JALAN:
-- Kolom "stroke" bukan cuma mengisi kartu Qty -- dia juga pembagi
-- Perjam Aktual (stroke / jam kerja). Kalau ada part yang stroke_ratio-nya
-- BUKAN 1, maka Perjam Aktual ikut berubah, dan target Perjam yang
-- diset manual di Master Data (mode "fixed", kolom gsph_target_fixed)
-- harus diisi ulang dalam satuan pcs/jam -- kalau tidak, OEE jadi salah.
-- Kalau semua stroke_ratio = 1 (kemungkinan besar, karena kolom itu tidak
-- bisa diisi dari menu mana pun), tidak ada angka yang berubah sama
-- sekali -- perubahan ini cuma mengunci supaya tetap sama ke depannya.
-- Query pengecekannya ada di bawah fungsi ini.
-- =========================================================

CREATE OR REPLACE FUNCTION public.performance_aggregate(
  p_mesin machine_type,
  p_stasiun_list text[],
  p_start timestamp with time zone,
  p_end timestamp with time zone
)
RETURNS TABLE(
  stroke numeric, ng numeric, ng_value numeric, dandori_menit numeric,
  downtime_menit numeric, break_menit numeric, wh_menit numeric,
  jumlah_baris bigint, target_std_menit numeric, repair_qty numeric
)
LANGUAGE sql
STABLE
AS $function$
  -- Nama CTE "rows_with_ratio" & kolom "ratio" sengaja DIBIARKAN walau
  -- ratio-nya sudah tidak dipakai lagi, supaya bedanya dengan definisi
  -- lama cuma 2 baris dan gampang dibandingkan. Join ke part_numbers
  -- tetap perlu untuk std_ct.
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
  ),
  -- NG hari produksi ini: jendela waktunya SAMA PERSIS dengan baris
  -- produksi di atas (p_start/p_end digeser +7 jam), cuma sumbernya
  -- jam kejadian NG, bukan kolom tanggal yang diketik operator.
  ng_shift as (
    select nil.qty, nil.value
    from public.ng_inline_log nil
    where nil.mesin = p_mesin
      and public.ng_waktu_kejadian(nil.waktu_kejadian, nil.tanggal, nil.jam)
            >= p_start + interval '7 hours'
      and public.ng_waktu_kejadian(nil.waktu_kejadian, nil.tanggal, nil.jam)
            <  p_end   + interval '7 hours'
  )
  select
    -- Qty = jumlah pcs apa adanya, TIDAK dikali stroke_ratio, supaya sama
    -- dengan kolom Aktual di tab Plan Harian (plan_produksi_actual juga
    -- memakai sum(qty) mentah).
    (select coalesce(sum(coalesce(qty, 0)), 0) from rows_with_ratio),          -- <-- DIUBAH
    -- NG & nilai NG: dari ng_inline_log, dibagi per HARI PRODUKSI
    (select coalesce(sum(qty), 0)   from ng_shift),
    (select coalesce(sum(value), 0) from ng_shift),
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
    -- Ratio ikut dicabut di sini juga -- lihat penjelasan di kepala file.
    (select coalesce(sum(coalesce(qty, 0) * std_ct), 0)                        -- <-- DIUBAH
       from rows_with_ratio where std_ct is not null and std_ct > 0),
    -- Repair: dari kolom production_log.repair (yang tampil di tabel
    -- "Produksi Hari Itu"), BUKAN dari tabel repair_log (menu Repair 3D).
    (select coalesce(sum(coalesce(repair, 0)), 0) from rows_with_ratio);
$function$;

grant execute on function public.performance_aggregate(machine_type, text[], timestamptz, timestamptz) to authenticated;


-- =========================================================
-- CEK SETELAH DIJALANKAN
-- =========================================================

-- 1) Apakah ada part yang stroke_ratio-nya bukan 1?
--    Kalau ratio_bukan_1 = 0 -> tidak ada satu angka pun yang berubah,
--    Perjam Aktual & OEE aman, tidak perlu set ulang target apa pun.
--    Kalau > 0 -> cek Perjam Aktual & target Perjam di Master Data.
select
  count(*)                                               as total_part,
  count(*) filter (where coalesce(stroke_ratio, 1) <> 1) as ratio_bukan_1
from public.part_numbers;

-- 2) Bandingkan Qty Performance vs Aktual Plan Harian untuk satu line &
--    satu hari. Kolom qty_performance dan qty_plan_harian HARUS sama.
--    Ganti tanggal & mesin sesuai kebutuhan.
select
  (select stroke
     from public.performance_aggregate(
       'E-02'::machine_type, null,
       ('2026-10-24'::timestamp at time zone 'Asia/Jakarta'),
       ('2026-10-25'::timestamp at time zone 'Asia/Jakarta'))
  ) as qty_performance,
  (select coalesce(sum(qty_aktual), 0)
     from public.plan_produksi_actual('2026-10-24'::date)
    where mesin = 'E-02'::machine_type
  ) as qty_plan_harian;


-- =========================================================
-- CARA MENGEMBALIKAN kalau ternyata tidak cocok:
-- jalankan lagi fungsi di atas dengan dua baris bertanda "<-- DIUBAH"
-- dikembalikan jadi:
--   (select coalesce(sum(coalesce(qty, 0) * ratio), 0) from rows_with_ratio),
--   (select coalesce(sum(coalesce(qty, 0) * ratio * std_ct), 0)
--      from rows_with_ratio where std_ct is not null and std_ct > 0),
-- =========================================================
