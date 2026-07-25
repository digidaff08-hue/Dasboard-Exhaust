-- =========================================================
-- MIGRASI: Proses Selanjutnya jadi BISA LEBIH DARI SATU (untuk part
-- yang separating/split jadi beberapa part number di proses berikutnya)
-- Jalankan sekali di Supabase SQL Editor
-- =========================================================

-- Kolom baru: array proses selanjutnya, format:
-- [{"line": "transfer_2000t", "part_number": "53741-VT020-001"},
--  {"line": "transfer_2000t", "part_number": "53742-VT020-001"}]
alter table public.part_numbers add column if not exists next_processes jsonb not null default '[]'::jsonb;

-- Pindahkan data lama (KALAU kolom next_line/next_part_number pernah ada
-- dari versi sebelumnya). Dibungkus pengecekan supaya aman dijalankan
-- juga di project yang belum pernah pakai fitur "Proses Selanjutnya"
-- versi lama sama sekali (kolomnya belum pernah dibuat).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'part_numbers' and column_name = 'next_line'
  ) then
    update public.part_numbers
    set next_processes = jsonb_build_array(
      jsonb_build_object('line', next_line, 'part_number', next_part_number)
    )
    where next_line is not null
      and (next_processes is null or next_processes = '[]'::jsonb);
  end if;
end $$;

-- Kolom lama tidak dipakai lagi (aman walau memang belum pernah ada)
alter table public.part_numbers drop column if exists next_line;
alter table public.part_numbers drop column if exists next_part_number;

-- =========================================================
-- SELESAI. Kolom next_processes siap dipakai — di app, tiap part number
-- bisa punya beberapa "Proses Selanjutnya" sekaligus (tombol + Tambah).
-- =========================================================
