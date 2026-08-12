-- DIAGNOSTIK -- cuma SELECT, tidak mengubah data apapun.
-- Tujuannya: lihat kolom & isi asli downtime_problems, biar ketauan
-- kenapa versi berangka & tanpa angka tidak ke-anggap "pasangan".

select id, mesin, value, created_at
from public.downtime_problems
where value ilike '%pressure leak test error%'
   or value ilike '%clamp unclamp cylinder fault%'
order by value, mesin;
