-- =========================================================
-- MIGRATION: Bersihkan data Master Downtime yang double
-- 1) Problem Kategori: "9. Welding bolong" vs "Welding bolong" -> pakai
--    yang TANPA angka, versi berangka dihapus (riwayat downtime_log ikut
--    diarahkan ke versi tanpa angka biar datanya tidak hilang).
-- 2) Area: duplikat beda kapitalisasi/spasi (mis. "ROBOT 1" vs "Robot 1")
--    -> disatukan, dipertahankan yang paling lama dibuat.
-- Aman dijalankan sekali. Tidak menghapus riwayat downtime manapun,
-- cuma menyeragamkan teksnya.
-- =========================================================

-- ============ 1. PROBLEM KATEGORI ============

-- 1a. Arahkan riwayat downtime_log yang masih pakai versi berangka
--     ke versi TANPA angka (kalau versi tanpa angka-nya ada)
update public.downtime_log dl
set problem = canon.value
from public.downtime_problems numbered
join public.downtime_problems canon
  on canon.mesin = numbered.mesin
  and trim(canon.value) = regexp_replace(trim(numbered.value), '^\d+\.\s*', '')
  and canon.id <> numbered.id
where dl.mesin = numbered.mesin
  and dl.problem = numbered.value
  and numbered.value ~ '^\d+\.\s*';

-- 1b. Hapus baris Master Data Problem Kategori yang berangka,
--     HANYA kalau versi tanpa angka-nya sudah ada
delete from public.downtime_problems numbered
using public.downtime_problems canon
where numbered.value ~ '^\d+\.\s*'
  and canon.mesin = numbered.mesin
  and trim(canon.value) = regexp_replace(trim(numbered.value), '^\d+\.\s*', '')
  and canon.id <> numbered.id;

-- ============ 2. AREA ============

-- 2a. Tentukan grup duplikat (disamakan: huruf besar semua + spasi rapi)
--     lalu tandai baris paling lama dibuat sebagai "kanonik" (rn = 1)
with ranked as (
  select
    da.id, da.mesin, da.value,
    upper(trim(regexp_replace(da.value, '\s+', ' ', 'g'))) as norm,
    row_number() over (
      partition by da.mesin, upper(trim(regexp_replace(da.value, '\s+', ' ', 'g')))
      order by da.created_at asc
    ) as rn
  from public.downtime_areas da
),
dup as (select * from ranked where rn > 1),
canon as (select * from ranked where rn = 1)
-- 2b. Arahkan riwayat downtime_log dari versi duplikat ke versi kanonik
update public.downtime_log dl
set area = canon.value
from dup
join canon on canon.mesin = dup.mesin and canon.norm = dup.norm
where dl.mesin = dup.mesin and dl.area = dup.value;

-- 2c. Hapus baris Master Data Area yang duplikat (rn > 1)
with ranked as (
  select
    da.id, da.mesin,
    upper(trim(regexp_replace(da.value, '\s+', ' ', 'g'))) as norm,
    row_number() over (
      partition by da.mesin, upper(trim(regexp_replace(da.value, '\s+', ' ', 'g')))
      order by da.created_at asc
    ) as rn
  from public.downtime_areas da
)
delete from public.downtime_areas da
using ranked r
where da.id = r.id and r.rn > 1;

-- =========================================================
-- SELESAI. Cek lagi dropdown Problem Kategori & Area di form Downtime,
-- harusnya sudah tidak ada yang dobel.
-- =========================================================
