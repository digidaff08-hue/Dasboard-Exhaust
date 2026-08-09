-- =========================================================
-- PATCH: trigger validasi Downtime yang lama (link_and_validate_downtime)
-- cuma cek ke tabel production_log (lama) -- makanya downtime yang
-- match ke production_log_new (Input Produksi baru) selalu ditolak,
-- walau kodenya sudah benar di sisi aplikasi.
--
-- Migration ini GANTI fungsi triggernya: sekarang cek ke Input Produksi
-- BARU dulu, kalau tidak ketemu baru cek ke Input Produksi NEW (lama).
-- Baru ditolak kalau dua-duanya sama sekali tidak match.
--
-- Aman dijalankan sekali; ini REPLACE fungsi yang sudah ada, trigger-nya
-- sendiri tidak perlu diubah (masih menempel ke fungsi yang sama).
-- =========================================================

create or replace function public.link_and_validate_downtime()
returns trigger as $$
declare
  match_new_id uuid;
  match_old_id uuid;
begin
  -- 1) Cek dulu ke Input Produksi (BARU)
  select id into match_new_id
  from public.production_log_new
  where mesin = new.mesin
    and waktu_awal <= new.waktu_awal
    and waktu_akhir >= new.waktu_akhir
  limit 1;

  if match_new_id is not null then
    new.production_log_new_id := match_new_id;
    new.production_log_id := null;
    return new;
  end if;

  -- 2) Tidak ketemu di baru -> cek ke Input Produksi NEW (LAMA)
  select id into match_old_id
  from public.production_log
  where mesin = new.mesin
    and (stasiun is not distinct from new.stasiun)
    and waktu_awal <= new.waktu_awal
    and waktu_akhir >= new.waktu_akhir
  limit 1;

  if match_old_id is null then
    raise exception 'Waktu downtime (% - %) tidak cocok dengan satu baris produksi mana pun di line ini (Input Produksi maupun Input Produksi NEW) — kemungkinan melintasi 2 part. Sesuaikan jamnya supaya pas di dalam satu part.',
      new.waktu_awal, new.waktu_akhir;
  end if;

  new.production_log_id := match_old_id;
  new.production_log_new_id := null;
  return new;
end;
$$ language plpgsql;

-- =========================================================
-- SELESAI. Trigger trg_downtime_log_validate otomatis pakai versi baru
-- ini (nempel by name, tidak perlu drop/create ulang trigger-nya).
-- =========================================================
