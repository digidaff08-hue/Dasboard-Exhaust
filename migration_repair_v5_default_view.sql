-- =========================================================
-- MIGRATION: Sudut kamera default per part (tombol "Simpan Sudut Ini")
-- Jalankan sekali setelah migration_repair_v4_point_normals.sql
-- Aman dijalankan berulang.
--
-- Kegunaan: admin/leader bisa putar model 3D ke sudut yang paling enak
-- dilihat (mis. tampak dari atas/depan part), lalu klik "Simpan Sudut
-- Ini" di tab Repair -- sudut itu jadi tampilan AWAL default buat semua
-- orang setiap kali form Repair dibuka, bukan hasil tebakan komputer.
-- =========================================================

alter table public.repair_views
  add column if not exists cam_dir_x numeric,
  add column if not exists cam_dir_y numeric,
  add column if not exists cam_dir_z numeric;

-- =========================================================
-- SELESAI. Kalau kolom ini masih kosong (belum pernah disimpan admin),
-- app otomatis pakai sudut umum sederhana sebagai tampilan awal.
-- =========================================================
