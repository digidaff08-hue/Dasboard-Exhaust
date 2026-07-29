-- Jalankan SETELAH ke-9 orang selesai daftar lewat form "Daftar di sini"
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = '180801@karyawan.id');

-- Cek hasil akhir -- harus 9 baris, 180801 role-nya 'admin', sisanya 'operator'
select p.full_name, p.role, u.email
from public.profiles p
join auth.users u on u.id = p.id
where u.email like '%@karyawan.id'
order by (p.role = 'admin') desc, p.full_name;
