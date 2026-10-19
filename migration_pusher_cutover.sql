-- =========================================================
-- BERALIH / KEMBALI antara Supabase Realtime dan Pusher
-- (lihat PUSHER.md). Dua blok terpisah, jalankan salah satu saja.
--
-- Blok A  : lepas tabel dari Supabase Realtime. Setelah ini Supabase
--           berhenti mengirim event Realtime untuk tabel-tabel itu,
--           jadi egress Realtime-nya hilang. JALANKAN HANYA SETELAH
--           semua layar sudah memakai Pusher (REALTIME_PROVIDER = "pusher"
--           sudah di-upload dan perangkat sudah memuat versi baru), kalau
--           tidak layar yang masih memakai Supabase tidak ter-update.
-- Blok B  : kembalikan ke Supabase Realtime (rollback). Setelah ini ubah
--           REALTIME_PROVIDER di assets/realtime.js kembali ke "supabase".
--
-- Tabel absensi/cuti (attendance_leave, cuti_jatah, hari_libur,
-- leave_requests) TIDAK disentuh: tetap Supabase Realtime.
-- Aman dijalankan berulang.
-- =========================================================

-- ---------------------------------------------------------
-- BLOK A: LEPAS dari Supabase Realtime
-- ---------------------------------------------------------
do $$
declare
  t text;
  tables text[] := array[
    'production_log', 'production_log_new', 'downtime_log', 'dandori_log',
    'ng_inline_log', 'repair_log', 'repair_views', 'repair_points',
    'andon_call', 'andon_setting'
  ];
begin
  foreach t in array tables loop
    if exists (select 1 from pg_publication_tables
               where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
      raise notice 'Dilepas dari Supabase Realtime: %', t;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------
-- BLOK B: KEMBALIKAN ke Supabase Realtime (rollback)
-- ---------------------------------------------------------
-- do $$
-- declare
--   t text;
--   tables text[] := array[
--     'production_log', 'production_log_new', 'downtime_log', 'dandori_log',
--     'ng_inline_log', 'repair_log', 'repair_views', 'repair_points',
--     'andon_call', 'andon_setting'
--   ];
-- begin
--   foreach t in array tables loop
--     if to_regclass('public.' || t) is not null
--        and not exists (select 1 from pg_publication_tables
--                        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
--       execute format('alter publication supabase_realtime add table public.%I', t);
--       raise notice 'Dipasang kembali ke Supabase Realtime: %', t;
--     end if;
--   end loop;
-- end $$;
--
-- (Untuk menjalankan Blok B: hapus tanda "-- " di depan tiap baris Blok B
--  dan beri tanda "-- " di Blok A, atau jalankan Blok B di jendela query baru.)
