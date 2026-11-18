-- =====================================================================
-- migration_role_line.sql
-- Jalankan SEKALI di Supabase > SQL Editor (klik Run, bukan Run selected).
-- Aman dijalankan ulang.
--
-- Menambahkan role baru "line": akun untuk SATU line tertentu (mis.
-- E-05), yang HANYA boleh membuka Dashboard Line, dan di dalamnya
-- dikunci ke line miliknya sendiri saja (tidak bisa pindah ke E-02 dst
-- lewat menu). Penguncian HALAMAN ada di assets/supabaseClient.js
-- (requireAuth & requireStaff) -- jadi file itu, dashboard-line.html, dan
-- assets/dashboard-line.js juga harus sudah di-upload sebelum akun ini
-- dipakai.
--
-- CATATAN KEAMANAN (baca dulu sebelum pakai):
--   1. Penguncian "line E-05 saja" ini di level TAMPILAN, sama seperti
--      role lain di sistem ini (guest dkk) -- bukan di level data.
--      Akun ini tetap bisa MEMBACA data SEMUA line kalau sengaja dibuka
--      lewat console browser (sama seperti guest selama ini bisa baca
--      semua line). Tidak bisa MENULIS apa pun di line manapun --
--      itu dikunci sungguhan lewat RLS di bagian 3 bawah.
--   2. Beda dari tab Administrator/Guest, login_line() DI BAWAH ini
--      SENGAJA tidak menolak password pendek/sederhana (mis. "000"),
--      karena akun ini memang untuk dipakai bersama di lantai produksi
--      dan haknya cuma lihat 1 dashboard, read-only. Kalau mau lebih
--      aman, pakai password lebih panjang -- tapi itu pilihan Anda, RPC
--      ini tidak memaksanya.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. Izinkan role 'line' + kolom "line milik siapa"
-- ---------------------------------------------------------------------
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
  check (role in ('admin', 'leader', 'operator', 'viewer', 'guest', 'supporting', 'line'));

-- Line yang jadi milik akun ini (cuma dipakai kalau role = 'line').
-- Pakai tipe machine_type yang sama dengan production_log.mesin, jadi
-- nilainya pasti salah satu dari E-02 .. E-07.
alter table public.profiles
  add column if not exists kode_line public.machine_type;

-- Satu line cuma boleh punya SATU akun Line aktif (mencegah salah ketik
-- bikin 2 akun E-05 tanpa sengaja). Tidak mengganggu akun admin/leader/dst
-- karena index ini hanya berlaku untuk baris ber-role 'line'.
create unique index if not exists profiles_kode_line_uniq
  on public.profiles (kode_line)
  where role = 'line';

-- ---------------------------------------------------------------------
-- 2. Fungsi cek akun Line yang sedang login
-- ---------------------------------------------------------------------
create or replace function public.is_line()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and lower(role) = 'line'
  );
$$;

grant execute on function public.is_line() to authenticated;

-- ---------------------------------------------------------------------
-- 3. Kunci tulis untuk akun Line di SEMUA tabel public (read-only,
--    sama seperti guest -- lihat migration_role_guest.sql).
-- ---------------------------------------------------------------------
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
    execute format('alter table public.%I enable row level security', t.relname);

    execute format('drop policy if exists "line_no_insert" on public.%I', t.relname);
    execute format('drop policy if exists "line_no_update" on public.%I', t.relname);
    execute format('drop policy if exists "line_no_delete" on public.%I', t.relname);

    execute format('create policy "line_no_insert" on public.%I as restrictive for insert to authenticated with check (not public.is_line())', t.relname);
    execute format('create policy "line_no_update" on public.%I as restrictive for update to authenticated using (not public.is_line()) with check (not public.is_line())', t.relname);
    execute format('create policy "line_no_delete" on public.%I as restrictive for delete to authenticated using (not public.is_line())', t.relname);
  end loop;
end $$;

