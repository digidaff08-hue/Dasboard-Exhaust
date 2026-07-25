-- =========================================================
-- MIGRASI: Fungsi pendukung Dashboard baru (trend per jam & status mesin)
-- Jalankan sekali di Supabase SQL Editor
-- =========================================================

-- 1. Trend GSPH per jam (utk grafik garis di dashboard)
create or replace function public.gsph_hourly(
  p_mesin machine_type,
  p_start timestamptz,
  p_end timestamptz
)
returns table (jam int, stroke numeric, wh_menit numeric, gsph numeric)
language sql stable
as $$
  with rows_with_ratio as (
    select pl.*, coalesce(pn.stroke_ratio, 1) as ratio,
           extract(hour from pl.waktu_awal at time zone 'Asia/Jakarta')::int as jam_mulai
    from public.production_log pl
    left join public.part_numbers pn
      on pn.mesin = pl.mesin and pn.value = pl.part_number
    where pl.mesin = p_mesin
      and pl.waktu_awal >= p_start and pl.waktu_awal < p_end
  ),
  per_jam as (
    select
      jam_mulai as jam,
      sum(coalesce(qty,0) * ratio) as stroke,
      sum(extract(epoch from (waktu_akhir - waktu_awal))/60) - sum(coalesce(break_menit,0)) as wh_menit
    from rows_with_ratio
    group by jam_mulai
  )
  select jam, stroke, wh_menit,
         case when wh_menit > 0 then stroke / (wh_menit/60) else 0 end as gsph
  from per_jam
  order by jam;
$$;
grant execute on function public.gsph_hourly(machine_type, timestamptz, timestamptz) to authenticated;

-- 2. Status mesin terkini (baris produksi paling akhir per mesin/stasiun)
create or replace function public.machine_live_status(
  p_start timestamptz,
  p_end timestamptz
)
returns table (
  mesin machine_type,
  stasiun text,
  part_number text,
  waktu_awal timestamptz,
  waktu_akhir timestamptz,
  qty numeric,
  stroke numeric,
  gsph numeric,
  downtime_menit numeric
)
language sql stable
as $$
  with ranked as (
    select pl.*, coalesce(pn.stroke_ratio,1) as ratio,
           row_number() over (partition by pl.mesin, pl.stasiun order by pl.waktu_awal desc) as rn
    from public.production_log pl
    left join public.part_numbers pn
      on pn.mesin = pl.mesin and pn.value = pl.part_number
    where pl.waktu_awal >= p_start and pl.waktu_awal < p_end
  )
  select
    mesin, stasiun, part_number, waktu_awal, waktu_akhir,
    qty,
    (coalesce(qty,0) * ratio) as stroke,
    case
      when (extract(epoch from (waktu_akhir - waktu_awal))/60 - coalesce(break_menit,0)) > 0
      then (coalesce(qty,0) * ratio) / ((extract(epoch from (waktu_akhir - waktu_awal))/60 - coalesce(break_menit,0))/60)
      else 0
    end as gsph,
    coalesce(downtime_menit, 0) as downtime_menit
  from ranked
  where rn = 1
  order by mesin, stasiun;
$$;
grant execute on function public.machine_live_status(timestamptz, timestamptz) to authenticated;

-- =========================================================
-- SELESAI.
-- =========================================================
