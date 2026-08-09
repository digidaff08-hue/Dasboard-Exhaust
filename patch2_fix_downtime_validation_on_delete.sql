-- =========================================================
-- PATCH 2: trigger validasi Downtime (link_and_validate_downtime)
-- ternyata ikut jalan ulang waktu Input Produksi induknya DIHAPUS --
-- karena foreign key "on delete set null" bikin downtime_log ke-UPDATE
-- (link-nya di-kosongin), dan UPDATE itu kena validasi jam lagi, padahal
-- baris produksinya lagi proses dihapus jadi otomatis gak ketemu -> GAGAL HAPUS.
--
-- Fix: validasi jam CUMA jalan kalau field jam/mesin/stasiun beneran
-- berubah. Kalau yang berubah cuma link (production_log_id /
-- production_log_new_id di-null-in oleh cascade), dibiarkan lewat.
-- =========================================================

create or replace function public.link_and_validate_downtime()
returns trigger as $$
declare
  match_new_id uuid;
  match_old_id uuid;
begin
  -- Update yang cuma disebabkan FK cascade (link dilepas krn induknya
  -- dihapus) -- jam/mesin/stasiun tidak berubah -> lewatin, tidak usah
  -- divalidasi ulang.
  if TG_OP = 'UPDATE'
     and NEW.waktu_awal = OLD.waktu_awal
     and NEW.waktu_akhir = OLD.waktu_akhir
     and NEW.mesin = OLD.mesin
     and NEW.stasiun is not distinct from OLD.stasiun then
    return NEW;
  end if;

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
-- SELESAI. Sekarang hapus Input Produksi yang ada Downtime nyantol
-- di dalamnya tidak akan ke-block lagi -- Downtime-nya cuma jadi
-- "tidak ter-link" (bukan ikut kehapus), sesuai perilaku on delete set null.
-- =========================================================
