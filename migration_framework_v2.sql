-- =========================================================
-- MIGRASI BESAR: Framework baru (Start/Stop presisi + Planning)
-- Jalankan sekali di Supabase SQL Editor. Semua ADDITIVE — tidak
-- menghapus/mengubah data yang sudah ada.
-- =========================================================

-- 1. Kolom baru di production_log: Dandori/Downtime/Manpower
--    nempel di baris produksi yang sama (bukan baris terpisah).
alter table public.production_log add column if not exists dandori_menit numeric;
alter table public.production_log add column if not exists downtime_menit numeric default 0;
alter table public.production_log add column if not exists manpower numeric;

-- 2. Role baru "leader" (sebelumnya cuma admin/operator)
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'leader', 'operator'));

-- 3. Tabel Planning Produksi
create table if not exists public.production_planning (
  id uuid primary key default gen_random_uuid(),
  mesin machine_type not null,
  stasiun text, -- 'PA-1'..'PA-10' / 'PC-1','PC-2' / NULL (mesin single-line)
  part_number text not null,
  qty_rencana integer,
  jam_rencana_mulai timestamptz not null,
  jam_rencana_selesai timestamptz not null,
  status text not null default 'pending' check (status in ('pending','selesai')),
  actual_production_id uuid references public.production_log(id) on delete set null,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_production_planning_mesin_waktu
  on public.production_planning (mesin, jam_rencana_mulai desc);

alter table public.production_planning enable row level security;

-- semua user login boleh LIHAT planning
drop policy if exists "Login bisa lihat production_planning" on public.production_planning;
create policy "Login bisa lihat production_planning"
  on public.production_planning for select to authenticated using (true);

-- cuma admin/leader yang boleh tambah/ubah/hapus planning
drop policy if exists "Admin/Leader bisa tambah production_planning" on public.production_planning;
create policy "Admin/Leader bisa tambah production_planning"
  on public.production_planning for insert to authenticated
  with check (exists (
    select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')
  ));

drop policy if exists "Admin/Leader bisa update production_planning" on public.production_planning;
create policy "Admin/Leader bisa update production_planning"
  on public.production_planning for update to authenticated
  using (exists (
    select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')
  ));

drop policy if exists "Admin/Leader bisa hapus production_planning" on public.production_planning;
create policy "Admin/Leader bisa hapus production_planning"
  on public.production_planning for delete to authenticated
  using (exists (
    select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')
  ));

drop trigger if exists trg_production_planning_updated on public.production_planning;
create trigger trg_production_planning_updated
  before update on public.production_planning
  for each row execute procedure public.set_updated_meta();

-- 4. Master Data baru: daftar jenis Non-Produksi (Meeting Awal Shift, Watari, 5S, TPM, dll)
create table if not exists public.nonproduksi_types (
  id uuid primary key default gen_random_uuid(),
  mesin machine_type not null,
  nama text not null,
  created_at timestamptz not null default now(),
  unique (mesin, nama)
);
alter table public.nonproduksi_types enable row level security;
drop policy if exists "Login bisa lihat nonproduksi_types" on public.nonproduksi_types;
create policy "Login bisa lihat nonproduksi_types"
  on public.nonproduksi_types for select to authenticated using (true);
drop policy if exists "Login bisa tambah nonproduksi_types" on public.nonproduksi_types;
create policy "Login bisa tambah nonproduksi_types"
  on public.nonproduksi_types for insert to authenticated with check (true);
drop policy if exists "Login bisa update nonproduksi_types" on public.nonproduksi_types;
create policy "Login bisa update nonproduksi_types"
  on public.nonproduksi_types for update to authenticated using (true);
drop policy if exists "Login bisa hapus nonproduksi_types" on public.nonproduksi_types;
create policy "Login bisa hapus nonproduksi_types"
  on public.nonproduksi_types for delete to authenticated using (true);

-- 5. Downtime WAJIB pas di dalam SATU baris produksi (tidak boleh melintasi
--    batas antar-part). Divalidasi & di-link di level database supaya
--    konsisten dari jalur mana pun (app langsung, atau import CSV nanti).
alter table public.downtime_log add column if not exists stasiun text;
alter table public.downtime_log add column if not exists production_log_id uuid references public.production_log(id) on delete cascade;

create or replace function public.link_and_validate_downtime()
returns trigger as $$
declare
  match_id uuid;
  match_count int;
begin
  select id, count(*) over() into match_id, match_count
  from public.production_log
  where mesin = new.mesin
    and (stasiun is not distinct from new.stasiun)
    and waktu_awal <= new.waktu_awal
    and waktu_akhir >= new.waktu_akhir
  limit 1;

  if match_count is null or match_count = 0 then
    raise exception 'Waktu downtime (% - %) tidak cocok dengan satu baris produksi mana pun di stasiun ini — kemungkinan melintasi 2 part. Sesuaikan jamnya supaya pas di dalam satu part.',
      new.waktu_awal, new.waktu_akhir;
  end if;

  new.production_log_id := match_id;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_downtime_log_validate on public.downtime_log;
create trigger trg_downtime_log_validate
  before insert or update on public.downtime_log
  for each row execute procedure public.link_and_validate_downtime();

create or replace function public.sync_production_downtime_menit()
returns trigger as $$
begin
  if TG_OP in ('UPDATE','DELETE') and OLD.production_log_id is not null then
    update public.production_log set downtime_menit = coalesce((
      select sum(extract(epoch from (waktu_akhir - waktu_awal)) / 60)
      from public.downtime_log where production_log_id = OLD.production_log_id
    ), 0) where id = OLD.production_log_id;
  end if;
  if TG_OP in ('INSERT','UPDATE') and NEW.production_log_id is not null then
    update public.production_log set downtime_menit = coalesce((
      select sum(extract(epoch from (waktu_akhir - waktu_awal)) / 60)
      from public.downtime_log where production_log_id = NEW.production_log_id
    ), 0) where id = NEW.production_log_id;
  end if;
  return null;
end;
$$ language plpgsql;

drop trigger if exists trg_sync_downtime_menit on public.downtime_log;
create trigger trg_sync_downtime_menit
  after insert or update or delete on public.downtime_log
  for each row execute procedure public.sync_production_downtime_menit();

-- =========================================================
-- SELESAI. Cek: production_log punya kolom dandori_menit/downtime_menit/
-- manpower, profiles bisa diisi role 'leader', tabel production_planning
-- dan nonproduksi_types sudah muncul, dan downtime_log sudah bisa validasi
-- otomatis (coba insert downtime yang melintasi 2 part -> harus ditolak).
-- =========================================================
