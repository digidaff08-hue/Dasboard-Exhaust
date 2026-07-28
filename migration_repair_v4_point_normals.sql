-- =========================================================
-- MIGRATION: Tambah arah normal (nx, ny, nz) di repair_points
-- Jalankan sekali setelah migration_repair_v3_3d.sql
-- Aman dijalankan berulang.
--
-- Kegunaan: supaya Point yang ditandai di permukaan model 3D bisa
-- "ketutup" badan model dengan benar pas modelnya diputar ke sisi yang
-- membelakangi kamera (dulu Point selalu kelihatan nembus model).
-- Point LAMA yang belum punya nx/ny/nz tetap jalan -- app otomatis
-- pakai arah dari titik tengah part sebagai cadangan.
-- =========================================================

alter table public.repair_points
  add column if not exists nx numeric,
  add column if not exists ny numeric,
  add column if not exists nz numeric;

-- =========================================================
-- SELESAI. Tidak perlu isi data apapun -- Point baru yang ditambah
-- lewat "Mode Edit Point" otomatis menyimpan nx/ny/nz ke depannya.
-- =========================================================
