-- =========================================================
-- MIGRATION: Login pakai NIK (tapi akun tetap pakai email asli)
-- Alurnya: Daftar tetap isi Email asli + Nama + NIK + Password.
-- Login cukup NIK + Password -- sistem cari email aslinya lewat NIK
-- dulu (fungsi di bawah), baru login pakai email itu ke Supabase.
-- Aman dijalankan berulang.
-- =========================================================

-- 1. Kolom NIK di profiles (nullable + unique -- akun lama boleh kosong dulu)
alter table public.profiles add column if not exists nik text;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_nik_key'
  ) then
    alter table public.profiles add constraint profiles_nik_key unique (nik);
  end if;
end $$;

-- 2. Trigger signup baru: simpan NIK juga (selain full_name & role default operator)
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, role, nik)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    'operator',
    new.raw_user_meta_data->>'nik'
  );
  return new;
end;
$$ language plpgsql security definer;

-- 3. Fungsi: cari email berdasarkan NIK -- dipanggil SEBELUM login (anon,
--    belum punya sesi), makanya perlu security definer + grant ke anon.
--    Catatan: fungsi ini cuma balikin email kalau NIK-nya cocok persis;
--    tetap ada celah kecil orang bisa "tebak-tebak" NIK buat tau email
--    siapa yang terdaftar -- untuk app internal pabrik ini risikonya kecil,
--    tapi kabari kalau mau dibikin lebih ketat (mis. rate limit).
create or replace function public.email_for_nik(p_nik text)
returns text
language sql
security definer
stable
as $$
  select u.email
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.nik = p_nik
  limit 1;
$$;

grant execute on function public.email_for_nik(text) to anon, authenticated;

-- 4. Isi NIK buat akun admin yang SUDAH ADA sekarang
update public.profiles set nik = '180801'
where id = (select id from auth.users where email = 'digidaff08@gmail.com');

-- Cek hasilnya
select p.full_name, p.role, p.nik, u.email
from public.profiles p join auth.users u on u.id = p.id
where u.email = 'digidaff08@gmail.com';

-- =========================================================
-- SELESAI. Lanjut ganti login.html, lalu daftar 8 karyawan baru
-- lewat form "Daftar" (isi email asli + nama + NIK + password).
-- =========================================================
