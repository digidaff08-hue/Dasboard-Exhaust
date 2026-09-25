-- =====================================================================
-- migration_andon_setting.sql -- Pengaturan suara Andon (khusus admin)
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

-- semua user login boleh MEMBACA (supaya semua HP/TV pakai suara yang sama)
create policy andon_setting_select on public.andon_setting for select to authenticated using (true);
-- hanya ADMIN yang boleh mengubah
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

commit;
notify pgrst, 'reload schema';

-- Hasil: 1 baris pengaturan (nada telepon, 30 detik, ulang 60 detik, volume 80)
select nada, durasi, ulang, volume, layar_panggilan, getar from public.andon_setting;
