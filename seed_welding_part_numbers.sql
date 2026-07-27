-- =========================================================
-- SEED: Part Number + Std Cycle Time (Welding)
-- Cycle Time sumber dalam DETIK -> dikonversi ke MENIT (dibagi 60)
-- karena kolom part_numbers.std_ct satuannya menit/stroke.
-- Aman dijalankan berulang (on conflict -> update std_ct).
-- =========================================================

insert into public.part_numbers (mesin, value, std_ct) values
  ('E-02', '14110-52P00',   105   / 60.0),
  ('E-02', '14110-73R10',   119   / 60.0),
  ('E-02', '14110-73R20',   119   / 60.0),
  ('E-02', '14110-74U00',   113   / 60.0),
  ('E-03', '25051-BZ060',   102.9 / 60.0),
  ('E-03', '25051-BZ260',   102.9 / 60.0),
  ('E-05', '25051-0Y050',   102.9 / 60.0),
  ('E-05', '25051-0Y060',   102.9 / 60.0),
  ('E-06', '25051-BZ140',   102.9 / 60.0),
  ('E-05', '25051-BZ140-T', 102.9 / 60.0),
  ('E-04', '25051-BZ150-T', 102.9 / 60.0),
  ('E-06', '25051-BZ110',   105   / 60.0),
  ('E-06', '25051-BZ010',   105   / 60.0),
  ('E-06', '25051-BZ180',   105   / 60.0),
  ('E-07', '14110-74U50',   92    / 60.0)
on conflict (mesin, value) do update
  set std_ct = excluded.std_ct;

-- =========================================================
-- SELESAI. Cek di Table Editor > part_numbers -- 15 baris di atas
-- harus muncul dengan std_ct dalam menit (mis. 14110-52P00 -> 1.75).
-- stroke_ratio default 1, harga_pcs & std_mp masih kosong -- isi
-- lewat tab Master Data di app kalau/saat datanya sudah ada.
-- =========================================================
