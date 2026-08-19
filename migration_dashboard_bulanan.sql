-- =========================================================
-- MIGRATION: Dashboard Exhaust — Tab Bulanan
-- Jalankan sekali di atas schema_welding.sql + schema_ng_inline.sql
-- yang sudah ada (butuh part_numbers.harga_pcs & ng_inline_log).
--
-- Definisi yang dipakai:
-- - PRODUCTIVITY  = Performance factor bulanan (GSPH aktual / target GSPH), max 100%
-- - AVAILABILITY  = (Jam Kerja - Downtime) / Jam Kerja x 100
-- - STRAIGHTPASS  = (Stroke - (NG Produksi + NG Inline)) / Stroke x 100
-- - Target garis putus-putus tiap kartu = tetap 100% (bisa diubah nanti
--   kalau butuh target per bulan yang berbeda-beda)
-- - "Plan" di Downtime Supporting/Line = target manual, diinput admin/leader,
--   disimpan di tabel downtime_plan_bulanan (baru)
-- - Weekly Breakdown = minggu kalender ISO (Senin-Minggu)
-- =========================================================

-- 1. Tabel Plan/Target Downtime Bulanan (diisi manual oleh admin/leader)
create table if not exists public.downtime_plan_bulanan (
  id uuid primary key default gen_random_uuid(),
  periode date not null,                 -- tanggal 1 di bulan terkait, mis. 2026-04-01
  dimensi text not null check (dimensi in ('pic', 'line')),
  kode text not null,                    -- nilai PIC (PE/MESIN/QC/PC-SUPP/PROD/PRESS) atau kode Line (E-02..E-07)
  target_menit numeric not null default 0,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (periode, dimensi, kode)
);

alter table public.downtime_plan_bulanan enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'downtime_plan_bulanan' and policyname = 'Login bisa lihat downtime_plan_bulanan') then
    create policy "Login bisa lihat downtime_plan_bulanan" on public.downtime_plan_bulanan for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'downtime_plan_bulanan' and policyname = 'Admin/Leader bisa insert downtime_plan_bulanan') then
    create policy "Admin/Leader bisa insert downtime_plan_bulanan" on public.downtime_plan_bulanan for insert to authenticated
      with check (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'downtime_plan_bulanan' and policyname = 'Admin/Leader bisa update downtime_plan_bulanan') then
    create policy "Admin/Leader bisa update downtime_plan_bulanan" on public.downtime_plan_bulanan for update to authenticated
      using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'downtime_plan_bulanan' and policyname = 'Admin/Leader bisa hapus downtime_plan_bulanan') then
    create policy "Admin/Leader bisa hapus downtime_plan_bulanan" on public.downtime_plan_bulanan for delete to authenticated
      using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')));
  end if;
end $$;

drop trigger if exists trg_downtime_plan_bulanan_updated on public.downtime_plan_bulanan;
create trigger trg_downtime_plan_bulanan_updated
  before update on public.downtime_plan_bulanan
  for each row execute procedure public.set_updated_meta();

-- =========================================================
-- 2. RPC: ringkasan produksi bulanan (semua line digabung),
--    di-bucket per bulan -- dipakai buat kartu Productivity &
--    Availability + trend Downtime Exhaust.
-- =========================================================
create or replace function public.dashboard_bulanan_produksi(
  p_start timestamptz,
  p_end timestamptz
)
returns table (
  bulan date,
  stroke numeric,
  ng numeric,
  wh_menit numeric,
  downtime_menit numeric,
  target_std_menit numeric
)
language sql stable
as $$
  with rows_with_ratio as (
    select
      date_trunc('month', pl.waktu_awal at time zone 'Asia/Jakarta')::date as bulan,
      pl.mesin, pl.stasiun, pl.waktu_awal, pl.waktu_akhir,
      coalesce(pl.qty, 0) * coalesce(pn.stroke_ratio, 1) as stroke,
      coalesce(pl.ng, 0) as ng,
      coalesce(pl.break_menit, 0) as break_menit,
      coalesce(pl.downtime_menit, 0) as downtime_menit,
      coalesce(pl.qty, 0) * coalesce(pn.stroke_ratio, 1) * coalesce(pn.std_ct, 0) as std_menit
    from public.production_log pl
    left join public.part_numbers pn
      on pn.mesin = pl.mesin and pn.value = pl.part_number
    where pl.waktu_awal >= p_start and pl.waktu_awal < p_end
  ),
  batched_time as (
    select bulan, mesin, stasiun, waktu_awal, waktu_akhir,
           max(break_menit) as break_menit,
           sum(downtime_menit) as downtime_menit
    from rows_with_ratio
    group by bulan, mesin, stasiun, waktu_awal, waktu_akhir
  )
  select
    r.bulan,
    sum(r.stroke) as stroke,
    sum(r.ng) as ng,
    (select coalesce(sum(extract(epoch from (waktu_akhir - waktu_awal)) / 60), 0)
       - coalesce(sum(break_menit), 0)
     from batched_time bt where bt.bulan = r.bulan) as wh_menit,
    (select coalesce(sum(downtime_menit), 0) from batched_time bt where bt.bulan = r.bulan) as downtime_menit,
    sum(r.std_menit) as target_std_menit
  from rows_with_ratio r
  group by r.bulan
  order by r.bulan;
$$;
grant execute on function public.dashboard_bulanan_produksi(timestamptz, timestamptz) to authenticated;

-- =========================================================
-- 3. RPC: NG Inline bulanan (semua line digabung) -- qty & value
-- =========================================================
create or replace function public.dashboard_bulanan_ng_inline(
  p_start timestamptz,
  p_end timestamptz
)
returns table (bulan date, qty numeric, value numeric)
language sql stable
as $$
  select
    date_trunc('month', n.tanggal)::date as bulan,
    sum(n.qty) as qty,
    sum(n.value) as value
  from public.ng_inline_log n
  where n.tanggal >= p_start::date and n.tanggal < p_end::date
  group by 1
  order by 1;
