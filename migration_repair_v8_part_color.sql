-- =========================================================
-- MIGRATION: Warna custom per Part 3D (Repair)
-- Jalankan sekali setelah migration_repair_v7_fix_delete.sql
-- Aman dijalankan berulang.
--
-- File .stl (terutama dari Solid Edge) TIDAK menyimpan data warna
-- sama sekali -- warna yang kelihatan di software CAD cuma tampilan
-- default programnya, bukan data yang ikut ke-export. Makanya warna
-- part 3D sekarang bisa dipilih manual per part lewat aplikasi
-- (color picker), disimpan di kolom baru ini.
-- =========================================================

alter table public.repair_views
  add column if not exists color text not null default '#9aa4ad';

-- =========================================================
-- SELESAI. Part yang sudah ada otomatis abu-abu (default lama),
-- tinggal ganti warnanya lewat color picker di Master Data > Repair.
-- =========================================================
