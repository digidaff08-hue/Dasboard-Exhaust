-- =========================================================
-- MIGRATION: Naikkan akses Teguh Santoso, Sri Hartono, Jumadi
-- jadi ADMIN (akses semua halaman).
--
-- Sebelumnya (lihat migration_jabatan.sql) ketiganya role-nya
-- 'operator' -- jabatan "FOREMAN"/"BIG BOSS" yang nempel cuma
-- tampilan badge di sidebar, BUKAN hak akses (operator cuma
-- bisa buka Input Attendance). Sekarang role-nya diubah jadi
-- 'admin' beneran supaya bisa buka semua halaman, termasuk
-- Data Mentah & Data Supporting yang khusus admin.
--
-- jabatan (FOREMAN/BIG BOSS) dibiarkan apa adanya -- itu cuma
-- label badge, tidak diubah di sini.
--
-- Dicocokkan berdasarkan full_name (harus sama persis dengan
-- nama yang diisi pas Daftar di login.html -- huruf besar/kecil
-- tidak masalah, tapi spasi & ejaan harus pas).
-- Aman dijalankan berulang.
-- =========================================================

update public.profiles
   set role = 'admin'
 where lower(trim(full_name)) in ('teguh santoso', 'sri hartono', 'jumadi');

-- Cek hasilnya -- ketiganya harus tampil role = admin
select full_name, role, jabatan, nik
  from public.profiles
 where lower(trim(full_name)) in ('teguh santoso', 'sri hartono', 'jumadi')
 order by full_name;

-- =========================================================
-- SELESAI.
-- Kalau salah satu baris TIDAK muncul di hasil cek di atas,
-- berarti orang itu belum pernah Daftar akun (full_name di
-- tabel profiles belum ada / beda ejaan) -- minta dia Daftar
-- dulu lewat login.html, lalu jalankan file ini sekali lagi.
-- =========================================================
