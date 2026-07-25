-- =========================================================
-- MIGRASI: ID unik produksi (reset harian) + tabel Dandori
-- Jalankan sekali di Supabase SQL Editor (project yang sudah jalan)
-- =========================================================

-- 1. Kolom kode unik di production_log, contoh: TDM-260717-001
alter table public.production_log add column if not exists kode text;
alter table public.production_log add constraint production_log_kode_unique unique (kode);

-- Tabel counter harian per mesin (internal, tidak diakses langsung dari app)
create table public.kode_counter (
  mesin machine_type not null,
  tanggal date not null,
  counter int not null default 0,
  primary key (mesin, tanggal)
);
alter table public.kode_counter enable row level security;
-- sengaja tidak dikasih policy apa pun -> hanya bisa diakses lewat trigger
-- (security definer) di bawah, bukan langsung dari app/user.

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

-- 2. Tabel Dandori (waktu setup ganti part number)
create table public.dandori_log (
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
-- SELESAI. Cek: production_log sekarang punya kolom 'kode' yang
-- otomatis terisi tiap ada data baru. Tabel dandori_log siap dipakai.
-- =========================================================
