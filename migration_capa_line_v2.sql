-- =========================================================
-- MIGRATION: Kapasitas Line (lengkap) + Master Part
--
-- Lanjutan migration_capa_line.sql. Dua tambahan:
--
--  1. production_capa_line dapat 4 kolom baru -- isi sub "Kapasitas Line"
--     (sesuai sheet Plan Produksi):
--        kapasitas          = kapasitas normal per hari (pcs)
--        man_power          = jumlah orang
--        kapasitas_jumat    = kapasitas hari Jum'at (pcs)
--        kapasitas_per_jam  = kapasitas per jam (pcs)
--     Kolom lama (capa_standar / capa_ot3 / capa_ot2_shift1) TIDAK diubah
--     -- itu tetap punya sub "Capacity Harian" (garis di grafik).
--
--  2. Tabel baru production_master_part -- isi sub "Master Part":
--        default_line = line utama part itu
--        cycle_time   = detik per pcs
--        watari       = line lain yang boleh dipakai ('NO' kalau tidak ada,
--                       atau daftar dipisah koma: 'E-03,E-04,E-06')
--     Tabel ini SENGAJA terpisah dari part_numbers. part_numbers dipakai
--     halaman mesin & Performance (std_ct jadi dasar target/OEE), jadi
--     mengubahnya dari form plan bisa menggeser angka OEE tanpa disadari.
--
-- Aman dijalankan ulang: kolom/tabel yang sudah ada dilewati, dan angka
-- yang sudah Anda ubah lewat dashboard TIDAK ditimpa (hanya yang masih
-- kosong/0 yang diisi).
-- =========================================================

-- ---------- 1) Kolom baru di production_capa_line ----------
alter table public.production_capa_line
  add column if not exists kapasitas          integer not null default 0,
  add column if not exists man_power           integer not null default 0,
  add column if not exists kapasitas_jumat     integer not null default 0,
  add column if not exists kapasitas_per_jam   integer not null default 0;

insert into public.production_capa_line
  (mesin, kapasitas, man_power, kapasitas_jumat, kapasitas_per_jam) values
  ('E-02', 240, 3, 270, 25),
  ('E-03', 600, 4, 568, 32),
  ('E-04', 640, 4, 608, 32),
  ('E-05', 600, 4, 568, 32),
  ('E-06', 534, 4, 502, 32),
  ('E-07', 260, 5, 225, 35)
on conflict (mesin) do update set
  -- hanya mengisi yang masih 0, jadi hasil editan tidak hilang
  kapasitas         = case when public.production_capa_line.kapasitas = 0
                           then excluded.kapasitas else public.production_capa_line.kapasitas end,
  man_power         = case when public.production_capa_line.man_power = 0
                           then excluded.man_power else public.production_capa_line.man_power end,
  kapasitas_jumat   = case when public.production_capa_line.kapasitas_jumat = 0
                           then excluded.kapasitas_jumat else public.production_capa_line.kapasitas_jumat end,
  kapasitas_per_jam = case when public.production_capa_line.kapasitas_per_jam = 0
                           then excluded.kapasitas_per_jam else public.production_capa_line.kapasitas_per_jam end;


-- ---------- 2) Tabel Master Part ----------
create table if not exists public.production_master_part (
  part_number  text primary key,
  default_line machine_type,
  cycle_time   numeric(10,2) not null default 0,
  watari       text not null default 'NO',
  updated_by   uuid references auth.users(id),
  updated_at   timestamptz not null default now()
);

alter table public.production_master_part enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'production_master_part'
                    and policyname = 'Login bisa lihat production_master_part') then
    create policy "Login bisa lihat production_master_part"
      on public.production_master_part for select to authenticated using (true);
  end if;

  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'production_master_part'
                    and policyname = 'Admin/Leader bisa tambah production_master_part') then
    create policy "Admin/Leader bisa tambah production_master_part"
      on public.production_master_part for insert to authenticated
      with check (exists (
        select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')
      ));
  end if;

  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'production_master_part'
                    and policyname = 'Admin/Leader bisa update production_master_part') then
    create policy "Admin/Leader bisa update production_master_part"
      on public.production_master_part for update to authenticated
      using (exists (
        select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')
      ));
  end if;

  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'production_master_part'
                    and policyname = 'Admin/Leader bisa hapus production_master_part') then
    create policy "Admin/Leader bisa hapus production_master_part"
      on public.production_master_part for delete to authenticated
      using (exists (
        select 1 from public.profiles where id = auth.uid() and role in ('admin','leader')
      ));
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_master_part_updated') then
    create trigger trg_master_part_updated
      before update on public.production_master_part
      for each row execute procedure public.set_updated_meta();
  end if;
end $$;

-- Isi awal = sheet "MASTER PART". Tidak menimpa baris yang sudah ada.
insert into public.production_master_part (part_number, default_line, cycle_time, watari) values
  ('14110-52P00',   'E-02', 105,   'NO'),
  ('14110-73R10',   'E-02', 119,   'NO'),
  ('14110-73R20',   'E-02', 119,   'NO'),
  ('14110-74U00',   'E-02', 113,   'NO'),
  ('25051-BZ060',   'E-03', 102.9, 'NO'),
  ('25051-BZ260',   'E-05', 102.9, 'E-03'),
  ('25051-0Y050',   'E-05', 102.9, 'NO'),
  ('25051-0Y060',   'E-05', 102.9, 'NO'),
  ('25051-BZ140',   'E-06', 102.9, 'E-03,E-04,E-05,E-06'),
  ('25051-BZ140-T', 'E-03', 102.9, 'E-03,E-04,E-06'),
  ('25051-BZ150-T', 'E-04', 102.9, 'E-05'),
  ('25051-BZ110',   'E-06', 105,   'NO'),
  ('25051-BZ010',   'E-06', 105,   'NO'),
  ('25051-BZ180',   'E-06', 105,   'NO'),
  ('14110-74U50',   'E-07', 92,    'NO')
on conflict (part_number) do nothing;


-- ---------- Pemeriksaan ----------
select mesin, capa_standar, capa_ot3, capa_ot2_shift1,
       kapasitas, man_power, kapasitas_jumat, kapasitas_per_jam
from public.production_capa_line
order by mesin;

select part_number, default_line, cycle_time, watari
from public.production_master_part
order by default_line, part_number;
