-- =========================================================
-- MIGRATION: Form Repair (baru, di semua 6 line)
-- Konsep: gambar part (bisa >1 tampilan -- Depan/Belakang/dst),
-- ditandai titik-titik (klik titik -> popup Qty + Kategori Repair).
-- Aman dijalankan sekali di atas migration_ng_inline (r11) yang sudah ada.
-- =========================================================

-- 1. Tampilan gambar part (Depan / Belakang / dst -- global, semua line sama)
create table if not exists public.repair_views (
  id uuid primary key default gen_random_uuid(),
  label text not null,           -- "Tampak Depan", "Tampak Belakang", dst
  image_url text not null,       -- path/URL gambar
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.repair_views enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'repair_views' and policyname = 'Login bisa lihat repair_views') then
    create policy "Login bisa lihat repair_views" on public.repair_views for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'repair_views' and policyname = 'Login bisa kelola repair_views') then
    create policy "Login bisa kelola repair_views" on public.repair_views for all to authenticated using (true) with check (true);
  end if;
end $$;

-- 2. Titik-titik di atas tiap gambar (posisi dalam PERSEN, biar responsif
--    di layar berapapun -- x_pct/y_pct 0-100)
create table if not exists public.repair_points (
  id uuid primary key default gen_random_uuid(),
  view_id uuid not null references public.repair_views(id) on delete cascade,
  x_pct numeric not null,
  y_pct numeric not null,
  label text,                    -- opsional, mis. "Titik 1" / "A"
  created_at timestamptz not null default now()
);
create index if not exists idx_repair_points_view on public.repair_points (view_id);
alter table public.repair_points enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'repair_points' and policyname = 'Login bisa lihat repair_points') then
    create policy "Login bisa lihat repair_points" on public.repair_points for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'repair_points' and policyname = 'Login bisa kelola repair_points') then
    create policy "Login bisa kelola repair_points" on public.repair_points for all to authenticated using (true) with check (true);
  end if;
end $$;

-- 3. Master Kategori Repair (dropdown di popup) -- kosong dulu, diisi
--    lewat tab Master Data (sama pola dengan Problem/Area di Downtime)
create table if not exists public.repair_kategori (
  id uuid primary key default gen_random_uuid(),
  value text not null unique,
  created_at timestamptz not null default now()
);
alter table public.repair_kategori enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'repair_kategori' and policyname = 'Login bisa lihat repair_kategori') then
    create policy "Login bisa lihat repair_kategori" on public.repair_kategori for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'repair_kategori' and policyname = 'Login bisa kelola repair_kategori') then
    create policy "Login bisa kelola repair_kategori" on public.repair_kategori for all to authenticated using (true) with check (true);
  end if;
end $$;

-- 4. Data Repair (hasil klik titik + isi popup)
create table if not exists public.repair_log (
  id uuid primary key default gen_random_uuid(),
  mesin machine_type not null,
  tanggal date not null,
  view_id uuid references public.repair_views(id),
  point_id uuid references public.repair_points(id) on delete set null,
  point_label text,               -- disimpan terpisah, biar riwayat tetap
                                   -- kebaca walau titiknya kehapus belakangan
  qty integer not null check (qty > 0),
  kategori_repair text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_repair_log_mesin_tanggal on public.repair_log (mesin, tanggal desc);
alter table public.repair_log enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'repair_log' and policyname = 'Login bisa lihat repair_log') then
    create policy "Login bisa lihat repair_log" on public.repair_log for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'repair_log' and policyname = 'Login bisa tambah repair_log') then
    create policy "Login bisa tambah repair_log" on public.repair_log for insert to authenticated with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'repair_log' and policyname = 'Login bisa update repair_log') then
    create policy "Login bisa update repair_log" on public.repair_log for update to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'repair_log' and policyname = 'Login bisa hapus repair_log') then
    create policy "Login bisa hapus repair_log" on public.repair_log for delete to authenticated using (true);
  end if;
end $$;

-- 5. Storage bucket buat gambar view yang di-upload admin lewat app
--    (seed 2 gambar pertama pakai file statis di /assets/repair/,
--    ini cuma buat upload gambar BARU ke depannya lewat Point Editor)
insert into storage.buckets (id, name, public)
values ('repair-photos', 'repair-photos', true)
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'objects' and schemaname = 'storage' and policyname = 'Login bisa upload foto repair') then
    create policy "Login bisa upload foto repair" on storage.objects for insert to authenticated with check (bucket_id = 'repair-photos');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'objects' and schemaname = 'storage' and policyname = 'Semua orang bisa lihat foto repair') then
    create policy "Semua orang bisa lihat foto repair" on storage.objects for select using (bucket_id = 'repair-photos');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'objects' and schemaname = 'storage' and policyname = 'Login bisa hapus foto repair') then
    create policy "Login bisa hapus foto repair" on storage.objects for delete to authenticated using (bucket_id = 'repair-photos');
  end if;
end $$;

-- =========================================================
-- SEED: 2 tampilan placeholder + titik ngasal (5 titik per gambar)
-- pakai gambar yang sama untuk Depan & Belakang (placeholder --
-- ganti image_url-nya kalau sudah ada foto beneran per sisi).
-- =========================================================
insert into public.repair_views (label, image_url, sort_order)
values
  ('Tampak Depan', '/assets/repair/view-1.png', 1),
  ('Tampak Belakang (placeholder)', '/assets/repair/view-2.png', 2)
on conflict do nothing;

insert into public.repair_points (view_id, x_pct, y_pct, label)
select v.id, p.x_pct, p.y_pct, p.label
from public.repair_views v
cross join (values
  (15.0, 45.0, 'Titik 1'),
  (35.0, 20.0, 'Titik 2'),
  (55.0, 55.0, 'Titik 3'),
  (72.0, 30.0, 'Titik 4'),
  (85.0, 65.0, 'Titik 5')
) as p(x_pct, y_pct, label)
where v.label in ('Tampak Depan', 'Tampak Belakang (placeholder)')
on conflict do nothing;

-- =========================================================
-- SELESAI. Titik masih ngasal -- geser/hapus/tambah lewat tab
-- Master Data > Repair setelah dijalankan.
-- =========================================================
