-- =========================================================
-- MIGRATION: Format Form Downtime Baru
-- Aman dijalankan sekali di atas schema_welding.sql yang sudah ada.
-- =========================================================

-- Kolom baru di downtime_log
alter table public.downtime_log
  add column if not exists pic text,               -- MESIN / PE / PROD / PC-SUPP / QC / PRESS
  add column if not exists waktu_tunggu numeric,    -- menit, isi manual
  add column if not exists ket text,                -- keterangan manual
  add column if not exists area text,               -- dropdown, master: downtime_areas
  add column if not exists status text;             -- Temporary Action / Permanent Action

-- Master data: Problem Detail (sebelumnya "Penyebab" -- teks manual, sekarang dropdown)
create table if not exists public.downtime_causes (
  id uuid primary key default gen_random_uuid(),
  mesin machine_type not null,
  value text not null,
  created_at timestamptz not null default now(),
  unique (mesin, value)
);
alter table public.downtime_causes enable row level security;
create policy "Login bisa lihat downtime_causes"
  on public.downtime_causes for select to authenticated using (true);
create policy "Login bisa tambah downtime_causes"
  on public.downtime_causes for insert to authenticated with check (true);
create policy "Login bisa update downtime_causes"
  on public.downtime_causes for update to authenticated using (true);
create policy "Login bisa hapus downtime_causes"
  on public.downtime_causes for delete to authenticated using (true);

-- Master data: Area
create table if not exists public.downtime_areas (
  id uuid primary key default gen_random_uuid(),
  mesin machine_type not null,
  value text not null,
  created_at timestamptz not null default now(),
  unique (mesin, value)
);
alter table public.downtime_areas enable row level security;
create policy "Login bisa lihat downtime_areas"
  on public.downtime_areas for select to authenticated using (true);
create policy "Login bisa tambah downtime_areas"
  on public.downtime_areas for insert to authenticated with check (true);
create policy "Login bisa update downtime_areas"
  on public.downtime_areas for update to authenticated using (true);
create policy "Login bisa hapus downtime_areas"
  on public.downtime_areas for delete to authenticated using (true);

-- =========================================================
-- SELESAI. downtime_causes & downtime_areas mulai kosong,
-- diisi lewat tab Master Data di app (sama seperti Problem).
-- =========================================================
