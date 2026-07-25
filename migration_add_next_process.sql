-- =========================================================
-- MIGRASI: Proses Selanjutnya (Next Process) di master Part Number
-- Dasar untuk integrasi stock antar line. Jalankan sekali di
-- Supabase SQL Editor.
-- =========================================================

alter table public.part_numbers add column if not exists next_line machine_type;
alter table public.part_numbers add column if not exists next_part_number text;

-- =========================================================
-- SELESAI. Tabel part_numbers sekarang punya kolom next_line dan
-- next_part_number, diisi lewat tab Master Data di app (Edit part
-- number -> pilih Proses Selanjutnya).
-- =========================================================
