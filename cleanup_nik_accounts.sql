-- =========================================================
-- HAPUS 9 akun NIK yang bermasalah (dibuat langsung lewat SQL,
-- ternyata bikin error 500 pas login). Aman dijalankan --
-- yang kehapus cuma akun @karyawan.local, akun lain tidak kesentuh.
-- =========================================================

delete from auth.identities
where user_id in (select id from auth.users where email like '%@karyawan.local');

delete from auth.users
where email like '%@karyawan.local';

-- profiles otomatis ikut kehapus (relasi cascade) -- cek harus 0 baris:
select count(*) as sisa_akun_karyawan
from auth.users where email like '%@karyawan.local';

-- =========================================================
-- SELESAI. Lanjut daftar ulang lewat tombol "Daftar di sini"
-- di halaman login (bukan lewat SQL lagi).
-- =========================================================
