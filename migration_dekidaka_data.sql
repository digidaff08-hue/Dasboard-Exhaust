-- =====================================================================
-- Migration: ISI DATA papan Dekidaka (Hasil Aktual per blok waktu,
-- Part Number, Dandori, + kartu ringkasan per shift).
--
-- Melengkapi migration_dekidaka.sql yang sudah ada (downtime & repair
-- qty). Konvensinya SAMA PERSIS dengan fungsi dashboard_* lain:
--   * p_start / p_end dikirim dashboard sebagai 00:00 WIB tanggal
--     terpilih s/d 00:00 WIB hari berikutnya, lalu DI DALAM fungsi ini
--     digeser +7 jam -> jendela sebenarnya 07:00 WIB s/d 07:00 WIB hari
--     berikutnya (1 "hari produksi" penuh). Lihat
--     migration_fix_hari_produksi_shift.sql.
--   * p_shift '1' = 07:00-19:30 WIB, selain itu '2' -- persis seperti
--     dashboard_dekidaka_repair_qty yang sudah ada.
--
-- CATATAN: baris Target / Rasio Dekidaka / Selisih / Akumulasi Selisih
-- BELUM diisi di sini -- rumus targetnya masih menunggu keputusan.
-- =====================================================================

-- 1) Baris produksi 1 line + 1 shift, lengkap dgn jam mulai & model,
--    dipakai papan Dekidaka untuk menempelkan Hasil Aktual / Part Number
--    / Dandori ke blok waktu yang sesuai (pencocokannya di sisi JS,
--    sama seperti dashboard_dekidaka_downtime_rows).
--
--    model: di-lookup dari master ng_model_parts (part_no -> model),
--    dipakai memilih papan kolom mana (mis. E-02 punya kolom "YHA/YR9"
--    dan "K15B"). Kalau part-nya belum terdaftar di master, model = null
--    dan JS akan mencoba mencocokkan dari teks part number-nya.
--
--    stasiun + jam_akhir ikut dikirim supaya JS bisa membuang duplikat
--    saat menjumlah Dandori: 1 jendela waktu yang sama bisa punya
--    beberapa baris (part berbeda) dengan dandori_menit yang sama, jadi
--    kalau dijumlah mentah hasilnya dobel. Perlakuan ini sama dengan
--    performance_aggregate yang mengambil max() per (stasiun, waktu).
CREATE OR REPLACE FUNCTION public.dashboard_dekidaka_production_rows(
  p_mesin machine_type,
  p_start timestamp with time zone,
  p_end timestamp with time zone,
  p_shift text
)
 RETURNS TABLE(
   jam text,
   jam_akhir text,
   stasiun text,
   part_number text,
   model text,
   qty numeric,
   repair numeric,
   dandori_menit numeric
 )
 LANGUAGE sql
 STABLE
AS $function$
  select
    to_char(pl.waktu_awal  at time zone 'Asia/Jakarta', 'HH24:MI') as jam,
    to_char(pl.waktu_akhir at time zone 'Asia/Jakarta', 'HH24:MI') as jam_akhir,
    coalesce(pl.stasiun, '')                                       as stasiun,
    coalesce(pl.part_number, '')                                   as part_number,
    mp.model                                                       as model,
    coalesce(pl.qty, 0)                                            as qty,
    coalesce(pl.repair, 0)                                         as repair,
    coalesce(pl.dandori_menit, 0)                                  as dandori_menit
  from public.production_log pl
  left join lateral (
    select nmp.model
    from public.ng_model_parts nmp
    where nmp.part_no = pl.part_number
    limit 1
  ) mp on true
  where pl.mesin = p_mesin
    and pl.waktu_awal >= p_start + interval '7 hours'
    and pl.waktu_awal <  p_end + interval '7 hours'
    and (
      case
        when (pl.waktu_awal at time zone 'Asia/Jakarta')::time >= time '07:00'
         and (pl.waktu_awal at time zone 'Asia/Jakarta')::time <  time '19:30'
        then '1'
        else '2'
      end
    ) = p_shift
  order by pl.waktu_awal;
$function$;

grant execute on function public.dashboard_dekidaka_production_rows(machine_type, timestamptz, timestamptz, text) to authenticated;

-- 2) Ringkasan 1 line + 1 shift untuk kartu di kanan papan:
--    Jam Produksi, Qty Produksi, Downtime (menit), Repair Qty.
--
--    Cara hitung jam kerja & downtime MENIRU performance_aggregate:
--    baris produksi dikelompokkan dulu per (stasiun, waktu_awal,
--    waktu_akhir) supaya 1 jendela waktu yang berisi beberapa part tidak
--    dihitung berkali-kali; break diambil max() per kelompok, downtime
--    dijumlah.
--
--    Kartu di papan nanti dihitung dari angka-angka ini:
--      Downtime Rasio     = downtime_menit / jam_produksi_menit * 100
--      Straight Pass Rasio= (qty_produksi - repair_qty) / qty_produksi * 100
--    (rumus Straightpass sama dengan kartu Straightpass dashboard:
--     (produksi - repair) / produksi; di papan ini satuannya pcs.)
CREATE OR REPLACE FUNCTION public.dashboard_dekidaka_summary(
  p_mesin machine_type,
  p_start timestamp with time zone,
  p_end timestamp with time zone,
  p_shift text
)
 RETURNS TABLE(
   jam_produksi_menit numeric,
   qty_produksi numeric,
   repair_qty numeric,
   downtime_menit numeric
 )
 LANGUAGE sql
 STABLE
AS $function$
  with rows_shift as (
    select pl.*
    from public.production_log pl
    where pl.mesin = p_mesin
      and pl.waktu_awal >= p_start + interval '7 hours'
      and pl.waktu_awal <  p_end + interval '7 hours'
      and (
        case
          when (pl.waktu_awal at time zone 'Asia/Jakarta')::time >= time '07:00'
           and (pl.waktu_awal at time zone 'Asia/Jakarta')::time <  time '19:30'
          then '1'
          else '2'
        end
      ) = p_shift
  ),
  batched_time as (
    select
      stasiun, waktu_awal, waktu_akhir,
      max(coalesce(break_menit, 0))    as break_menit,
      sum(coalesce(downtime_menit, 0)) as downtime_menit
    from rows_shift
    group by stasiun, waktu_awal, waktu_akhir
  )
  select
    (select coalesce(sum(extract(epoch from (waktu_akhir - waktu_awal)) / 60), 0)
          - coalesce(sum(break_menit), 0)
     from batched_time),
    (select coalesce(sum(qty), 0)    from rows_shift),
    (select coalesce(sum(repair), 0) from rows_shift),
    (select coalesce(sum(downtime_menit), 0) from batched_time);
$function$;

grant execute on function public.dashboard_dekidaka_summary(machine_type, timestamptz, timestamptz, text) to authenticated;
