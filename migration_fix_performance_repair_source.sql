-- =========================================================
-- FIX #3: Kartu "Repair" di tab Performance harus ambil dari
-- kolom production_log.repair (diisi langsung di form Input
-- Produksi NEW), BUKAN dari tabel repair_log (menu "Repair"
-- 3D yang terpisah -- itu buat plot titik kerusakan body part).
-- =========================================================

create or replace function public.performance_aggregate(
  p_mesin machine_type,
  p_stasiun_list text[],
  p_start timestamptz,
  p_end timestamptz
)
returns table (
  stroke numeric,
  ng numeric,
  ng_value numeric,
  dandori_menit numeric,
  downtime_menit numeric,
  break_menit numeric,
  wh_menit numeric,
  jumlah_baris bigint,
  target_std_menit numeric,
  repair_qty numeric
)
language sql stable
as $$
  with rows_with_ratio as (
    select pl.*, coalesce(pn.stroke_ratio, 1) as ratio, pn.std_ct, pn.harga_pcs
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
    (select coalesce(sum(nil.qty), 0) from public.ng_inline_log nil
       where nil.mesin = p_mesin
         and nil.tanggal >= (p_start at time zone 'Asia/Jakarta')::date
         and nil.tanggal < (p_end at time zone 'Asia/Jakarta')::date),
    (select coalesce(sum(nil.value), 0) from public.ng_inline_log nil
       where nil.mesin = p_mesin
         and nil.tanggal >= (p_start at time zone 'Asia/Jakarta')::date
         and nil.tanggal < (p_end at time zone 'Asia/Jakarta')::date),
    (select coalesce(sum(dandori_menit), 0) from batched_time),
    (select coalesce(sum(downtime_menit), 0) from batched_time),
    (select coalesce(sum(break_menit), 0) from batched_time),
    (select coalesce(sum(extract(epoch from (waktu_akhir - waktu_awal)) / 60), 0)
       - (select coalesce(sum(break_menit), 0) from batched_time)
     from batched_time),
    (select count(*) from rows_with_ratio),
    (select coalesce(sum(coalesce(qty, 0) * ratio * std_ct), 0) from rows_with_ratio where std_ct is not null and std_ct > 0),
    (select coalesce(sum(repair), 0) from rows_with_ratio);
$$;
grant execute on function public.performance_aggregate(machine_type, text[], timestamptz, timestamptz) to authenticated;

-- =========================================================
-- SELESAI. Refresh halaman Performance (Ctrl+Shift+R).
-- =========================================================
