-- =========================================================
-- MIGRATION: Rename label Titik -> Point + seed Kategori Repair
-- Jalankan sekali setelah migration_repair_v1.sql
-- Aman dijalankan berulang.
-- =========================================================

-- Ganti label titik placeholder ("Titik 1".."Titik 5") jadi ("Point A".."Point E")
update public.repair_points set label = 'Point A' where label = 'Titik 1';
update public.repair_points set label = 'Point B' where label = 'Titik 2';
update public.repair_points set label = 'Point C' where label = 'Titik 3';
update public.repair_points set label = 'Point D' where label = 'Titik 4';
update public.repair_points set label = 'Point E' where label = 'Titik 5';

-- Seed Kategori Repair
insert into public.repair_kategori (value) values
  ('Beadlas'),
  ('Bolong <2.0mm'),
  ('Bocor'),
  ('Undercut'),
  ('Keropos'),
  ('Scratch/ Dakon'),
  ('Akurasi (Mentok)'),
  ('Ulir Nut Macet'),
  ('Dll')
on conflict (value) do nothing;

-- =========================================================
-- SELESAI.
-- =========================================================
