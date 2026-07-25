-- =========================================================
-- MIGRASI: Stasiun (multi-mesin Tandem/PC200t) + Non-Produksi
-- (Dandori/Watari/Stop Line/Other otomatis saat mulai produksi lagi)
-- Jalankan sekali di Supabase SQL Editor
-- =========================================================

-- 1. Kolom stasiun di production_log — diisi 'PA-1'..'PA-10' untuk
--    Tandem, 'PC-1'/'PC-2' untuk PC200t, NULL untuk mesin lain (1 line).
alter table public.production_log add column if not exists stasiun text;

-- 2. Tabel dandori_log dari migrasi sebelumnya (kalau belum pernah
--    dijalankan, dibuat sekalian di sini supaya file ini aman dijalankan
--    sendiri tanpa bergantung urutan).
create table if not exists public.dandori_log (
  id uuid primary key default gen_random_uuid(),
  mesin machine_type not null,
  waktu_awal timestamptz not null,
  waktu_akhir timestamptz not null,
  part_dari text,
  part_ke text,
  keterangan text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_dandori_log_mesin_waktu on public.dandori_log (mesin, waktu_awal desc);

alter table public.dandori_log enable row level security;
drop policy if exists "Login bisa lihat dandori_log" on public.dandori_log;
create policy "Login bisa lihat dandori_log"
  on public.dandori_log for select to authenticated using (true);
drop policy if exists "Login bisa tambah dandori_log" on public.dandori_log;
create policy "Login bisa tambah dandori_log"
  on public.dandori_log for insert to authenticated with check (true);
drop policy if exists "Login bisa update dandori_log" on public.dandori_log;
create policy "Login bisa update dandori_log"
  on public.dandori_log for update to authenticated using (true);
drop policy if exists "Login bisa hapus dandori_log" on public.dandori_log;
create policy "Login bisa hapus dandori_log"
  on public.dandori_log for delete to authenticated using (true);

-- Perluas dandori_log jadi catatan "non-produksi" umum: DANDORI, WATARI,
-- STOP_LINE, atau OTHER — bukan cuma dandori. Kolom lama tetap dipakai.
alter table public.dandori_log add column if not exists kategori text not null default 'DANDORI';
alter table public.dandori_log add column if not exists stasiun text;

-- 3. Trigger updated_at (aman dijalankan ulang)
drop trigger if exists trg_dandori_log_updated on public.dandori_log;
create trigger trg_dandori_log_updated
  before update on public.dandori_log
  for each row execute procedure public.set_updated_meta();

-- =========================================================
-- SELESAI. production_log punya kolom 'stasiun', dan dandori_log
-- (dipakai sebagai tabel "Non-Produksi" di app) punya kolom 'kategori'
-- (DANDORI/WATARI/STOP_LINE/OTHER) dan 'stasiun'.
-- =========================================================