-- Kunci upload/hapus file (foto NG, file 3D, dst) untuk akun Line juga.
do $$
begin
  execute 'drop policy if exists "line_no_insert" on storage.objects';
  execute 'drop policy if exists "line_no_update" on storage.objects';
  execute 'drop policy if exists "line_no_delete" on storage.objects';
  execute 'create policy "line_no_insert" on storage.objects as restrictive for insert to authenticated with check (not public.is_line())';
  execute 'create policy "line_no_update" on storage.objects as restrictive for update to authenticated using (not public.is_line()) with check (not public.is_line())';
  execute 'create policy "line_no_delete" on storage.objects as restrictive for delete to authenticated using (not public.is_line())';
exception when others then
  raise notice 'Policy storage dilewati: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- 4. Login tab "Line": Kode Line + Password (BUKAN NIK).
--    Balikan: { ok:true, email } atau
--              { ok:false, kode:'salah'|'terkunci', menit? }
--    Kode Line boleh diketik "E05", "e-05", atau "E-05" -- dirapikan
--    jadi "E-05" sebelum dicocokkan.
-- ---------------------------------------------------------------------
create or replace function public.login_line(p_kode text, p_password text)
returns jsonb
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_kode   text;
  v_kunci  text;
  v_row    public.login_gagal%rowtype;
  v_email  text;
  v_jumlah integer;
begin
  -- Rapikan kode: buang spasi/strip, huruf besar, lalu pasang lagi
  -- strip di antara huruf & angka -> "e 05" / "e-05" / "E05" jadi "E-05".
  v_kode := upper(regexp_replace(trim(coalesce(p_kode, '')), '[^A-Za-z0-9]', '', 'g'));
  if v_kode ~ '^[A-Z]+[0-9]+$' then
    v_kode := regexp_replace(v_kode, '^([A-Z]+)([0-9]+)$', '\1-\2');
  end if;

  if v_kode = '' or coalesce(p_password, '') = '' then
    return jsonb_build_object('ok', false, 'kode', 'salah');
  end if;
  v_kunci := '#line:' || v_kode;   -- kunci percobaan gagal per kode line

  select * into v_row from public.login_gagal where nik = v_kunci;
  if found and v_row.terkunci_sampai is not null and v_row.terkunci_sampai > now() then
    return jsonb_build_object('ok', false, 'kode', 'terkunci',
      'menit', greatest(1, ceil(extract(epoch from (v_row.terkunci_sampai - now())) / 60)::int));
  end if;

  select u.email into v_email
    from public.profiles p
    join auth.users u on u.id = p.id
   where lower(coalesce(p.role, '')) = 'line'
     and p.kode_line::text = v_kode
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
  return jsonb_build_object('ok', true, 'email', v_email);
end $$;

revoke all on function public.login_line(text, text) from public;
grant execute on function public.login_line(text, text) to anon, authenticated;

commit;

-- =====================================================================
-- LANGKAH WAJIB SETELAH FILE INI: BUAT AKUN LINE-NYA
--
-- Ulangi langkah a+b ini untuk SETIAP line yang mau dibuatkan akun
-- (E-02, E-03, E-04, E-05, E-06, E-07) -- contoh di bawah untuk E-05.
--
-- a) Buat akunnya dulu di Supabase:
--    Authentication > Users > Add user > Create new user
--      Email    : apa saja yang belum dipakai, mis. line-e05@internal.local
--      Password : terserah Anda, mis. 000 (boleh pendek -- lihat catatan
--                  keamanan di atas file ini)
--      Centang  : "Auto Confirm User"
--
-- b) Jadikan akun itu akun Line untuk E-05 (ganti EMAIL_AKUN & KODE_LINE):
--
-- update public.profiles
-- set role = 'line',
--     kode_line = 'E-05',
--     full_name = 'Line E-05'
-- where id = (select id from auth.users where email = 'line-e05@internal.local');
--
-- c) Cek hasil -- harus muncul 1 baris per line yang sudah dibuat:
--
-- select p.full_name, p.role, p.kode_line, u.email
-- from public.profiles p join auth.users u on u.id = p.id
-- where p.role = 'line'
-- order by p.kode_line;
--
-- Setelah akunnya jadi: buka login.html, pilih tab "Line", masuk pakai
-- Kode Line (mis. E05 atau E-05) + password yang baru dibuat. Akan
-- langsung diarahkan ke Dashboard Line, terkunci ke line itu saja.
-- =====================================================================
