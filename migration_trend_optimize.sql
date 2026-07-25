-- =========================================================
-- MIGRASI: Optimasi tren GSPH (1 query per line, bukan per-periode)
--
-- Sebelumnya dashboard menembak performance_aggregate sekali untuk TIAP
-- hari/bulan × TIAP line (mis. 31 hari × 5 line = 155 query) -- lambat.
-- Fungsi ini mengelompokkan langsung di database, jadi cukup 5 query.
-- Jalankan sekali di Supabase SQL Editor
-- =========================================================

create or replace function public.gsph_trend_bucketed(
  p_mesin machine_type,
  p_start timestamptz,
  p_end timestamptz,
  p_bucket text            -- 'hour' | 'day' | 'month'
)
returns table (bucket_start timestamptz, stroke numeric, wh_menit numeric, gsph numeric)
language sql stable
as $$
  with rows_with_ratio as (
    select
      date_trunc(p_bucket, pl.waktu_awal at time zone 'Asia/Jakarta') as b,
      pl.stasiun, pl.waktu_awal, pl.waktu_akhir,
      coalesce(pl.qty, 0) * coalesce(pn.stroke_ratio, 1) as stroke,
      coalesce(pl.break_menit, 0) as break_menit
    from public.production_log pl
    left join public.part_numbers pn
      on pn.mesin = pl.mesin and pn.value = pl.part_number
    where pl.mesin = p_mesin
      and pl.waktu_awal >= p_start
      and pl.waktu_awal < p_end
  ),
  -- durasi & break dihitung sekali per (stasiun, waktu) supaya baris part
  -- "separating" (waktu sama) tidak menggandakan jam kerja
  waktu_unik as (
    select b, stasiun, waktu_awal, waktu_akhir,
           max(break_menit) as break_menit
    from rows_with_ratio
    group by b, stasiun, waktu_awal, waktu_akhir
  ),
  wh as (
    select b,
           sum(extract(epoch from (waktu_akhir - waktu_awal)) / 60) - sum(break_menit) as wh_menit
    from waktu_unik
    group by b
  ),
  st as (
    select b, sum(stroke) as stroke
    from rows_with_ratio
    group by b
  )
  select
    st.b at time zone 'Asia/Jakarta' as bucket_start,
    st.stroke,
    coalesce(wh.wh_menit, 0) as wh_menit,
    case when coalesce(wh.wh_menit, 0) > 0
         then st.stroke / (wh.wh_menit / 60)
         else 0 end as gsph
  from st
  left join wh on wh.b = st.b
  order by st.b;
$$;
grant execute on function public.gsph_trend_bucketed(machine_type, timestamptz, timestamptz, text) to authenticated;

-- =========================================================
-- SELESAI.
-- =========================================================
