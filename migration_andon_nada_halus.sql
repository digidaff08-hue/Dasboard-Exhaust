-- =====================================================================
-- migration_andon_nada_halus.sql -- izinkan 4 nada halus baru di pengaturan
-- Jalankan sekali di Supabase > SQL Editor (Run). Aman diulang.
-- =====================================================================
alter table public.andon_setting drop constraint if exists andon_setting_nada_check;
alter table public.andon_setting add constraint andon_setting_nada_check
  check (nada in ('telepon','sirene','alarm','bel','marimba','lonceng','kristal','piano'));

select 'OK - nada halus aktif' as status;
