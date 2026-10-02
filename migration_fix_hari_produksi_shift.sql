-- =========================================================
-- FIX: "hari produksi" (batas hari jam 07:00 WIB, bukan 00:00)
-- belum konsisten diterapkan di semua RPC yang baca production_log /
-- downtime_log. Akibatnya data Shift 2 (19:30 - 07:00 keesokan hari)
-- yang waktu_awal-nya sudah lewat tengah malam (00:00-06:59 WIB) ikut
-- "nyasar" ke bulan/tanggal BERIKUTNYA, padahal shift itu masih bagian
-- hari sebelumnya.
--
-- dashboard_harian_produksi & dashboard_bulanan_weekly SUDAH benar
-- (sudah pakai pola "- interval '7 hours'"). Migration ini menyamakan
-- SEMUA fungsi lain yang baca production_log/downtime_log supaya pakai
-- pola yang sama persis: baik di FILTER (p_start/p_end) maupun di
-- BUCKET tanggal/bulan (kalau ada).
--
-- Fungsi yang baca ng_inline_log/repair_log TIDAK disentuh di sini --
-- itu filter pakai kolom "tanggal" (date murni, bukan timestamp),
-- jadi tidak kena masalah pergeseran jam di level SQL ini.
-- =========================================================

-- ============ 1) dashboard_harian_downtime_by_line ============
CREATE OR REPLACE FUNCTION public.dashboard_harian_downtime_by_line(p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(mesin machine_type, act_menit numeric)
 LANGUAGE sql
 STABLE
AS $function$
  select
    dl.mesin,
    sum(extract(epoch from (dl.waktu_akhir - dl.waktu_awal)) / 60) as act_menit
  from public.downtime_log dl
  where dl.waktu_awal >= p_start + interval '7 hours'
    and dl.waktu_awal <  p_end + interval '7 hours'
  group by 1
  order by 1;
$function$;

-- ============ 2) dashboard_harian_downtime_by_pic (tanpa p_mesin) ============
CREATE OR REPLACE FUNCTION public.dashboard_harian_downtime_by_pic(p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(pic text, act_menit numeric)
 LANGUAGE sql
 STABLE
AS $function$
  select
    coalesce(pic, '(kosong)') as pic,
    sum(extract(epoch from (waktu_akhir - waktu_awal)) / 60) as act_menit
  from public.downtime_log
  where waktu_awal >= p_start + interval '7 hours'
    and waktu_awal <  p_end + interval '7 hours'
  group by 1
  order by 1;
$function$;

-- ============ 3) dashboard_harian_downtime_by_pic (dengan p_mesin) ============
CREATE OR REPLACE FUNCTION public.dashboard_harian_downtime_by_pic(p_start timestamp with time zone, p_end timestamp with time zone, p_mesin machine_type DEFAULT NULL::machine_type)
 RETURNS TABLE(pic text, act_menit numeric)
 LANGUAGE sql
 STABLE
AS $function$
  select
    coalesce(pic, '(kosong)') as pic,
    sum(extract(epoch from (waktu_akhir - waktu_awal)) / 60) as act_menit
  from public.downtime_log
  where waktu_awal >= p_start + interval '7 hours'
    and waktu_awal <  p_end + interval '7 hours'
    and (p_mesin is null or mesin = p_mesin)
  group by 1
  order by 1;
$function$;

-- ============ 4) dashboard_bulanan_top_problems_summary (tanpa p_mesin) ============
CREATE OR REPLACE FUNCTION public.dashboard_bulanan_top_problems_summary(p_start timestamp with time zone, p_end timestamp with time zone, p_limit integer DEFAULT 10)
 RETURNS TABLE(problem text, total_menit numeric, frekuensi bigint)
 LANGUAGE sql
 STABLE
AS $function$
  select
    coalesce(problem, '(tanpa keterangan)') as problem,
    sum(extract(epoch from (waktu_akhir - waktu_awal)) / 60) as total_menit,
    count(*) as frekuensi
  from public.downtime_log
  where waktu_awal >= p_start + interval '7 hours'
    and waktu_awal <  p_end + interval '7 hours'
  group by 1
  order by total_menit desc
  limit p_limit;