$$;
grant execute on function public.dashboard_bulanan_ng_inline(timestamptz, timestamptz) to authenticated;

-- =========================================================
-- 4. RPC: Downtime bulanan per PIC (Downtime Supporting) --
--    Actual dari downtime_log, Plan dari downtime_plan_bulanan
-- =========================================================
create or replace function public.dashboard_bulanan_downtime_by_pic(
  p_start timestamptz,
  p_end timestamptz
)
returns table (pic text, plan_menit numeric, act_menit numeric)
language sql stable
as $$
  with act as (
    select coalesce(pic, '(kosong)') as pic,
           sum(extract(epoch from (waktu_akhir - waktu_awal)) / 60) as menit
    from public.downtime_log
    where waktu_awal >= p_start and waktu_awal < p_end
    group by 1
  ),
  plan as (
    select kode as pic, sum(target_menit) as menit
    from public.downtime_plan_bulanan
    where dimensi = 'pic'
      and periode >= date_trunc('month', p_start::date)
      and periode < date_trunc('month', p_end::date) + interval '1 month'
    group by 1
  )
  select coalesce(act.pic, plan.pic) as pic,
         coalesce(plan.menit, 0) as plan_menit,
         coalesce(act.menit, 0) as act_menit
  from act
  full outer join plan on plan.pic = act.pic
  order by 1;
$$;
grant execute on function public.dashboard_bulanan_downtime_by_pic(timestamptz, timestamptz) to authenticated;

-- =========================================================
-- 5. RPC: Downtime bulanan per Line (Downtime Line)
-- =========================================================
create or replace function public.dashboard_bulanan_downtime_by_line(
  p_start timestamptz,
  p_end timestamptz
)
returns table (mesin machine_type, plan_menit numeric, act_menit numeric)
language sql stable
as $$
  with act as (
    select dl.mesin,
           sum(extract(epoch from (dl.waktu_akhir - dl.waktu_awal)) / 60) as menit
    from public.downtime_log dl
    where dl.waktu_awal >= p_start and dl.waktu_awal < p_end
    group by 1
  ),
  plan as (
    select kode::machine_type as mesin, sum(target_menit) as menit
    from public.downtime_plan_bulanan
    where dimensi = 'line'
      and periode >= date_trunc('month', p_start::date)
      and periode < date_trunc('month', p_end::date) + interval '1 month'
    group by 1
  )
  select coalesce(act.mesin, plan.mesin) as mesin,
         coalesce(plan.menit, 0) as plan_menit,
         coalesce(act.menit, 0) as act_menit
  from act
  full outer join plan on plan.mesin = act.mesin
  order by 1;
$$;
grant execute on function public.dashboard_bulanan_downtime_by_line(timestamptz, timestamptz) to authenticated;

-- =========================================================
-- 6. RPC: Weekly Breakdown -- total downtime per minggu ISO (Senin-Minggu)
--    per line, dalam rentang tanggal yang diminta.
-- =========================================================
create or replace function public.dashboard_bulanan_weekly(
  p_start timestamptz,
  p_end timestamptz
)
returns table (minggu_mulai date, mesin machine_type, downtime_menit numeric)
language sql stable
as $$
  select
    date_trunc('week', dl.waktu_awal at time zone 'Asia/Jakarta')::date as minggu_mulai,
    dl.mesin,
    sum(extract(epoch from (dl.waktu_akhir - dl.waktu_awal)) / 60) as downtime_menit
  from public.downtime_log dl
  where dl.waktu_awal >= p_start and dl.waktu_awal < p_end
  group by 1, 2
  order by 1, 2;
$$;
grant execute on function public.dashboard_bulanan_weekly(timestamptz, timestamptz) to authenticated;

-- =========================================================
-- 7. RPC: Downtime Terbesar per line (top-N, sudah termasuk PIC)
--    -- versi bulanan dari downtime_top_problems yang sudah ada
-- =========================================================
create or replace function public.dashboard_bulanan_top_problems(
  p_mesin machine_type,
  p_start timestamptz,
  p_end timestamptz,
  p_limit int default 5
)
returns table (pic text, problem text, total_menit numeric)
language sql stable
as $$
  select coalesce(pic, '(kosong)') as pic,
         coalesce(problem, '(tanpa keterangan)') as problem,
         sum(extract(epoch from (waktu_akhir - waktu_awal)) / 60) as total_menit
  from public.downtime_log
  where mesin = p_mesin
    and waktu_awal >= p_start and waktu_awal < p_end
  group by 1, 2
  order by total_menit desc
  limit p_limit;
$$;
grant execute on function public.dashboard_bulanan_top_problems(machine_type, timestamptz, timestamptz, int) to authenticated;

-- =========================================================
-- SELESAI. Setelah dijalankan:
-- 1. Isi target GSPH per line seperti biasa (mesin_settings) --
--    dipakai utk hitung target_std_menit -> Productivity.
-- 2. Isi Plan bulanan (downtime_plan_bulanan) lewat tab Master Data
--    baru "Plan Downtime Bulanan" (akan dibuatkan form-nya menyusul)
--    -- atau isi manual dulu lewat SQL Editor / Table Editor Supabase,
--    contoh:
--      insert into public.downtime_plan_bulanan (periode, dimensi, kode, target_menit)
--      values ('2026-04-01', 'pic', 'MESIN', 1000),
--             ('2026-04-01', 'line', 'E-02', 400);
-- =========================================================
