-- =========================================================
-- MIGRATION: Kapasitas (CAPACITY) per Line
--
-- Dipakai garis acuan di grafik CAPACITY (tab Plan Harian):
--   1. capa_standar      -> garis HIJAU  (kapasitas standar)
--   2. capa_ot3          -> garis BIRU   (standar + OT 3 jam)
--   3. capa_ot2_shift1   -> garis MERAH  (standar + OT 2 jam + Shift 1)
--
-- Angkanya bisa diubah dari dashboard (tombol "⚙️ Capacity" di tab
-- Plan Harian, khusus admin/leader) -- tabel ini yang disimpan.
--
-- Jalankan di Supabase > SQL Editor. Aman diulang: kalau tabelnya
-- sudah ada, blok "create table" dilewati dan isinya TIDAK ditimpa.
-- Butuh schema_welding.sql lebih dulu (type machine_type, tabel
-- profiles, dan fungsi set_updated_meta sudah ada).
-- =========================================================

create table if not exists public.production_capa_line (
  mesin            machine_type primary key,
  capa_standar     integer not null default 0,
  capa_ot3         integer not null default 0,
  capa_ot2_shift1  integer not null default 0,
  updated_by       uuid references auth.users(id),
  updated_at       timestamptz not null default now()
);

alter table public.production_capa_line enable row level security;

-- Policy dibuat satu per satu dengan penjagaan "kalau belum ada",
-- supaya file ini bisa dijalankan ulang tanpa error.
do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'production_capa_line'
                    and policyname = 'Login bisa lihat production_capa_line') then
    create policy "Login bisa lihat production_capa_line"
      on public.production_capa_line for select to authenticated using (true);
  end if;

  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'production_capa_line'
                    and policyname = 'Admin/Leader bisa tambah production_capa_line') then
    create policy "Admin/Leader bisa tambah production_capa_line"
      on public.production_capa_line for insert to authenticated
      with check (exists (
        select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')
      ));
  end if;

  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'production_capa_line'
                    and policyname = 'Admin/Leader bisa update production_capa_line') then
    create policy "Admin/Leader bisa update production_capa_line"
      on public.production_capa_line for update to authenticated
      using (exists (
        select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')
      ));
  end if;

  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'production_capa_line'
                    and policyname = 'Admin/Leader bisa hapus production_capa_line') then
    create policy "Admin/Leader bisa hapus production_capa_line"
      on public.production_capa_line for delete to authenticated
      using (exists (
        select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')
      ));
  end if;
end $$;

-- Trigger updated_at (dilewati kalau sudah terpasang)
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_capa_line_updated') then
    create trigger trg_capa_line_updated
      before update on public.production_capa_line
      for each row execute procedure public.set_updated_meta();
  end if;
end $$;

-- Isi awal = angka yang dipakai sekarang.
-- "on conflict do nothing" -> kalau nanti angkanya sudah diubah lewat
-- dashboard, menjalankan file ini lagi TIDAK mengembalikannya ke angka
-- di bawah ini.
insert into public.production_capa_line (mesin, capa_standar, capa_ot3, capa_ot2_shift1) values
  ('E-02', 360, 420, 460),
  ('E-03', 480, 550, 600),
  ('E-04', 480, 576, 640),
  ('E-05', 480, 550, 600),
  ('E-06', 412, 480, 534),
  ('E-07', 520, 625, 695)
on conflict (mesin) do nothing;

-- Pemeriksaan: harus keluar 6 baris dengan angka di atas.
select mesin, capa_standar, capa_ot3, capa_ot2_shift1
from public.production_capa_line
order by mesin;
