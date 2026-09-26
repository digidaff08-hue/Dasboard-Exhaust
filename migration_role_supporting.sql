-- =====================================================================
-- migration_role_supporting.sql
-- Jalankan SEKALI di Supabase > SQL Editor (klik Run, bukan Run selected).
-- Aman dijalankan ulang.
--
-- Menambahkan role baru "supporting": akun untuk tim supporting yang
-- HANYA boleh membuka halaman Andon (tidak bisa buka Dashboard, Input
-- Produksi, Attendance, halaman mesin, dst). Penguncian halamannya ada
-- di assets/supabaseClient.js (requireAuth & requireStaff) -- jadi file
-- itu juga harus sudah di-upload ke Vercel sebelum akun ini dipakai.
-- =====================================================================
begin;

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
  check (role in ('admin', 'leader', 'operator', 'viewer', 'guest', 'supporting'));

commit;

-- Hasil: constraint sekarang mengizinkan role 'supporting'.
select conname, pg_get_constraintdef(oid)
  from pg_constraint
 where conrelid = 'public.profiles'::regclass and contype = 'c';
