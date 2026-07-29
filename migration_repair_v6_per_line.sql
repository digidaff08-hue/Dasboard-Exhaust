-- =========================================================
-- MIGRATION: Repair — Model 3D Part sekarang PER LINE
-- Jalankan sekali setelah migration_repair_v5_part_number.sql
-- Aman dijalankan berulang.
--
-- SEBELUM ini: semua part 3D di tab Repair itu SHARED, dipakai
-- bareng-bareng oleh ke-6 line (E-02...E-07).
-- SESUDAH ini: setiap part 3D dimiliki 1 line tertentu. Kalau ada
-- part yang sama dipakai di beberapa line, tinggal upload/tandai
-- part itu lagi di line-line yang butuh (lewat Master Data > Repair
-- di line masing-masing) -- boleh pakai file .stl yang sama.
--
-- Part yang SUDAH ADA sekarang otomatis DIGANDAKAN ke ke-6 line biar
-- datanya tidak hilang. Belum ada Point yang ditandai di part ini
-- (sesuai catatan di README), jadi aman digandakan tanpa perlu
-- mindahin Point/Riwayat Repair apa pun. Nanti tinggal hapus manual
-- dari line yang memang tidak butuh part itu (tombol hapus di tab
-- Master Data > Repair — Model 3D Part).
-- =========================================================

alter table public.repair_views
  add column if not exists mesin machine_type;

do $$
declare
  v record;
  lines text[] := array['E-02','E-03','E-04','E-05','E-06','E-07'];
  i int;
begin
  for v in select * from public.repair_views where mesin is null loop
    -- baris asli jadi milik line pertama
    update public.repair_views set mesin = lines[1]::machine_type where id = v.id;
    -- gandakan buat 5 line sisanya (model_url/kind/label sama, Point kosong)
    for i in 2..array_length(lines, 1) loop
      insert into public.repair_views (label, image_url, model_url, kind, sort_order, mesin)
      values (v.label, v.image_url, v.model_url, v.kind, v.sort_order, lines[i]::machine_type);
    end loop;
  end loop;
end $$;

alter table public.repair_views alter column mesin set not null;
create index if not exists idx_repair_views_mesin on public.repair_views (mesin, sort_order);

-- =========================================================
-- SELESAI. Part 3D baru yang di-upload lewat tab Master Data > Repair
-- otomatis kesimpen buat line yang lagi dibuka saja.
-- =========================================================
