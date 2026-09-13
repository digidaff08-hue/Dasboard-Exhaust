// =========================================================
// KONFIGURASI SUPABASE
// Ambil dari: Supabase Dashboard > Project Settings > API
// =========================================================
const SUPABASE_URL = "https://ugrbunhudqhycgjlkwha.supabase.co"; // contoh: https://xxxxx.supabase.co
const SUPABASE_ANON_KEY = "sb_publishable_6TV-ESdlX9EQ5HdrEFPIyg_as3XTP_c";

// Dipakai bersama di semua halaman (login.html, index.html, machines/*.html)
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Helper: pastikan user sudah login, kalau belum redirect ke login.html
async function requireAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = getBasePath() + "login.html";
    return null;
  }
  return session;
}

// Penjaga halaman: hanya admin & leader yang boleh membuka halaman
// selain Attendance. Operator dipantulkan balik ke input-attendance.html.
//
// Ini penjagaan SUNGGUHAN, bukan sekadar menyembunyikan menu -- operator
// yang mengetik alamat halaman langsung di browser tetap dipantulkan.
// Batasan siapa boleh MENGUBAH data tetap dipegang RLS di database.
//
// Dipanggil setelah requireAuth(). Balikannya false = sedang dipantulkan,
// jadi init() halaman harus langsung berhenti.
async function requireStaff(session) {
  if (!session) return false;
  const { data } = await supabaseClient
    .from("profiles").select("role,jabatan").eq("id", session.user.id).maybeSingle();
  const r = ((data && data.role) || "").toLowerCase();
  const j = ((data && data.jabatan) || "").toLowerCase();
  const boleh = ["admin", "leader"].includes(r) || ["admin", "leader"].includes(j);
  if (!boleh) {
    window.location.href = getBasePath() + "input-attendance.html";
    return false;
  }
  return true;
}

// Helper: hitung path relatif ke root project, supaya link login/logout
// tetap benar walau file dipanggil dari dalam folder /machines/
function getBasePath() {
  return window.location.pathname.includes("/machines/") ? "../" : "";
}

async function logout() {
  await supabaseClient.auth.signOut();
  window.location.href = getBasePath() + "login.html";
}

// Daftarkan service worker (biar bisa "Install App" / Add to Home Screen).
// Dibungkus try/catch + cek protokol karena SW butuh https (atau localhost) —
// aman diabaikan kalau lagi dites via file:// di komputer.
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {
      // diam-diam gagal kalau tidak didukung, tidak mengganggu app utama
    });
  });
}