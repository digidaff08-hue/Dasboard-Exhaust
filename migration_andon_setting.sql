-- =====================================================================
-- migration_andon_setting.sql -- Pengaturan suara Andon (khusus admin)
-- + edit riwayat Andon (masalah & countermeasure).
-- Jalankan SEKALI di Supabase > SQL Editor (klik Run). Aman diulang.
-- Butuh migration_andon.sql sudah dijalankan.
-- =====================================================================
begin;

create table if not exists public.andon_setting (
  id              int primary key default 1 check (id = 1),   -- hanya 1 baris
  nada            text not null default 'telepon' check (nada in ('telepon','sirene','alarm','bel')),
  durasi          int  not null default 30  check (durasi between 0 and 600),  -- detik; 0 = sampai direspons
  ulang           int  not null default 60  check (ulang between 0 and 3600),  -- detik; 0 = tidak diulang
  volume          int  not null default 80  check (volume between 0 and 100),
  layar_panggilan boolean not null default true,
  getar           boolean not null default true,
  updated_at      timestamptz not null default now(),
  updated_by      uuid
);

insert into public.andon_setting (id) values (1) on conflict (id) do nothing;

create or replace function public.andon_setting_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.id := 1; new.updated_at := now(); new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists trg_andon_setting_stamp on public.andon_setting;
create trigger trg_andon_setting_stamp before insert or update on public.andon_setting
  for each row execute function public.andon_setting_stamp();

alter table public.andon_setting enable row level security;
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'andon_setting'
  loop execute format('drop policy %I on public.andon_setting', p.policyname); end loop;
end $$;

create policy andon_setting_select on public.andon_setting for select to authenticated using (true);
create policy andon_setting_insert on public.andon_setting for insert to authenticated with check (
  exists (select 1 from public.profiles where id = auth.uid() and lower(role) = 'admin'));
create policy andon_setting_update on public.andon_setting for update to authenticated using (
  exists (select 1 from public.profiles where id = auth.uid() and lower(role) = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and lower(role) = 'admin'));

revoke all on public.andon_setting from anon;
grant select, insert, update on public.andon_setting to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'andon_setting') then
    execute 'alter publication supabase_realtime add table public.andon_setting';
  end if;
end $$;


alter table public.andon_call add column if not exists diedit_at   timestamptz;
alter table public.andon_call add column if not exists diedit_nama text;

create or replace function public.andon_edit(p_id uuid, p_keterangan text, p_catatan text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.andon_boleh() then
    return jsonb_build_object('ok', false, 'pesan', 'Akun ini tidak boleh mengubah Andon.');
  end if;
  update public.andon_call
     set keterangan  = nullif(trim(coalesce(p_keterangan, '')), ''),
         catatan     = nullif(trim(coalesce(p_catatan, '')), ''),
         diedit_at   = now(),
         diedit_nama = public.andon_nama_saya()
   where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'pesan', 'Data tidak ditemukan.');
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.andon_edit(uuid, text, text) from public, anon;
grant execute on function public.andon_edit(uuid, text, text) to authenticated;

commit;
notify pgrst, 'reload schema';

-- Hasil: 1 baris pengaturan + fitur edit aktif
select s.nada, s.durasi, s.ulang, s.volume,
       to_regprocedure('public.andon_edit(uuid,text,text)') is not null as edit_ok
  from public.andon_setting s;
