-- =========================================================
-- RESET: Hapus semua objek dari schema_welding.sql (kalau ada sisa
-- dari percobaan run sebelumnya) supaya bisa di-run ulang dari nol.
-- AMAN dijalankan walau sebagian/semua objek belum ada (pakai IF EXISTS).
-- Jalankan file ini DULU, baru jalankan ulang schema_welding.sql.
-- =========================================================

-- Trigger di auth.users (bukan di schema public, harus di-drop terpisah)
drop trigger if exists on_auth_user_created on auth.users;

-- Tabel (CASCADE otomatis bawa serta policy, index, trigger miliknya)
drop table if exists public.safety_log cascade;
drop table if exists public.scrap_top_end cascade;
drop table if exists public.attendance_log cascade;
drop table if exists public.mesin_settings cascade;
drop table if exists public.production_planning cascade;
drop table if exists public.nonproduksi_types cascade;
drop table if exists public.downtime_problems cascade;
drop table if exists public.part_numbers cascade;
drop table if exists public.dandori_log cascade;
drop table if exists public.kode_counter cascade;
drop table if exists public.downtime_log cascade;
drop table if exists public.production_log cascade;
drop table if exists public.profiles cascade;

-- Fungsi
drop function if exists public.downtime_by_category(machine_type, text[], timestamptz, timestamptz) cascade;
drop function if exists public.downtime_top_problems(machine_type, text[], timestamptz, timestamptz, int) cascade;
drop function if exists public.machine_live_status(timestamptz, timestamptz) cascade;
drop function if exists public.gsph_trend_bucketed(machine_type, timestamptz, timestamptz, text) cascade;
drop function if exists public.gsph_hourly(machine_type, timestamptz, timestamptz) cascade;
drop function if exists public.performance_by_part(machine_type, text[], timestamptz, timestamptz) cascade;
drop function if exists public.performance_aggregate(machine_type, text[], timestamptz, timestamptz) cascade;
drop function if exists public.safety_summary(date, date) cascade;
drop function if exists public.scrap_top_end_summary(date, date) cascade;
drop function if exists public.achievement_summary(machine_type, text[], timestamptz, timestamptz) cascade;
drop function if exists public.achievement_aggregate(machine_type, timestamptz, timestamptz) cascade;
drop function if exists public.attendance_summary(date, date) cascade;
drop function if exists public.generate_kode_produksi() cascade;
drop function if exists public.sync_production_downtime_menit() cascade;
drop function if exists public.link_and_validate_downtime() cascade;
drop function if exists public.set_updated_meta() cascade;
drop function if exists public.handle_new_user() cascade;

-- Enum type (paling akhir, karena tabel/fungsi di atas mungkin masih pakai)
drop type if exists machine_type cascade;

-- =========================================================
-- SELESAI. Sekarang jalankan ulang schema_welding.sql dari awal.
-- =========================================================
