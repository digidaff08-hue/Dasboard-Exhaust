-- =========================================================
-- UPDATE 6 RPC Dashboard "Kontrol Kualitas" (NG Inline & NG Trial)
-- supaya Value diambil dari ng_inline_log.value (Qty x Harga Area)
-- -- BUKAN LAGI dari qty x part_numbers.harga_pcs.
--
-- Ini yang bikin Dashboard Exhaust belum nampilin Value walau
-- data di tabel ng_inline_log sudah keisi -- 6 function ini
-- sebelumnya masih pakai rumus lama.
--
-- Aman dijalankan berkali-kali (create or replace).
-- =========================================================

create or replace function public.dashboard_qc_ng_daily(p_type_ng text, p_start timestamp with time zone, p_end timestamp with time zone)
 returns table(tanggal date, qty numeric, value numeric)
 language sql
 stable
as $function$
  select
    n.tanggal,
    sum(n.qty) as qty,
    sum(n.value) as value
  from public.ng_inline_log n
  where n.type_ng = p_type_ng
    and n.tanggal >= p_start::date and n.tanggal < p_end::date
  group by 1
  order by 1;
$function$;

create or replace function public.dashboard_qc_ng_detail(p_type_ng text, p_tanggal date)
 returns table(model text, mesin machine_type, part_number text, area text, ng_proses text, qty numeric, ng_kategori text, value numeric)
 language sql
 stable
as $function$
  select
    n.model,
    n.mesin,
    n.part_number,
    n.area,
    n.ng_proses,
    n.qty,
    n.ng_kategori,
    n.value as value
  from public.ng_inline_log n
  where n.type_ng = p_type_ng
    and n.tanggal = p_tanggal
  order by n.created_at desc;
$function$;

create or replace function public.dashboard_qc_ng_detail_range(p_type_ng text, p_start date, p_end date)
 returns table(model text, mesin machine_type, part_number text, area text, ng_proses text, qty numeric, ng_kategori text, value numeric, tanggal date)
 language sql
 stable
as $function$
  select
    n.model,
    n.mesin,
    n.part_number,
    n.area,
    n.ng_proses,
    n.qty,
    n.ng_kategori,
    n.value as value,
    n.tanggal
  from public.ng_inline_log n
  where n.type_ng = p_type_ng
    and n.tanggal >= p_start
    and n.tanggal <  p_end
  order by n.tanggal asc, n.created_at desc;
$function$;

create or replace function public.dashboard_qc_ng_month(p_type_ng text, p_start timestamp with time zone, p_end timestamp with time zone)
 returns table(bulan date, qty numeric, value numeric)
 language sql
 stable
as $function$
  select
    date_trunc('month', n.tanggal)::date as bulan,
    sum(n.qty) as qty,
    sum(n.value) as value
  from public.ng_inline_log n
  where n.type_ng = p_type_ng
    and n.tanggal >= p_start::date and n.tanggal < p_end::date
  group by 1
  order by 1;
$function$;

create or replace function public.dashboard_qc_ng_perline(p_type_ng text, p_start timestamp with time zone, p_end timestamp with time zone)
 returns table(mesin machine_type, qty numeric, value numeric)
 language sql
 stable
as $function$
  select
    n.mesin,
    sum(n.qty) as qty,
    sum(n.value) as value
  from public.ng_inline_log n
  where n.type_ng = p_type_ng
    and n.tanggal >= p_start::date and n.tanggal < p_end::date
  group by 1
  order by 1;
$function$;

create or replace function public.dashboard_qc_ng_permodel(p_type_ng text, p_start timestamp with time zone, p_end timestamp with time zone)
 returns table(model text, qty numeric, value numeric)
 language sql
 stable
as $function$
  select
    n.model,
    sum(n.qty) as qty,
    sum(n.value) as value
  from public.ng_inline_log n
  where n.type_ng = p_type_ng
    and n.tanggal >= p_start::date and n.tanggal < p_end::date
  group by 1
  order by 1;
$function$;

-- =========================================================
-- SELESAI. Refresh halaman Dashboard Exhaust (F5), Value NG Inline
-- (bulanan, per line, per model, harian, rekap detail) seharusnya
-- sudah muncul.
-- =========================================================
