-- ============================================================
-- Target KPI Bulanan (NG Ratio & Straight Pass)
-- Dipakai kartu "Ringkasan Bulan" di Dashboard Line.
--
-- Satu angka per bulan, berlaku untuk SEMUA line (E-02..E-07).
-- Diisi lewat halaman Data Dashboard > panel "Target KPI Bulanan".
--
-- Aman dijalankan berulang kali.
-- ============================================================

-- 1. Tabel -----------------------------------------------------
create table if not exists public.kpi_target (
  tahun                smallint not null,
  bulan                smallint not null check (bulan between 1 and 12),
  -- Keduanya boleh kosong: kalau NULL, kartunya tampil polos tanpa
  -- target dan tanpa emotikon (tidak dianggap target 0).
  ng_ratio_target      numeric,         -- persen, makin KECIL makin bagus
  straight_pass_target numeric,         -- persen, makin BESAR makin bagus
  updated_by           uuid references auth.users(id),
  updated_at           timestamptz not null default now(),
  primary key (tahun, bulan)
);

comment on table public.kpi_target is
  'Target bulanan NG Ratio & Straight Pass, berlaku untuk semua line.';

alter table public.kpi_target enable row level security;

-- 2. Hak akses -- pola yang sama dengan mesin_settings ----------
drop policy if exists "Login bisa lihat kpi_target" on public.kpi_target;
create policy "Login bisa lihat kpi_target"
  on public.kpi_target for select to authenticated using (true);

drop policy if exists "Admin/Leader bisa insert kpi_target" on public.kpi_target;
create policy "Admin/Leader bisa insert kpi_target"
  on public.kpi_target for insert to authenticated
  with check (exists (select 1 from public.profiles
                      where id = auth.uid() and role in ('admin','leader')));

drop policy if exists "Admin/Leader bisa update kpi_target" on public.kpi_target;
create policy "Admin/Leader bisa update kpi_target"
  on public.kpi_target for update to authenticated
  using (exists (select 1 from public.profiles
                 where id = auth.uid() and role in ('admin','leader')));

drop policy if exists "Admin/Leader bisa hapus kpi_target" on public.kpi_target;
create policy "Admin/Leader bisa hapus kpi_target"
  on public.kpi_target for delete to authenticated
  using (exists (select 1 from public.profiles
                 where id = auth.uid() and role in ('admin','leader')));

-- 3. Isi awal (OPSIONAL) ---------------------------------------
-- Hapus tanda komentar di bawah dan ganti angkanya kalau mau
-- langsung terisi. Kalau tidak, isi saja lewat form di halaman
-- Data Dashboard -- hasilnya sama.
--
-- insert into public.kpi_target (tahun, bulan, ng_ratio_target, straight_pass_target)
-- values (2026, 11, 0.05, 95)
-- on conflict (tahun, bulan) do update
--   set ng_ratio_target      = excluded.ng_ratio_target,
--       straight_pass_target = excluded.straight_pass_target,
--       updated_at           = now();

-- 4. Pemeriksaan -----------------------------------------------
select tahun, bulan, ng_ratio_target, straight_pass_target, updated_at
from public.kpi_target
order by tahun desc, bulan desc;
