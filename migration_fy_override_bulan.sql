-- =====================================================================
-- migration_fy_override_bulan.sql
-- Jalankan SETELAH migration_fy_override.sql.
-- Klik Run (bukan Run selected). Aman dijalankan ulang.
--
-- Downtime Supporting (per PIC) & Downtime Line (per Line) sekarang
-- diisi PER BULAN, bukan satu angka untuk satu tahun.
-- Angka di chart tab Tahunan = jumlah 12 bulan (dihitung otomatis).
--
-- CATATAN: baris lama yang belum punya bulan akan dihapus. Kalau sudah
-- terlanjur mengisi angka setahun di tab Dashboard FY, angka Supporting
-- & Line itu perlu diisi ulang per bulan (Productivity, Availability,
-- NG, Straight Pass, Downtime Exhaust TIDAK terpengaruh).
-- =====================================================================
begin;

-- 1) Tambah kolom bulan (1 = April ... 12 = Maret)
alter table public.fy_override_kategori
  add column if not exists bulan int;

-- 2) Buang baris lama yang belum punya bulan (dulu 1 baris = 1 tahun)
delete from public.fy_override_kategori where bulan is null;

-- 3) Kunci utama baru: satu baris = 1 FY + jenis + kode + bulan
alter table public.fy_override_kategori
  alter column bulan set not null;

do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.fy_override_kategori'::regclass and contype = 'p';
  if c is not null then
    execute format('alter table public.fy_override_kategori drop constraint %I', c);
  end if;
end $$;

alter table public.fy_override_kategori
  add constraint fy_override_kategori_pkey primary key (fy, jenis, kode, bulan);

alter table public.fy_override_kategori
  drop constraint if exists fy_override_kategori_bulan_check;
alter table public.fy_override_kategori
  add constraint fy_override_kategori_bulan_check check (bulan between 1 and 12);

-- 4) Siapkan baris kosong FY 2025: 12 bulan x 6 PIC + 12 bulan x 6 Line
insert into public.fy_override_kategori (fy, jenis, kode, bulan)
select 2025, 'supporting', k, b
  from unnest(array['PE', 'MESIN', 'QC', 'PC-SUPP', 'PROD', 'PRESS']) k
  cross join generate_series(1, 12) b
  on conflict (fy, jenis, kode, bulan) do nothing;

insert into public.fy_override_kategori (fy, jenis, kode, bulan)
select 2025, 'line', k, b
  from unnest(array['E-02', 'E-03', 'E-04', 'E-05', 'E-06', 'E-07']) k
  cross join generate_series(1, 12) b
  on conflict (fy, jenis, kode, bulan) do nothing;

commit;

notify pgrst, 'reload schema';

-- Hasil: supporting = 72, line = 72
select
  (select count(*) from public.fy_override_kategori where fy = 2025 and jenis = 'supporting') as supporting,
  (select count(*) from public.fy_override_kategori where fy = 2025 and jenis = 'line')       as line;
