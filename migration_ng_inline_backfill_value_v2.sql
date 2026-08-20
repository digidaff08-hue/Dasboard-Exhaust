-- =========================================================
-- BACKFILL v2: perbaikan untuk baris yang Area-nya SUDAH TERISI
-- tapi gagal ke-backfill di migration_ng_inline_backfill_value.sql
-- (karena versi pertama nyocokin mesin+area+ng_proses sekaligus,
-- padahal teks ng_proses di data lama sudah tidak sama dengan yang
-- sekarang -- nama prosesnya sempat diedit di master data).
--
-- Versi ini cocokkan HANYA lewat Area (harga memang nempel di
-- Area, bukan ng_proses), jadi lebih longgar tapi tetap akurat.
--
-- Aman dijalankan berkali-kali, hanya menyentuh baris value=0.
-- =========================================================

-- 1) Backfill umum: cocokkan lewat Area saja.
update public.ng_inline_log as l
set value = l.qty * am.harga
from (select distinct area, harga from public.ng_model_areas) as am
where am.area = l.area
  and l.area is not null and l.area <> ''
  and (l.value = 0 or l.value is null);

-- 2) 2 baris khusus: Area-nya ditulis format lama/typo, jadi tidak
--    match persis dengan nama Area yang sekarang. Dicocokkan manual:
--      - "JIG 1 E05 889F" (E-05, proses "...0Y060") -> maksudnya
--        "JIG 1 B E05 889F" (kode 0Y060 = varian B, bukan A/0Y050)
--      - "JIG 10" (E-07) -> maksudnya "JIG 10 E07 YTB"
--        (satu-satunya "JIG 10" yang ada untuk mesin E-07)
update public.ng_inline_log as l
set value = l.qty * (select harga from public.ng_model_areas where area = 'JIG 1 B E05 889F' limit 1)
where l.id = 'b6122790-ccdd-4dea-8b4c-3ce8a9bf2923'
  and (l.value = 0 or l.value is null);

update public.ng_inline_log as l
set value = l.qty * (select harga from public.ng_model_areas where area = 'JIG 10 E07 YTB' limit 1)
where l.id = '9287647e-23ee-4c53-88a0-3e916170ecc1'
  and (l.value = 0 or l.value is null);

-- =========================================================
-- Cek hasil akhir: baris yang MASIH 0 setelah backfill v1 + v2 ini.
-- Yang tersisa di sini seharusnya HANYA baris dengan Area kosong
-- (data lama sebelum fitur dropdown Area ada, Mei-Sep 2025) --
-- itu memang tidak bisa di-backfill otomatis.
-- =========================================================
select l.id, l.mesin, l.tanggal, l.model, l.area, l.ng_proses, l.qty, l.value
from public.ng_inline_log l
where l.value = 0
order by l.tanggal desc;
