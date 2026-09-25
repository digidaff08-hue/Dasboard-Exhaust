-- =====================================================================
-- migration_andon.sql  -- ANDON tahap 1 (panggil supporting)
-- Jalankan SEKALI di Supabase > SQL Editor (klik Run, bukan Run selected).
-- Aman dijalankan ulang.
--
-- Alur status:  memanggil -> ditangani -> selesai   (atau: memanggil -> batal)
--   * memanggil : operator menekan "Panggil Supporting" di halaman mesin
--   * ditangani : orang supporting menekan "Saya menuju ke sana"
--   * selesai   : perbaikan beres
-- Waktu respons  = ditangani_at - dipanggil_at
-- Waktu perbaikan = selesai_at  - ditangani_at
--
-- Isi tabel hanya bisa DITAMBAH lewat insert biasa (jam & nama diisi
-- server), dan hanya bisa DIUBAH lewat fungsi andon_aksi() -- jadi jam
-- tidak bisa dimanipulasi dari aplikasi. Guest & viewer tidak bisa
-- memanggil / mengubah.
-- =====================================================================
begin;

create table if not exists public.andon_call (
  id              uuid primary key default gen_random_uuid(),
  mesin           text not null,
  tim             text not null,
  keterangan      text,
  status          text not null default 'memanggil'
                  check (status in ('memanggil', 'ditangani', 'selesai', 'batal')),
  dipanggil_at    timestamptz not null default now(),
  dipanggil_oleh  uuid,
  dipanggil_nama  text,
  ditangani_at    timestamptz,
  ditangani_oleh  uuid,
  ditangani_nama  text,
  selesai_at      timestamptz,
  selesai_oleh    uuid,
  selesai_nama    text,
  catatan         text
);

create index if not exists andon_call_waktu_idx  on public.andon_call (dipanggil_at desc);
create index if not exists andon_call_status_idx on public.andon_call (status)
  where status in ('memanggil', 'ditangani');
-- Satu mesin tidak bisa memanggil tim yang sama dua kali selama
-- panggilan sebelumnya belum selesai (mencegah tombol ditekan berulang).
create unique index if not exists andon_call_aktif_uq on public.andon_call (mesin, tim)
  where status in ('memanggil', 'ditangani');


-- Boleh memanggil / menangani? (semua user login KECUALI guest & viewer)
create or replace function public.andon_boleh()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid()
       and lower(coalesce(role, '')) not in ('guest', 'viewer')
  );
$$;

create or replace function public.andon_nama_saya()
returns text
language sql stable security definer
set search_path = public
as $$
  select coalesce(nullif(trim(full_name), ''), 'User')
    from public.profiles where id = auth.uid();
$$;


-- Insert: jam, status & nama pemanggil DITENTUKAN SERVER
create or replace function public.andon_before_insert()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  new.status         := 'memanggil';
  new.dipanggil_at   := now();
  new.dipanggil_oleh := auth.uid();
  new.dipanggil_nama := public.andon_nama_saya();
  new.mesin          := upper(trim(new.mesin));
  new.tim            := upper(trim(new.tim));
  new.keterangan     := nullif(trim(coalesce(new.keterangan, '')), '');
  new.ditangani_at := null; new.ditangani_oleh := null; new.ditangani_nama := null;
  new.selesai_at   := null; new.selesai_oleh   := null; new.selesai_nama   := null;
  return new;
end $$;

drop trigger if exists trg_andon_before_insert on public.andon_call;
create trigger trg_andon_before_insert
  before insert on public.andon_call
  for each row execute function public.andon_before_insert();


