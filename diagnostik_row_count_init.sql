-- =========================================================
-- DIAGNOSTIK: cek berapa banyak baris di tabel-tabel yang dimuat
-- otomatis pas buka halaman mesin (Promise.all di init()).
-- Jalankan di SQL Editor Supabase -- aman, cuma SELECT (baca doang).
--
-- Ganti 'E-04' di bawah sesuai mesin yang kerasa lambat.
-- =========================================================

select 'production_log' as tabel, count(*) as jumlah_baris
from production_log where mesin = 'E-04'
union all
select 'downtime_log', count(*) from downtime_log where mesin = 'E-04'
union all
select 'dandori_log', count(*) from dandori_log where mesin = 'E-04'
union all
select 'production_log_new', count(*) from production_log_new where mesin = 'E-04'
union all
-- INI YANG PALING DICURIGAI -- fetchNgInline() SEBELUM ini gak dibatasi
-- sama sekali, jadi kalau baris di sini sudah banyak (ribuan+), itu yang
-- bikin loading lama. Sudah saya kasih limit(500) di kodenya.
select 'ng_inline_log', count(*) from ng_inline_log where mesin = 'E-04'
union all
select 'repair_points (semua part di mesin ini)', count(*)
  from repair_points where view_id in (select id from repair_views where mesin = 'E-04')
union all
select 'repair_log', count(*) from repair_log where mesin = 'E-04'
order by jumlah_baris desc;

-- =========================================================
-- Cara baca hasilnya:
-- - Kalau salah satu baris jumlahnya JAUH lebih besar dari yang lain
--   (misal ribuan, sementara yang lain cuma ratusan), itu kandidat kuat
--   penyebab lambat -- apalagi kalau query buat tabel itu TIDAK dibatasi
--   limit() di kodenya (sudah saya cek: cuma ng_inline_log yang begitu,
--   sudah saya kasih limit(500) di machine-page.js).
-- - Kalau semua angkanya wajar (ratusan ke bawah) tapi tetap lambat,
--   besar kemungkinan bukan soal jumlah data lagi, tapi koneksi
--   internet/latency ke Supabase.
-- =========================================================