$function$;

-- ============ 5) dashboard_bulanan_top_problems_summary (dengan p_mesin) ============
CREATE OR REPLACE FUNCTION public.dashboard_bulanan_top_problems_summary(p_start timestamp with time zone, p_end timestamp with time zone, p_limit integer DEFAULT 10, p_mesin machine_type DEFAULT NULL::machine_type)
 RETURNS TABLE(problem text, total_menit numeric, frekuensi bigint)
 LANGUAGE sql
 STABLE
AS $function$
  select
    coalesce(problem, '(tanpa keterangan)') as problem,
    sum(extract(epoch from (waktu_akhir - waktu_awal)) / 60) as total_menit,
    count(*) as frekuensi
  from public.downtime_log
  where waktu_awal >= p_start + interval '7 hours'
    and waktu_awal <  p_end + interval '7 hours'
    and (p_mesin is null or mesin = p_mesin)
  group by 1
  order by total_menit desc
  limit p_limit;
$function$;

-- ============ 6) dashboard_bulanan_weekly (filter disamakan; bucket minggu sudah benar sebelumnya) ============
CREATE OR REPLACE FUNCTION public.dashboard_bulanan_weekly(p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(minggu_mulai date, mesin machine_type, downtime_menit numeric)
 LANGUAGE sql
 STABLE
AS $function$
  select
    date_trunc('week', (dl.waktu_awal at time zone 'Asia/Jakarta') - interval '7 hours')::date as minggu_mulai,
    dl.mesin,
    sum(extract(epoch from (dl.waktu_akhir - dl.waktu_awal)) / 60) as downtime_menit
  from public.downtime_log dl
  where dl.waktu_awal >= p_start + interval '7 hours'
    and dl.waktu_awal <  p_end + interval '7 hours'
  group by 1, 2
  order by 1, 2;
$function$;

-- ============ 7) dashboard_harian_produksi (tanpa p_mesin) ============
CREATE OR REPLACE FUNCTION public.dashboard_harian_produksi(p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(tanggal date, wh_menit numeric, downtime_menit numeric, target_std_menit numeric)
 LANGUAGE sql
 STABLE
AS $function$
  with prod_union as (
    select mesin, stasiun, waktu_awal, waktu_akhir, qty, part_number, break_menit
    from public.production_log
    where waktu_awal >= p_start + interval '7 hours' and waktu_awal < p_end + interval '7 hours'
    union all
    select mesin, stasiun, waktu_awal, waktu_akhir, qty, part_number, break_menit
    from public.production_log_new
    where waktu_awal >= p_start + interval '7 hours' and waktu_awal < p_end + interval '7 hours'
  ),
  rows_with_ratio as (
    select
      (date_trunc('day', (pu.waktu_awal at time zone 'Asia/Jakarta') - interval '7 hours'))::date as tanggal,
      pu.mesin, pu.stasiun, pu.waktu_awal, pu.waktu_akhir,
      coalesce(pu.break_menit, 0) as break_menit,
      coalesce(pu.qty, 0) * coalesce(pn.stroke_ratio, 1) * coalesce(pn.std_ct, 0) as std_menit
    from prod_union pu
    left join public.part_numbers pn
      on pn.mesin = pu.mesin and pn.value = pu.part_number
  ),
  batched_time as (
    select tanggal, mesin, stasiun, waktu_awal, waktu_akhir,
           max(break_menit) as break_menit
    from rows_with_ratio
    group by tanggal, mesin, stasiun, waktu_awal, waktu_akhir
  ),
  wh_per_tanggal as (
    select tanggal,
           coalesce(sum(extract(epoch from (waktu_akhir - waktu_awal)) / 60), 0)
             - coalesce(sum(break_menit), 0) as wh_menit
    from batched_time
    group by tanggal
  ),
  std_per_tanggal as (
    select tanggal, sum(std_menit) as target_std_menit
    from rows_with_ratio
    group by tanggal
  ),
  downtime_per_tanggal as (
    select
      (date_trunc('day', (dl.waktu_awal at time zone 'Asia/Jakarta') - interval '7 hours'))::date as tanggal,
      sum(extract(epoch from (dl.waktu_akhir - dl.waktu_awal)) / 60) as downtime_menit
    from public.downtime_log dl
    where dl.waktu_awal >= p_start + interval '7 hours' and dl.waktu_awal < p_end + interval '7 hours'
    group by 1
  )
  select
    coalesce(w.tanggal, s.tanggal, d.tanggal) as tanggal,
    coalesce(w.wh_menit, 0) as wh_menit,
    coalesce(d.downtime_menit, 0) as downtime_menit,
    coalesce(s.target_std_menit, 0) as target_std_menit
  from wh_per_tanggal w
  full outer join std_per_tanggal s on s.tanggal = w.tanggal
  full outer join downtime_per_tanggal d on d.tanggal = coalesce(w.tanggal, s.tanggal)
  order by 1;
$function$;

-- ============ 8) dashboard_harian_produksi (dengan p_mesin) ============
CREATE OR REPLACE FUNCTION public.dashboard_harian_produksi(p_start timestamp with time zone, p_end timestamp with time zone, p_mesin machine_type DEFAULT NULL::machine_type)
 RETURNS TABLE(tanggal date, wh_menit numeric, downtime_menit numeric, target_std_menit numeric)
 LANGUAGE sql
 STABLE
