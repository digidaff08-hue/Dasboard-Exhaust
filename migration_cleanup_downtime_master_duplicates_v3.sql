-- =========================================================
-- MIGRATION v3: Bersihkan data Master Downtime yang double
-- (Perbaikan dari v2 -- kemarin gagal karena downtime_causes.problem_id
-- masih nempel ke baris Problem Kategori yang mau dihapus)
-- Standalone -- aman dijalankan dari awal, tidak butuh v1/v2 sebelumnya.
-- =========================================================

-- ============ 1. PROBLEM KATEGORI ============

-- 1a. Arahkan riwayat downtime_log yang masih pakai versi berangka,
--     ke versi TANPA angka
update public.downtime_log dl
set problem = canon.value
from public.downtime_problems numbered
join public.downtime_problems canon
  on trim(canon.value) = regexp_replace(trim(numbered.value), '^\d+\.\s*', '')
  and canon.id <> numbered.id
where dl.problem = numbered.value
  and numbered.value ~ '^\d+\.\s*';

-- 1b. Pindahkan link downtime_causes.problem_id dari versi berangka
--     ke versi tanpa angka (BARU setelah ini baris berangka boleh dihapus)
update public.downtime_causes dc
set problem_id = canon.id
from public.downtime_problems numbered
join public.downtime_problems canon
  on trim(canon.value) = regexp_replace(trim(numbered.value), '^\d+\.\s*', '')
  and canon.id <> numbered.id
where dc.problem_id = numbered.id
  and numbered.value ~ '^\d+\.\s*';

-- 1c. Hapus baris Master Data Problem Kategori yang berangka,
--     HANYA kalau versi tanpa angka-nya sudah ada
delete from public.downtime_problems numbered
using public.downtime_problems canon
where numbered.value ~ '^\d+\.\s*'
  and trim(canon.value) = regexp_replace(trim(numbered.value), '^\d+\.\s*', '')
  and canon.id <> numbered.id;

-- ============ 2. AREA ============

-- 2a. Grup duplikat (huruf besar semua + spasi rapi), baris paling lama
--     dibuat jadi "kanonik" (rn=1)
with ranked as (
  select
    da.id, da.value,
    upper(trim(regexp_replace(da.value, '\s+', ' ', 'g'))) as norm,
    row_number() over (
      partition by upper(trim(regexp_replace(da.value, '\s+', ' ', 'g')))
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
join canon on canon.norm = dup.norm
where dl.area = dup.value;

-- 2c. Hapus baris Master Data Area yang duplikat (rn > 1)
with ranked as (
  select
    da.id,
    upper(trim(regexp_replace(da.value, '\s+', ' ', 'g'))) as norm,
    row_number() over (
      partition by upper(trim(regexp_replace(da.value, '\s+', ' ', 'g')))
      order by da.created_at asc
    ) as rn
  from public.downtime_areas da
)
delete from public.downtime_areas da
using ranked r
where da.id = r.id and r.rn > 1;

-- =========================================================
-- SELESAI. Refresh halaman aplikasi, cek dropdown Problem Kategori &
-- Area -- harusnya sekarang benar-benar tidak ada yang dobel lagi.
-- =========================================================