-- Ubah status. p_aksi: 'ambil' | 'selesai' | 'batal'
create or replace function public.andon_aksi(p_id uuid, p_aksi text, p_catatan text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  r      public.andon_call%rowtype;
  v_aksi text := lower(trim(coalesce(p_aksi, '')));
  v_nama text;
  v_role text;
begin
  if not public.andon_boleh() then
    return jsonb_build_object('ok', false, 'pesan', 'Akun ini tidak boleh mengubah Andon.');
  end if;

  select * into r from public.andon_call where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'pesan', 'Panggilan tidak ditemukan.');
  end if;

  v_nama := public.andon_nama_saya();
  select lower(coalesce(role, '')) into v_role from public.profiles where id = auth.uid();

  if v_aksi = 'ambil' then
    if r.status <> 'memanggil' then
      return jsonb_build_object('ok', false, 'pesan',
        case when r.status = 'ditangani' then 'Sudah ditangani oleh ' || coalesce(r.ditangani_nama, 'orang lain') || '.'
             else 'Panggilan ini sudah ' || r.status || '.' end);
    end if;
    update public.andon_call
       set status = 'ditangani', ditangani_at = now(),
           ditangani_oleh = auth.uid(), ditangani_nama = v_nama
     where id = p_id;

  elsif v_aksi = 'selesai' then
    if r.status not in ('memanggil', 'ditangani') then
      return jsonb_build_object('ok', false, 'pesan', 'Panggilan ini sudah ' || r.status || '.');
    end if;
    update public.andon_call
       set status = 'selesai',
           -- langsung "Selesai" tanpa "ambil" -> dianggap ditangani sekarang
           ditangani_at   = coalesce(ditangani_at, now()),
           ditangani_oleh = coalesce(ditangani_oleh, auth.uid()),
           ditangani_nama = coalesce(ditangani_nama, v_nama),
           selesai_at = now(), selesai_oleh = auth.uid(), selesai_nama = v_nama,
           catatan = coalesce(nullif(trim(coalesce(p_catatan, '')), ''), catatan)
     where id = p_id;

  elsif v_aksi = 'batal' then
    if r.status <> 'memanggil' then
      return jsonb_build_object('ok', false, 'pesan', 'Hanya panggilan yang belum ditangani yang bisa dibatalkan.');
    end if;
    if r.dipanggil_oleh is distinct from auth.uid() and v_role not in ('admin', 'leader') then
      return jsonb_build_object('ok', false, 'pesan', 'Hanya pemanggil, leader, atau admin yang bisa membatalkan.');
    end if;
    update public.andon_call
       set status = 'batal', selesai_at = now(), selesai_oleh = auth.uid(), selesai_nama = v_nama
     where id = p_id;

  else
    return jsonb_build_object('ok', false, 'pesan', 'Aksi tidak dikenal.');
  end if;

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.andon_aksi(uuid, text, text) from public, anon;
grant execute on function public.andon_aksi(uuid, text, text) to authenticated;
revoke all on function public.andon_boleh() from public, anon;
grant execute on function public.andon_boleh() to authenticated;


-- RLS
alter table public.andon_call enable row level security;
do $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'andon_call'
  loop
    execute format('drop policy %I on public.andon_call', p.policyname);
  end loop;
end $$;

create policy andon_select on public.andon_call
  for select to authenticated using (true);
create policy andon_insert on public.andon_call
  for insert to authenticated with check (public.andon_boleh());
create policy andon_delete on public.andon_call
  for delete to authenticated using (
    exists (select 1 from public.profiles where id = auth.uid() and lower(role) = 'admin'));
-- Sengaja TIDAK ada policy UPDATE: status hanya berubah lewat andon_aksi().

revoke all on public.andon_call from anon;
grant select, insert, delete on public.andon_call to authenticated;


-- Realtime (halaman Andon & halaman mesin langsung ter-update)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime'
                        and schemaname = 'public' and tablename = 'andon_call') then
    execute 'alter publication supabase_realtime add table public.andon_call';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';

-- Hasil: harus tampil 1 baris dengan semua kolom = true
select
  to_regclass('public.andon_call') is not null                      as tabel_ada,
  to_regprocedure('public.andon_aksi(uuid,text,text)') is not null  as fungsi_ada,
  (select count(*) from pg_policies where tablename = 'andon_call') = 3 as rls_ok,
  exists (select 1 from pg_publication_tables
           where pubname = 'supabase_realtime' and tablename = 'andon_call') as realtime_ok;
