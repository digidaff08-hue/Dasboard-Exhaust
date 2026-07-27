-- =========================================================
-- MIGRATION v3: Cascading Dropdown (PIC -> Problem Kategori -> Problem Detail)
-- Aman dijalankan sekali di atas migration_downtime_format_v2.sql yang sudah ada.
-- =========================================================

-- Problem Kategori sekarang nempel ke PIC tertentu
alter table public.downtime_problems
  add column if not exists pic text;

-- Problem Detail sekarang nempel ke Problem Kategori tertentu
alter table public.downtime_causes
  add column if not exists problem_kategori text;

-- Ganti unique constraint downtime_causes: dulu (mesin, value),
-- sekarang (mesin, problem_kategori, value) -- karena detail text yang sama
-- ("solenoid valve rusak", dst) muncul di beberapa Problem Kategori berbeda.
alter table public.downtime_causes
  drop constraint if exists downtime_causes_mesin_value_key;
alter table public.downtime_causes
  add constraint downtime_causes_mesin_kategori_value_key unique (mesin, problem_kategori, value);

-- =========================================================
-- SELESAI. Lanjut jalankan seed_downtime_master.sql
-- =========================================================