AS $function$
  with prod_union as (
    select mesin, stasiun, waktu_awal, waktu_akhir, qty, part_number, break_menit
    from public.production_log
    where waktu_awal >= p_start + interval '7 hours' and waktu_awal < p_end + interval '7 hours'
      and (p_mesin is null or mesin = p_mesin)
    union all
    select mesin, stasiun, waktu_awal, waktu_akhir, qty, part_number, break_menit
    from public.production_log_new
    where waktu_awal >= p_start + interval '7 hours' and waktu_awal < p_end + interval '7 hours'
      and (p_mesin is null or mesin = p_mesin)
  ),
  rows_with_ratio as (
    select
      (date_trunc('day', (pu.waktu_awal at time zone 'Asia/Jakarta') - interval '7 hours'))::date as tanggal,
      pu.mesin, pu.stasiun, pu.waktu_awal, pu.waktu_akhir,
      coalesce(pu.break_menit, 0) as break_menit,
      coalesce(pu.qty, 0) * coalesce(pn.stroke_ratio, 1) * coalesce(pn.std_ct, 0) as std_menit
    from prod_union pu
    left join public.part_numbers pn
      on pn.mesin = pu.mesin and pn.value = pu.part_number
  ),
  batched_time as (
    select tanggal, mesin, stasiun, waktu_awal, waktu_akhir,
           max(break_menit) as break_menit
    from rows_with_ratio
    group by tanggal, mesin, stasiun, waktu_awal, waktu_akhir
  ),
  wh_per_tanggal as (
    select tanggal,
           coalesce(sum(extract(epoch from (waktu_akhir - waktu_awal)) / 60), 0)
             - coalesce(sum(break_menit), 0) as wh_menit
    from batched_time
    group by tanggal
  ),
  std_per_tanggal as (
    select tanggal, sum(std_menit) as target_std_menit
    from rows_with_ratio
    group by tanggal
  ),
  downtime_per_tanggal as (
    select
      (date_trunc('day', (dl.waktu_awal at time zone 'Asia/Jakarta') - interval '7 hours'))::date as tanggal,
      sum(extract(epoch from (dl.waktu_akhir - dl.waktu_awal)) / 60) as downtime_menit
    from public.downtime_log dl
    where dl.waktu_awal >= p_start + interval '7 hours' and dl.waktu_awal < p_end + interval '7 hours'
      and (p_mesin is null or dl.mesin = p_mesin)
    group by 1
  )
  select
    coalesce(w.tanggal, s.tanggal, d.tanggal) as tanggal,
    coalesce(w.wh_menit, 0) as wh_menit,
    coalesce(d.downtime_menit, 0) as downtime_menit,
    coalesce(s.target_std_menit, 0) as target_std_menit
  from wh_per_tanggal w
  full outer join std_per_tanggal s on s.tanggal = w.tanggal
  full outer join downtime_per_tanggal d on d.tanggal = coalesce(w.tanggal, s.tanggal)
  order by 1;
