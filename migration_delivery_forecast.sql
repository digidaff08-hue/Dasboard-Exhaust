-- =========================================================
-- MIGRATION: Delivery Plan & Forecast (bahan hitung Plan Harian)
--
-- Dua tabel ini SUMBER ANGKA, bukan hasil. Yang dipakai rumus:
--   delivery_plan   -> "dp"  (dicocokkan pakai kode UNIQ / kolom AM)
--   forecast_harian -> "fc"  (dicocokkan pakai PART NUMBER)
--
-- ---------------------------------------------------------
-- KENAPA TIDAK 31 KOLOM (d1..d31) SEPERTI DI SHEET?
-- Rumusnya selalu melihat H, H+1, H+2, H+3. Dengan 31 kolom, H+1
-- yang jatuh di tanggal 1 bulan berikutnya ada di BARIS LAIN dengan
-- KOLOM LAIN -- tiap perhitungan akhir bulan jadi kasus khusus.
-- Disimpan 1 baris = 1 part 1 tanggal, lompat hari/bulan jadi
-- pencarian tanggal biasa. Tampilan grid 1..31-nya tetap ada,
-- lewat fungsi di bagian bawah file ini.
-- ---------------------------------------------------------
--
-- Aman dijalankan ulang.
-- =========================================================

-- ---------- 1) DELIVERY PLAN ----------
create table if not exists public.delivery_plan (
  uniq        text not null,                 -- kode UNIQ / kolom AM di sheet
  part_number text not null,                 -- P/N (keterangan + buat cari balik)
  tanggal     date not null,
  qty         integer not null default 0,
  updated_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now(),
  primary key (uniq, tanggal)
);
create index if not exists idx_delivery_plan_tanggal on public.delivery_plan (tanggal);
create index if not exists idx_delivery_plan_part    on public.delivery_plan (part_number, tanggal);

-- ---------- 2) FORECAST ----------
-- Dicocokkan pakai PART NUMBER (di sheet: kolom CE), jadi part number
-- yang jadi kuncinya. uniq ikut disimpan sebagai keterangan.
create table if not exists public.forecast_harian (
  part_number text not null,
  uniq        text,
  tanggal     date not null,
  qty         integer not null default 0,
  updated_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now(),
  primary key (part_number, tanggal)
);
create index if not exists idx_forecast_tanggal on public.forecast_harian (tanggal);

-- ---------- RLS: semua yang login boleh lihat, admin/leader boleh ubah ----------
alter table public.delivery_plan   enable row level security;
alter table public.forecast_harian enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['delivery_plan', 'forecast_harian'] loop
    if not exists (select 1 from pg_policies
                    where schemaname = 'public' and tablename = t
                      and policyname = 'Login bisa lihat ' || t) then
      execute format(
        'create policy %I on public.%I for select to authenticated using (true)',
        'Login bisa lihat ' || t, t);
    end if;

    if not exists (select 1 from pg_policies
                    where schemaname = 'public' and tablename = t
                      and policyname = 'Admin/Leader bisa tambah ' || t) then
      execute format(
        'create policy %I on public.%I for insert to authenticated with check (exists '
        '(select 1 from public.profiles where id = auth.uid() and role in (''admin'',''leader'')))',
        'Admin/Leader bisa tambah ' || t, t);
    end if;

    if not exists (select 1 from pg_policies
                    where schemaname = 'public' and tablename = t
                      and policyname = 'Admin/Leader bisa update ' || t) then
      execute format(
        'create policy %I on public.%I for update to authenticated using (exists '
        '(select 1 from public.profiles where id = auth.uid() and role in (''admin'',''leader'')))',
        'Admin/Leader bisa update ' || t, t);
    end if;

    if not exists (select 1 from pg_policies
                    where schemaname = 'public' and tablename = t
                      and policyname = 'Admin/Leader bisa hapus ' || t) then
      execute format(
        'create policy %I on public.%I for delete to authenticated using (exists '
        '(select 1 from public.profiles where id = auth.uid() and role in (''admin'',''leader'')))',
        'Admin/Leader bisa hapus ' || t, t);
    end if;
  end loop;
end $$;

-- ---------- Trigger updated_at ----------
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_delivery_plan_updated') then
    create trigger trg_delivery_plan_updated
      before update on public.delivery_plan
      for each row execute procedure public.set_updated_meta();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_forecast_harian_updated') then
    create trigger trg_forecast_harian_updated
      before update on public.forecast_harian
      for each row execute procedure public.set_updated_meta();
  end if;
end $$;


