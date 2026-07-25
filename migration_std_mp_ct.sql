-- =========================================================
-- MIGRASI: Std Manpower & Std CT (Cycle Time) di Master Data Part Number
-- SPM (Stroke Per Menit) dihitung otomatis di app = 1 / std_ct
-- Jalankan sekali di Supabase SQL Editor
-- =========================================================

alter table public.part_numbers add column if not exists std_mp numeric;
alter table public.part_numbers add column if not exists std_ct numeric; -- menit per stroke

-- Rasio Stroke sebenarnya per part (Output x Separating dari sheet CT TIME).
-- STROKE SEBENARNYA (utk GSPH) = qty (Count Stroke) x stroke_ratio.
-- Default 1 = part normal (bukan bagian dari part "separating"/pairing).
alter table public.part_numbers add column if not exists stroke_ratio numeric not null default 1;

-- =========================================================
-- SELESAI. Kolom std_mp, std_ct, stroke_ratio siap dipakai di Master Data.
-- =========================================================
