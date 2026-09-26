-- =====================================================================
-- migration_master_karyawan.sql
-- Jalankan SEKALI di Supabase > SQL Editor (klik Run, bukan Run selected).
-- Aman dijalankan ulang.
--
-- 1. Fungsi untuk tab baru "Data Karyawan" di Master Data (tambah &
--    hapus karyawan dari karyawan_master, khusus admin/leader).
-- 2. Mengisi 16 orang Tim Supporting yang sudah ditentukan ke
--    karyawan_master + andon_tim_anggota, supaya langsung muncul di
--    tab baru "Data Supporting".
-- =====================================================================
begin;

-- Boleh kelola Master Data Karyawan? (admin & leader, sama seperti hak
-- akses halaman Master Data)
create or replace function public.md_staff_boleh()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid()
       and (lower(coalesce(role, '')) in ('admin', 'leader')
         or lower(coalesce(jabatan, '')) in ('admin', 'leader'))
  );
$$;
revoke all on function public.md_staff_boleh() from public, anon;
grant execute on function public.md_staff_boleh() to authenticated;

-- Tambah / ubah nama karyawan
create or replace function public.master_karyawan_simpan(p_nik text, p_nama text)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_nik  text := trim(coalesce(p_nik, ''));
  v_nama text := upper(trim(coalesce(p_nama, '')));
begin
  if not public.md_staff_boleh() then
    return jsonb_build_object('ok', false, 'pesan', 'Tidak punya akses untuk mengubah Data Karyawan.');
  end if;
  if v_nik = '' or v_nama = '' then
    return jsonb_build_object('ok', false, 'pesan', 'NIK dan nama wajib diisi.');
  end if;
  insert into public.karyawan_master (nik, nama)
  values (v_nik, v_nama)
  on conflict (nik) do update set nama = excluded.nama;
  return jsonb_build_object('ok', true);
end $$;

-- Hapus karyawan (ditolak otomatis kalau datanya masih dipakai di
-- tempat lain, mis. Attendance / Tim Supporting -- pesan errornya
-- ditampilkan apa adanya supaya jelas apa yang menahan)
create or replace function public.master_karyawan_hapus(p_nik text)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare v_nik text := trim(coalesce(p_nik, ''));
begin
  if not public.md_staff_boleh() then
    return jsonb_build_object('ok', false, 'pesan', 'Tidak punya akses untuk menghapus Data Karyawan.');
  end if;
  begin
    delete from public.karyawan_master where nik = v_nik;
  exception when others then
    return jsonb_build_object('ok', false, 'pesan', 'Tidak bisa dihapus, data ini masih dipakai di tempat lain: ' || sqlerrm);
  end;
  return jsonb_build_object('ok', found);
end $$;

revoke all on function public.master_karyawan_simpan(text, text) from public, anon;
revoke all on function public.master_karyawan_hapus(text) from public, anon;
grant execute on function public.master_karyawan_simpan(text, text) to authenticated;
grant execute on function public.master_karyawan_hapus(text) to authenticated;


-- ---- Isi 16 orang Tim Supporting ----
insert into public.karyawan_master (nik, nama) values
  ('121003', 'EKO SANTOSO'), ('130212', 'DODI SUWITNO'), ('181004', 'HASANUDIN'),
  ('130611', 'SYARIF'), ('130504', 'ANDRI SIDHARTA'), ('121104', 'MAKHRUS GUNAWAN'),
  ('130321', 'DANANG PURNA IRAWAN'), ('131201', 'ANGGUN ACHMAD SAPUTRA'), ('150807', 'IMAM AMININGRUM'),
  ('130618', 'SUNU ADIRISWANTO'), ('170903', 'AHMAD HIDAYAT'), ('130124', 'DIKY RISTANTO'),
  ('130815', 'ASEP SUSANTO'), ('130519', 'SEPTIAN BUDI PRASETYO'), ('131012', 'SUDARMAWAN'),
  ('140307', 'TARMAN')
on conflict (nik) do nothing;

insert into public.andon_tim_anggota (nik, nama, tim) values
  ('121003', 'EKO SANTOSO', 'MESIN'), ('130212', 'DODI SUWITNO', 'MESIN'), ('181004', 'HASANUDIN', 'MESIN'),
  ('130611', 'SYARIF', 'MESIN'), ('130504', 'ANDRI SIDHARTA', 'MESIN'), ('121104', 'MAKHRUS GUNAWAN', 'MESIN'),
  ('130321', 'DANANG PURNA IRAWAN', 'PE'), ('131201', 'ANGGUN ACHMAD SAPUTRA', 'PE'), ('150807', 'IMAM AMININGRUM', 'PE'),
  ('130618', 'SUNU ADIRISWANTO', 'PE'), ('170903', 'AHMAD HIDAYAT', 'PE'), ('130124', 'DIKY RISTANTO', 'PE'),
  ('130815', 'ASEP SUSANTO', 'PC-SUPP'), ('130519', 'SEPTIAN BUDI PRASETYO', 'QC'),
  ('131012', 'SUDARMAWAN', 'PRESS'), ('140307', 'TARMAN', 'DIES')
on conflict (nik) do update set nama = excluded.nama, tim = excluded.tim;

commit;
notify pgrst, 'reload schema';

-- Hasil: fungsi_ok = true, jumlah_supporting = 16
select
  to_regprocedure('public.master_karyawan_simpan(text,text)') is not null as fungsi_ok,
  (select count(*) from public.andon_tim_anggota) as jumlah_supporting;