-- =========================================================
-- TAMPILAN GRID 1..31 (buat mencocokkan dengan sheet)
--   select * from public.delivery_plan_grid('2026-10-01');
--   select * from public.forecast_grid('2026-10-01');
-- Tanggal yang dikirim boleh tanggal berapa saja di bulan itu.
-- =========================================================
create or replace function public.delivery_plan_grid(p_bulan date)
returns table (
  uniq text, part_number text,
  "d1" int, "d2" int, "d3" int, "d4" int, "d5" int, "d6" int, "d7" int, "d8" int,
  "d9" int, "d10" int, "d11" int, "d12" int, "d13" int, "d14" int, "d15" int, "d16" int,
  "d17" int, "d18" int, "d19" int, "d20" int, "d21" int, "d22" int, "d23" int, "d24" int,
  "d25" int, "d26" int, "d27" int, "d28" int, "d29" int, "d30" int, "d31" int
) language sql stable as $$
  select t.uniq, max(t.part_number),
    max(t.qty) filter (where extract(day from t.tanggal)=1)::int as "d1", max(t.qty) filter (where extract(day from t.tanggal)=2)::int as "d2", max(t.qty) filter (where extract(day from t.tanggal)=3)::int as "d3",
    max(t.qty) filter (where extract(day from t.tanggal)=4)::int as "d4", max(t.qty) filter (where extract(day from t.tanggal)=5)::int as "d5", max(t.qty) filter (where extract(day from t.tanggal)=6)::int as "d6",
    max(t.qty) filter (where extract(day from t.tanggal)=7)::int as "d7", max(t.qty) filter (where extract(day from t.tanggal)=8)::int as "d8", max(t.qty) filter (where extract(day from t.tanggal)=9)::int as "d9",
    max(t.qty) filter (where extract(day from t.tanggal)=10)::int as "d10", max(t.qty) filter (where extract(day from t.tanggal)=11)::int as "d11", max(t.qty) filter (where extract(day from t.tanggal)=12)::int as "d12",
    max(t.qty) filter (where extract(day from t.tanggal)=13)::int as "d13", max(t.qty) filter (where extract(day from t.tanggal)=14)::int as "d14", max(t.qty) filter (where extract(day from t.tanggal)=15)::int as "d15",
    max(t.qty) filter (where extract(day from t.tanggal)=16)::int as "d16", max(t.qty) filter (where extract(day from t.tanggal)=17)::int as "d17", max(t.qty) filter (where extract(day from t.tanggal)=18)::int as "d18",
    max(t.qty) filter (where extract(day from t.tanggal)=19)::int as "d19", max(t.qty) filter (where extract(day from t.tanggal)=20)::int as "d20", max(t.qty) filter (where extract(day from t.tanggal)=21)::int as "d21",
    max(t.qty) filter (where extract(day from t.tanggal)=22)::int as "d22", max(t.qty) filter (where extract(day from t.tanggal)=23)::int as "d23", max(t.qty) filter (where extract(day from t.tanggal)=24)::int as "d24",
    max(t.qty) filter (where extract(day from t.tanggal)=25)::int as "d25", max(t.qty) filter (where extract(day from t.tanggal)=26)::int as "d26", max(t.qty) filter (where extract(day from t.tanggal)=27)::int as "d27",
    max(t.qty) filter (where extract(day from t.tanggal)=28)::int as "d28", max(t.qty) filter (where extract(day from t.tanggal)=29)::int as "d29", max(t.qty) filter (where extract(day from t.tanggal)=30)::int as "d30",
    max(t.qty) filter (where extract(day from t.tanggal)=31)::int as "d31"
  from public.delivery_plan t
  where t.tanggal >= date_trunc('month', p_bulan)::date
    and t.tanggal <  (date_trunc('month', p_bulan) + interval '1 month')::date
  group by t.uniq
  order by t.uniq;
$$;

