-- =========================================================
-- FITUR BARU: Input NG Inline (semua line E-02..E-07)
-- Jalankan file ini SEKALI di Supabase SQL Editor, setelah
-- schema_welding.sql + seed-seed sebelumnya sudah jalan.
-- =========================================================

-- 1. Master data: Area -> NG Proses (shared lintas semua line,
--    SAMA SEPERTI downtime_areas -- dikelola lewat tab Master Data).
--    Sengaja TANPA kolom 'mesin' (global, bukan per-line) supaya
--    tidak kena masalah yang sama dengan downtime_areas/downtime_causes
--    (kolom 'mesin' di situ NOT NULL tapi tidak pernah diisi dari UI).
--    Kosong dulu -- diisi belakangan lewat tab Master Data > NG Inline.
create table public.ng_areas (
  id uuid primary key default gen_random_uuid(),
  area text not null,
  ng_proses text not null,
  created_at timestamptz not null default now(),
  unique (area)
);
alter table public.ng_areas enable row level security;
create policy "Login bisa lihat ng_areas"
  on public.ng_areas for select to authenticated using (true);
create policy "Login bisa tambah ng_areas"
  on public.ng_areas for insert to authenticated with check (true);
create policy "Login bisa update ng_areas"
  on public.ng_areas for update to authenticated using (true) with check (true);
create policy "Login bisa hapus ng_areas"
  on public.ng_areas for delete to authenticated using (true);

-- 2. Tabel LOG NG Inline (semua line, semua role operator/leader/admin
--    boleh input -- konsisten dengan pola RLS tabel lain di app ini).
create table public.ng_inline_log (
  id uuid primary key default gen_random_uuid(),
  mesin machine_type not null,
  tanggal date not null,
  type_ng text not null check (type_ng in ('NG PRODUKSI', 'NG TRIAL')),
  pic text not null,
  part_number text not null,
  area text not null,
  ng_proses text not null,
  qty integer not null check (qty > 0),
  ng_kategori text not null,
  reason text not null,
  foto_url text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index idx_ng_inline_log_mesin_tanggal on public.ng_inline_log (mesin, tanggal desc);

alter table public.ng_inline_log enable row level security;
create policy "Login bisa lihat ng_inline_log"
  on public.ng_inline_log for select to authenticated using (true);
create policy "Login bisa tambah ng_inline_log"
  on public.ng_inline_log for insert to authenticated with check (true);
create policy "Login bisa update ng_inline_log"
  on public.ng_inline_log for update to authenticated using (true);
create policy "Login bisa hapus ng_inline_log"
  on public.ng_inline_log for delete to authenticated using (true);

-- 3. Storage bucket buat foto NG Inline (public read, biar gampang
--    ditampilkan langsung di tabel riwayat pakai getPublicUrl).
insert into storage.buckets (id, name, public)
values ('ng-inline-photos', 'ng-inline-photos', true)
on conflict (id) do nothing;

create policy "Login bisa upload foto ng inline"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'ng-inline-photos');
create policy "Semua orang bisa lihat foto ng inline"
  on storage.objects for select
  using (bucket_id = 'ng-inline-photos');
create policy "Login bisa hapus foto ng inline"
  on storage.objects for delete to authenticated
  using (bucket_id = 'ng-inline-photos');

-- =========================================================
-- SELESAI.
-- ng_areas sengaja kosong dulu -- nanti diisi Area & NG Proses-nya
-- lewat tab Master Data di halaman tiap line (sama seperti cara isi
-- Area punya Downtime), atau lewat insert manual:
--
--   insert into public.ng_areas (area, ng_proses) values
--     ('Nama Area 1', 'NG Proses 1'),
--     ('Nama Area 2', 'NG Proses 2');
-- =========================================================
