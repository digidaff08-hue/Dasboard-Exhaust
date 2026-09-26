-- =====================================================================
-- migration_andon_selesai_penangan.sql
-- Panggilan yang SUDAH DITERIMA hanya boleh diselesaikan oleh orang yang
-- menerimanya (atau admin sebagai cadangan). Jalankan sekali, aman diulang.
-- =====================================================================
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
        case when r.status = 'ditangani' then 'Sudah ditangani oleh ' || coalesce(r.ditangani_nama, 'orang lain') || '.'
             else 'Panggilan ini sudah ' || r.status || '.' end);
    end if;
    update public.andon_call
       set status = 'ditangani', ditangani_at = now(), ditangani_oleh = auth.uid(), ditangani_nama = v_nama
     where id = p_id;

  elsif v_aksi = 'selesai' then
    if r.status not in ('memanggil', 'ditangani') then
      return jsonb_build_object('ok', false, 'pesan', 'Panggilan ini sudah ' || r.status || '.');
    end if;
    -- BARU: sudah diterima orang lain -> hanya penerima (atau admin) yang boleh menyelesaikan
    if r.status = 'ditangani' and r.ditangani_oleh is distinct from auth.uid() and v_role <> 'admin' then
      return jsonb_build_object('ok', false, 'pesan',
        'Hanya ' || coalesce(r.ditangani_nama, 'orang yang menerima panggilan') || ' yang bisa menyelesaikan perbaikan ini.');
    end if;
    update public.andon_call
       set status = 'selesai',
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
notify pgrst, 'reload schema';

select 'OK - aturan selesai oleh penerima aktif' as status;
