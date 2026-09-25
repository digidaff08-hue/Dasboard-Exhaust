-- =====================================================================
-- migration_viewer_guest.sql
-- Jalankan SETELAH migration_keamanan_login.sql. Aman dijalankan ulang.
--
-- 1. Role baru "viewer": karyawan yang masuk lewat tab Karyawan (NIK)
--    dan hanya bisa membuka Dashboard Exhaust + Attendance.
-- 2. JUMADI (130713) & SRI HARTONO (130714): bukan admin lagi -> viewer.
--    Password mereka dikembalikan ke 123456 seperti karyawan lain
--    (tadi ikut berubah jadi 000 waktu password semua admin diganti).
-- 3. Akun Guest = setyab605@gmail.com, password 000.
-- =====================================================================

begin;

-- 1) Izinkan role 'viewer'
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.profiles'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.profiles drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'leader', 'operator', 'viewer', 'guest'));

-- 2) JUMADI & SRI HARTONO -> viewer, password kembali 123456
update public.profiles
   set role = 'viewer'
 where nik in ('130713', '130714');

update auth.users
   set encrypted_password = extensions.crypt('123456', extensions.gen_salt('bf')),
       updated_at = now()
 where id in (select id from public.profiles where nik in ('130713', '130714'));

-- 3) Guest = setyab605@gmail.com, password 000
update public.profiles
   set role = 'guest'
 where id = (select id from auth.users where lower(email) = 'setyab605@gmail.com');

update auth.users
   set encrypted_password = extensions.crypt('000', extensions.gen_salt('bf')),
       updated_at = now()
 where lower(email) = 'setyab605@gmail.com';

-- Buka kunci percobaan login yang tadi sempat salah
delete from public.login_gagal where nik in ('#guest', '#admin', '130713', '130714');

commit;

-- Hasil: harus tampil Abdul (admin), JUMADI & SRI HARTONO (viewer),
-- dan 1 baris guest dengan email setyab605@gmail.com.
-- Kalau baris guest TIDAK muncul, email itu belum terdaftar: buat dulu di
-- Authentication > Users > Add user (centang Auto Confirm User), lalu
-- jalankan file ini sekali lagi.
select p.full_name, p.role, p.nik, u.email
  from public.profiles p
  join auth.users u on u.id = p.id
 where lower(p.role) in ('admin', 'viewer', 'guest')
 order by p.role, p.full_name;
