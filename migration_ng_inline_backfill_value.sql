-- =========================================================
-- BACKFILL: isi kolom `value` untuk data NG Inline LAMA
-- (yang diinput SEBELUM fitur Value ada, jadi value-nya masih 0).
--
-- Jalankan file ini SETELAH migration_ng_inline_isi_harga_area.sql
-- (harga per Area harus sudah terisi dulu, baru backfill ini jalan).
--
-- Aman dijalankan berkali-kali: hanya menyentuh baris yang
-- value-nya masih 0/kosong, jadi tidak akan menimpa data yang
-- sudah benar (termasuk yang harganya kebetulan memang 0).
-- =========================================================

update public.ng_inline_log as l
set value = l.qty * a.harga
from public.ng_model_areas as a
where a.mesin = l.mesin
  and a.area = l.area
  and a.ng_proses = l.ng_proses
  and (l.value = 0 or l.value is null);

-- =========================================================
-- Cek hasil: baris NG Inline yang MASIH 0 setelah backfill.
-- Kalau ada baris muncul di sini, penyebabnya biasanya salah satu:
--   a) Harga di ng_model_areas untuk Area itu memang masih 0
--      (belum diisi) -> cek & isi dulu harganya.
--   b) Kombinasi mesin+area+ng_proses di baris lama itu sudah
--      tidak ada lagi di ng_model_areas (misal Area-nya pernah
--      diubah/dihapus dari master) -> perlu dicek manual satu-satu.
-- =========================================================
select l.id, l.mesin, l.tanggal, l.model, l.area, l.ng_proses, l.qty, l.value
from public.ng_inline_log l
where l.value = 0
order by l.tanggal desc;
