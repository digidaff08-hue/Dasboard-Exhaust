-- =========================================================
-- MIGRASI: Rata-rata absensi HANYA hari kerja (Sabtu & Minggu diabaikan)
-- Jalankan sekali di Supabase SQL Editor
-- =========================================================

drop function if exists public.attendance_summary(date, date);
create or replace function public.attendance_summary(
  p_start date,
  p_end date
)
returns table (
  total_orang numeric,
  hadir numeric,
  cuti numeric,
  absen numeric,
  overtime_jam numeric,
  jumlah_hari bigint
)
language sql stable
as $$
  -- extract(dow) -> 0 = Minggu, 6 = Sabtu. Keduanya dibuang dari
  -- perhitungan supaya rata-rata harian mencerminkan HARI KERJA saja.
  select
    coalesce(sum(total_orang), 0),
    coalesce(sum(hadir), 0),
    coalesce(sum(cuti), 0),
    coalesce(sum(absen), 0),
    coalesce(sum(overtime_jam), 0),
    count(*)
  from public.attendance_log
  where tanggal >= p_start
    and tanggal < p_end
    and extract(dow from tanggal) not in (0, 6);
$$;
grant execute on function public.attendance_summary(date, date) to authenticated;

-- =========================================================
-- SELESAI.
-- =========================================================
