-- =========================================================
-- Kolom ringkasan "FY SEBELUMNYA" untuk tab Tahunan
--
-- Tiap grafik di tab Tahunan punya DUA kolom ringkasan di paling kiri:
--   kolom 1 = FY sebelumnya  (diisi TANGAN di Master Data > Dashboard FY)
--   kolom 2 = FY berjalan    (dihitung sendiri dari 12 bulan di sebelahnya)
--
-- Kolom FY sebelumnya diisi tangan karena data tahun lama belum tentu
-- lengkap di sistem. Angka ini SELALU dipakai, tidak peduli saklar
-- "Pakai data manual" menyala atau tidak -- saklar itu urusan angka
-- 12 bulan, bukan kolom ringkasan ini.
--
-- SATUAN (penting, salah isi bikin grafiknya tidak terbaca):
--   productivity_fy_prev  : persen, rata-rata setahun          (mis. 92.4)
--   availability_fy_prev  : persen, rata-rata setahun          (mis. 96.1)
--   sp_fy_prev            : persen, rata-rata setahun          (mis. 98.7)
--   downtime_fy_prev_menit: menit, RATA-RATA PER BULAN         (mis. 4333)
--   ng_qty_fy_prev        : jumlah, RATA-RATA PER BULAN        (mis. 121)
--   ng_value_fy_prev      : rupiah, RATA-RATA PER BULAN        (mis. 1208000)
--   ng_trial_qty_fy_prev  : jumlah, RATA-RATA PER BULAN        (mis. 35)
--   ng_trial_value_fy_prev: rupiah, RATA-RATA PER BULAN        (mis. 350000)
--   sp_repair_fy_prev     : jumlah, RATA-RATA PER BULAN        (mis. 300)
--
-- Yang satuannya jumlah sengaja rata-rata per bulan, BUKAN total setahun.
-- Kalau diisi total, batangnya jadi dua belas kali lipat batang bulanan
-- di sebelahnya, dan batang bulanannya tergencet jadi garis tipis.
--
-- Kolom downtime_fy_prev_menit sudah ada sejak dulu, tidak dibuat ulang.
-- Dikosongkan = kolomnya tidak digambar di grafik (bukan nol).
--
-- Tidak menyentuh data yang sudah ada. Aman dijalankan berulang.
-- =========================================================

alter table public.fy_override
  add column if not exists productivity_fy_prev numeric,
  add column if not exists availability_fy_prev numeric,
  add column if not exists ng_qty_fy_prev       numeric,
  add column if not exists ng_value_fy_prev     numeric,
  add column if not exists ng_trial_qty_fy_prev   numeric,
  add column if not exists ng_trial_value_fy_prev numeric,
  add column if not exists sp_fy_prev           numeric,
  add column if not exists sp_repair_fy_prev    numeric;

-- Cek hasilnya:
-- select column_name, data_type
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'fy_override'
--  order by ordinal_position;
