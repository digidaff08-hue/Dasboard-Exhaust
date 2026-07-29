-- Test: apakah hash password yang tersimpan itu BENAR cocok dengan "123456"?
select
  email,
  (encrypted_password = crypt('123456', encrypted_password)) as password_cocok_123456,
  left(encrypted_password, 7) as awalan_hash
from auth.users
where email like '%@karyawan.local'
order by email;
