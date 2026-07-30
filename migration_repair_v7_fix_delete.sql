-- =========================================================
-- MIGRATION: Perbaiki tombol Hapus di Repair - Model 3D Part
-- Jalankan sekali setelah migration_repair_v6_per_line.sql
-- Aman dijalankan berulang.
--
-- MASALAH: kolom repair_log.view_id nunjuk ke repair_views(id)
-- TANPA aturan "on delete", jadi kalau part itu SUDAH PERNAH ada
-- riwayat Repair-nya (repair_log), Postgres nolak dihapus (error
-- foreign key constraint) -- makanya tombol "Hapus" kelihatan
-- kayak tidak berfungsi.
--
-- PERBAIKAN: ganti jadi "on delete set null". Riwayat Repair lama
-- TETAP aman/tidak hilang (nama part-nya sudah kesimpen terpisah
-- di kolom point_label), cuma kaitannya ke part 3D yang dihapus
-- jadi kosong.
-- =========================================================

alter table public.repair_log drop constraint if exists repair_log_view_id_fkey;
alter table public.repair_log
  add constraint repair_log_view_id_fkey
  foreign key (view_id) references public.repair_views(id) on delete set null;

-- =========================================================
-- SELESAI. Sekarang part 3D yang sudah ada riwayat Repair-nya
-- juga bisa dihapus lewat tombol "Hapus" di Master Data > Repair.
-- =========================================================
