-- Migration: tambah kolom `repair` (pengganti mekanisme extra jsonb yang
-- bermasalah) dan hapus kolom `kategori_ng` yang memang tidak pernah dipakai
-- di production_log.
--
-- CATATAN: kolom `ng` SENGAJA TIDAK diubah/dihapus/di-rename, karena kolom
-- ini masih dipakai aktif untuk hitung Quality% & OEE di Dashboard utama
-- (index.html) dan tab Performance (machine-page.js). Rename kolom ini akan
-- diam-diam mengubah makna semua laporan Quality/OEE yang sudah ada.

alter table public.production_log
  add column if not exists repair integer;

alter table public.production_log
  drop column if exists kategori_ng;
