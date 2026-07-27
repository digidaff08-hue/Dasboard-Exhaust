-- =========================================================
-- SEED: Jenis Non-Produksi (dropdown tab Dandori)
-- Berlaku sama untuk semua 6 line Welding (E-02..E-07).
-- Aman dijalankan berulang (on conflict -> tidak dobel).
-- =========================================================

insert into public.nonproduksi_types (mesin, nama)
select m.mesin, t.nama
from (values
  ('E-02'::machine_type), ('E-03'::machine_type), ('E-04'::machine_type),
  ('E-05'::machine_type), ('E-06'::machine_type), ('E-07'::machine_type)
) as m(mesin)
cross join (values
  ('Agenda Perusahaan'),
  ('Meeting Awal'),
  ('Meeting Akhir'),
  ('5S'),
  ('Equipment'),
  ('SPM'),
  ('Watari')
) as t(nama)
on conflict (mesin, nama) do nothing;

-- =========================================================
-- SELESAI. Cek di Table Editor > nonproduksi_types -- harus ada
-- 42 baris (7 jenis x 6 line).
-- =========================================================
