-- =========================================================
-- MIGRATION: Plan Produksi Harian
-- Jalankan setelah schema_welding.sql (butuh type machine_type
-- & tabel profiles sudah ada).
--
-- Struktur mengikuti request: 1 baris = 1 Part Number, plan
-- diinput terpisah per Line (E-02..E-07) dan per Shift (1/2).
-- Backlog disimpan per (tanggal, part_number) -- tidak per line,
-- karena backlog itu sifatnya akumulasi part, bukan line.
-- "Actual" TIDAK disimpan di sini -- dihitung on-the-fly dari
-- tabel production_log yang sudah ada (qty per part/mesin/shift).
-- =========================================================

-- 1) Plan per Part Number x Line x Shift
create table public.production_plan_harian (
  id uuid primary key default gen_random_uuid(),
  tanggal date not null,
  part_number text not null,
  mesin machine_type not null,
  shift smallint not null check (shift in (1,2)),
  qty_rencana integer not null default 0,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tanggal, part_number, mesin, shift)
);
create index idx_plan_harian_tanggal on public.production_plan_harian (tanggal);

alter table public.production_plan_harian enable row level security;

create policy "Login bisa lihat production_plan_harian"
  on public.production_plan_harian for select to authenticated using (true);

create policy "Admin/Leader bisa tambah production_plan_harian"
  on public.production_plan_harian for insert to authenticated
  with check (exists (
    select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')
  ));

create policy "Admin/Leader bisa update production_plan_harian"
  on public.production_plan_harian for update to authenticated
  using (exists (
    select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')
  ));

create policy "Admin/Leader bisa hapus production_plan_harian"
  on public.production_plan_harian for delete to authenticated
  using (exists (
    select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')
  ));

create trigger trg_plan_harian_updated
  before update on public.production_plan_harian
  for each row execute procedure public.set_updated_meta();

-- 2) Backlog per Part Number per hari (tidak per line)
create table public.production_plan_backlog (
  tanggal date not null,
  part_number text not null,
  backlog integer not null default 0,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (tanggal, part_number)
);
alter table public.production_plan_backlog enable row level security;

create policy "Login bisa lihat production_plan_backlog"
  on public.production_plan_backlog for select to authenticated using (true);

create policy "Admin/Leader bisa tambah production_plan_backlog"
  on public.production_plan_backlog for insert to authenticated
  with check (exists (
    select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')
  ));

create policy "Admin/Leader bisa update production_plan_backlog"
  on public.production_plan_backlog for update to authenticated
  using (exists (
    select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')
  ));

create policy "Admin/Leader bisa hapus production_plan_backlog"
  on public.production_plan_backlog for delete to authenticated
  using (exists (
    select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')
  ));

create trigger trg_plan_backlog_updated
  before update on public.production_plan_backlog
  for each row execute procedure public.set_updated_meta();

-- 3) RPC: ambil ACTUAL (qty produksi) per part_number x mesin x shift,
--    untuk 1 tanggal tertentu. Dipakai halaman Plan Produksi untuk
--    membandingkan Plan vs Act tanpa perlu tarik semua baris production_log
--    ke browser (dihitung di server, jauh lebih ringan).
create or replace function public.plan_produksi_actual(p_tanggal date)
returns table (mesin machine_type, part_number text, shift smallint, qty_aktual bigint)
language sql stable as $$
  select
    pl.mesin,
    pl.part_number,
    case
      when (pl.waktu_awal at time zone 'Asia/Jakarta')::time >= time '07:00'
       and (pl.waktu_awal at time zone 'Asia/Jakarta')::time <  time '19:30'
      then 1::smallint
      else 2::smallint
    end as shift,
    sum(coalesce(pl.qty, 0))::bigint as qty_aktual
  from public.production_log pl
  where pl.part_number is not null
    and (
      -- shift 1: 07:00 - 19:30 tanggal yg sama
      (pl.waktu_awal >= (p_tanggal::timestamp at time zone 'Asia/Jakarta') + interval '7 hour'
       and pl.waktu_awal <  (p_tanggal::timestamp at time zone 'Asia/Jakarta') + interval '19.5 hour')
      or
      -- shift 2: 19:30 tanggal ybs - 07:00 keesokan harinya
      (pl.waktu_awal >= (p_tanggal::timestamp at time zone 'Asia/Jakarta') + interval '19.5 hour'
       and pl.waktu_awal <  (p_tanggal::timestamp at time zone 'Asia/Jakarta') + interval '1 day 7 hour')
    )
  group by pl.mesin, pl.part_number, 3;
$$;
