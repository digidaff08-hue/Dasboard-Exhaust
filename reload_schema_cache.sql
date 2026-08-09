-- Paksa Supabase refresh cache skema tabel (kadang kolom baru butuh ini
-- biar langsung kedetect oleh API, tanpa perlu tunggu lama).
NOTIFY pgrst, 'reload schema';
