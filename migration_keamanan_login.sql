-- =====================================================================
-- migration_keamanan_login.sql
-- Jalankan SEKALI di Supabase > SQL Editor. Aman dijalankan ulang.
--
-- MASALAH YANG DITUTUP:
--   Dulu email karyawan bisa diambil dari NIK TANPA login (email_for_nik
--   terbuka untuk anon), dan banyak akun masih ber-password 123456.
--   Akibatnya siapa pun yang tahu NIK orang lain (termasuk NIK atasan)
--   bisa masuk memakai akun orang itu.
--
-- PERUBAHAN:
--   1. login_nik(nik, password): email baru diberikan ke halaman login
--      KALAU password-nya benar. Tidak ada lagi cara mengambil email
--      hanya dengan NIK.
--   2. Salah password 5x dalam 15 menit -> NIK itu dikunci 15 menit.
--   3. Password lemah/default (123456 dst, atau sama dengan NIK) DITOLAK
--      masuk. Pemiliknya harus membuat password baru lewat link yang
--      dikirim ke EMAIL-nya sendiri (menu "Ganti Password" di halaman
--      login) -- orang lain tidak punya akses ke email itu.
--   4. email_for_nik dicabut dari anon & authenticated.
--   5. cek_email_nik(nik, email): dipakai form Ganti Password untuk
--      memastikan email yang diketik memang milik NIK itu.
--   6. Kunci "guest tidak boleh menulis" dipasang ulang di SEMUA tabel,
--      termasuk leave_requests (sempat terhapus oleh
--      migration_approval_cuti_v2.sql) dan tabel baru login_gagal.
--
-- Daftar password lemah di fungsi password_lemah() HARUS SAMA dengan
-- PASSWORD_LEMAH di login.html dan reset-password.html.
-- =====================================================================

begin;

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- 1. Catatan percobaan login gagal (tidak bisa dibaca/ditulis langsung
--    dari aplikasi -- hanya lewat fungsi login_nik)
-- ---------------------------------------------------------------------
create table if not exists public.login_gagal (
  nik              text primary key,
  jumlah           integer     not null default 0,
  terakhir         timestamptz not null default now(),
  terkunci_sampai  timestamptz
);
alter table public.login_gagal enable row level security;
revoke all on public.login_gagal from anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. Password lemah / default
-- ---------------------------------------------------------------------
create or replace function public.password_lemah(p_password text, p_nik text)
returns boolean
language sql immutable
as $$
  select coalesce(length(p_password), 0) < 8
      or lower(p_password) in (
           '123456', '1234567', '12345678', '123456789', '1234567890',
           '111111', '000000', '654321', '112233', '121212',
           'password', 'qwerty', 'abc123', 'futaba', 'welding'
         )
      or p_password = trim(coalesce(p_nik, ''));
$$;


-- ---------------------------------------------------------------------
-- 3. Login pakai NIK + password
--    Balikan: { ok:true, email } atau { ok:false, kode:'salah'|'terkunci'|'password_default', menit? }
-- ---------------------------------------------------------------------
create or replace function public.login_nik(p_nik text, p_password text)
returns jsonb
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_nik    text := trim(coalesce(p_nik, ''));
  v_email  text;
  v_hash   text;
  v_row    public.login_gagal%rowtype;
  v_jumlah integer;
