-- Jalankan ini di Supabase SQL Editor, lalu copy semua hasilnya
-- (kolom "definisi") dan kirim balik ke saya -- saya perlu lihat
-- kode aslinya biar bisa perbaiki bagian yang hitung Value NG Inline.

select
  p.proname as nama_function,
  pg_get_functiondef(p.oid) as definisi
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'dashboard_qc_ng_month',
    'dashboard_qc_ng_perline',
    'dashboard_qc_ng_permodel',
    'dashboard_qc_ng_daily',
    'dashboard_qc_ng_detail',
    'dashboard_qc_ng_detail_range'
  )
order by p.proname;
