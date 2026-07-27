-- =========================================================
-- SKEMA DATABASE (FINAL, KONSOLIDASI): Sistem Input Produksi & Downtime
-- Departemen: WELDING (6 line: E-02, E-03, E-04, E-05, E-06, E-07)
-- Jalankan file ini SEKALI di Supabase Dashboard > SQL Editor (project baru)
--
-- File ini menggantikan schema.sql + seluruh migration_*.sql versi Press.
-- Semua line Welding bersifat FLAT (1 mesin = 1 line, tanpa sub-stasiun),
-- jadi kolom 'stasiun' tetap ada demi kompatibilitas fungsi agregasi,
-- tapi akan selalu NULL untuk seluruh data Welding.
-- =========================================================

-- 1. Enum daftar line Welding
create type machine_type as enum (
  'E-02',
  'E-03',
  'E-04',
  'E-05',
  'E-06',
  'E-07'
);

-- 2. Tabel profil user (role: admin / leader / operator)
create table public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  full_name text,
  role text not null default 'operator' check (role in ('admin','leader','operator')),
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

-- Trigger generik auto-update kolom updated_at & updated_by
create or replace function public.set_updated_meta()
returns trigger as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$ language plpgsql;

-- 3. Tabel LOG PRODUKSI (semua line, kolom spesifik masuk ke 'extra' jsonb)
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
  stasiun text, -- tidak dipakai di Welding (semua line flat) -> selalu NULL
  extra jsonb not null default '{}'::jsonb, -- disamakan strukturnya utk semua line E-02..E-07
  kode text, -- ID unik harian, contoh: E02-260727-001
  dandori_menit numeric,
  downtime_menit numeric default 0,
  manpower numeric,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_log_kode_unique unique (kode)
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

create trigger trg_production_log_updated
  before update on public.production_log
  for each row execute procedure public.set_updated_meta();

