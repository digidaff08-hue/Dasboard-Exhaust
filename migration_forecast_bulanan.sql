-- =========================================================
-- MIGRATION: Total Forecast per part (bulanan) + Hari Kerja
--
-- Melengkapi forecast_harian (angka per tanggal) yang sudah dibuat
-- di migration_delivery_forecast.sql:
--   forecast_bulanan   -> kolom "Total Forecast" di form (1 angka per
--                         part per bulan)
--   hari_kerja_bulanan -> isian "Hari Kerja" (1 angka per bulan)
--
-- periode = tanggal 1 bulan yang bersangkutan (mis. 2026-10-01).
-- Aman dijalankan ulang.
-- =========================================================

create table if not exists public.forecast_bulanan (
  periode        date not null,
  part_number    text not null,
  uniq           text,
  total_forecast integer not null default 0,
  updated_by     uuid references auth.users(id),
  updated_at     timestamptz not null default now(),
  primary key (periode, part_number)
);
create index if not exists idx_forecast_bulanan_periode on public.forecast_bulanan (periode);

create table if not exists public.hari_kerja_bulanan (
  periode    date primary key,
  hari_kerja integer not null default 0,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.forecast_bulanan   enable row level security;
alter table public.hari_kerja_bulanan enable row level security;

do $$
declare t text;
begin
  foreach t in array array['forecast_bulanan', 'hari_kerja_bulanan'] loop
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t
                     and policyname='Login bisa lihat '||t) then
      execute format('create policy %I on public.%I for select to authenticated using (true)',
                     'Login bisa lihat '||t, t);
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t
                     and policyname='Admin/Leader bisa tambah '||t) then
      execute format('create policy %I on public.%I for insert to authenticated with check (exists '
                     '(select 1 from public.profiles where id = auth.uid() and role in (''admin'',''leader'')))',
                     'Admin/Leader bisa tambah '||t, t);
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t
                     and policyname='Admin/Leader bisa update '||t) then
      execute format('create policy %I on public.%I for update to authenticated using (exists '
                     '(select 1 from public.profiles where id = auth.uid() and role in (''admin'',''leader'')))',
                     'Admin/Leader bisa update '||t, t);
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t
                     and policyname='Admin/Leader bisa hapus '||t) then
      execute format('create policy %I on public.%I for delete to authenticated using (exists '
                     '(select 1 from public.profiles where id = auth.uid() and role in (''admin'',''leader'')))',
                     'Admin/Leader bisa hapus '||t, t);
    end if;
  end loop;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname='trg_forecast_bulanan_updated') then
    create trigger trg_forecast_bulanan_updated before update on public.forecast_bulanan
      for each row execute procedure public.set_updated_meta();
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_hari_kerja_bulanan_updated') then
    create trigger trg_hari_kerja_bulanan_updated before update on public.hari_kerja_bulanan
      for each row execute procedure public.set_updated_meta();
  end if;
end $$;

-- ---------- Pemeriksaan ----------
select count(*) as baris_forecast_bulanan from public.forecast_bulanan;
select * from public.hari_kerja_bulanan order by periode;
