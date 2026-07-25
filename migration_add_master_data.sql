-- 5. Master data untuk dropdown Part Number & Problem (bisa nambah dari app)
create table public.part_numbers (
  id uuid primary key default gen_random_uuid(),
  mesin machine_type not null,
  value text not null,
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

-- =========================================================
-- SELESAI. Cek Table Editor di Supabase — pastikan tabel
-- part_numbers & downtime_problems sudah muncul.
-- Lanjutkan dengan menjalankan seed.sql untuk mengisi data awal
-- dari Excel lama Anda.
-- =========================================================
