-- =========================================================
-- MIGRATION: Kolom "jabatan" di profiles
-- Tujuan: badge di pojok kiri bawah sekarang nampilin jabatan asli
-- (BIG BOSS / FOREMAN / LEADER), bukan cuma role sistem
-- (admin/leader/operator) yang dipakai buat hak akses.
-- Aman dijalankan berulang.
-- =========================================================

-- 1. Kolom jabatan (nullable -- kalau kosong, tampilan fallback ke role)
alter table public.profiles add column if not exists jabatan text;

-- 2. Set role + jabatan buat 8 karyawan berikut.
--    Cocokin berdasarkan full_name (harus SAMA PERSIS dengan nama yang
--    diisi pas Daftar di login.html -- huruf besar/kecil tidak masalah,
--    tapi spasi & ejaan harus pas). Kalau orangnya belum daftar,
--    baris terkait tidak akan ke-update apa-apa -- jalankan lagi
--    migration ini setelah mereka daftar.
update public.profiles set role = 'leader', jabatan = 'BIG BOSS'
where lower(trim(full_name)) in ('sri hartono', 'jumadi');

update public.profiles set role = 'leader', jabatan = 'FOREMAN'
where lower(trim(full_name)) in ('teguh santoso');

update public.profiles set role = 'leader', jabatan = 'LEADER'
where lower(trim(full_name)) in (
  'iin fajrin munir',
  'agus wibowo',
  'asep supriatna',
  'davit aristiyanto',
  'lamijo'
);

-- Cek hasilnya
select full_name, role, jabatan, nik
from public.profiles
where lower(trim(full_name)) in (
  'sri hartono', 'jumadi', 'teguh santoso',
  'iin fajrin munir', 'agus wibowo', 'asep supriatna',
  'davit aristiyanto', 'lamijo'
)
order by jabatan, full_name;

-- =========================================================
-- SELESAI.
-- Kalau ke-8 orang ini BELUM pernah daftar akun:
--   1. Buka login.html -> klik "Daftar di sini"
--   2. Isi Nama Lengkap (harus sama persis dengan nama di atas),
--      NIK, Email asli, Password
--   3. Setelah semua 8 orang selesai daftar, jalankan lagi file
--      migration ini di Supabase SQL Editor supaya role & jabatan
--      ke-set dengan benar (defaultnya waktu daftar role='operator'
--      dan jabatan kosong).
-- =========================================================
