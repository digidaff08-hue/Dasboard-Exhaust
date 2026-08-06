-- =========================================================
-- MIGRATION: Tambah Jenis Non-Produksi (kode) untuk semua 6 line
-- Menambah, TIDAK menghapus/mengubah jenis yang sudah ada
-- (Agenda Perusahaan, Meeting Awal, Meeting Akhir, 5S, Equipment,
-- SPM, Watari) -- itu tetap ada, ini cuma nambah baris baru.
-- Aman dijalankan berulang (on conflict -> tidak dobel).
-- =========================================================

insert into public.nonproduksi_types (mesin, nama)
select m.mesin, t.nama
from (values
  ('E-02'::machine_type), ('E-03'::machine_type), ('E-04'::machine_type),
  ('E-05'::machine_type), ('E-06'::machine_type), ('E-07'::machine_type)
) as m(mesin)
cross join (values
  ('A'), ('B'), ('B1'), ('C'), ('E'), ('F'), ('G'), ('G1'),
  ('H'), ('J'), ('K'), ('L'), ('S'), ('X'), ('M'), ('N'), ('Q')
) as t(nama)
on conflict (mesin, nama) do nothing;

-- =========================================================
-- SELESAI. Cek di Table Editor > nonproduksi_types.
-- Total baris sekarang harus 24 x 6 line = 144
-- (7 jenis lama + 17 kode baru = 24 jenis per line).
-- =========================================================
