-- Diagnostik: bandingkan akun NIK baru vs akun admin lama yang SUDAH BISA login
select
  email,
  instance_id,
  confirmed_at,
  email_confirmed_at,
  (encrypted_password is not null and encrypted_password <> '') as ada_password,
  aud,
  role
from auth.users
where email like '%@karyawan.local' or email = 'digidaff08@gmail.com'
order by email;
