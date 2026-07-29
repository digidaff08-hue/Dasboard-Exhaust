-- =========================================================
-- MIGRATION: Tambah Part No di popup Repair (sebelum kolom Qty)
-- Jalankan sekali setelah migration_repair_v4_point_normals.sql
-- Aman dijalankan berulang.
--
-- Kegunaan: setiap data Repair (klik titik -> isi popup) sekarang
-- juga mencatat Part Number-nya, dipilih dari dropdown Part Number
-- line tersebut (tabel part_numbers, sama seperti di Input Produksi).
-- Data Repair LAMA yang belum punya part_number tetap jalan --
-- kolomnya akan kosong ("-") untuk baris lama.
-- =========================================================

alter table public.repair_log
  add column if not exists part_number text;

-- =========================================================
-- SELESAI. Tidak perlu isi data apapun untuk baris lama.
-- Data Repair baru wajib pilih Part Number lewat popup.
-- =========================================================
