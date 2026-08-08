-- =========================================================
-- MIGRATION: Tab "Input Produksi" BARU
-- Tabel baru terpisah dari production_log (yang lama tetap dipakai
-- oleh tab "Input Produksi OLD", Riwayat Produksi, Performance, dst
-- -- TIDAK diubah/disentuh sama sekali).
-- Aman dijalankan sekali di atas schema_welding.sql yang sudah ada.
-- =========================================================

-- 1. Counter kode harian khusus tabel baru (terpisah dari kode_counter lama,
--    supaya penomoran "Input Produksi OLD" dan "Input Produksi" baru
--    tidak saling pengaruh)
create table if not exists public.kode_counter_new (
  mesin machine_type not null,
  tanggal date not null,
  counter int not null default 0,
  primary key (mesin, tanggal)
);
alter table public.kode_counter_new enable row level security;
-- sengaja tanpa policy -> hanya diakses lewat trigger security definer di bawah

-- 2. Tabel LOG PRODUKSI BARU
create table public.production_log_new (
  id uuid primary key default gen_random_uuid(),
  mesin machine_type not null,
  stasiun text, -- ikut pola lama: NULL kalau line tidak pakai stasiun
  kode text,    -- ID unik harian, contoh: E02N-260807-001 (N = penanda tabel baru)

  -- ==== Input manual ====
  waktu_awal timestamptz not null,
  waktu_akhir timestamptz not null,
  part_number text,
  qty integer,
  break_menit numeric default 0,
  dandori_menit numeric default 0,
  waktu_problem_menit numeric default 0,
  total_repair_menit numeric default 0,

  -- ==== Meta ====
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_log_new_kode_unique unique (kode)
);

create index idx_production_log_new_mesin_waktu on public.production_log_new (mesin, waktu_awal desc);

alter table public.production_log_new enable row level security;

create policy "Login bisa lihat production_log_new"
  on public.production_log_new for select to authenticated using (true);
create policy "Login bisa tambah production_log_new"
  on public.production_log_new for insert to authenticated with check (true);
create policy "Login bisa update production_log_new"
  on public.production_log_new for update to authenticated using (true);
create policy "Login bisa hapus production_log_new"
  on public.production_log_new for delete to authenticated using (true);

create trigger trg_production_log_new_updated
  before update on public.production_log_new
  for each row execute procedure public.set_updated_meta();

-- 3. Generator kode otomatis (format: E02N-YYMMDD-001)
create or replace function public.generate_kode_produksi_new()
returns trigger as $$
declare
  prefix text;
  hari date := (new.waktu_awal at time zone 'Asia/Jakarta')::date;
  next_counter int;
begin
  prefix := replace(new.mesin::text, '-', '') || 'N';

  insert into public.kode_counter_new (mesin, tanggal, counter)
  values (new.mesin, hari, 1)
  on conflict (mesin, tanggal) do update set counter = public.kode_counter_new.counter + 1
  returning counter into next_counter;

  new.kode := prefix || '-' || to_char(hari, 'YYMMDD') || '-' || lpad(next_counter::text, 3, '0');
  return new;
end;
$$ language plpgsql security definer;

create trigger trg_production_log_new_kode
  before insert on public.production_log_new
  for each row execute procedure public.generate_kode_produksi_new();

-- 4. Tambah kolom target P.Eff di Master Data Part Number (dipakai utk
--    "P.Eff Seharusnya" -- tidak mengubah/menghapus kolom yang sudah ada)
alter table public.part_numbers
  add column if not exists target_peff numeric;

-- =========================================================
-- SELESAI.
-- Cek: tabel production_log_new & kode_counter_new harus muncul di
-- Table Editor, dan part_numbers punya kolom baru target_peff.
-- =========================================================
