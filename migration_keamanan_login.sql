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
--   1. login_nik(nik, password) -- tab KARYAWAN di halaman login:
--      email baru diberikan KALAU password-nya benar. Tidak ada lagi cara
--      mengambil email hanya dengan NIK. Akun ber-role admin/guest TIDAK
--      bisa masuk lewat tab ini (walau NIK & password-nya benar).
--      Password lemah karyawan (123456) untuk sementara MASIH boleh.
--   2. login_khusus(jenis, password) -- tab ADMINISTRATOR / GUEST:
--      cukup password. Password lemah (123456 dst) DITOLAK, jadi password
--      admin & guest harus diganti dulu (lihat bagian paling bawah file).
--   3. Salah password 5x dalam 15 menit -> dikunci 15 menit (per NIK
--      untuk karyawan, per tab untuk Administrator / Guest).
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
  v_role   text;
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

  select u.email, u.encrypted_password, lower(coalesce(p.role, ''))
    into v_email, v_hash, v_role
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

  -- Akun Administrator & Guest hanya boleh masuk lewat tab khususnya.
  -- Jadi NIK admin + 123456 tidak bisa lagi dipakai orang lain.
  if v_role in ('admin', 'guest') then
    return jsonb_build_object('ok', false, 'kode', 'akun_khusus', 'role', v_role);
  end if;

  -- Karyawan dengan password lemah untuk sementara tetap boleh masuk;
  -- halaman login cuma diberi tanda supaya bisa mengingatkan.
  return jsonb_build_object('ok', true, 'email', v_email,
                            'password_lemah', public.password_lemah(p_password, v_nik));
end $$;

revoke all on function public.login_nik(text, text) from public;
grant execute on function public.login_nik(text, text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 3b. Login tab ADMINISTRATOR / GUEST -- cukup password.
--     Dicocokkan ke semua akun ber-role itu; yang password-nya cocok
--     yang dipakai. Balikan: { ok:true, email } atau
--     { ok:false, kode:'salah'|'terkunci'|'password_default' }
-- ---------------------------------------------------------------------
create or replace function public.login_khusus(p_jenis text, p_password text)
returns jsonb
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_jenis  text := lower(trim(coalesce(p_jenis, '')));
  v_kunci  text;
  v_row    public.login_gagal%rowtype;
  v_email  text;
  v_jumlah integer;
begin
  if v_jenis not in ('admin', 'guest') or coalesce(p_password, '') = '' then
    return jsonb_build_object('ok', false, 'kode', 'salah');
  end if;
  v_kunci := '#' || v_jenis;   -- kunci percobaan gagal per tab

  select * into v_row from public.login_gagal where nik = v_kunci;
  if found and v_row.terkunci_sampai is not null and v_row.terkunci_sampai > now() then
    return jsonb_build_object('ok', false, 'kode', 'terkunci',
      'menit', greatest(1, ceil(extract(epoch from (v_row.terkunci_sampai - now())) / 60)::int));
  end if;

  select u.email into v_email
    from public.profiles p
    join auth.users u on u.id = p.id
   where lower(coalesce(p.role, '')) = v_jenis
     and u.encrypted_password is not null
     and extensions.crypt(p_password, u.encrypted_password) = u.encrypted_password
   limit 1;

  if v_email is null then
    v_jumlah := case
                  when v_row.nik is null or v_row.terakhir < now() - interval '15 minutes' then 1
                  else v_row.jumlah + 1
                end;
    insert into public.login_gagal (nik, jumlah, terakhir, terkunci_sampai)
    values (v_kunci, v_jumlah, now(),
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

  delete from public.login_gagal where nik = v_kunci;

  -- Password admin/guest yang masih lemah tidak boleh dipakai sama sekali.
  if public.password_lemah(p_password, null) then
    return jsonb_build_object('ok', false, 'kode', 'password_default');
  end if;

  return jsonb_build_object('ok', true, 'email', v_email);
end $$;

revoke all on function public.login_khusus(text, text) from public;
grant execute on function public.login_khusus(text, text) to anon, authenticated;


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
-- LANGKAH WAJIB SETELAH FILE INI: GANTI PASSWORD ADMIN & GUEST
--
-- Tab Administrator & Guest menolak password lemah (123456 dst), jadi
-- password kedua akun ini harus diganti dulu. Password baru hanya Anda
-- yang menentukan -- JANGAN simpan query yang sudah berisi password.
--
-- a) Lihat dulu akun admin & guest yang ada:
--
-- select p.full_name, p.role, p.nik, u.email
--   from public.profiles p join auth.users u on u.id = p.id
--  where p.role in ('admin', 'guest');
--
-- b) Ganti password (ulangi untuk tiap akun; ganti EMAIL & PASSWORD_BARU,
--    minimal 8 karakter, bukan 123456 / NIK):
--
-- update auth.users
--    set encrypted_password = extensions.crypt('PASSWORD_BARU', extensions.gen_salt('bf')),
--        updated_at = now()
--  where email = 'EMAIL_AKUN';
--
-- Kalau ada 2 akun admin, beri password BERBEDA untuk masing-masing --
-- tab Administrator mencari akun dari password-nya.
--
-- Disarankan juga: Supabase > Authentication > Providers > Email >
-- "Minimum password length" = 8.
-- =====================================================================
