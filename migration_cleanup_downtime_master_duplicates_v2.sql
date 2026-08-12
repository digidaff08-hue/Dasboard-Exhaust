-- =========================================================
-- MIGRATION v2: Bersihkan data Master Downtime yang double
-- (Perbaikan dari migration_cleanup_downtime_master_duplicates.sql)
--
-- Ternyata kolom `mesin` di downtime_problems / downtime_areas TIDAK
-- dipakai aplikasi (listnya sudah global utk semua line). Versi v1
-- kemarin gagal karena syaratnya "mesin harus sama persis", padahal
-- banyak baris lama mesin-nya NULL sementara pasangannya E-02/dst --
-- makanya tidak pernah dianggap "pasangan". Migration ini menghapus
-- syarat mesin itu sepenuhnya, cocokkan HANYA dari teksnya.
--
-- Aman dijalankan meski migration v1 sudah pernah dijalankan duluan.
-- =========================================================

-- ============ 1. PROBLEM KATEGORI ============

-- 1a. Arahkan riwayat downtime_log yang masih pakai versi berangka,
--     ke versi TANPA angka (kalau versi tanpa angka-nya ada di mana pun)
update public.downtime_log dl
set problem = canon.value
from public.downtime_problems numbered
join public.downtime_problems canon
  on trim(canon.value) = regexp_replace(trim(numbered.value), '^\d+\.\s*', '')
  and canon.id <> numbered.id
where dl.problem = numbered.value
  and numbered.value ~ '^\d+\.\s*';

-- 1b. Hapus baris Master Data Problem Kategori yang berangka,
--     HANYA kalau versi tanpa angka-nya sudah ada (di mana pun)
delete from public.downtime_problems numbered
using public.downtime_problems canon
where numbered.value ~ '^\d+\.\s*'
  and trim(canon.value) = regexp_replace(trim(numbered.value), '^\d+\.\s*', '')
  and canon.id <> numbered.id;

-- ============ 2. AREA ============

-- 2a. Tentukan grup duplikat (disamakan: huruf besar semua + spasi rapi),
--     TANPA syarat mesin -- baris paling lama dibuat jadi "kanonik" (rn=1)
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
