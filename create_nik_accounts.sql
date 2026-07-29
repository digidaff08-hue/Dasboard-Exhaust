-- =========================================================
-- BUAT AKUN NIK + PASSWORD (bulk, 9 akun sekaligus)
-- Password default SEMUA: 123456
-- Aman dijalankan berulang -- NIK yang sudah terdaftar otomatis dilewati.
-- =========================================================

create extension if not exists pgcrypto;

do $$
declare
  v_domain text := 'karyawan.local';
  v_password text := '123456';
  v_new_id uuid;
  rec record;
begin
  for rec in
    select * from (values
      ('130714', 'SRI HARTONO', 'operator'),
      ('130713', 'JUMADI', 'operator'),
      ('130529', 'TEGUH SANTOSO', 'operator'),
      ('130101', 'IIN FAJRIN MUNIR', 'operator'),
      ('130327', 'AGUS WIBOWO', 'operator'),
      ('180614', 'ASEP SUPRIATNA', 'operator'),
      ('140905', 'DAVIT ARISTIYANTO', 'operator'),
      ('130924', 'LAMIJO', 'operator'),
      ('180801', 'ABDUL. H', 'admin')
    ) as t(nik, nama, role)
  loop
    -- lewati kalau NIK ini sudah pernah dibuat sebelumnya
    if exists (select 1 from auth.users where email = rec.nik || '@' || v_domain) then
      raise notice 'NIK % (%) sudah ada, dilewati.', rec.nik, rec.nama;
      continue;
    end if;

    v_new_id := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      is_super_admin, confirmation_token, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_new_id, 'authenticated', 'authenticated',
      rec.nik || '@' || v_domain, crypt(v_password, gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object('full_name', rec.nama),
      false, '', ''
    );

    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), v_new_id,
      jsonb_build_object('sub', v_new_id::text, 'email', rec.nik || '@' || v_domain),
      'email', v_new_id::text, now(), now(), now()
    );

    -- Baris di public.profiles otomatis kebuat oleh trigger yang sudah ada
    -- (on_auth_user_created), defaultnya role='operator' -- tinggal
    -- diperbaiki role & nama-nya sesuai daftar di atas.
    update public.profiles set role = rec.role, full_name = rec.nama where id = v_new_id;

    raise notice 'NIK % (%) berhasil dibuat, role=%.', rec.nik, rec.nama, rec.role;
  end loop;
end $$;

-- Cek hasilnya -- harus muncul 9 baris
select p.full_name, p.role, u.email
from public.profiles p
join auth.users u on u.id = p.id
where u.email like '%@karyawan.local'
order by (p.role = 'admin') desc, p.full_name;

-- =========================================================
-- SELESAI. Coba login di app pakai NIK 130714 / password 123456,
-- dan NIK 180801 / password 123456 buat akun admin.
-- =========================================================
