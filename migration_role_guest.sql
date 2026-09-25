-- =========================================================
-- ROLE BARU: GUEST (tamu) -- hanya bisa MELIHAT Dashboard Exhaust
--
-- Jalankan di Supabase > SQL Editor. Aman dijalankan berkali-kali.
--
-- Isi:
--   1) Izinkan nilai role 'guest' di tabel profiles.
--   2) Fungsi is_guest() untuk mengecek user yang sedang login.
--   3) Kunci DATABASE: akun guest DITOLAK menambah / mengubah / menghapus
--      data di SEMUA tabel (policy RESTRICTIVE). Jadi walaupun guest
--      mencoba lewat console browser, tetap tidak bisa mengubah apa pun.
--      Membaca data (untuk menampilkan dashboard) tetap boleh.
--   4) Jadikan akun tamu sebagai guest (edit bagian paling bawah).
--
-- Catatan: kalau nanti ada TABEL BARU, jalankan ulang file ini supaya
-- tabel baru itu ikut terkunci untuk guest.
-- =========================================================

-- 1) Izinkan role 'guest' ------------------------------------------------
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
  check (role in ('admin', 'leader', 'operator', 'guest'));

-- 2) Fungsi cek guest ----------------------------------------------------
create or replace function public.is_guest()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and lower(role) = 'guest'
  );
$$;

grant execute on function public.is_guest() to authenticated;

-- 3) Kunci tulis untuk guest di SEMUA tabel public -------------------------
do $$
declare t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
  loop
    -- pastikan RLS aktif (tabel yang sudah aktif tidak berubah apa-apa)
    execute format('alter table public.%I enable row level security', t.relname);

    execute format('drop policy if exists "guest_no_insert" on public.%I', t.relname);
    execute format('drop policy if exists "guest_no_update" on public.%I', t.relname);
    execute format('drop policy if exists "guest_no_delete" on public.%I', t.relname);

    execute format('create policy "guest_no_insert" on public.%I as restrictive for insert to authenticated with check (not public.is_guest())', t.relname);
    execute format('create policy "guest_no_update" on public.%I as restrictive for update to authenticated using (not public.is_guest()) with check (not public.is_guest())', t.relname);
    execute format('create policy "guest_no_delete" on public.%I as restrictive for delete to authenticated using (not public.is_guest())', t.relname);
  end loop;
end $$;

-- Kunci upload/hapus file (foto NG, file 3D, dst) untuk guest.
-- Dibungkus supaya kalau project tidak mengizinkan ubah policy storage,
-- bagian ini dilewati tanpa menggagalkan langkah lain.
do $$
begin
  execute 'drop policy if exists "guest_no_insert" on storage.objects';
  execute 'drop policy if exists "guest_no_update" on storage.objects';
  execute 'drop policy if exists "guest_no_delete" on storage.objects';
  execute 'create policy "guest_no_insert" on storage.objects as restrictive for insert to authenticated with check (not public.is_guest())';
  execute 'create policy "guest_no_update" on storage.objects as restrictive for update to authenticated using (not public.is_guest()) with check (not public.is_guest())';
  execute 'create policy "guest_no_delete" on storage.objects as restrictive for delete to authenticated using (not public.is_guest())';
exception when others then
  raise notice 'Policy storage dilewati: %', sqlerrm;
end $$;

-- 4) JADIKAN AKUN TAMU SEBAGAI GUEST --------------------------------------
-- Buat akunnya dulu di: Authentication > Users > Add user > Create new user
-- (isi email & password, centang "Auto Confirm User").
-- Lalu GANTI 3 nilai di bawah, dan jalankan bagian ini:
--   <EMAIL_GUEST> = email akun tamu tadi
--   <NIK_GUEST>   = "NIK" untuk login tamu (bebas, mis. 999999, asal
--                   belum dipakai karyawan lain)
--   <NAMA>        = nama yang tampil di dashboard, mis. Guest
update public.profiles
set role = 'guest',
    nik = '<NIK_GUEST>',
    full_name = '<NAMA>'
where id = (select id from auth.users where email = '<EMAIL_GUEST>');

-- Cek hasil: harus muncul 1 baris dengan role = guest
select p.full_name, p.role, p.nik, u.email
from public.profiles p
join auth.users u on u.id = p.id
where p.role = 'guest';
