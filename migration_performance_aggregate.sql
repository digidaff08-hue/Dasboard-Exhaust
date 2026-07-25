-- =========================================================
-- MIGRASI: Agregasi Performance di database (server-side)
-- Menghindari batas 50.000 baris di sisi browser yang bikin data
-- kepotong untuk mesin/periode dengan volume besar.
-- Jalankan sekali di Supabase SQL Editor.
-- =========================================================

create or replace function public.performance_aggregate(
  p_mesin machine_type,
  p_stasiun_list text[],   -- null = semua stasiun (mesin single-line / semua)
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
  jumlah_baris bigint
)
language sql stable
as $$
  -- STROKE pakai rasio per part (Output x Separating dari CT TIME, kolom
  -- stroke_ratio) -- cocok dengan formula asli Excel: STROKE = qty x rasio.
  -- Tidak perlu dedup baris utk stroke, karena rasio sudah menangani
  -- pembagian yang benar utk part "separating" (pasangan, waktu sama).
  --
  -- WH/Break/Dandori TETAP dikelompokkan per (stasiun,waktu_awal,waktu_akhir)
  -- supaya durasi waktu yang sama tidak ke-dobel-jumlah kalau tercatat
  -- di 2+ baris part sekaligus (sudah di-nolkan di baris ke-2+ saat import).
  with rows_with_ratio as (
    select pl.*, coalesce(pn.stroke_ratio, 1) as ratio
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
    (select count(*) from rows_with_ratio);
$$;

grant execute on function public.performance_aggregate(machine_type, text[], timestamptz, timestamptz) to authenticated;

-- =========================================================
-- SELESAI. Uji coba di SQL Editor:
-- select * from performance_aggregate('tandem', null, '2026-03-01', '2026-04-01');
-- =========================================================
