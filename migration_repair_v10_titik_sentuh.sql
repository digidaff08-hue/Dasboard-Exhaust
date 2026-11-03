-- =========================================================
-- Repair: simpan POSISI SENTUH leader pada model 3D
-- Jalankan sekali di Supabase SQL Editor. Aman diulang.
--
-- Isi: koordinat titik yang disentuh pada permukaan model
-- (koordinat lokal model, sama dengan titik area di repair_points).
-- Dipakai Dashboard Line untuk menampilkan titik sentuh, bukan
-- seluruh area.
-- Catatan lama (tanpa posisi sentuh) tetap tampil di tengah areanya.
-- =========================================================
alter table public.repair_log add column if not exists touch_x numeric;
alter table public.repair_log add column if not exists touch_y numeric;
alter table public.repair_log add column if not exists touch_z numeric;
