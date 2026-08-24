-- =========================================================
-- MIGRATION: Aktifkan Supabase Realtime
-- Jalankan SEKALI di Supabase SQL Editor. Aman dijalankan
-- berulang (idempotent -- cek dulu sebelum nambahin ke publication).
--
-- KENAPA: Supaya begitu ada user/HP mana pun simpan/ubah/hapus data
-- Produksi, Downtime, Non-Produksi, NG Inline, atau Repair, semua
-- device/tab lain yang lagi buka halaman line yang sama otomatis
-- ke-update (lihat assets/machine-page.js -> initRealtime()),
-- TANPA perlu reload manual.
--
-- Default-nya Supabase TIDAK mengirim event realtime untuk tabel
-- baru sampai tabel itu didaftarkan ke publication khusus bernama
-- `supabase_realtime`. Ini yang dilakukan migration ini.
--
-- REPLICA IDENTITY FULL diperlukan supaya waktu ada UPDATE/DELETE,
-- Postgres ikut kirim ISI LENGKAP baris LAMA (bukan cuma primary
-- key-nya) -- dipakai misalnya buat tahu view_id punya Point Repair
-- yang baru dihapus.
-- =========================================================

-- 1) Tambahkan tabel ke publication supabase_realtime (kalau belum ada)
do $$
declare
  t text;
  tables text[] := array[
    'production_log', 'production_log_new', 'downtime_log',
    'dandori_log', 'ng_inline_log', 'repair_log',
    'repair_points', 'repair_views'
  ];
begin
  foreach t in array tables loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- 2) REPLICA IDENTITY FULL supaya payload old record lengkap
alter table public.production_log      replica identity full;
alter table public.production_log_new  replica identity full;
alter table public.downtime_log        replica identity full;
alter table public.dandori_log         replica identity full;
alter table public.ng_inline_log       replica identity full;
alter table public.repair_log          replica identity full;
alter table public.repair_points       replica identity full;
alter table public.repair_views        replica identity full;

-- =========================================================
-- SELESAI. Tidak perlu restart apa pun -- efeknya langsung aktif.
-- Kalau mau cek: buka 1 line yang sama di 2 tab/HP berbeda, simpan
-- data (Produksi/Downtime/NG Inline/Repair) di salah satunya, tab
-- yang lain harus otomatis ke-update dalam ~1 detik tanpa reload.
-- =========================================================
