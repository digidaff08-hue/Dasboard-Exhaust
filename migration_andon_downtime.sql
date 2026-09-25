-- =====================================================================
-- migration_andon_downtime.sql -- Panggilan Andon -> form Downtime
-- Jalankan SEKALI di Supabase > SQL Editor (klik Run). Aman diulang.
-- Butuh migration_andon.sql sudah dijalankan.
-- =====================================================================
begin;

-- penanda: panggilan ini sudah dibuat jadi downtime / sengaja diabaikan
alter table public.andon_call add column if not exists downtime_id   uuid;
alter table public.andon_call add column if not exists downtime_skip boolean not null default false;

-- p_downtime_id = id downtime yang baru dibuat; NULL = "Abaikan"
create or replace function public.andon_link_downtime(p_id uuid, p_downtime_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.andon_boleh() then
    return jsonb_build_object('ok', false, 'pesan', 'Akun ini tidak boleh mengubah Andon.');
  end if;
  update public.andon_call
     set downtime_id   = p_downtime_id,
         downtime_skip = (p_downtime_id is null)
   where id = p_id;
  return jsonb_build_object('ok', found);
end $$;
revoke all on function public.andon_link_downtime(uuid, uuid) from public, anon;
grant execute on function public.andon_link_downtime(uuid, uuid) to authenticated;

commit;
notify pgrst, 'reload schema';

-- Hasil: 1 baris, semua true
select
  exists (select 1 from information_schema.columns where table_name = 'andon_call' and column_name = 'downtime_id')   as kolom_downtime_id,
  exists (select 1 from information_schema.columns where table_name = 'andon_call' and column_name = 'downtime_skip') as kolom_downtime_skip,
  to_regprocedure('public.andon_link_downtime(uuid,uuid)') is not null as fungsi_ok;