begin
  if v_nik = '' or coalesce(p_password, '') = '' then
    return jsonb_build_object('ok', false, 'kode', 'salah');
  end if;

  -- Sedang dikunci?
  select * into v_row from public.login_gagal where nik = v_nik;
  if found and v_row.terkunci_sampai is not null and v_row.terkunci_sampai > now() then
    return jsonb_build_object('ok', false, 'kode', 'terkunci',
      'menit', greatest(1, ceil(extract(epoch from (v_row.terkunci_sampai - now())) / 60)::int));
  end if;

  select u.email, u.encrypted_password into v_email, v_hash
    from public.profiles p
    join auth.users u on u.id = p.id
   where p.nik = v_nik
   limit 1;

  -- NIK tidak ada ATAU password salah -> jawabannya SAMA (tidak membocorkan
  -- NIK mana yang terdaftar), dan dihitung sebagai percobaan gagal.
  if v_hash is null or extensions.crypt(p_password, v_hash) <> v_hash then
    v_jumlah := case
                  when v_row.nik is null or v_row.terakhir < now() - interval '15 minutes' then 1
                  else v_row.jumlah + 1
                end;
    insert into public.login_gagal (nik, jumlah, terakhir, terkunci_sampai)
    values (v_nik, v_jumlah, now(),
            case when v_jumlah >= 5 then now() + interval '15 minutes' end)
    on conflict (nik) do update
      set jumlah = excluded.jumlah,
          terakhir = excluded.terakhir,
          terkunci_sampai = excluded.terkunci_sampai;
    if v_jumlah >= 5 then
      return jsonb_build_object('ok', false, 'kode', 'terkunci', 'menit', 15);
    end if;
    return jsonb_build_object('ok', false, 'kode', 'salah');
  end if;

  delete from public.login_gagal where nik = v_nik;

  -- Password benar tapi masih lemah/default -> tidak boleh masuk.
  -- Pemilik akun ganti password lewat link email (menu Ganti Password).
  if public.password_lemah(p_password, v_nik) then
    return jsonb_build_object('ok', false, 'kode', 'password_default');
  end if;

  return jsonb_build_object('ok', true, 'email', v_email);
end $$;

revoke all on function public.login_nik(text, text) from public;
grant execute on function public.login_nik(text, text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. Form Ganti Password: cocokkan NIK dengan email yang diketik user
-- ---------------------------------------------------------------------
create or replace function public.cek_email_nik(p_nik text, p_email text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.profiles p
      join auth.users u on u.id = p.id
     where p.nik = trim(coalesce(p_nik, ''))
       and lower(u.email) = lower(trim(coalesce(p_email, '')))
  );
$$;

revoke all on function public.cek_email_nik(text, text) from public;
grant execute on function public.cek_email_nik(text, text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 5. Tutup email_for_nik (sumber kebocoran email)
-- ---------------------------------------------------------------------
do $$
begin
  execute 'revoke all on function public.email_for_nik(text) from public, anon, authenticated';
exception when undefined_function then null;
end $$;


-- ---------------------------------------------------------------------
-- 6. Pasang ulang kunci guest di SEMUA tabel (sama dengan
--    migration_role_guest.sql bagian 3). Butuh fungsi is_guest() yang
--    sudah dibuat oleh migration_role_guest.sql.
-- ---------------------------------------------------------------------
do $$
declare t record;
begin
  if to_regprocedure('public.is_guest()') is null then
    raise notice 'is_guest() belum ada -- jalankan migration_role_guest.sql dulu, lalu file ini lagi.';
    return;
  end if;
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('alter table public.%I enable row level security', t.relname);
    execute format('drop policy if exists "guest_no_insert" on public.%I', t.relname);
    execute format('drop policy if exists "guest_no_update" on public.%I', t.relname);
    execute format('drop policy if exists "guest_no_delete" on public.%I', t.relname);
    execute format('create policy "guest_no_insert" on public.%I as restrictive for insert to authenticated with check (not public.is_guest())', t.relname);
    execute format('create policy "guest_no_update" on public.%I as restrictive for update to authenticated using (not public.is_guest()) with check (not public.is_guest())', t.relname);
    execute format('create policy "guest_no_delete" on public.%I as restrictive for delete to authenticated using (not public.is_guest())', t.relname);
  end loop;
end $$;

commit;

-- =====================================================================
-- SETELAH MENJALANKAN FILE INI (disarankan):
--   Supabase > Authentication > Providers > Email > "Minimum password
--   length" = 8, supaya aturan panjang minimal juga dijaga server.
--
-- Cek siapa saja yang password-nya masih 123456 (tidak bisa login sampai
-- mereka membuat password baru lewat email). Kalau ada karyawan yang tidak
-- bisa buka emailnya, admin bisa set password baru untuknya di
-- Supabase > Authentication > Users > (pilih user) > Reset/Update password.
--
-- select p.nik, p.full_name, u.email
--   from public.profiles p join auth.users u on u.id = p.id
--  where extensions.crypt('123456', u.encrypted_password) = u.encrypted_password;
-- =====================================================================
