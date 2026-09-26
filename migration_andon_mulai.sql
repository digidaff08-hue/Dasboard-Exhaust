-- =====================================================================
-- migration_andon_mulai.sql -- Tahap "Mulai perbaikan"
-- Alur: memanggil -> ditangani (diterima, menuju lokasi)
--       -> diperbaiki (sudah sampai, mulai perbaikan) -> selesai
-- Waktu respons = ditangani_at - dipanggil_at
-- Waktu tiba    = mulai_at     - dipanggil_at
-- Waktu perbaikan = selesai_at - mulai_at
-- Jalankan sekali di Supabase > SQL Editor (Run). Aman diulang.
-- =====================================================================
begin;

alter table public.andon_call add column if not exists mulai_at timestamptz;

-- status baru 'diperbaiki'
alter table public.andon_call drop constraint if exists andon_call_status_check;
alter table public.andon_call add constraint andon_call_status_check
  check (status in ('memanggil', 'ditangani', 'diperbaiki', 'selesai', 'batal'));

-- satu mesin tidak bisa memanggil tim yang sama selama panggilan masih berjalan
drop index if exists public.andon_call_aktif_uq;
create unique index andon_call_aktif_uq on public.andon_call (mesin, tim)
  where status in ('memanggil', 'ditangani', 'diperbaiki');
drop index if exists public.andon_call_status_idx;
create index andon_call_status_idx on public.andon_call (status)
  where status in ('memanggil', 'ditangani', 'diperbaiki');

-- andon_aksi: tambah aksi 'mulai'
create or replace function public.andon_aksi(p_id uuid, p_aksi text, p_catatan text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
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
        case when r.status in ('ditangani', 'diperbaiki') then 'Sudah diterima oleh ' || coalesce(r.ditangani_nama, 'orang lain') || '.'
             else 'Panggilan ini sudah ' || r.status || '.' end);
    end if;
    update public.andon_call
       set status = 'ditangani', ditangani_at = now(), ditangani_oleh = auth.uid(), ditangani_nama = v_nama
     where id = p_id;

  elsif v_aksi = 'mulai' then
    if r.status <> 'ditangani' then
      return jsonb_build_object('ok', false, 'pesan',
        case when r.status = 'diperbaiki' then 'Perbaikan sudah dimulai.'
             when r.status = 'memanggil' then 'Terima panggilan dulu sebelum mulai perbaikan.'
             else 'Panggilan ini sudah ' || r.status || '.' end);
    end if;
    if r.ditangani_oleh is distinct from auth.uid() and v_role <> 'admin' then
      return jsonb_build_object('ok', false, 'pesan',
        'Hanya ' || coalesce(r.ditangani_nama, 'penerima panggilan') || ' yang bisa memulai perbaikan ini.');
    end if;
    update public.andon_call set status = 'diperbaiki', mulai_at = now() where id = p_id;

  elsif v_aksi = 'selesai' then
    if r.status not in ('memanggil', 'ditangani', 'diperbaiki') then
      return jsonb_build_object('ok', false, 'pesan', 'Panggilan ini sudah ' || r.status || '.');
    end if;
    if r.status in ('ditangani', 'diperbaiki') and r.ditangani_oleh is distinct from auth.uid() and v_role <> 'admin' then
      return jsonb_build_object('ok', false, 'pesan',
        'Hanya ' || coalesce(r.ditangani_nama, 'orang yang menerima panggilan') || ' yang bisa menyelesaikan perbaikan ini.');
    end if;
    update public.andon_call
       set status = 'selesai',
           ditangani_at   = coalesce(ditangani_at, now()),
           ditangani_oleh = coalesce(ditangani_oleh, auth.uid()),
           ditangani_nama = coalesce(ditangani_nama, v_nama),
           mulai_at       = coalesce(mulai_at, ditangani_at, now()),
           selesai_at = now(), selesai_oleh = auth.uid(), selesai_nama = v_nama,
           catatan = coalesce(nullif(trim(coalesce(p_catatan, '')), ''), catatan)
     where id = p_id;

  elsif v_aksi = 'batal' then
    if r.status <> 'memanggil' then
      return jsonb_build_object('ok', false, 'pesan', 'Hanya panggilan yang belum diterima yang bisa dibatalkan.');
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

commit;
notify pgrst, 'reload schema';

select 'OK - tahap Mulai perbaikan aktif' as status;
