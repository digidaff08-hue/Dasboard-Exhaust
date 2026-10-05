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
  // Akun GUEST hanya boleh membuka Dashboard Exhaust. Halaman lain
  // (Input Produksi, Attendance, halaman mesin, dst) langsung dipantulkan
  // ke Dashboard Exhaust -- termasuk kalau alamatnya diketik manual.
  const myRole = await getMyRole(session);
  if (!isDashboardExhaustPage() && !isEmbeddedPerformanceView() && myRole === "guest") {
    window.location.href = getBasePath() + "dashboard-exhaust.html";
    return null;
  }
  // Akun SUPPORTING (tim yang menerima panggilan Andon) hanya boleh
  // membuka halaman Andon -- halaman lain langsung dipantulkan ke sana,
  // termasuk kalau alamatnya diketik manual.
  if (!isAndonPage() && myRole === "supporting") {
    window.location.href = getBasePath() + "andon.html";
    return null;
  }
  return session;
}

// Role user yang sedang login (huruf kecil), mis. "admin" / "leader" /
// "operator" / "viewer" / "guest". Kosong kalau profil gagal dibaca.
async function getMyRole(session) {
  if (!session) return "";
  try {
    const { data } = await supabaseClient
      .from("profiles").select("role").eq("id", session.user.id).maybeSingle();
    return ((data && data.role) || "").toLowerCase();
  } catch (e) {
    return "";
  }
}

function isDashboardExhaustPage() {
  return window.location.pathname.toLowerCase().includes("dashboard-exhaust");
}

// true kalau halaman mesin ini dibuka lewat ?tab=performance -- itu cara
// Dashboard Exhaust menampilkan tab "Performance" (lihat <iframe> di
// dashboard-exhaust.html & embedMode di assets/machine-page.js). Akun
// GUEST/VIEWER memang BOLEH membuka Dashboard Exhaust, dan tab
// "Performance" di dalamnya secara teknis memuat machines/e-0X.html di
// iframe -- tanpa pengecualian ini, pemantulan "halaman mesin" di bawah
// membuat IFRAME itu sendiri dipantulkan balik ke dashboard-exhaust.html,
// sehingga yang muncul di dalam tab Performance adalah Dashboard Exhaust
// versi mini (nyasar), bukan data Performance/OEE line yang dipilih.
// Ini CUMA guard kenyamanan tampilan -- yang beneran menahan GUEST/VIEWER
// supaya tidak bisa UBAH data tetap RLS di database, bukan ini.
function isEmbeddedPerformanceView() {
  try { return new URLSearchParams(window.location.search).get("tab") === "performance"; }
  catch (e) { return false; }
}

function isAndonPage() {
  return window.location.pathname.toLowerCase().includes("andon");
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
  // GUEST: boleh HANYA di Dashboard Exhaust (lihat saja), halaman lain
  // dipantulkan ke Dashboard Exhaust.
  if (r === "guest") {
    if (isDashboardExhaustPage() || isEmbeddedPerformanceView()) return true;
    window.location.href = getBasePath() + "dashboard-exhaust.html";
    return false;
  }
  // VIEWER: karyawan yang boleh MELIHAT Dashboard Exhaust + Attendance
  // (Attendance memang terbuka untuk semua yang login, tidak lewat sini).
  // Halaman lain dipantulkan ke Attendance.
  if (r === "viewer") {
    if (isDashboardExhaustPage() || isEmbeddedPerformanceView()) return true;
    window.location.href = getBasePath() + "input-attendance.html";
    return false;
  }
  // SUPPORTING: tim yang menerima panggilan Andon -- hanya boleh membuka
  // halaman Andon, halaman lain dipantulkan ke sana.
  if (r === "supporting") {
    if (isAndonPage()) return true;
    window.location.href = getBasePath() + "andon.html";
    return false;
  }
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
