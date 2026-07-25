-- =========================================================
-- MIGRASI: Modul Absensi (Morale) + Achievement (actual vs planning)
-- Jalankan sekali di Supabase SQL Editor
-- =========================================================

-- 1. Absensi harian per shift (level pabrik, bukan per mesin)
create table if not exists public.attendance_log (
  id uuid primary key default gen_random_uuid(),
  tanggal date not null,
  shift text not null check (shift in ('1','2')),
  total_orang integer not null default 0,
  hadir integer not null default 0,
  absen integer not null default 0,
  overtime_jam numeric not null default 0,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tanggal, shift)
);
alter table public.attendance_log enable row level security;

drop policy if exists "Login bisa lihat attendance_log" on public.attendance_log;
create policy "Login bisa lihat attendance_log"
  on public.attendance_log for select to authenticated using (true);

drop policy if exists "Admin/Leader bisa insert attendance_log" on public.attendance_log;
create policy "Admin/Leader bisa insert attendance_log"
  on public.attendance_log for insert to authenticated
  with check (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')));

drop policy if exists "Admin/Leader bisa update attendance_log" on public.attendance_log;
create policy "Admin/Leader bisa update attendance_log"
  on public.attendance_log for update to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')));

drop trigger if exists trg_attendance_log_updated on public.attendance_log;
create trigger trg_attendance_log_updated
  before update on public.attendance_log
  for each row execute procedure public.set_updated_meta();

-- 2. Ringkasan absensi utk rentang tanggal (dipakai Dashboard)
create or replace function public.attendance_summary(
  p_start date,
  p_end date
)
returns table (total_orang numeric, hadir numeric, absen numeric, overtime_jam numeric)
language sql stable
as $$
  select
    coalesce(avg(total_orang), 0),
    coalesce(sum(hadir), 0),
    coalesce(sum(absen), 0),
    coalesce(sum(overtime_jam), 0)
  from public.attendance_log
  where tanggal >= p_start and tanggal < p_end;
$$;
grant execute on function public.attendance_summary(date, date) to authenticated;

-- 3. Achievement (aktual vs planning) per mesin/periode
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

-- =========================================================
-- SELESAI.
-- =========================================================
