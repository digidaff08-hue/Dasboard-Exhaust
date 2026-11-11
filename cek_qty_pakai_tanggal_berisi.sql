-- =========================================================
-- Lanjutan pemeriksaan setelah migration_qty_tanpa_stroke_ratio.sql
-- dijalankan.
--
-- Hasil 0 vs 0 kemarin belum membuktikan apa pun -- tanggal itu memang
-- belum ada baris produksinya, jadi dua-duanya nol apa pun rumusnya.
-- Perbandingannya harus dipakai di tanggal yang BENAR-BENAR ada isinya.
--
-- Tidak mengubah apa pun. Jalankan A, B, lalu C.
-- =========================================================


-- ---------------------------------------------------------
-- A) Apakah "× stroke_ratio" tadi berpengaruh sama sekali?
--    Ini pertanyaan paling penting dan belum terjawab.
--
--    ratio_bukan_1 = 0  -> tidak ada satu angka pun yang berubah.
--                          Perjam Aktual & OEE aman, tidak perlu set
--                          ulang target apa pun di Master Data.
--    ratio_bukan_1 > 0  -> Perjam Aktual ikut bergeser; target Perjam
--                          mode "fixed" harus diisi ulang dalam pcs/jam.
--                          Tolong kabari saya kalau hasilnya begini.
-- ---------------------------------------------------------
select
  count(*)                                               as total_part,
  count(*) filter (where coalesce(stroke_ratio, 1) <> 1) as ratio_bukan_1
from public.part_numbers;


-- ---------------------------------------------------------
-- B) Cari tanggal & line yang ADA produksinya, buat bahan uji.
--    Ambil salah satu baris teratas, pakai di query C.
-- ---------------------------------------------------------
select
  (pl.waktu_awal at time zone 'Asia/Jakarta')::date as tanggal,
  pl.mesin,
  count(*)                      as jumlah_baris,
  sum(coalesce(pl.qty, 0))      as total_qty
from public.production_log pl
where pl.part_number is not null
group by 1, 2
having sum(coalesce(pl.qty, 0)) > 0
order by 1 desc, 2
limit 20;


-- ---------------------------------------------------------
-- C) Bandingkan Qty Performance vs Aktual Plan Harian.
--    GANTI dua nilai di baris "param" saja, pakai hasil dari B.
--    Dua kolom hasilnya HARUS sama. Kalau beda, kirim angkanya ke saya.
-- ---------------------------------------------------------
with param as (
  select '2026-10-05'::date as tgl, 'E-02'::machine_type as mesin   -- <-- GANTI DI SINI
)
select
  p.tgl,
  p.mesin,
  (select pa.stroke
     from public.performance_aggregate(
            p.mesin, null,
            (p.tgl::timestamp at time zone 'Asia/Jakarta'),
            ((p.tgl + 1)::timestamp at time zone 'Asia/Jakarta')
          ) pa
  ) as qty_performance,
  (select coalesce(sum(a.qty_aktual), 0)
     from public.plan_produksi_actual(p.tgl) a
    where a.mesin = p.mesin
  ) as qty_plan_harian
from param p;
