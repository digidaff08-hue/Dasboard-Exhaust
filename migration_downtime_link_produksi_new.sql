-- =========================================================
-- MIGRATION: Link Downtime -> Input Produksi (baru), otomatis
-- ngisi Waktu Problem lewat trigger (sistem "production_log_id",
-- versi yang BENERAN jalan untuk tabel production_log_new).
--
-- Tabel production_log (lama) & downtime_menit-nya TIDAK disentuh.
-- =========================================================

-- 1. Kolom link baru di downtime_log -> production_log_new
alter table public.downtime_log
  add column if not exists production_log_new_id uuid references public.production_log_new(id) on delete set null;

create index if not exists idx_downtime_log_production_log_new_id
  on public.downtime_log (production_log_new_id);

-- 2. Trigger: setiap kali downtime_log berubah (insert/update/delete) dan
--    match ke sebuah production_log_new_id, hitung ulang total durasi
--    downtime yang ke-link ke situ, simpan ke waktu_problem_menit.
create or replace function public.sync_production_new_waktu_problem()
returns trigger as $$
begin
  if TG_OP in ('UPDATE','DELETE') and OLD.production_log_new_id is not null then
    update public.production_log_new set waktu_problem_menit = coalesce((
      select sum(extract(epoch from (waktu_akhir - waktu_awal)) / 60)
      from public.downtime_log where production_log_new_id = OLD.production_log_new_id
    ), 0) where id = OLD.production_log_new_id;
  end if;
  if TG_OP in ('INSERT','UPDATE') and NEW.production_log_new_id is not null then
    update public.production_log_new set waktu_problem_menit = coalesce((
      select sum(extract(epoch from (waktu_akhir - waktu_awal)) / 60)
      from public.downtime_log where production_log_new_id = NEW.production_log_new_id
    ), 0) where id = NEW.production_log_new_id;
  end if;
  return null;
end;
$$ language plpgsql;

drop trigger if exists trg_sync_production_new_waktu_problem on public.downtime_log;
create trigger trg_sync_production_new_waktu_problem
  after insert or update or delete on public.downtime_log
  for each row execute procedure public.sync_production_new_waktu_problem();

-- =========================================================
-- SELESAI. Alur baru:
-- 1) Isi & simpan Input Produksi (baru) dulu -> Waktu Problem = 0 (belum ada link)
-- 2) Buka tab Downtime -> pilih "Terkait Input Produksi" -> Simpan
-- 3) Waktu Problem di entry Input Produksi itu ke-update OTOMATIS (trigger)
-- =========================================================
