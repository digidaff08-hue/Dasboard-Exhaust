-- =========================================================
-- Migration Repair v5 -- Tampilan Awal Kamera (manual, per part)
-- Jalankan SEKALI setelah migration_repair_v4_point_normals.sql
-- =========================================================
-- Kolom ini nyimpen posisi & arah kamera yang DIATUR MANUAL lewat
-- tombol "Atur Tampilan Awal" di tab Repair (Mode Edit Point section).
-- Formatnya JSON: { "pos": [x,y,z], "up": [x,y,z] }
-- - "pos"  = posisi kamera (koordinat asli STL, relatif ke titik
--            tengah part / bbox center, sama seperti titik Repair).
-- - "up"   = arah "atas" kamera saat itu disimpan (perlu disimpan
--            terpisah karena TrackballControls muterin arah atas juga,
--            bukan cuma posisi).
-- Kalau kolom ini NULL/kosong untuk suatu part, tampilan default balik
-- ke perhitungan otomatis (diagonal) seperti sebelumnya -- jadi part
-- lama yang belum diatur manual tetap aman, tidak error.
alter table public.repair_views
  add column if not exists default_camera jsonb;
