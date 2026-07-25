-- =========================================================
-- MIGRASI: Breakdown per Part Number (tab Performance) +
-- Achievement/Delivery (Planning vs Aktual)
-- Jalankan sekali di Supabase SQL Editor
-- =========================================================

-- 1. Breakdown per Part Number -- utk tabel detail di tab Performance
--    (mirip contoh "Daily Status" yang Anda kirim: Qty, Earned, Operasi, GSPH per part)
create or replace function public.performance_by_part(
  p_mesin machine_type,
  p_stasiun_list text[],
  p_start timestamptz,
  p_end timestamptz
)
returns table (
  part_number text,
  qty numeric,
  stroke numeric,
  operasi_menit numeric,
  earned_menit numeric,
  gsph numeric,
  jumlah_baris bigint
)
language sql stable
as $$
  select
    pl.part_number,
    sum(coalesce(pl.qty, 0)) as qty,
    sum(coalesce(pl.qty, 0) * coalesce(pn.stroke_ratio, 1)) as stroke,
    sum(extract(epoch from (pl.waktu_akhir - pl.waktu_awal)) / 60) as operasi_menit,
    sum(coalesce(pl.qty, 0) * coalesce(pn.stroke_ratio, 1) * coalesce(pn.std_ct, 0)) as earned_menit,
    case when sum(extract(epoch from (pl.waktu_akhir - pl.waktu_awal)) / 60) > 0
      then sum(coalesce(pl.qty, 0) * coalesce(pn.stroke_ratio, 1))
           / (sum(extract(epoch from (pl.waktu_akhir - pl.waktu_awal)) / 60) / 60)
      else 0 end as gsph,
    count(*) as jumlah_baris
  from public.production_log pl
  left join public.part_numbers pn
    on pn.mesin = pl.mesin and pn.value = pl.part_number
  where pl.mesin = p_mesin
    and (p_stasiun_list is null or pl.stasiun = any(p_stasiun_list))
    and pl.waktu_awal >= p_start and pl.waktu_awal < p_end
  group by pl.part_number
  order by stroke desc;
$$;
grant execute on function public.performance_by_part(machine_type, text[], timestamptz, timestamptz) to authenticated;

-- 2. Achievement (Delivery) -- total qty aktual vs qty rencana (Planning),
--    utk periode yang sama.
create or replace function public.achievement_summary(
  p_mesin machine_type,
  p_stasiun_list text[],
  p_start timestamptz,
  p_end timestamptz
)
returns table (qty_rencana numeric, qty_aktual numeric, achievement_pct numeric)
language sql stable
as $$
  with rencana as (
    select coalesce(sum(qty_rencana), 0) as total
    from public.production_planning
    where mesin = p_mesin
      and (p_stasiun_list is null or stasiun = any(p_stasiun_list))
      and jam_rencana_mulai >= p_start and jam_rencana_mulai < p_end
  ),
  aktual as (
    select coalesce(sum(qty), 0) as total
    from public.production_log
    where mesin = p_mesin
      and (p_stasiun_list is null or stasiun = any(p_stasiun_list))
      and waktu_awal >= p_start and waktu_awal < p_end
  )
  select
    rencana.total, aktual.total,
    case when rencana.total > 0 then (aktual.total / rencana.total) * 100 else null end
  from rencana, aktual;
$$;
grant execute on function public.achievement_summary(machine_type, text[], timestamptz, timestamptz) to authenticated;

-- =========================================================
-- SELESAI.
-- =========================================================
