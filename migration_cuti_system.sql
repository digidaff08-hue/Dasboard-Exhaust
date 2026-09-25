-- =====================================================================
-- MIGRATION: Sistem Pengajuan Cuti / Izin / Sakit / Alfa
-- Jalankan di Supabase SQL Editor (sekali saja)
-- =====================================================================

-- 1. Tambah kolom no_wa di tabel profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS no_wa TEXT;

COMMENT ON COLUMN profiles.no_wa IS 'Nomor WhatsApp (tanpa +, contoh: 628123456789)';

-- 2. Tabel leave_requests (pengajuan cuti/izin/sakit/alfa)
CREATE TABLE IF NOT EXISTS leave_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  jenis         TEXT NOT NULL CHECK (jenis IN ('Izin','Sakit','Cuti','Alfa')),
  tanggal_mulai DATE NOT NULL,
  tanggal_selesai DATE NOT NULL,
  alasan        TEXT,
  status        TEXT NOT NULL DEFAULT 'Menunggu' CHECK (status IN ('Menunggu','Disetujui','Ditolak')),
  atasan_id     UUID REFERENCES auth.users(id),   -- siapa yang di-notify / perlu approve
  approved_by   UUID REFERENCES auth.users(id),
  approved_at   TIMESTAMPTZ,
  catatan_atasan TEXT,
  token         TEXT UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index untuk query cepat
