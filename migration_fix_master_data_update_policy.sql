-- =========================================================
-- PERBAIKAN BUG: kebijakan akses "update" ketinggalan waktu bikin
-- tabel part_numbers & downtime_problems, jadi edit Part Number/Problem
-- (termasuk "Proses Selanjutnya") gagal tersimpan diam-diam.
-- Jalankan sekali di Supabase SQL Editor.
-- =========================================================

drop policy if exists "Login bisa update part_numbers" on public.part_numbers;
create policy "Login bisa update part_numbers"
  on public.part_numbers for update to authenticated using (true) with check (true);

drop policy if exists "Login bisa update downtime_problems" on public.downtime_problems;
create policy "Login bisa update downtime_problems"
  on public.downtime_problems for update to authenticated using (true) with check (true);

-- =========================================================
-- SELESAI. Setelah ini, coba lagi edit part number/problem di app —
-- harusnya sudah benar-benar tersimpan sekarang.
-- =========================================================