$function$;

-- ============ 9) dashboard_bulanan_downtime_by_line (cuma CTE "act" yang disentuh) ============
CREATE OR REPLACE FUNCTION public.dashboard_bulanan_downtime_by_line(p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(mesin machine_type, plan_menit numeric, act_menit numeric)
 LANGUAGE sql
 STABLE
AS $function$
  with act as (
    select dl.mesin,
           sum(extract(epoch from (dl.waktu_akhir - dl.waktu_awal)) / 60) as menit
    from public.downtime_log dl
    where dl.waktu_awal >= p_start + interval '7 hours'
      and dl.waktu_awal <  p_end + interval '7 hours'
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
$function$;

-- ============ 10) dashboard_bulanan_problem_detail_by_line ============
CREATE OR REPLACE FUNCTION public.dashboard_bulanan_problem_detail_by_line(p_problem text, p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(mesin machine_type, total_menit numeric, frekuensi bigint)
 LANGUAGE sql
 STABLE
AS $function$
  select
    mesin,
    sum(extract(epoch from (waktu_akhir - waktu_awal)) / 60) as total_menit,
    count(*) as frekuensi
  from public.downtime_log
  where coalesce(problem, '(tanpa keterangan)') = p_problem
    and waktu_awal >= p_start + interval '7 hours'
    and waktu_awal <  p_end + interval '7 hours'
  group by mesin
  order by total_menit desc;
$function$;

-- ============ 11) dashboard_bulanan_top_problems ============
CREATE OR REPLACE FUNCTION public.dashboard_bulanan_top_problems(p_mesin machine_type, p_start timestamp with time zone, p_end timestamp with time zone, p_limit integer DEFAULT 5)
 RETURNS TABLE(pic text, problem text, total_menit numeric)
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce(pic, '(kosong)') as pic,
         coalesce(problem, '(tanpa keterangan)') as problem,
         sum(extract(epoch from (waktu_akhir - waktu_awal)) / 60) as total_menit
  from public.downtime_log
  where mesin = p_mesin
    and waktu_awal >= p_start + interval '7 hours'
    and waktu_awal <  p_end + interval '7 hours'
  group by 1, 2
  order by total_menit desc
  limit p_limit;
$function$;

-- ============ 12) dashboard_harian_top_problems (label Shift 1/2 TIDAK diubah, cuma filter) ============
CREATE OR REPLACE FUNCTION public.dashboard_harian_top_problems(p_mesin machine_type, p_start timestamp with time zone, p_end timestamp with time zone, p_limit integer DEFAULT 5)
 RETURNS TABLE(pic text, problem text, area text, countermeasure text, status text, shift text, total_menit numeric)
 LANGUAGE sql
 STABLE
AS $function$
  select
    coalesce(pic, '(kosong)') as pic,
    coalesce(problem, '(tanpa keterangan)') as problem,
    coalesce(area, '(kosong)') as area,
    coalesce(countermeasure, '(kosong)') as countermeasure,
    coalesce(status, '(kosong)') as status,
    case
      when (waktu_awal at time zone 'Asia/Jakarta')::time >= time '07:00'
       and (waktu_awal at time zone 'Asia/Jakarta')::time <  time '19:30'
      then 'Shift 1'
      else 'Shift 2'
    end as shift,
    extract(epoch from (waktu_akhir - waktu_awal)) / 60 as total_menit
  from public.downtime_log
  where mesin = p_mesin
    and waktu_awal >= p_start + interval '7 hours'
    and waktu_awal <  p_end + interval '7 hours'
  order by total_menit desc nulls last
  limit p_limit;