CREATE INDEX IF NOT EXISTS idx_leave_requests_user ON leave_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_atasan ON leave_requests(atasan_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_token ON leave_requests(token);

-- 3. Fungsi: dapatkan atasan dari user_id berdasarkan jabatan
--    Aturan:
--    - Operator / Leader (jabatan bukan Foreman/Supervisor/Manager) → cari Foreman
--    - Foreman → cari Supervisor
--    - Supervisor → cari Manager
--    - Manager / Admin → NULL (tidak ada atasan, tidak perlu approve)
CREATE OR REPLACE FUNCTION get_atasan_id(p_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_jabatan TEXT;
  v_target_jabatan TEXT;
  v_atasan_id UUID;
BEGIN
  -- Ambil jabatan user yang mengajukan
  SELECT UPPER(COALESCE(jabatan,'')) INTO v_jabatan
  FROM profiles WHERE id = p_user_id;

  -- Tentukan jabatan atasan yang dicari
  CASE v_jabatan
    WHEN 'FOREMAN'    THEN v_target_jabatan := 'SUPERVISOR';
    WHEN 'SUPERVISOR' THEN v_target_jabatan := 'MANAGER';
    WHEN 'MANAGER'    THEN v_target_jabatan := NULL; -- tidak perlu approve
    ELSE v_target_jabatan := 'FOREMAN'; -- operator, leader, dan jabatan lain
  END CASE;

  IF v_target_jabatan IS NULL THEN
    RETURN NULL;
  END IF;

  -- Ambil user pertama dengan jabatan target (jabatan case-insensitive)
  SELECT id INTO v_atasan_id
  FROM profiles
  WHERE UPPER(COALESCE(jabatan,'')) = v_target_jabatan
    AND id != p_user_id
  LIMIT 1;

  RETURN v_atasan_id;
END;
$$;

-- 4. Fungsi: approve atau tolak pengajuan cuti (dipanggil dari approval-cuti.html)
CREATE OR REPLACE FUNCTION proses_approval_cuti(
  p_token     TEXT,
  p_action    TEXT,  -- 'approve' atau 'tolak'
  p_catatan   TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_req         leave_requests%ROWTYPE;
  v_new_status  TEXT;
BEGIN
  -- Ambil record berdasarkan token
  SELECT * INTO v_req FROM leave_requests WHERE token = p_token;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'pesan', 'Token tidak valid atau sudah tidak berlaku.');
  END IF;

  IF v_req.status != 'Menunggu' THEN
    RETURN json_build_object('ok', false, 'pesan', 'Pengajuan ini sudah diproses sebelumnya (status: ' || v_req.status || ').');
  END IF;

  IF p_action = 'approve' THEN
    v_new_status := 'Disetujui';
  ELSIF p_action = 'tolak' THEN
    v_new_status := 'Ditolak';
  ELSE
    RETURN json_build_object('ok', false, 'pesan', 'Aksi tidak dikenal: ' || p_action);
  END IF;

  -- Update status
  UPDATE leave_requests SET
    status        = v_new_status,
    approved_at   = NOW(),
    catatan_atasan = p_catatan
  WHERE id = v_req.id;

  RETURN json_build_object(
    'ok',     true,
    'status', v_new_status,
    'pesan',  'Pengajuan berhasil ' || CASE WHEN v_new_status = 'Disetujui' THEN 'disetujui' ELSE 'ditolak' END || '.'
  );
END;
$$;

-- 5. Trigger: saat cuti disetujui, otomatis buat record di attendance_log
--    (satu baris per hari dalam rentang tanggal_mulai - tanggal_selesai)
CREATE OR REPLACE FUNCTION trg_fn_auto_attendance_on_approve()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tgl DATE;
BEGIN
  -- Hanya jalan saat status berubah MENJADI Disetujui
  IF NEW.status = 'Disetujui' AND OLD.status != 'Disetujui' THEN
    v_tgl := NEW.tanggal_mulai;
    WHILE v_tgl <= NEW.tanggal_selesai LOOP
      -- Insert atau update attendance_log; pakai ON CONFLICT agar tidak duplikat
      INSERT INTO attendance_log (user_id, tanggal, status, keterangan, created_at)
      VALUES (
        NEW.user_id,
        v_tgl,
        NEW.jenis,   -- 'Izin' / 'Sakit' / 'Cuti'
        COALESCE(NEW.alasan, ''),
        NOW()
      )
      ON CONFLICT (user_id, tanggal) DO UPDATE
        SET status     = EXCLUDED.status,
            keterangan = EXCLUDED.keterangan;
      v_tgl := v_tgl + INTERVAL '1 day';
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_auto_attendance_on_approve
  AFTER UPDATE ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION trg_fn_auto_attendance_on_approve();

-- 6. RLS pada leave_requests
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;

-- User bisa melihat pengajuan SENDIRI
CREATE POLICY "user lihat milik sendiri"
  ON leave_requests FOR SELECT
  USING (user_id = auth.uid());

-- Atasan bisa melihat pengajuan yang ditujukan ke dirinya
CREATE POLICY "atasan lihat yang perlu disetujui"
  ON leave_requests FOR SELECT
  USING (atasan_id = auth.uid());

-- User bisa INSERT pengajuan baru untuk diri sendiri
CREATE POLICY "user bisa ajukan"
  ON leave_requests FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Atasan bisa UPDATE status pengajuan yang ditujukan ke dirinya
-- (dipakai oleh fungsi proses_approval_cuti yang SECURITY DEFINER)
CREATE POLICY "atasan bisa approve"
  ON leave_requests FOR UPDATE
  USING (atasan_id = auth.uid())
  WITH CHECK (atasan_id = auth.uid());

-- Halaman approval-cuti.html menggunakan ANON key + fungsi SECURITY DEFINER
-- sehingga tidak perlu policy UPDATE untuk anon — fungsi yang menghandle.

-- 7. Pastikan kolom jabatan di profiles bisa dibaca semua user auth
--    (untuk fungsi get_atasan_id yang cari jabatan 'FOREMAN')
DO $$
BEGIN
  -- Cek apakah sudah ada policy SELECT di profiles
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'profiles' AND policyname = 'profiles bisa dibaca auth'
  ) THEN
    CREATE POLICY "profiles bisa dibaca auth"
      ON profiles FOR SELECT
      TO authenticated
      USING (true);
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;

-- =====================================================================
-- SELESAI. Langkah selanjutnya:
-- 1. Jalankan SQL ini di Supabase SQL Editor
-- 2. Isi kolom no_wa di tabel profiles untuk setiap user
--    (lewat Supabase Table Editor atau dari halaman profil)
-- 3. Upload approval-cuti.html ke hosting
-- 4. Update input-attendance.html
-- =====================================================================
