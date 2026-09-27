-- =====================================================================
-- migration_fy_override.sql
-- Jalankan SEKALI di Supabase > SQL Editor (klik Run, bukan Run selected).
-- Aman dijalankan ulang.
--
-- Data manual untuk tab TAHUNAN di Dashboard Exhaust.
-- Dipakai kalau angka hasil hitungan sistem (RPC) TIDAK SAMA dengan angka
-- actual laporan. Kalau FY-nya diaktifkan di sini, semua chart tab Tahunan
-- memakai angka dari tabel ini -- bukan dari RPC lagi.
--
-- 3 tabel:
--   1. fy_override           -> saklar ON/OFF tiap FY + angka FY sebelumnya
--   2. fy_override_bulan     -> angka per bulan (1 = April ... 12 = Maret)
--   3. fy_override_kategori  -> Downtime Supporting (per PIC) & Downtime Line
--
-- Diisi lewat: Master Data > tab "Dashboard FY".
-- =====================================================================
begin;

-- Boleh mengisi? (admin & leader -- sama seperti hak akses Master Data)
create or replace function public.md_staff_boleh()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid()
       and (lower(coalesce(role, '')) in ('admin', 'leader')
         or lower(coalesce(jabatan, '')) in ('admin', 'leader'))
  );
$$;
revoke all on function public.md_staff_boleh() from public, anon;
grant execute on function public.md_staff_boleh() to authenticated;


-- ---- 1) Saklar per tahun fiskal ----
-- fy = tahun MULAI fiskal. 2025 berarti April 2025 s/d Maret 2026.
create table if not exists public.fy_override (
  fy                     int primary key,
  aktif                  boolean not null default true,
  downtime_fy_prev_menit numeric,    -- bar FY sebelumnya di chart Downtime Exhaust
  updated_at             timestamptz not null default now(),
  updated_by             uuid
);

-- ---- 2) Angka per bulan. bulan 1 = April, 12 = Maret ----
create table if not exists public.fy_override_bulan (
  fy                     int not null,
  bulan                  int not null check (bulan between 1 and 12),
  productivity_actual    numeric,   -- %
  productivity_target    numeric,   -- %
  availability_actual    numeric,   -- %
  ng_qty                 numeric,   -- pcs
  ng_value               numeric,   -- rupiah
  sp_actual              numeric,   -- % straight pass
  sp_qty                 numeric,   -- stroke
  sp_repair_qty          numeric,   -- qty repair
  downtime_exhaust_menit numeric,   -- menit
  primary key (fy, bulan)
);

-- ---- 3) Downtime Supporting (per PIC) & Downtime Line (per Line) ----
create table if not exists public.fy_override_kategori (
  fy         int not null,
  jenis      text not null check (jenis in ('supporting', 'line')),
  kode       text not null,          -- PIC (PE/MESIN/...) atau Line (E-02/...)
  plan_menit numeric,
  act_menit  numeric,
  primary key (fy, jenis, kode)
);


-- ---- RLS: semua yang login boleh BACA (dashboard perlu), ----
-- ---- yang boleh MENGUBAH hanya admin & leader.            ----
do $$
declare t text; p record;
begin
  foreach t in array array['fy_override', 'fy_override_bulan', 'fy_override_kategori'] loop
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_sel', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.md_staff_boleh())', t || '_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.md_staff_boleh()) with check (public.md_staff_boleh())', t || '_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.md_staff_boleh())', t || '_del', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Catat siapa & kapan terakhir mengubah saklar FY
create or replace function public.fy_override_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists trg_fy_override_stamp on public.fy_override;
create trigger trg_fy_override_stamp before insert or update on public.fy_override
  for each row execute function public.fy_override_stamp();


-- ---- Siapkan baris kosong untuk FY 2025 supaya langsung bisa diisi ----
insert into public.fy_override (fy, aktif) values (2025, true)
  on conflict (fy) do nothing;

insert into public.fy_override_bulan (fy, bulan)
select 2025, g from generate_series(1, 12) g
  on conflict (fy, bulan) do nothing;

insert into public.fy_override_kategori (fy, jenis, kode)
select 2025, 'supporting', k
  from unnest(array['PE', 'MESIN', 'QC', 'PC-SUPP', 'PROD', 'PRESS']) k
  on conflict (fy, jenis, kode) do nothing;

insert into public.fy_override_kategori (fy, jenis, kode)
select 2025, 'line', k
  from unnest(array['E-02', 'E-03', 'E-04', 'E-05', 'E-06', 'E-07']) k
  on conflict (fy, jenis, kode) do nothing;

commit;

notify pgrst, 'reload schema';

-- Hasil: baris_bulan = 12, baris_kategori = 12, aktif = true
select
  (select count(*) from public.fy_override_bulan     where fy = 2025) as baris_bulan,
  (select count(*) from public.fy_override_kategori  where fy = 2025) as baris_kategori,
  (select aktif    from public.fy_override           where fy = 2025) as aktif;
