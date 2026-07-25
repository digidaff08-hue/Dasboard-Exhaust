-- =========================================================
-- MIGRASI: Target GSPH (2 mode) + breakdown Downtime utk Performance
-- Jalankan sekali di Supabase SQL Editor
-- =========================================================

-- 1. Setting Target GSPH per mesin
create table if not exists public.mesin_settings (
  mesin machine_type primary key,
  gsph_target_mode text not null default 'fixed' check (gsph_target_mode in ('fixed','per_part')),
  gsph_target_fixed numeric not null default 0,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.mesin_settings enable row level security;

drop policy if exists "Login bisa lihat mesin_settings" on public.mesin_settings;
create policy "Login bisa lihat mesin_settings"
  on public.mesin_settings for select to authenticated using (true);

drop policy if exists "Admin/Leader bisa insert mesin_settings" on public.mesin_settings;
create policy "Admin/Leader bisa insert mesin_settings"
  on public.mesin_settings for insert to authenticated
  with check (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')));

drop policy if exists "Admin/Leader bisa update mesin_settings" on public.mesin_settings;
create policy "Admin/Leader bisa update mesin_settings"
  on public.mesin_settings for update to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')));

-- 2. performance_aggregate: tambah kolom target (mode 'per_part' dihitung dari
--    std_ct tiap part; mode 'fixed' cukup pakai gsph_target_fixed langsung di JS,
--    tidak perlu dari sini).
drop function if exists public.performance_aggregate(machine_type, text[], timestamptz, timestamptz);
create or replace function public.performance_aggregate(
  p_mesin machine_type,
  p_stasiun_list text[],
  p_start timestamptz,
  p_end timestamptz
)
returns table (
  stroke numeric,
  ng numeric,
  dandori_menit numeric,
  downtime_menit numeric,
  break_menit numeric,
  wh_menit numeric,
  jumlah_baris bigint,
  target_std_menit numeric   -- total menit standar (utk GSPH target mode 'per_part')
)
language sql stable
as $$
  with rows_with_ratio as (
    select pl.*, coalesce(pn.stroke_ratio, 1) as ratio, pn.std_ct
    from public.production_log pl
    left join public.part_numbers pn
      on pn.mesin = pl.mesin and pn.value = pl.part_number
    where pl.mesin = p_mesin
      and (p_stasiun_list is null or pl.stasiun = any(p_stasiun_list))
      and pl.waktu_awal >= p_start
      and pl.waktu_awal < p_end
  ),
  batched_time as (
    select
      stasiun, waktu_awal, waktu_akhir,
      max(coalesce(break_menit, 0)) as break_menit,
      max(coalesce(dandori_menit, 0)) as dandori_menit,
      sum(coalesce(downtime_menit, 0)) as downtime_menit
    from rows_with_ratio
    group by stasiun, waktu_awal, waktu_akhir
  )
  select
    (select coalesce(sum(coalesce(qty, 0) * ratio), 0) from rows_with_ratio),
    (select coalesce(sum(ng), 0) from rows_with_ratio),
    (select coalesce(sum(dandori_menit), 0) from batched_time),
    (select coalesce(sum(downtime_menit), 0) from batched_time),
    (select coalesce(sum(break_menit), 0) from batched_time),
    (select coalesce(sum(extract(epoch from (waktu_akhir - waktu_awal)) / 60), 0)
       - (select coalesce(sum(break_menit), 0) from batched_time)
     from batched_time),
    (select count(*) from rows_with_ratio),
    (select coalesce(sum(coalesce(qty, 0) * ratio * std_ct), 0) from rows_with_ratio where std_ct is not null and std_ct > 0);
$$;
grant execute on function public.performance_aggregate(machine_type, text[], timestamptz, timestamptz) to authenticated;

-- 3. 5 Worst Downtime (per problem, total menit terbesar)
create or replace function public.downtime_top_problems(
  p_mesin machine_type,
  p_stasiun_list text[],
  p_start timestamptz,
  p_end timestamptz,
  p_limit int default 5
)
returns table (kategori text, problem text, total_menit numeric)
language sql stable
as $$
  select kategori, coalesce(problem, '(tanpa keterangan)') as problem,
         sum(extract(epoch from (waktu_akhir - waktu_awal)) / 60) as total_menit
  from public.downtime_log
  where mesin = p_mesin
    and (p_stasiun_list is null or stasiun = any(p_stasiun_list))
    and waktu_awal >= p_start and waktu_awal < p_end
  group by kategori, problem
  order by total_menit desc
  limit p_limit;
$$;
grant execute on function public.downtime_top_problems(machine_type, text[], timestamptz, timestamptz, int) to authenticated;

-- 4. Downtime per kategori (utk pie chart)
create or replace function public.downtime_by_category(
  p_mesin machine_type,
  p_stasiun_list text[],
  p_start timestamptz,
  p_end timestamptz
)
returns table (kategori text, total_menit numeric)
language sql stable
as $$
  select kategori, sum(extract(epoch from (waktu_akhir - waktu_awal)) / 60) as total_menit
  from public.downtime_log
  where mesin = p_mesin
    and (p_stasiun_list is null or stasiun = any(p_stasiun_list))
    and waktu_awal >= p_start and waktu_awal < p_end
  group by kategori
  order by total_menit desc;
$$;
grant execute on function public.downtime_by_category(machine_type, text[], timestamptz, timestamptz) to authenticated;

-- =========================================================
-- SELESAI.
-- =========================================================
