-- =========================================================
-- CEK: angka "Aktual" di tab Plan Harian ambil dari mana?
--
-- Jawabannya: dari tabel production_log, lewat fungsi
-- public.plan_produksi_actual(tanggal) -- lihat
-- migration_plan_produksi.sql baris 97.
--
-- File ini TIDAK mengubah apa pun. Isinya cuma query pemeriksaan,
-- supaya kamu bisa buktikan sendiri angkanya cocok.
-- Jalankan di Supabase SQL Editor. Ganti tanggalnya sesuai kebutuhan.
-- =========================================================

-- Ganti tanggal di tiga tempat di bawah kalau mau tanggal lain.

-- ---------------------------------------------------------
-- 1) Angka yang DIPAKAI dashboard (hasil fungsinya)
-- ---------------------------------------------------------
select mesin, part_number, shift, qty_aktual
  from public.plan_produksi_actual('2026-10-24'::date)
 order by mesin, part_number, shift;

-- ---------------------------------------------------------
-- 2) Hitung ULANG langsung dari production_log, tanpa fungsi.
--    Hasilnya HARUS sama persis dengan nomor 1. Kalau beda,
--    berarti fungsi di database belum sama dengan yang di
--    migration_plan_produksi.sql (perlu dijalankan ulang).
-- ---------------------------------------------------------
select
  pl.mesin,
  pl.part_number,
  case
    when (pl.waktu_awal at time zone 'Asia/Jakarta')::time >= time '07:00'
     and (pl.waktu_awal at time zone 'Asia/Jakarta')::time <  time '19:30'
    then 1 else 2
  end as shift,
  sum(coalesce(pl.qty, 0)) as qty_aktual
from public.production_log pl
where pl.part_number is not null
  and pl.waktu_awal >= ('2026-10-24'::timestamp at time zone 'Asia/Jakarta') + interval '7 hour'
  and pl.waktu_awal <  ('2026-10-24'::timestamp at time zone 'Asia/Jakarta') + interval '1 day 7 hour'
group by pl.mesin, pl.part_number, 3
order by pl.mesin, pl.part_number, 3;

-- ---------------------------------------------------------
-- 3) Baris produksi yang TIDAK terhitung: part_number kosong.
--    Qty di baris-baris ini tidak muncul di Plan Harian karena
--    tidak bisa ditempelkan ke part mana pun. Kalau jumlahnya
--    besar, berarti ada operator yang input produksi tanpa
--    memilih part number.
-- ---------------------------------------------------------
select pl.mesin, count(*) as jumlah_baris, sum(coalesce(pl.qty, 0)) as qty_tidak_terhitung
from public.production_log pl
where pl.part_number is null
  and pl.waktu_awal >= ('2026-10-24'::timestamp at time zone 'Asia/Jakarta') + interval '7 hour'
  and pl.waktu_awal <  ('2026-10-24'::timestamp at time zone 'Asia/Jakarta') + interval '1 day 7 hour'
group by pl.mesin
order by pl.mesin;
