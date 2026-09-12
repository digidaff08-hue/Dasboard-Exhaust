-- =========================================================
-- PATCH KEAMANAN: kunci kolom role / jabatan / nik di tabel profiles
-- Jalankan sekali di Supabase SQL Editor. Aman dijalankan berulang.
--
-- KENAPA: policy "User bisa update profil sendiri" (schema_welding.sql)
-- mengizinkan user mengubah SEMUA kolom profilnya sendiri, termasuk
-- `role`. Karena halaman Daftar terbuka untuk umum, siapa pun yang punya
-- akun bisa menjalankan dari console browser:
--   supabaseClient.from("profiles").update({ role: "admin" }).eq("id", "<id-sendiri>")
-- lalu langsung jadi admin. Pembatasan admin/leader di aplikasi selama
-- ini cuma di tampilan (x-show), bukan di database.
--
-- ISI PATCH:
-- 1) Trigger yang menolak perubahan role/jabatan/nik kalau yang mengubah
--    BUKAN admin. User biasa tetap boleh ubah kolom lain (mis. full_name).
--    Perubahan dari SQL Editor / service role (auth.uid() kosong) dan
--    trigger pendaftaran akun baru (handle_new_user) tetap diizinkan.
-- 2) Insert profil manual dari aplikasi oleh non-admin dipaksa role
--    'operator' (jaga-jaga kalau trigger pendaftaran sempat gagal).
-- 3) search_path dikunci di fungsi SECURITY DEFINER yang sudah ada
--    (rekomendasi keamanan Supabase, tidak mengubah isi fungsinya).
-- =========================================================

create or replace function public.protect_profile_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Dijalankan dari SQL Editor / service role / trigger signup -> boleh
  if auth.uid() is null then
    return new;
  end if;

  -- Admin boleh ubah apa saja
  if exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.role := 'operator';
    new.jabatan := null;
    return new;
  end if;

  if new.role is distinct from old.role
     or new.jabatan is distinct from old.jabatan
     or new.nik is distinct from old.nik then
    raise exception 'Tidak diizinkan mengubah role, jabatan, atau NIK. Hubungi admin.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_profile_privileged_columns on public.profiles;
create trigger trg_protect_profile_privileged_columns
  before insert or update on public.profiles
  for each row execute function public.protect_profile_privileged_columns();

-- Kunci search_path fungsi SECURITY DEFINER yang sudah ada
alter function public.handle_new_user() set search_path = public;
alter function public.email_for_nik(text) set search_path = public;

-- =========================================================
-- CATATAN (belum diubah di patch ini, butuh keputusan dulu):
-- * email_for_nik masih bisa dipanggil tanpa login (anon), jadi email
--   karyawan bisa dicari dengan menebak NIK. Fungsi ini dibutuhkan halaman
--   login (login pakai NIK), jadi tidak bisa langsung dicabut tanpa
--   mengganti cara login (mis. lewat Supabase Edge Function).
-- * Kalau akun baru selalu dibuatkan admin, matikan pendaftaran umum di
--   Authentication > Sign In / Providers > "Allow new users to sign up".
-- * Policy tabel data (production_log, downtime_log, dst) masih
--   mengizinkan SEMUA user login tambah/ubah/hapus data.
-- =========================================================

-- Cek hasil: harus muncul 1 baris trigger
select tgname from pg_trigger where tgname = 'trg_protect_profile_privileged_columns';