create or replace function public.forecast_grid(p_bulan date)
returns table (
  part_number text, uniq text,
  "d1" int, "d2" int, "d3" int, "d4" int, "d5" int, "d6" int, "d7" int, "d8" int,
  "d9" int, "d10" int, "d11" int, "d12" int, "d13" int, "d14" int, "d15" int, "d16" int,
  "d17" int, "d18" int, "d19" int, "d20" int, "d21" int, "d22" int, "d23" int, "d24" int,
  "d25" int, "d26" int, "d27" int, "d28" int, "d29" int, "d30" int, "d31" int
) language sql stable as $$
  select t.part_number, max(t.uniq),
    max(t.qty) filter (where extract(day from t.tanggal)=1)::int as "d1", max(t.qty) filter (where extract(day from t.tanggal)=2)::int as "d2", max(t.qty) filter (where extract(day from t.tanggal)=3)::int as "d3",
    max(t.qty) filter (where extract(day from t.tanggal)=4)::int as "d4", max(t.qty) filter (where extract(day from t.tanggal)=5)::int as "d5", max(t.qty) filter (where extract(day from t.tanggal)=6)::int as "d6",
    max(t.qty) filter (where extract(day from t.tanggal)=7)::int as "d7", max(t.qty) filter (where extract(day from t.tanggal)=8)::int as "d8", max(t.qty) filter (where extract(day from t.tanggal)=9)::int as "d9",
    max(t.qty) filter (where extract(day from t.tanggal)=10)::int as "d10", max(t.qty) filter (where extract(day from t.tanggal)=11)::int as "d11", max(t.qty) filter (where extract(day from t.tanggal)=12)::int as "d12",
    max(t.qty) filter (where extract(day from t.tanggal)=13)::int as "d13", max(t.qty) filter (where extract(day from t.tanggal)=14)::int as "d14", max(t.qty) filter (where extract(day from t.tanggal)=15)::int as "d15",
    max(t.qty) filter (where extract(day from t.tanggal)=16)::int as "d16", max(t.qty) filter (where extract(day from t.tanggal)=17)::int as "d17", max(t.qty) filter (where extract(day from t.tanggal)=18)::int as "d18",
    max(t.qty) filter (where extract(day from t.tanggal)=19)::int as "d19", max(t.qty) filter (where extract(day from t.tanggal)=20)::int as "d20", max(t.qty) filter (where extract(day from t.tanggal)=21)::int as "d21",
    max(t.qty) filter (where extract(day from t.tanggal)=22)::int as "d22", max(t.qty) filter (where extract(day from t.tanggal)=23)::int as "d23", max(t.qty) filter (where extract(day from t.tanggal)=24)::int as "d24",
    max(t.qty) filter (where extract(day from t.tanggal)=25)::int as "d25", max(t.qty) filter (where extract(day from t.tanggal)=26)::int as "d26", max(t.qty) filter (where extract(day from t.tanggal)=27)::int as "d27",
    max(t.qty) filter (where extract(day from t.tanggal)=28)::int as "d28", max(t.qty) filter (where extract(day from t.tanggal)=29)::int as "d29", max(t.qty) filter (where extract(day from t.tanggal)=30)::int as "d30",
    max(t.qty) filter (where extract(day from t.tanggal)=31)::int as "d31"
  from public.forecast_harian t
  where t.tanggal >= date_trunc('month', p_bulan)::date
    and t.tanggal <  (date_trunc('month', p_bulan) + interval '1 month')::date
  group by t.part_number
  order by t.part_number;
$$;


-- =========================================================
-- CONTOH ISI (3 baris pertama gambar, tanggal 1-5 Okt 2026).
-- Boleh dihapus/diganti kapan saja.
-- =========================================================
insert into public.delivery_plan (uniq, part_number, tanggal, qty) values
  ('D159', '25051-0Y050',   date '2026-10-01', 246),
  ('D159', '25051-0Y050',   date '2026-10-02', 196),
  ('D159', '25051-0Y050',   date '2026-10-03',   0),
  ('D159', '25051-0Y050',   date '2026-10-04',   0),
  ('D159', '25051-0Y050',   date '2026-10-05', 297),
  ('D160', '25051-0Y060',   date '2026-10-01', 166),
  ('D160', '25051-0Y060',   date '2026-10-02', 136),
  ('D160', '25051-0Y060',   date '2026-10-03',   0),
  ('D160', '25051-0Y060',   date '2026-10-04',   0),
  ('D160', '25051-0Y060',   date '2026-10-05',  94),
  ('D410', '25051-BZ140-T', date '2026-10-01', 512),
  ('D410', '25051-BZ140-T', date '2026-10-02', 474),
  ('D410', '25051-BZ140-T', date '2026-10-03',   0),
  ('D410', '25051-BZ140-T', date '2026-10-04',   0),
  ('D410', '25051-BZ140-T', date '2026-10-05', 436)
on conflict (uniq, tanggal) do nothing;


-- ---------- Pemeriksaan ----------
select * from public.delivery_plan_grid(date '2026-10-01');
select count(*) as baris_delivery_plan from public.delivery_plan;
select count(*) as baris_forecast      from public.forecast_harian;
