-- =========================================================
-- MIGRATION: Point Repair jadi GARIS LAS (bukan cuma titik bola)
-- Jalankan sekali setelah migration_repair_v8_part_color.sql
-- Aman dijalankan berulang (pakai IF NOT EXISTS).
--
-- Konsep baru: admin bisa gambar Point dengan cara TAHAN & SERET
-- (drag) menyusuri jalur las di permukaan model 3D -- hasilnya
-- disimpan sebagai SERANGKAIAN koordinat (path/jalur), bukan cuma
-- 1 titik (x,y,z) tunggal seperti sebelumnya.
--
-- - Kolom "path" (jsonb): array titik [{x,y,z}, ...] menyusuri
--   jalur las, dalam ruang koordinat asli file STL yang sama
--   dengan kolom x/y/z yang sudah ada.
-- - Kolom x/y/z LAMA tetap dipakai sebagai titik "wakil" (dari
--   tengah jalur) -- supaya kode lama yang belum tahu soal "path"
--   tetap jalan tanpa error.
-- - Point LAMA yang belum punya path (path IS NULL / kosong) tetap
--   ditampilkan sebagai bola merah kecil seperti sebelumnya --
--   TIDAK ada data yang hilang atau perlu dimigrasi manual.
-- - Point BARU yang ditambah lewat drag-menyusuri garis las otomatis
--   tampil sebagai garis merah tipis menyusuri bentuk las-nya.
-- =========================================================

alter table public.repair_points
  add column if not exists path jsonb;

comment on column public.repair_points.path is
  'Array titik [{x,y,z}, ...] menyusuri garis las (koordinat lokal STL). NULL = Point lama bentuk titik/bola tunggal.';

-- =========================================================
-- SELESAI. Di tab Master Data > Repair, aktifkan "Mode Edit Point"
-- lalu TAHAN & SERET kursor/jari menyusuri jalur las di permukaan
-- model -- lepas di ujungnya, jalurnya otomatis dihaluskan jadi
-- garis merah dan tersimpan sebagai 1 Point baru.
-- =========================================================
