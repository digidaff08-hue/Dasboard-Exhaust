-- =========================================================
-- REVISI: NG Inline jadi cascading Line -> Model -> Part No / Area -> NG Proses
-- Jalankan file ini SETELAH schema_ng_inline.sql (yang lama).
-- AMAN dijalankan berkali-kali (idempotent).
--
-- CATATAN: tabel `ng_areas` dan `ng_models` (flat/global) dari revisi
-- SEBELUMNYA sudah TIDAK DIPAKAI lagi oleh form -- diganti 3 tabel baru
-- di bawah ini. Tabel lama itu saya BIARKAN saja (tidak saya hapus,
-- jaga-jaga kalau sudah keburu diisi data) -- boleh diabaikan atau
-- dihapus manual nanti kalau kawan mau beres-beres.
-- =========================================================

-- 1. Line -> Model (dropdown Model, difilter sesuai line/mesin saat ini)
create table if not exists public.ng_line_models (
  id uuid primary key default gen_random_uuid(),
  mesin machine_type not null,
  model text not null,
  created_at timestamptz not null default now(),
  unique (mesin, model)
);
alter table public.ng_line_models enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'ng_line_models' and policyname = 'Login bisa lihat ng_line_models') then
    create policy "Login bisa lihat ng_line_models" on public.ng_line_models for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'ng_line_models' and policyname = 'Login bisa tambah ng_line_models') then
    create policy "Login bisa tambah ng_line_models" on public.ng_line_models for insert to authenticated with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'ng_line_models' and policyname = 'Login bisa update ng_line_models') then
    create policy "Login bisa update ng_line_models" on public.ng_line_models for update to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'ng_line_models' and policyname = 'Login bisa hapus ng_line_models') then
    create policy "Login bisa hapus ng_line_models" on public.ng_line_models for delete to authenticated using (true);
  end if;
end $$;

-- 2. Model -> Part No (dropdown Part No, difilter sesuai Model yang dipilih)
create table if not exists public.ng_model_parts (
  id uuid primary key default gen_random_uuid(),
  model text not null,
  part_no text not null,
  created_at timestamptz not null default now(),
  unique (model, part_no)
);
alter table public.ng_model_parts enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'ng_model_parts' and policyname = 'Login bisa lihat ng_model_parts') then
    create policy "Login bisa lihat ng_model_parts" on public.ng_model_parts for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'ng_model_parts' and policyname = 'Login bisa tambah ng_model_parts') then
    create policy "Login bisa tambah ng_model_parts" on public.ng_model_parts for insert to authenticated with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'ng_model_parts' and policyname = 'Login bisa update ng_model_parts') then
    create policy "Login bisa update ng_model_parts" on public.ng_model_parts for update to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'ng_model_parts' and policyname = 'Login bisa hapus ng_model_parts') then
    create policy "Login bisa hapus ng_model_parts" on public.ng_model_parts for delete to authenticated using (true);
  end if;
end $$;

-- 3. Line + Model -> Area -> NG Proses (dropdown Area, difilter sesuai
--    Line saat ini + Model yang dipilih). SENGAJA TIDAK unique(mesin,model,area)
--    -- karena kawan konfirmasi ada Area yang sama tapi punya 2 NG Proses
--    berbeda (misal E-07/K15C: "JIG 4 E07 YTB" & "JIG 6 E07 YTB"), itu
--    memang valid, jadi 2 baris dianggap 2 pilihan berbeda di dropdown.
create table if not exists public.ng_model_areas (
  id uuid primary key default gen_random_uuid(),
  mesin machine_type not null,
  model text not null,
  area text not null,
  ng_proses text not null,
  created_at timestamptz not null default now(),
  unique (mesin, model, area, ng_proses)
);
alter table public.ng_model_areas enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'ng_model_areas' and policyname = 'Login bisa lihat ng_model_areas') then
    create policy "Login bisa lihat ng_model_areas" on public.ng_model_areas for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'ng_model_areas' and policyname = 'Login bisa tambah ng_model_areas') then
    create policy "Login bisa tambah ng_model_areas" on public.ng_model_areas for insert to authenticated with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'ng_model_areas' and policyname = 'Login bisa update ng_model_areas') then
    create policy "Login bisa update ng_model_areas" on public.ng_model_areas for update to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'ng_model_areas' and policyname = 'Login bisa hapus ng_model_areas') then
    create policy "Login bisa hapus ng_model_areas" on public.ng_model_areas for delete to authenticated using (true);
  end if;
end $$;

-- =========================================================
-- SELESAI. Lanjut jalankan seed_ng_inline_master.sql buat isi datanya.
-- =========================================================
