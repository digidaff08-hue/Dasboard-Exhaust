-- =========================================================
-- Isi fungsi performance_aggregate, DIPECAH PER BARIS.
--
-- Query sebelumnya memulangkan satu sel panjang yang kepotong di
-- tabel hasil Supabase. Yang ini memulangkan satu baris kode per
-- baris tabel, jadi bisa dibaca & disalin seluruhnya.
--
-- Salin SEMUA baris hasilnya (kolom "teks") lalu kirim ke chat.
-- Tidak mengubah apa pun.
-- =========================================================

select t.ord as no, t.teks
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral regexp_split_to_table(pg_get_functiondef(p.oid), E'\n')
     with ordinality as t(teks, ord)
where n.nspname = 'public'
  and p.proname = 'performance_aggregate'
order by t.ord;
