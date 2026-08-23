-- =========================================================
-- MIGRATION: Perbaikan performa query tabel production_log_new
-- (dipakai tab "Input Produksi" / Riwayat Input Produksi).
--
-- Latar belakang: query utama tab ini (fetchProduksiNew di
-- machine-page.js) sudah punya index yang PAS dari migration lama
-- (idx_production_log_new_mesin_waktu), jadi kalau lemot padahal
-- index ini sudah ada, kemungkinan besar penyebabnya statistik tabel
-- yang basi (belum di-ANALYZE) atau koneksi/network -- bukan index.
-- Migration ini:
--   1. Mastiin index utama itu beneran ada (aman dijalankan berkali-kali).
--   2. Nambah index buat trigger validasi Downtime (link_and_validate_downtime)
--      yang query-nya butuh kolom waktu_akhir juga, belum ke-cover index lama.
--   3. Refresh statistik tabel (ANALYZE) -- WAJIB dijalankan kalau baris
--      di tabel ini sudah banyak bertambah sejak awal dibuat, karena planner
--      Postgres butuh statistik terbaru buat milih rencana query paling cepat.
--
-- Aman dijalankan berkali-kali (pakai IF NOT EXISTS / idempotent).
-- =========================================================

-- 1. Pastikan index utama (mesin + waktu_awal, buat Riwayat Input Produksi) ada
create index if not exists idx_production_log_new_mesin_waktu
  on public.production_log_new (mesin, waktu_awal desc);

-- 2. Index tambahan buat trigger validasi Downtime (link_and_validate_downtime),
--    yang nyari baris production_log_new dgn: mesin = ... AND waktu_awal <= ...
--    AND waktu_akhir >= ... -- index lama cuma nge-cover mesin+waktu_awal,
--    waktu_akhir-nya masih full-scan tanpa ini.
create index if not exists idx_production_log_new_mesin_waktu_akhir
  on public.production_log_new (mesin, waktu_akhir);

-- 3. Refresh statistik planner (murah & aman, gak mengunci tabel lama-lama)
analyze public.production_log_new;

-- =========================================================
-- SELESAI.
-- Cek cepat kalau masih lemot setelah ini (jalankan di SQL Editor):
--
--   explain analyze
--   select * from production_log_new
--   where mesin = 'E-02'
--   order by waktu_awal desc
--   limit 500;
--
-- Kalau baris paling atas hasilnya "Index Scan using
-- idx_production_log_new_mesin_waktu" dan "Execution Time"-nya kecil
-- (< 100ms), berarti query-nya sendiri sudah cepat -- kalau di aplikasi
-- masih kerasa lemot 30 detik, penyebabnya BUKAN index/database lagi,
-- tapi kemungkinan koneksi internet/latency ke Supabase, atau ada proses
-- lain (mis. sync offline queue) yang keblokir/nunggu duluan.
-- =========================================================
