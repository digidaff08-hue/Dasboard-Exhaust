-- =========================================================
-- MIGRATION: Repair jadi 3D (ganti foto 2D -> model .stl bisa diputar)
-- Jalankan sekali setelah migration_repair_v1.sql & v2.sql
-- Aman dijalankan berulang (pakai IF NOT EXISTS / ON CONFLICT).
--
-- Konsep baru: 1 model 3D = 1 "tampilan" (dulu Depan/Belakang jadi 2
-- entri terpisah karena foto 2D cuma 1 sisi -- sekarang cukup 1 model
-- per part karena bisa diputar 360 derajat lihat semua sisi).
-- Titik Repair sekarang disimpan sebagai koordinat 3D (x, y, z) di
-- ruang koordinat asli file STL-nya, bukan lagi persen posisi di foto.
-- =========================================================

-- 1. Tambah kolom buat model 3D di repair_views
alter table public.repair_views
  add column if not exists model_url text,
  add column if not exists kind text not null default '2d';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'repair_views_kind_check'
  ) then
    alter table public.repair_views
      add constraint repair_views_kind_check check (kind in ('2d', '3d'));
  end if;
end $$;

-- image_url dulu wajib diisi (foto) -- sekarang boleh kosong kalau kind = '3d'
alter table public.repair_views alter column image_url drop not null;

-- 2. Tambah kolom koordinat 3D di repair_points, & bikin x_pct/y_pct opsional
alter table public.repair_points
  add column if not exists x numeric,
  add column if not exists y numeric,
  add column if not exists z numeric;

alter table public.repair_points alter column x_pct drop not null;
alter table public.repair_points alter column y_pct drop not null;

-- 3. Storage bucket buat file .stl yang di-upload admin lewat app
--    (part yang dikirim manual ke saya taruh statis di /assets/repair/,
--    ini buat upload part BARU ke depannya lewat Master Data)
insert into storage.buckets (id, name, public)
values ('repair-models', 'repair-models', true)
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'objects' and schemaname = 'storage' and policyname = 'Login bisa upload model repair') then
    create policy "Login bisa upload model repair" on storage.objects for insert to authenticated with check (bucket_id = 'repair-models');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'objects' and schemaname = 'storage' and policyname = 'Semua orang bisa lihat model repair') then
    create policy "Semua orang bisa lihat model repair" on storage.objects for select using (bucket_id = 'repair-models');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'objects' and schemaname = 'storage' and policyname = 'Login bisa hapus model repair') then
    create policy "Login bisa hapus model repair" on storage.objects for delete to authenticated using (bucket_id = 'repair-models');
  end if;
end $$;

-- 4. Buang 2 tampilan placeholder lama (foto Jig_8.png + titik ngasal) dan
--    titik-titiknya, sekaligus riwayat repair_log yang nempel ke titik
--    placeholder itu (kalau ada data uji coba yang sudah sempat disimpan)
delete from public.repair_log
where view_id in (select id from public.repair_views where label in ('Tampak Depan', 'Tampak Belakang (placeholder)'));

delete from public.repair_points
where view_id in (select id from public.repair_views where label in ('Tampak Depan', 'Tampak Belakang (placeholder)'));

delete from public.repair_views
where label in ('Tampak Depan', 'Tampak Belakang (placeholder)');

-- 5. Seed model 3D pertama (part yang sudah dikirim), file-nya ada statis
--    di /assets/repair/25051-BZ040_C15-01137.stl (sudah ikut di paket app)
insert into public.repair_views (label, model_url, kind, sort_order)
values ('25051-BZ040 / C15-01137', '/assets/repair/25051-BZ040_C15-01137.stl', '3d', 1)
on conflict do nothing;

-- =========================================================
-- SELESAI. Buka tab Repair -> model 3D-nya langsung muncul, bisa diputar.
-- Tambah titik Repair lewat tombol "Mode Edit Point" -> klik di permukaan
-- model. Tambah part 3D lain lewat tab Master Data > Repair — Model 3D Part.
-- =========================================================
