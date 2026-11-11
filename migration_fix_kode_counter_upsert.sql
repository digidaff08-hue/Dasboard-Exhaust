-- =========================================================
-- PERBAIKAN: nomor kode produksi menggelembung saat sinkron sheet
--
-- MASALAHNYA
-- Sinkronisasi dari Google Sheets memakai "upsert": satu perintah yang
-- artinya "tambahkan, atau perbarui kalau sudah ada". Postgres menjalankan
-- trigger BEFORE INSERT untuk SETIAP baris yang masuk -- termasuk baris
-- yang ternyata sudah ada dan akhirnya cuma diperbarui. Akibatnya
-- generate_kode_produksi() mengambil nomor baru dari kode_counter setiap
-- kali sheet mengirim ulang baris lama, padahal tidak ada baris baru.
-- Nomor di baris lamanya sendiri tidak berubah (kolom kode tidak ikut
-- dikirim sheet), jadi yang rusak cuma penomoran untuk baris berikutnya:
-- terus melompat makin jauh tanpa sebab.
--
-- Diuji: satu baris dikirim ulang 2x menaikkan counter dari 1 jadi 3.
--
-- KAPAN INI PENTING
-- Terutama sebelum menjalankan backfillAll, yang mengirim ulang SELURUH
-- isi sheet sekaligus -- ribuan baris lama, ribuan nomor terbuang.
--
-- PERBAIKANNYA
-- Baris yang punya sheet_row_id DAN sheet_row_id itu sudah ada di tabel
-- berarti baris lama yang sedang dikirim ulang: langsung keluar, jangan
-- ambil nomor. Baris baru dari sheet tetap dapat nomor seperti biasa,
-- dan baris dari aplikasi (sheet_row_id kosong) sama sekali tidak
-- terpengaruh.
--
-- Tidak mengubah data apa pun. Aman dijalankan berulang.
-- Tabel production_log_new tidak perlu diperbaiki karena tidak diisi
-- dari Google Sheets.
-- =========================================================

create or replace function public.generate_kode_produksi()
returns trigger as $$
declare
  prefix text;
  hari date := (new.waktu_awal at time zone 'Asia/Jakarta')::date;
  next_counter int;
begin
  -- Baris lama yang sedang dikirim ulang dari sheet: jangan ambil nomor.
  -- Cek ini harus di awal, karena BEFORE INSERT jalan SEBELUM Postgres
  -- tahu bahwa barisnya ternyata bentrok dan cuma akan diperbarui.
  if new.sheet_row_id is not null
     and exists (select 1 from public.production_log p
                 where p.sheet_row_id = new.sheet_row_id) then
    return new;
  end if;

  -- Prefix = nama line tanpa tanda hubung, mis. 'E-02' -> 'E02'
  prefix := replace(new.mesin::text, '-', '');

  insert into public.kode_counter (mesin, tanggal, counter)
  values (new.mesin, hari, 1)
  on conflict (mesin, tanggal) do update set counter = public.kode_counter.counter + 1
  returning counter into next_counter;

  new.kode := prefix || '-' || to_char(hari, 'YYMMDD') || '-' || lpad(next_counter::text, 3, '0');
  return new;
end;
$$ language plpgsql security definer;

-- =========================================================
-- CARA MENGEMBALIKAN (kalau perlu): jalankan lagi definisi lama dari
-- schema_welding.sql baris 209-227, yaitu fungsi yang sama tanpa blok
-- "if new.sheet_row_id is not null ... return new; end if;".
-- =========================================================
