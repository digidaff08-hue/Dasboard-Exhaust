-- =========================================================
-- SKEMA DATABASE: Sistem Input Produksi & Downtime
-- Jalankan file ini di Supabase Dashboard > SQL Editor
-- =========================================================

-- 1. Enum daftar mesin
create type machine_type as enum (
  'tandem',
  'blanking',
  'transfer_2000t',
  'transfer_800t',
  'pc200t'
);

-- 2. Tabel profil user (role: admin / operator)
create table public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  full_name text,
  role text not null default 'operator' check (role in ('admin','operator')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Semua user login bisa lihat daftar profil"
  on public.profiles for select
  to authenticated
  using (true);

create policy "User bisa update profil sendiri"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id);

create policy "User bisa insert profil sendiri"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

-- Auto-buat baris profile setiap ada user baru signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'operator');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 3. Tabel LOG PRODUKSI (semua mesin, kolom spesifik mesin masuk ke 'extra' jsonb)
create table public.production_log (
  id uuid primary key default gen_random_uuid(),
  mesin machine_type not null,
  waktu_awal timestamptz not null,
  waktu_akhir timestamptz not null,
  part_number text,
  qty integer,
  ng integer,
  kategori_ng text,
  break_menit integer,
  stasiun text, -- 'PA-1'..'PA-10' (Tandem) / 'PC-1','PC-2' (PC200t) / NULL (mesin lain)
  extra jsonb not null default '{}'::jsonb,
  -- extra contoh isi per mesin:
  --  tandem          : {"rout_pa1":1,"rout_pa2":2,"rout_pa3":3,"rout_pa4":4,"rout_pa5":null}
  --  blanking        : {"top_coil":"44/12","berat_coil":1250}
  --  transfer_2000t  : {}
  --  transfer_800t   : {}
  --  pc200t          : {"pc1":1,"pc2":2}
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_production_log_mesin_waktu on public.production_log (mesin, waktu_awal desc);

alter table public.production_log enable row level security;

create policy "Login bisa lihat production_log"
  on public.production_log for select to authenticated using (true);
create policy "Login bisa tambah production_log"
  on public.production_log for insert to authenticated with check (true);
create policy "Login bisa update production_log"
  on public.production_log for update to authenticated using (true);
create policy "Login bisa hapus production_log"
  on public.production_log for delete to authenticated using (true);

-- 4. Tabel LOG DOWNTIME (semua mesin)
create table public.downtime_log (
  id uuid primary key default gen_random_uuid(),
  mesin machine_type not null,
  waktu_awal timestamptz not null,
  waktu_akhir timestamptz not null,
  kategori text,
  problem text,
  penyebab text,
  countermeasure text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_downtime_log_mesin_waktu on public.downtime_log (mesin, waktu_awal desc);

alter table public.downtime_log enable row level security;

create policy "Login bisa lihat downtime_log"
  on public.downtime_log for select to authenticated using (true);
create policy "Login bisa tambah downtime_log"
  on public.downtime_log for insert to authenticated with check (true);
create policy "Login bisa update downtime_log"
  on public.downtime_log for update to authenticated using (true);
create policy "Login bisa hapus downtime_log"
  on public.downtime_log for delete to authenticated using (true);

-- 5. Trigger auto-update kolom updated_at & updated_by
create or replace function public.set_updated_meta()
returns trigger as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$ language plpgsql;

create trigger trg_production_log_updated
  before update on public.production_log
  for each row execute procedure public.set_updated_meta();

create trigger trg_downtime_log_updated
  before update on public.downtime_log
  for each row execute procedure public.set_updated_meta();

-- 5. Master data untuk dropdown Part Number & Problem (bisa nambah dari app)
create table public.part_numbers (
  id uuid primary key default gen_random_uuid(),
  mesin machine_type not null,
  value text not null,
  next_processes jsonb not null default '[]'::jsonb, -- [{"line":"...","part_number":"..."}] — dasar integrasi stock antar line, bisa lebih dari satu (part separating/split)
  created_at timestamptz not null default now(),
  unique (mesin, value)
);
alter table public.part_numbers enable row level security;
create policy "Login bisa lihat part_numbers"
  on public.part_numbers for select to authenticated using (true);
create policy "Login bisa tambah part_numbers"
  on public.part_numbers for insert to authenticated with check (true);
create policy "Login bisa hapus part_numbers"
  on public.part_numbers for delete to authenticated using (true);
create policy "Login bisa update part_numbers"
  on public.part_numbers for update to authenticated using (true) with check (true);

create table public.downtime_problems (
  id uuid primary key default gen_random_uuid(),
  mesin machine_type not null,
  value text not null,
  created_at timestamptz not null default now(),
  unique (mesin, value)
);
alter table public.downtime_problems enable row level security;
create policy "Login bisa lihat downtime_problems"
  on public.downtime_problems for select to authenticated using (true);
create policy "Login bisa tambah downtime_problems"
  on public.downtime_problems for insert to authenticated with check (true);
create policy "Login bisa hapus downtime_problems"
  on public.downtime_problems for delete to authenticated using (true);
create policy "Login bisa update downtime_problems"
  on public.downtime_problems for update to authenticated using (true) with check (true);

-- 6. Kolom ID unik produksi (reset harian), contoh: TDM-260717-001
alter table public.production_log add column kode text;
alter table public.production_log add constraint production_log_kode_unique unique (kode);

create table public.kode_counter (
  mesin machine_type not null,
  tanggal date not null,
  counter int not null default 0,
  primary key (mesin, tanggal)
);
alter table public.kode_counter enable row level security;
-- sengaja tanpa policy -> hanya diakses lewat trigger security definer di bawah

create or replace function public.generate_kode_produksi()
returns trigger as $$
declare
  prefix text;
  hari date := (new.waktu_awal at time zone 'Asia/Jakarta')::date;
  next_counter int;
begin
  prefix := case new.mesin
    when 'tandem' then 'TDM'
    when 'blanking' then 'BLK'
    when 'transfer_2000t' then 'TR2'
    when 'transfer_800t' then 'TR8'
    when 'pc200t' then 'PC2'
    else 'MSN'
  end;

  insert into public.kode_counter (mesin, tanggal, counter)
  values (new.mesin, hari, 1)
  on conflict (mesin, tanggal) do update set counter = public.kode_counter.counter + 1
  returning counter into next_counter;

  new.kode := prefix || '-' || to_char(hari, 'YYMMDD') || '-' || lpad(next_counter::text, 3, '0');
  return new;
end;
$$ language plpgsql security definer;

create trigger trg_production_log_kode
  before insert on public.production_log
  for each row execute procedure public.generate_kode_produksi();

-- 7. Tabel Dandori (waktu setup ganti part number)
create table public.dandori_log (
  id uuid primary key default gen_random_uuid(),
  mesin machine_type not null,
  waktu_awal timestamptz not null,
  waktu_akhir timestamptz not null,
  kategori text not null default 'DANDORI', -- DANDORI / WATARI / STOP_LINE / OTHER
  stasiun text, -- 'PA-1'..'PA-10' (Tandem) / 'PC-1','PC-2' (PC200t) / NULL
  part_dari text,
  part_ke text,
  keterangan text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_dandori_log_mesin_waktu on public.dandori_log (mesin, waktu_awal desc);

alter table public.dandori_log enable row level security;
create policy "Login bisa lihat dandori_log"
  on public.dandori_log for select to authenticated using (true);
create policy "Login bisa tambah dandori_log"
  on public.dandori_log for insert to authenticated with check (true);
create policy "Login bisa update dandori_log"
  on public.dandori_log for update to authenticated using (true);
create policy "Login bisa hapus dandori_log"
  on public.dandori_log for delete to authenticated using (true);

create trigger trg_dandori_log_updated
  before update on public.dandori_log
  for each row execute procedure public.set_updated_meta();

-- =========================================================
-- SELESAI. Setelah dijalankan, cek Table Editor di Supabase
-- untuk memastikan tabel profiles, production_log, downtime_log,
-- part_numbers, downtime_problems, dandori_log sudah muncul, dan
-- production_log punya kolom 'kode'.
-- Lanjutkan dengan menjalankan seed.sql untuk mengisi Part Number
-- & Problem dari data Excel lama Anda.
-- =========================================================