-- 4. Tabel LOG DOWNTIME (semua line)
create table public.downtime_log (
  id uuid primary key default gen_random_uuid(),
  mesin machine_type not null,
  waktu_awal timestamptz not null,
  waktu_akhir timestamptz not null,
  kategori text,
  problem text,
  penyebab text,
  countermeasure text,
  stasiun text, -- tidak dipakai di Welding -> selalu NULL
  production_log_id uuid references public.production_log(id) on delete cascade,
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

create trigger trg_downtime_log_updated
  before update on public.downtime_log
  for each row execute procedure public.set_updated_meta();

-- Downtime wajib pas di dalam SATU baris produksi (divalidasi & di-link otomatis)
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
    raise exception 'Waktu downtime (% - %) tidak cocok dengan satu baris produksi mana pun di line ini — kemungkinan melintasi 2 part. Sesuaikan jamnya supaya pas di dalam satu part.',
      new.waktu_awal, new.waktu_akhir;
  end if;

  new.production_log_id := match_id;
  return new;
end;
$$ language plpgsql;

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

create trigger trg_sync_downtime_menit
  after insert or update or delete on public.downtime_log
  for each row execute procedure public.sync_production_downtime_menit();

-- 5. Kode Counter + generator ID unik produksi (reset harian), contoh: E02-260727-001
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
  -- Prefix = nama line tanpa tanda hubung, mis. 'E-02' -> 'E02'
  prefix := replace(new.mesin::text, '-', '');

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

-- 6. Tabel Non-Produksi (Dandori/Watari/Stop Line/Other)
create table public.dandori_log (
  id uuid primary key default gen_random_uuid(),
  mesin machine_type not null,
  waktu_awal timestamptz not null,
  waktu_akhir timestamptz not null,
  kategori text not null default 'DANDORI', -- DANDORI / WATARI / STOP_LINE / OTHER
  stasiun text, -- tidak dipakai di Welding -> selalu NULL
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

-- 7. Master data dropdown Part Number & Problem (bisa nambah dari app)
create table public.part_numbers (
  id uuid primary key default gen_random_uuid(),
  mesin machine_type not null,
  value text not null,
  next_processes jsonb not null default '[]'::jsonb, -- [{"line":"...","part_number":"..."}] — proses selanjutnya, bisa >1
  harga_pcs numeric,       -- Rp per pcs, dipakai hitung NG Value (Rp)
  std_mp numeric,          -- Std Manpower
  std_ct numeric,          -- Std Cycle Time (menit per stroke); SPM = 1 / std_ct
  stroke_ratio numeric not null default 1, -- rasio Output x Separating; default 1 = part normal
  alias_values text[] not null default '{}', -- nama lain/alias part number ini (dipakai UI master data)
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

-- 8. Master Data: jenis Non-Produksi (Meeting Awal Shift, Watari, 5S, TPM, dll)
create table public.nonproduksi_types (
  id uuid primary key default gen_random_uuid(),
  mesin machine_type not null,
  nama text not null,
  created_at timestamptz not null default now(),
  unique (mesin, nama)
);
alter table public.nonproduksi_types enable row level security;
create policy "Login bisa lihat nonproduksi_types"
  on public.nonproduksi_types for select to authenticated using (true);
create policy "Login bisa tambah nonproduksi_types"
  on public.nonproduksi_types for insert to authenticated with check (true);
create policy "Login bisa update nonproduksi_types"
  on public.nonproduksi_types for update to authenticated using (true);
create policy "Login bisa hapus nonproduksi_types"
  on public.nonproduksi_types for delete to authenticated using (true);

-- 9. Tabel Planning Produksi
create table public.production_planning (
  id uuid primary key default gen_random_uuid(),
  mesin machine_type not null,
  stasiun text, -- tidak dipakai di Welding -> selalu NULL
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
create index idx_production_planning_mesin_waktu
  on public.production_planning (mesin, jam_rencana_mulai desc);

alter table public.production_planning enable row level security;

create policy "Login bisa lihat production_planning"
  on public.production_planning for select to authenticated using (true);

create policy "Admin/Leader bisa tambah production_planning"
  on public.production_planning for insert to authenticated
  with check (exists (
    select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')
  ));

create policy "Admin/Leader bisa update production_planning"
  on public.production_planning for update to authenticated
  using (exists (
    select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')
  ));

create policy "Admin/Leader bisa hapus production_planning"
  on public.production_planning for delete to authenticated
  using (exists (
    select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')
  ));

create trigger trg_production_planning_updated
  before update on public.production_planning
  for each row execute procedure public.set_updated_meta();

-- 10. Setting Target GSPH per line
create table public.mesin_settings (
  mesin machine_type primary key,
  gsph_target_mode text not null default 'fixed' check (gsph_target_mode in ('fixed','per_part')),
  gsph_target_fixed numeric not null default 0,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.mesin_settings enable row level security;

create policy "Login bisa lihat mesin_settings"
  on public.mesin_settings for select to authenticated using (true);
create policy "Admin/Leader bisa insert mesin_settings"
  on public.mesin_settings for insert to authenticated
  with check (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')));
create policy "Admin/Leader bisa update mesin_settings"
  on public.mesin_settings for update to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')));

-- 11. Absensi harian per shift (level pabrik, bukan per line) + Achievement
create table public.attendance_log (
  id uuid primary key default gen_random_uuid(),
  tanggal date not null,
  shift text not null check (shift in ('1','2')),
  total_orang integer not null default 0,
  hadir integer not null default 0,
  cuti integer not null default 0,
  absen integer not null default 0,
  overtime_jam numeric not null default 0,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tanggal, shift)
);
alter table public.attendance_log enable row level security;

create policy "Login bisa lihat attendance_log"
  on public.attendance_log for select to authenticated using (true);
create policy "Admin/Leader bisa insert attendance_log"
  on public.attendance_log for insert to authenticated
  with check (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')));
create policy "Admin/Leader bisa update attendance_log"
  on public.attendance_log for update to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')));

create trigger trg_attendance_log_updated
  before update on public.attendance_log
  for each row execute procedure public.set_updated_meta();

-- Ringkasan absensi HANYA hari kerja (Sabtu & Minggu diabaikan)
create or replace function public.attendance_summary(
  p_start date,
  p_end date
)
returns table (
  total_orang numeric,
  hadir numeric,
  cuti numeric,
  absen numeric,
  overtime_jam numeric,
  jumlah_hari bigint
)
language sql stable
as $$
  select
    coalesce(sum(total_orang), 0),
    coalesce(sum(hadir), 0),
    coalesce(sum(cuti), 0),
    coalesce(sum(absen), 0),
    coalesce(sum(overtime_jam), 0),
    count(*)
  from public.attendance_log
  where tanggal >= p_start
    and tanggal < p_end
    and extract(dow from tanggal) not in (0, 6);
$$;
grant execute on function public.attendance_summary(date, date) to authenticated;

-- Achievement (aktual vs planning) per line/periode
create or replace function public.achievement_aggregate(
  p_mesin machine_type,
  p_start timestamptz,
  p_end timestamptz
)
returns table (qty_rencana numeric, qty_aktual numeric)
language sql stable
as $$
  select
    coalesce(sum(pp.qty_rencana), 0),
    coalesce(sum(
      case when pp.actual_production_id is not null then
        (select coalesce(pl.qty,0) * coalesce(pn.stroke_ratio,1)
         from public.production_log pl
         left join public.part_numbers pn on pn.mesin = pl.mesin and pn.value = pl.part_number
         where pl.id = pp.actual_production_id)
      else 0 end
    ), 0)
  from public.production_planning pp
  where pp.mesin = p_mesin
    and pp.jam_rencana_mulai >= p_start and pp.jam_rencana_mulai < p_end;
$$;
grant execute on function public.achievement_aggregate(machine_type, timestamptz, timestamptz) to authenticated;

-- Achievement (Delivery) versi lengkap dgn persentase — belum dipakai app saat ini, disiapkan utk fitur lanjutan
create or replace function public.achievement_summary(
  p_mesin machine_type,
  p_stasiun_list text[],
  p_start timestamptz,
  p_end timestamptz
)
returns table (qty_rencana numeric, qty_aktual numeric, achievement_pct numeric)
language sql stable
as $$
  with rencana as (
    select coalesce(sum(qty_rencana), 0) as total
    from public.production_planning
    where mesin = p_mesin
      and (p_stasiun_list is null or stasiun = any(p_stasiun_list))
      and jam_rencana_mulai >= p_start and jam_rencana_mulai < p_end
  ),
  aktual as (
    select coalesce(sum(qty), 0) as total
    from public.production_log
    where mesin = p_mesin
      and (p_stasiun_list is null or stasiun = any(p_stasiun_list))
      and waktu_awal >= p_start and waktu_awal < p_end
  )
  select
    rencana.total, aktual.total,
    case when rencana.total > 0 then (aktual.total / rencana.total) * 100 else null end
  from rencana, aktual;
$$;
grant execute on function public.achievement_summary(machine_type, text[], timestamptz, timestamptz) to authenticated;

-- 12. Scrap Top End (data bulanan, satuan K IDR)
create table public.scrap_top_end (
  id uuid primary key default gen_random_uuid(),
  tahun integer not null,
  bulan integer not null check (bulan between 1 and 12),
  scrap_value_kidr numeric not null default 0,
  total_value_kidr numeric not null default 0,
  target_rasio numeric,
  created_at timestamptz not null default now(),
  unique (tahun, bulan)
);
alter table public.scrap_top_end enable row level security;

create policy "Login bisa lihat scrap_top_end"
  on public.scrap_top_end for select to authenticated using (true);
create policy "Admin/Leader kelola scrap_top_end"
  on public.scrap_top_end for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')));

create or replace function public.scrap_top_end_summary(
  p_start date,
  p_end date
)
returns table (scrap_value_kidr numeric, total_value_kidr numeric, rasio numeric, target_rasio numeric)
language sql stable
as $$
  with f as (
    select * from public.scrap_top_end
    where make_date(tahun, bulan, 1) >= date_trunc('month', p_start)::date
      and make_date(tahun, bulan, 1) < p_end
  )
  select
    coalesce(sum(scrap_value_kidr), 0),
    coalesce(sum(total_value_kidr), 0),
    case when coalesce(sum(total_value_kidr),0) > 0
      then sum(scrap_value_kidr) / sum(total_value_kidr) else 0 end,
    coalesce(avg(target_rasio), 0)
  from f;
$$;
grant execute on function public.scrap_top_end_summary(date, date) to authenticated;

-- 13. Safety (catatan insiden; kosong = 0 accident)
create table public.safety_log (
  id uuid primary key default gen_random_uuid(),
  tanggal date not null,
  kategori text not null default 'ACCIDENT',
  keterangan text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.safety_log enable row level security;

create policy "Login bisa lihat safety_log"
  on public.safety_log for select to authenticated using (true);
create policy "Admin/Leader kelola safety_log"
  on public.safety_log for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')));

create or replace function public.safety_summary(
  p_start date,
  p_end date
)
returns table (accident_count bigint, hari_tanpa_accident integer)
language sql stable
as $$
  select
    (select count(*) from public.safety_log
      where tanggal >= p_start and tanggal < p_end and kategori = 'ACCIDENT'),
    (select coalesce(
      (current_date - max(tanggal))::integer,
      (current_date - current_date)::integer  -- belum pernah ada insiden -> ganti tanggal mulai hitung sesuai kebutuhan
    ) from public.safety_log where kategori = 'ACCIDENT');
$$;
grant execute on function public.safety_summary(date, date) to authenticated;

-- 14. Fungsi Performance/Dashboard (agregasi server-side)
create or replace function public.performance_aggregate(
  p_mesin machine_type,
  p_stasiun_list text[],   -- kirim NULL dari app (Welding tidak pakai stasiun)
  p_start timestamptz,
  p_end timestamptz
)
returns table (
  stroke numeric,
  ng numeric,
  ng_value numeric,
  dandori_menit numeric,
  downtime_menit numeric,
  break_menit numeric,
  wh_menit numeric,
  jumlah_baris bigint,
  target_std_menit numeric
)
language sql stable
as $$
  with rows_with_ratio as (
    select pl.*, coalesce(pn.stroke_ratio, 1) as ratio, pn.std_ct, pn.harga_pcs
    from public.production_log pl
    left join public.part_numbers pn
      on pn.mesin = pl.mesin and pn.value = pl.part_number
    where pl.mesin = p_mesin
      and (p_stasiun_list is null or pl.stasiun = any(p_stasiun_list))
      and pl.waktu_awal >= p_start
      and pl.waktu_awal < p_end
  ),
  batched_time as (
    select
      stasiun, waktu_awal, waktu_akhir,
      max(coalesce(break_menit, 0)) as break_menit,
      max(coalesce(dandori_menit, 0)) as dandori_menit,
      sum(coalesce(downtime_menit, 0)) as downtime_menit
    from rows_with_ratio
    group by stasiun, waktu_awal, waktu_akhir
  )
  select
    (select coalesce(sum(coalesce(qty, 0) * ratio), 0) from rows_with_ratio),
    (select coalesce(sum(ng), 0) from rows_with_ratio),
    (select coalesce(sum(coalesce(ng,0) * coalesce(harga_pcs,0)), 0) from rows_with_ratio),
    (select coalesce(sum(dandori_menit), 0) from batched_time),
    (select coalesce(sum(downtime_menit), 0) from batched_time),
    (select coalesce(sum(break_menit), 0) from batched_time),
    (select coalesce(sum(extract(epoch from (waktu_akhir - waktu_awal)) / 60), 0)
       - (select coalesce(sum(break_menit), 0) from batched_time)
     from batched_time),
    (select count(*) from rows_with_ratio),
    (select coalesce(sum(coalesce(qty, 0) * ratio * std_ct), 0) from rows_with_ratio where std_ct is not null and std_ct > 0);
$$;
grant execute on function public.performance_aggregate(machine_type, text[], timestamptz, timestamptz) to authenticated;

-- Breakdown per Part Number — disiapkan utk fitur lanjutan, belum dipakai app saat ini
create or replace function public.performance_by_part(
  p_mesin machine_type,
  p_stasiun_list text[],
  p_start timestamptz,
  p_end timestamptz
)
returns table (
  part_number text,
  qty numeric,
  stroke numeric,
  operasi_menit numeric,
  earned_menit numeric,
  gsph numeric,
  jumlah_baris bigint
)
language sql stable
as $$
  select
    pl.part_number,
    sum(coalesce(pl.qty, 0)) as qty,
    sum(coalesce(pl.qty, 0) * coalesce(pn.stroke_ratio, 1)) as stroke,
    sum(extract(epoch from (pl.waktu_akhir - pl.waktu_awal)) / 60) as operasi_menit,
    sum(coalesce(pl.qty, 0) * coalesce(pn.stroke_ratio, 1) * coalesce(pn.std_ct, 0)) as earned_menit,
    case when sum(extract(epoch from (pl.waktu_akhir - pl.waktu_awal)) / 60) > 0
      then sum(coalesce(pl.qty, 0) * coalesce(pn.stroke_ratio, 1))
           / (sum(extract(epoch from (pl.waktu_akhir - pl.waktu_awal)) / 60) / 60)
      else 0 end as gsph,
    count(*) as jumlah_baris
  from public.production_log pl
  left join public.part_numbers pn
    on pn.mesin = pl.mesin and pn.value = pl.part_number
  where pl.mesin = p_mesin
    and (p_stasiun_list is null or pl.stasiun = any(p_stasiun_list))
    and pl.waktu_awal >= p_start and pl.waktu_awal < p_end
  group by pl.part_number
  order by stroke desc;
$$;
grant execute on function public.performance_by_part(machine_type, text[], timestamptz, timestamptz) to authenticated;

-- Trend GSPH per jam
create or replace function public.gsph_hourly(
  p_mesin machine_type,
  p_start timestamptz,
  p_end timestamptz
)
returns table (jam int, stroke numeric, wh_menit numeric, gsph numeric)
language sql stable
as $$
  with rows_with_ratio as (
    select pl.*, coalesce(pn.stroke_ratio, 1) as ratio,
           extract(hour from pl.waktu_awal at time zone 'Asia/Jakarta')::int as jam_mulai
    from public.production_log pl
    left join public.part_numbers pn
      on pn.mesin = pl.mesin and pn.value = pl.part_number
    where pl.mesin = p_mesin
      and pl.waktu_awal >= p_start and pl.waktu_awal < p_end
  ),
  per_jam as (
    select
      jam_mulai as jam,
      sum(coalesce(qty,0) * ratio) as stroke,
      sum(extract(epoch from (waktu_akhir - waktu_awal))/60) - sum(coalesce(break_menit,0)) as wh_menit
    from rows_with_ratio
    group by jam_mulai
  )
  select jam, stroke, wh_menit,
         case when wh_menit > 0 then stroke / (wh_menit/60) else 0 end as gsph
  from per_jam
  order by jam;
$$;
grant execute on function public.gsph_hourly(machine_type, timestamptz, timestamptz) to authenticated;

-- Trend GSPH ter-bucket (hemat query: 1 query per line, bukan per-periode)
create or replace function public.gsph_trend_bucketed(
  p_mesin machine_type,
  p_start timestamptz,
  p_end timestamptz,
  p_bucket text            -- 'hour' | 'day' | 'month'
)
returns table (bucket_start timestamptz, stroke numeric, wh_menit numeric, gsph numeric)
language sql stable
as $$
  with rows_with_ratio as (
    select
      date_trunc(p_bucket, pl.waktu_awal at time zone 'Asia/Jakarta') as b,
      pl.stasiun, pl.waktu_awal, pl.waktu_akhir,
      coalesce(pl.qty, 0) * coalesce(pn.stroke_ratio, 1) as stroke,
      coalesce(pl.break_menit, 0) as break_menit
    from public.production_log pl
    left join public.part_numbers pn
      on pn.mesin = pl.mesin and pn.value = pl.part_number
    where pl.mesin = p_mesin
      and pl.waktu_awal >= p_start
      and pl.waktu_awal < p_end
  ),
  waktu_unik as (
    select b, stasiun, waktu_awal, waktu_akhir,
           max(break_menit) as break_menit
    from rows_with_ratio
    group by b, stasiun, waktu_awal, waktu_akhir
  ),
  wh as (
    select b,
           sum(extract(epoch from (waktu_akhir - waktu_awal)) / 60) - sum(break_menit) as wh_menit
    from waktu_unik
    group by b
  ),
  st as (
    select b, sum(stroke) as stroke
    from rows_with_ratio
    group by b
  )
  select
    st.b at time zone 'Asia/Jakarta' as bucket_start,
    st.stroke,
    coalesce(wh.wh_menit, 0) as wh_menit,
    case when coalesce(wh.wh_menit, 0) > 0
         then st.stroke / (wh.wh_menit / 60)
         else 0 end as gsph
  from st
  left join wh on wh.b = st.b
  order by st.b;
$$;
grant execute on function public.gsph_trend_bucketed(machine_type, timestamptz, timestamptz, text) to authenticated;

-- Status line terkini (baris produksi paling akhir per line)
create or replace function public.machine_live_status(
  p_start timestamptz,
  p_end timestamptz
)
returns table (
  mesin machine_type,
  stasiun text,
  part_number text,
  waktu_awal timestamptz,
  waktu_akhir timestamptz,
  qty numeric,
  stroke numeric,
  gsph numeric,
  downtime_menit numeric
)
language sql stable
as $$
  with ranked as (
    select pl.*, coalesce(pn.stroke_ratio,1) as ratio,
           row_number() over (partition by pl.mesin, pl.stasiun order by pl.waktu_awal desc) as rn
    from public.production_log pl
    left join public.part_numbers pn
      on pn.mesin = pl.mesin and pn.value = pl.part_number
    where pl.waktu_awal >= p_start and pl.waktu_awal < p_end
  )
  select
    mesin, stasiun, part_number, waktu_awal, waktu_akhir,
    qty,
    (coalesce(qty,0) * ratio) as stroke,
    case
      when (extract(epoch from (waktu_akhir - waktu_awal))/60 - coalesce(break_menit,0)) > 0
      then (coalesce(qty,0) * ratio) / ((extract(epoch from (waktu_akhir - waktu_awal))/60 - coalesce(break_menit,0))/60)
      else 0
    end as gsph,
    coalesce(downtime_menit, 0) as downtime_menit
  from ranked
  where rn = 1
  order by mesin, stasiun;
$$;
grant execute on function public.machine_live_status(timestamptz, timestamptz) to authenticated;

-- 5 Worst Downtime (per problem, total menit terbesar)
create or replace function public.downtime_top_problems(
  p_mesin machine_type,
  p_stasiun_list text[],
  p_start timestamptz,
  p_end timestamptz,
  p_limit int default 5
)
returns table (kategori text, problem text, total_menit numeric)
language sql stable
as $$
  select kategori, coalesce(problem, '(tanpa keterangan)') as problem,
         sum(extract(epoch from (waktu_akhir - waktu_awal)) / 60) as total_menit
  from public.downtime_log
  where mesin = p_mesin
    and (p_stasiun_list is null or stasiun = any(p_stasiun_list))
    and waktu_awal >= p_start and waktu_awal < p_end
  group by kategori, problem
  order by total_menit desc
  limit p_limit;
$$;
grant execute on function public.downtime_top_problems(machine_type, text[], timestamptz, timestamptz, int) to authenticated;

-- Downtime per kategori (pie chart)
create or replace function public.downtime_by_category(
  p_mesin machine_type,
  p_stasiun_list text[],
  p_start timestamptz,
  p_end timestamptz
)
returns table (kategori text, total_menit numeric)
language sql stable
as $$
  select kategori, sum(extract(epoch from (waktu_akhir - waktu_awal)) / 60) as total_menit
  from public.downtime_log
  where mesin = p_mesin
    and (p_stasiun_list is null or stasiun = any(p_stasiun_list))
    and waktu_awal >= p_start and waktu_awal < p_end
  group by kategori
  order by total_menit desc;
$$;
grant execute on function public.downtime_by_category(machine_type, text[], timestamptz, timestamptz) to authenticated;

-- =========================================================
-- SELESAI. Setelah dijalankan, cek Table Editor di Supabase untuk
-- memastikan seluruh tabel di atas sudah muncul, lalu isi Master Data
-- (part_numbers & downtime_problems) untuk masing-masing line Welding
-- E-02..E-07 -- baik lewat SQL seed atau langsung dari tab Master Data
-- di aplikasi.
-- =========================================================
