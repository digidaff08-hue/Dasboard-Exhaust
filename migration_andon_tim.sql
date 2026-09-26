-- =====================================================================
-- migration_andon_tim.sql -- Anggota Tim Supporting (menu Pengaturan Andon)
-- Jalankan SEKALI di Supabase > SQL Editor (klik Run). Aman diulang.
-- Butuh migration_andon.sql sudah dijalankan.
--
-- Admin menambah NIK + nama + tim dari halaman Andon. NIK otomatis
-- didaftarkan ke karyawan_master (kalau belum ada), jadi orang itu bisa
-- langsung "Daftar" sendiri di halaman login. Akun login TIDAK dibuat
-- dari sini (butuh kunci rahasia Supabase yang tidak boleh ada di web).
-- =====================================================================
begin;

create table if not exists public.andon_tim_anggota (
  nik        text primary key,
  nama       text not null,
  tim        text not null check (tim in ('MESIN','DIES','PE','QC','PC-SUPP','PRESS')),
  created_at timestamptz not null default now(),
  created_by uuid
);

alter table public.andon_tim_anggota enable row level security;
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'andon_tim_anggota'
  loop execute format('drop policy %I on public.andon_tim_anggota', p.policyname); end loop;
end $$;
-- semua user login boleh membaca (dipakai untuk filter tim otomatis);
-- menambah / menghapus hanya lewat fungsi di bawah (khusus admin)
create policy andon_tim_select on public.andon_tim_anggota for select to authenticated using (true);
revoke all on public.andon_tim_anggota from anon;
grant select on public.andon_tim_anggota to authenticated;

create or replace function public.andon_saya_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and lower(role) = 'admin');
$$;

-- Tambah / ubah anggota
create or replace function public.andon_tim_simpan(p_nik text, p_nama text, p_tim text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_nik  text := trim(coalesce(p_nik, ''));
  v_nama text := upper(trim(coalesce(p_nama, '')));
  v_tim  text := upper(trim(coalesce(p_tim, '')));
  v_baru boolean := false;
begin
  if not public.andon_saya_admin() then
    return jsonb_build_object('ok', false, 'pesan', 'Hanya admin yang bisa menambah anggota tim.');
  end if;
  if v_nik = '' or v_nama = '' then
    return jsonb_build_object('ok', false, 'pesan', 'NIK dan nama wajib diisi.');
  end if;
  if v_tim not in ('MESIN','DIES','PE','QC','PC-SUPP','PRESS') then
    return jsonb_build_object('ok', false, 'pesan', 'Tim tidak dikenal.');
  end if;

  -- NIK belum ada di data karyawan -> daftarkan supaya bisa "Daftar" di login
  if not exists (select 1 from public.karyawan_master where nik = v_nik) then
    begin
      insert into public.karyawan_master (nik, nama) values (v_nik, v_nama);
      v_baru := true;
    exception when others then
      return jsonb_build_object('ok', false, 'pesan', 'Gagal mendaftarkan NIK ke data karyawan: ' || sqlerrm);
    end;
  end if;

  insert into public.andon_tim_anggota (nik, nama, tim, created_by)
  values (v_nik, v_nama, v_tim, auth.uid())
  on conflict (nik) do update set nama = excluded.nama, tim = excluded.tim;

  return jsonb_build_object('ok', true, 'nik_baru', v_baru);
end $$;

-- Hapus dari tim (data karyawan & akun login TIDAK ikut dihapus)
create or replace function public.andon_tim_hapus(p_nik text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.andon_saya_admin() then
    return jsonb_build_object('ok', false, 'pesan', 'Hanya admin yang bisa menghapus anggota tim.');
  end if;
  delete from public.andon_tim_anggota where nik = trim(coalesce(p_nik, ''));
  return jsonb_build_object('ok', found);
end $$;

-- Daftar anggota + status sudah punya akun atau belum (khusus admin)
create or replace function public.andon_tim_daftar()
returns table (nik text, nama text, tim text, punya_akun boolean, nama_akun text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.andon_saya_admin() then return; end if;
  return query
    select a.nik, a.nama, a.tim,
           p.id is not null as punya_akun,
           p.full_name::text as nama_akun
      from public.andon_tim_anggota a
      left join public.profiles p on p.nik = a.nik
     order by a.tim, a.nama;
end $$;

revoke all on function public.andon_tim_simpan(text, text, text) from public, anon;
revoke all on function public.andon_tim_hapus(text) from public, anon;
revoke all on function public.andon_tim_daftar() from public, anon;
revoke all on function public.andon_saya_admin() from public, anon;
grant execute on function public.andon_tim_simpan(text, text, text) to authenticated;
grant execute on function public.andon_tim_hapus(text) to authenticated;
grant execute on function public.andon_tim_daftar() to authenticated;
grant execute on function public.andon_saya_admin() to authenticated;

commit;
notify pgrst, 'reload schema';

-- Hasil: 1 baris, semua true
select to_regclass('public.andon_tim_anggota') is not null as tabel_ok,
       to_regprocedure('public.andon_tim_simpan(text,text,text)') is not null as fungsi_ok;
