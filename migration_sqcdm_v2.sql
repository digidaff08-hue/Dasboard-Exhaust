-- =========================================================
-- MIGRASI: Cuti di absensi + Scrap Top End + Safety
-- Jalankan sekali di Supabase SQL Editor
-- =========================================================

-- 1. Kolom cuti di absensi (utk grafik Moral 2 versi: include & exclude cuti)
alter table public.attendance_log add column if not exists cuti integer not null default 0;

-- Perbarui ringkasan absensi supaya ikut bawa angka cuti
drop function if exists public.attendance_summary(date, date);
create or replace function public.attendance_summary(
  p_start date,
  p_end date
)
returns table (total_orang numeric, hadir numeric, cuti numeric, absen numeric, overtime_jam numeric, jumlah_hari bigint)
language sql stable
as $$
  select
    coalesce(sum(total_orang), 0),
    coalesce(sum(hadir), 0),
    coalesce(sum(cuti), 0),
    coalesce(sum(absen), 0),
    coalesce(sum(overtime_jam), 0),
    count(*)
  from public.attendance_log
  where tanggal >= p_start and tanggal < p_end;
$$;
grant execute on function public.attendance_summary(date, date) to authenticated;

-- 2. Scrap Top End (data bulanan, satuan K IDR sesuai laporan aslinya)
create table if not exists public.scrap_top_end (
  id uuid primary key default gen_random_uuid(),
  tahun integer not null,
  bulan integer not null check (bulan between 1 and 12),
  scrap_value_kidr numeric not null default 0,   -- Scrap Top End Value (K IDR)
  total_value_kidr numeric not null default 0,   -- Total Value produksi (K IDR)
  target_rasio numeric,                          -- mis. 0.0046
  created_at timestamptz not null default now(),
  unique (tahun, bulan)
);
alter table public.scrap_top_end enable row level security;

drop policy if exists "Login bisa lihat scrap_top_end" on public.scrap_top_end;
create policy "Login bisa lihat scrap_top_end"
  on public.scrap_top_end for select to authenticated using (true);
drop policy if exists "Admin/Leader kelola scrap_top_end" on public.scrap_top_end;
create policy "Admin/Leader kelola scrap_top_end"
  on public.scrap_top_end for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')));

create or replace function public.scrap_top_end_summary(
  p_start date,
  p_end date
)
returns table (scrap_value_kidr numeric, total_value_kidr numeric, rasio numeric, target_rasio numeric)
language sql stable
as $$
  with f as (
    select * from public.scrap_top_end
    where make_date(tahun, bulan, 1) >= date_trunc('month', p_start)::date
      and make_date(tahun, bulan, 1) < p_end
  )
  select
    coalesce(sum(scrap_value_kidr), 0),
    coalesce(sum(total_value_kidr), 0),
    case when coalesce(sum(total_value_kidr),0) > 0
      then sum(scrap_value_kidr) / sum(total_value_kidr) else 0 end,
    coalesce(avg(target_rasio), 0)
  from f;
$$;
grant execute on function public.scrap_top_end_summary(date, date) to authenticated;

-- 3. Safety (catatan insiden; kalau kosong = 0 accident)
create table if not exists public.safety_log (
  id uuid primary key default gen_random_uuid(),
  tanggal date not null,
  kategori text not null default 'ACCIDENT',
  keterangan text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.safety_log enable row level security;

drop policy if exists "Login bisa lihat safety_log" on public.safety_log;
create policy "Login bisa lihat safety_log"
  on public.safety_log for select to authenticated using (true);
drop policy if exists "Admin/Leader kelola safety_log" on public.safety_log;
create policy "Admin/Leader kelola safety_log"
  on public.safety_log for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')));

-- Hitung accident + hari sejak insiden terakhir (utk kartu Safety)
create or replace function public.safety_summary(
  p_start date,
  p_end date
)
returns table (accident_count bigint, hari_tanpa_accident integer)
language sql stable
as $$
  select
    (select count(*) from public.safety_log
      where tanggal >= p_start and tanggal < p_end and kategori = 'ACCIDENT'),
    (select coalesce(
      (current_date - max(tanggal))::integer,
      (current_date - date '2024-04-01')::integer  -- belum pernah ada insiden sejak FY2024
    ) from public.safety_log where kategori = 'ACCIDENT');
$$;
grant execute on function public.safety_summary(date, date) to authenticated;

-- =========================================================
-- SELESAI.
-- =========================================================
