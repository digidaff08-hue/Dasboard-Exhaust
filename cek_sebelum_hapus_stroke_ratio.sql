-- =========================================================
-- CEK SEBELUM MENGHAPUS "× stroke_ratio" DI performance_aggregate
--
-- Permintaan: Qty di tab Performance harus sama dengan Aktual di Plan
-- Harian, yaitu jumlah pcs mentah, tanpa dikali stroke_ratio.
--
-- File ini TIDAK mengubah apa pun. Jalankan dua query di bawah dulu,
-- lalu kirim hasilnya -- baru migration penggantinya saya buatkan.
--
-- KENAPA TIDAK LANGSUNG DIGANTI:
-- performance_aggregate pernah ditulis ulang beberapa kali, dan dua
-- versi terakhir di repo SALING BERBEDA soal sumber angka NG:
--   - migration_fix_performance_ng_inline.sql  -> NG dari ng_inline_log
--   - migration_fix_performance_shift.sql      -> NG dari production_log.ng
-- Kalau saya timpa pakai tebakan versi yang salah, kartu NG dan OEE
-- Quality di SEMUA line (E-02..E-07) bisa balik jadi 0 tanpa ketahuan.
-- Jadi saya perlu lihat dulu isi fungsi yang BENAR-BENAR hidup di
-- database kamu, bukan menebak dari file.
-- =========================================================


-- ---------------------------------------------------------
-- QUERY 1 -- Apakah "× stroke_ratio" ini berpengaruh sama sekali?
--
-- stroke_ratio tidak bisa diisi dari menu Master Data mana pun, dan
-- seed-nya memasang nilai 1. Kalau SEMUA part ratio-nya 1, maka
-- qty × 1 = qty -- artinya angka Performance SEBENARNYA SUDAH SAMA
-- dengan Plan Harian, dan tidak ada yang perlu diubah.
--
-- Yang diharapkan: ratio_bukan_1 = 0
-- ---------------------------------------------------------
select
  count(*)                                                  as total_part,
  count(*) filter (where coalesce(stroke_ratio, 1) <> 1)    as ratio_bukan_1,
  min(coalesce(stroke_ratio, 1))                            as ratio_terkecil,
  max(coalesce(stroke_ratio, 1))                            as ratio_terbesar
from public.part_numbers;

-- Kalau ratio_bukan_1 > 0, tampilkan part mana saja:
select mesin, value as part_number, stroke_ratio
from public.part_numbers
where coalesce(stroke_ratio, 1) <> 1
order by mesin, value;


-- ---------------------------------------------------------
-- QUERY 2 -- Isi fungsi performance_aggregate yang SEKARANG hidup.
-- Salin seluruh hasilnya dan kirim ke chat. Dari situ saya buat
-- migration yang cuma mencabut "× ratio", tanpa menyentuh bagian
-- lain (NG, downtime, repair, wh_menit) yang sudah benar.
-- ---------------------------------------------------------
select pg_get_functiondef(p.oid) as definisi_sekarang
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'performance_aggregate';
