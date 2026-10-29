// =========================================================
// KONFIGURASI SUPABASE
// Ambil dari: Supabase Dashboard > Project Settings > API
// =========================================================
const SUPABASE_URL = "https://ugrbunhudqhycgjlkwha.supabase.co"; // contoh: https://xxxxx.supabase.co
const SUPABASE_ANON_KEY = "sb_publishable_6TV-ESdlX9EQ5HdrEFPIyg_as3XTP_c";

// Dipakai bersama di semua halaman (login.html, index.html, machines/*.html)
// =========================================================
// TANPA SUPABASE (untuk memperbaiki/cek TAMPILAN saja)
//
// Isi MODE_TANPA_SUPABASE (di baris tepat di bawah kotak komentar ini):
//   true   -> TANPA Supabase (semua data kosong)
//   false  -> PAKAI Supabase (normal)
//
// >>> Kalau Supabase sudah aktif lagi: ubah true menjadi false.
//
// Saat true dan halaman dibuka dari komputer sendiri (file lokal,
// localhost, 127.0.0.1, 192.168.x.x), aplikasi TIDAK terhubung ke
// Supabase dan tanpa data sama sekali (assets/tanpa-supabase.js).
// Saat dibuka dari alamat online (mis. *.vercel.app) pengaturan ini
// diabaikan -> tetap terhubung ke Supabase, jadi aman kalau lupa
// diganti sebelum di-upload.
//
// Tanpa mengedit file, bisa dipaksa lewat alamat (disimpan di browser itu):
//   ?supabase=off    -> paksa TANPA Supabase (juga di alamat online)
//   ?supabase=on     -> paksa PAKAI Supabase
//   ?supabase=reset  -> kembali ke aturan otomatis di atas
// =========================================================
const MODE_TANPA_SUPABASE = true;

const TANPA_SUPABASE_AKTIF = (() => {
  try {
    const q = new URLSearchParams(window.location.search).get("supabase");
    if (q === "off") localStorage.setItem("tanpa_supabase_v1", "off");
    else if (q === "on") localStorage.setItem("tanpa_supabase_v1", "on");
    else if (q === "reset") localStorage.removeItem("tanpa_supabase_v1");
    const manual = localStorage.getItem("tanpa_supabase_v1");
    if (manual === "off") return true;
    if (manual === "on") return false;
    const h = window.location.hostname || "";
    const lokal = window.location.protocol === "file:" || h === "localhost" || h === "127.0.0.1" || /^192\.168\./.test(h);
    return MODE_TANPA_SUPABASE && lokal;
  } catch (e) { return false; }
})();

const supabaseClient = TANPA_SUPABASE_AKTIF
  ? (() => {
      // Muat pengganti Supabase secara sinkron (jalan sebelum <script> berikutnya),
      // lalu teruskan semua pemanggilan ke sana.
      const src = (document.currentScript && document.currentScript.src || "").replace(/supabaseClient\.js(\?.*)?$/, "tanpa-supabase.js");
      document.write('<script src="' + src + '"><\/script>');
      return new Proxy({}, {
        get(_, k) {
          const c = window.__tanpaSupabase;
          if (!c) throw new Error("tanpa-supabase.js belum termuat");
          const v = c[k];
          return typeof v === "function" ? v.bind(c) : v;
        },
      });
    })()
  : window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Helper: pastikan user sudah login, kalau belum redirect ke login.html
async function requireAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = getBasePath() + "login.html";
    return null;
  }
  // Akun GUEST hanya boleh membuka Dashboard Exhaust & Dashboard Line. Halaman lain
  // (Input Produksi, Attendance, halaman mesin, dst) langsung dipantulkan
  // ke Dashboard Exhaust -- termasuk kalau alamatnya diketik manual.
  const myRole = await getMyRole(session);
  if (!isDashboardExhaustPage() && !isDashboardLinePage() && !isEmbeddedPerformanceView() && !isDekidakaEmbed() && myRole === "guest") {
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

// Dashboard Line (dibuka admin & guest) dan papan Dekidaka yang dipasang di dalamnya lewat iframe
// (?dekidaka=1 -> dekidaka-line.html / machines/e-0X.html).
function isDashboardLinePage() {
  return window.location.pathname.toLowerCase().includes("dashboard-line");
}
function isDekidakaEmbed() {
  try { return new URLSearchParams(window.location.search).get("dekidaka") === "1"; }
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
  // GUEST: boleh HANYA di Dashboard Exhaust & Dashboard Line (lihat saja), halaman lain
  // dipantulkan ke Dashboard Exhaust.
  if (r === "guest") {
    if (isDashboardExhaustPage() || isDashboardLinePage() || isEmbeddedPerformanceView() || isDekidakaEmbed()) return true;
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