$function$;

-- ============ 13) dashboard_qc_produksi_daily (filter disamakan; bucket harian sudah benar) ============
CREATE OR REPLACE FUNCTION public.dashboard_qc_produksi_daily(p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(tanggal date, stroke numeric, ng numeric)
 LANGUAGE sql
 STABLE
AS $function$
  select
    (date_trunc('day', (pl.waktu_awal at time zone 'Asia/Jakarta') - interval '7 hours'))::date as tanggal,
    sum(coalesce(pl.qty, 0) * coalesce(pn.stroke_ratio, 1)) as stroke,
    sum(coalesce(pl.ng, 0)) as ng
  from public.production_log pl
  left join public.part_numbers pn
    on pn.mesin = pl.mesin and pn.value = pl.part_number
  where pl.waktu_awal >= p_start + interval '7 hours'
    and pl.waktu_awal <  p_end + interval '7 hours'
  group by 1;
$function$;

-- ============ 14) dashboard_qc_produksi_perline ============
CREATE OR REPLACE FUNCTION public.dashboard_qc_produksi_perline(p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(mesin machine_type, stroke numeric, ng numeric)
 LANGUAGE sql
 STABLE
AS $function$
  select
    pl.mesin,
    sum(coalesce(pl.qty, 0) * coalesce(pn.stroke_ratio, 1)) as stroke,
    sum(coalesce(pl.ng, 0)) as ng
  from public.production_log pl
  left join public.part_numbers pn
    on pn.mesin = pl.mesin and pn.value = pl.part_number
  where pl.waktu_awal >= p_start + interval '7 hours'
    and pl.waktu_awal <  p_end + interval '7 hours'
  group by pl.mesin;
$function$;

-- ============ 15) dashboard_qc_produksi_permodel ============
CREATE OR REPLACE FUNCTION public.dashboard_qc_produksi_permodel(p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(model text, stroke numeric, ng numeric)
 LANGUAGE sql
 STABLE
AS $function$
  select
    nmp.model,
    sum(coalesce(pl.qty, 0) * coalesce(pn.stroke_ratio, 1)) as stroke,
    sum(coalesce(pl.ng, 0)) as ng
  from public.production_log pl
  left join public.part_numbers pn
    on pn.mesin = pl.mesin and pn.value = pl.part_number
  left join public.ng_model_parts nmp
    on nmp.part_no = pl.part_number
  where pl.waktu_awal >= p_start + interval '7 hours'
    and pl.waktu_awal <  p_end + interval '7 hours'
    and nmp.model is not null
  group by nmp.model;
$function$;

-- ============ 16) dashboard_qc_repair_daily (filter disamakan; bucket harian sudah benar) ============
CREATE OR REPLACE FUNCTION public.dashboard_qc_repair_daily(p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(tanggal date, qty numeric)
 LANGUAGE sql
 STABLE
AS $function$
  select
    (date_trunc('day', (pl.waktu_awal at time zone 'Asia/Jakarta') - interval '7 hours'))::date as tanggal,
    sum(coalesce(pl.repair, 0)) as qty
  from public.production_log pl
  where pl.waktu_awal >= p_start + interval '7 hours'
    and pl.waktu_awal <  p_end + interval '7 hours'
  group by 1;
$function$;

-- ============ 17) dashboard_qc_repair_month (filter + bucket "bulan" DIPERBAIKI, dulu mentah) ============
CREATE OR REPLACE FUNCTION public.dashboard_qc_repair_month(p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(bulan date, mesin machine_type, qty numeric)
 LANGUAGE sql
 STABLE
AS $function$
  select
    (date_trunc('month', (pl.waktu_awal at time zone 'Asia/Jakarta') - interval '7 hours'))::date as bulan,
    pl.mesin,
    sum(coalesce(pl.repair, 0)) as qty
  from public.production_log pl
  where pl.waktu_awal >= p_start + interval '7 hours'
    and pl.waktu_awal <  p_end + interval '7 hours'
  group by 1, 2
  order by 1, 2;
$function$;

-- ============ 18) dashboard_qc_repair_perline ============
CREATE OR REPLACE FUNCTION public.dashboard_qc_repair_perline(p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(mesin machine_type, qty numeric)
 LANGUAGE sql
 STABLE
AS $function$
  select
    pl.mesin,
    sum(coalesce(pl.repair, 0)) as qty
  from public.production_log pl
  where pl.waktu_awal >= p_start + interval '7 hours'
    and pl.waktu_awal <  p_end + interval '7 hours'
  group by pl.mesin;
$function$;

-- ============ 19) dashboard_qc_repair_permodel ============
CREATE OR REPLACE FUNCTION public.dashboard_qc_repair_permodel(p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(model text, qty numeric)
 LANGUAGE sql
 STABLE
AS $function$
  select
    nmp.model,
    sum(coalesce(pl.repair, 0)) as qty
  from public.production_log pl
  left join public.ng_model_parts nmp
    on nmp.part_no = pl.part_number
  where pl.waktu_awal >= p_start + interval '7 hours'
    and pl.waktu_awal <  p_end + interval '7 hours'
    and nmp.model is not null
  group by nmp.model;
$function$;

-- ============ 20) dashboard_tahunan_downtime_act_by_pic_perline ============
CREATE OR REPLACE FUNCTION public.dashboard_tahunan_downtime_act_by_pic_perline(p_mesin machine_type, p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(pic text, act_menit numeric)
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce(pic, '(kosong)') as pic,
         sum(extract(epoch from (waktu_akhir - waktu_awal)) / 60) as act_menit
  from public.downtime_log
  where waktu_awal >= p_start + interval '7 hours'
    and waktu_awal <  p_end + interval '7 hours'
    and mesin = p_mesin
  group by 1
  order by 1;
$function$;

-- ============ 21) dashboard_bulanan_produksi (filter + bucket "bulan" DIPERBAIKI, dulu mentah) ============
CREATE OR REPLACE FUNCTION public.dashboard_bulanan_produksi(p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(bulan date, mesin machine_type, stroke numeric, ng numeric, wh_menit numeric, downtime_menit numeric, target_std_menit numeric)
 LANGUAGE sql
 STABLE
AS $function$
  with rows_with_ratio as (
    select
      (date_trunc('month', (pl.waktu_awal at time zone 'Asia/Jakarta') - interval '7 hours'))::date as bulan,
      pl.mesin, pl.stasiun, pl.waktu_awal, pl.waktu_akhir,
      coalesce(pl.qty, 0) * coalesce(pn.stroke_ratio, 1) as stroke,
      coalesce(pl.ng, 0) as ng,
      coalesce(pl.break_menit, 0) as break_menit,
      coalesce(pl.downtime_menit, 0) as downtime_menit,
      coalesce(pl.qty, 0) * coalesce(pn.stroke_ratio, 1) * coalesce(pn.std_ct, 0) as std_menit
    from public.production_log pl
    left join public.part_numbers pn
      on pn.mesin = pl.mesin and pn.value = pl.part_number
    where pl.waktu_awal >= p_start + interval '7 hours'
      and pl.waktu_awal <  p_end + interval '7 hours'
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
    r.mesin,
    sum(r.stroke) as stroke,
    sum(r.ng) as ng,
    (select coalesce(sum(extract(epoch from (waktu_akhir - waktu_awal)) / 60), 0)
       - coalesce(sum(break_menit), 0)
     from batched_time bt where bt.bulan = r.bulan and bt.mesin = r.mesin) as wh_menit,
    (select coalesce(sum(downtime_menit), 0)
     from batched_time bt where bt.bulan = r.bulan and bt.mesin = r.mesin) as downtime_menit,
    sum(r.std_menit) as target_std_menit
  from rows_with_ratio r
  group by r.bulan, r.mesin
  order by r.bulan, r.mesin;
$function$;
