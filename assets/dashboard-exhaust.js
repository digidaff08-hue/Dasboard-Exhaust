// =========================================================
// Dashboard Exhaust -- logika Alpine.js dashboard-exhaust.html
// (dulu inline di <script>; dipindah apa adanya).
// Butuh assets/utils.js (cssVar, localDateStr) dimuat SEBELUM file ini.
// =========================================================

// =========================================================
// SIAPA YANG BOLEH MEMBUKA TAB TERTENTU
//
//   false = HANYA Administrator. Tombol tabnya disembunyikan dari
//           yang lain, dan isinya tidak bisa dibuka walau dipaksa.
//   true  = semua orang yang sudah login boleh membukanya.
//
// Cukup ganti true/false-nya saja, tidak ada yang lain yang perlu
// diubah. Tab yang tidak terdaftar di sini terbuka untuk semua.
//
// CATATAN PENTING: ini mengatur TAMPILAN, bukan kunci data. Orang yang
// sudah login tetap bisa membaca angkanya lewat jalur lain kalau dia
// tahu caranya, karena izin baca data diatur di database, bukan di sini.
// Untuk mengunci betulan, aturan di database yang harus diubah.
// =========================================================
const TAB_UNTUK_SEMUA = {
  performance: false,
  plan_harian: false,
};

// Dua kolom ringkasan "FY '25" & "FY '26" di paling kiri grafik bulanan.
// Dipakai bersama oleh tab Tahunan, Kontrol Downtime, dan Kontrol Kualitas
// supaya bentuk & aturannya sama persis di ketiganya.
const fyTickLabel = (th) => ["FY", "'" + String(th).slice(-2)];
// Rata-rata per bulan; bulan yang belum berjalan (kosong/nol) tidak membagi.
const rataBulanan = (arr) => {
  const v = (arr || []).filter((x) => x !== null && x !== undefined && Number.isFinite(Number(x)) && Number(x) !== 0);
  return v.length ? Math.round(v.reduce((a, b) => a + Number(b), 0) / v.length) : null;
};
const angkaManual = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

const MACHINES = [
  { key: "E-02", label: "E-02", href: "machines/e-02.html" },
  { key: "E-03", label: "E-03", href: "machines/e-03.html" },
  { key: "E-04", label: "E-04", href: "machines/e-04.html" },
  { key: "E-05", label: "E-05", href: "machines/e-05.html" },
  { key: "E-06", label: "E-06", href: "machines/e-06.html" },
  { key: "E-07", label: "E-07", href: "machines/e-07.html" },
];

const BULAN_LABELS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
// Urutan tahun fiskal: April di paling atas, Maret di paling bawah.
// Isinya tetap nomor bulan kalender 1-12 -- cuma URUTAN TAMPILnya yang
// berubah, jadi arti tiap pilihan sama sekali tidak berubah.
const BULAN_FY = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3].map((n) => ({ n, nm: BULAN_LABELS[n - 1] }));
// Daftar tetap Line & Model untuk chart Perline/Model di tab Kontrol Kualitas
const QC_LINES = ["E-02", "E-03", "E-04", "E-05", "E-06", "E-07"];
const QC_MODELS = ["YR9", "YHA", "K15B", "K15C", "D98E", "889F", "D13", "D73F", "D40"];
// Tab Dekidaka (DKD_LINES dkk, dkdBuild*HTML) sudah dihapus dari sini --
// lihat catatan di assets/dashboard-exhaust.css.
// Kelompok tabel realtime -- dipakai supaya begitu ada perubahan, cache yang
// ditandai "basi" (perlu ditarik ulang) cuma yang BENERAN dipengaruhi tabel
// itu, bukan SEMUA cache 3 tab sekaligus (perilaku lama). Ini penting
// terutama buat peta Line-Model tab Kualitas (qcLineModelMap) yang isinya
// tarikan detail 1 TAHUN PENUH data NG Inline/Trial/Repair (ribuan baris) --
// dulu peta berat ini ikut ditarik ulang tiap kali production_log berubah
// (misal autosave Qty/Repair di halaman mesin, yang paling SERING terjadi),
// padahal peta itu sama sekali tidak berisi data production_log. Lihat
// handleRealtimeChange() untuk pemetaan lengkap grup -> cache yang di-reset.
const RT_TABLE_GROUP = {
  production_log: "produksi",
  production_log_new: "produksi",
  downtime_log: "downtime",
  dandori_log: "downtime",
  ng_inline_log: "kualitas",
  repair_log: "kualitas",
  repair_views: "kualitas",
};
// Jumlah hari dalam bulan tertentu (menangani tahun kabisat)
function daysInMonth(year, month1to12) {
  return new Date(year, month1to12, 0).getDate();
}

function fmtNum(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "-";
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: 1 });
}
// Format tanggal 'YYYY-MM-DD' -> 'DD/MM/YYYY' (dipakai kolom "Tanggal
// Cuti" di tabel Cuti tab Kontrol Attendance).
function fmtTglID(s) {
  if (!s) return "-";
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}
// Angka utuh (TIDAK dibagi 1000) tapi dikasih titik pemisah ribuan --
// dipakai buat kolom Value NG Inline/NG Trial di tabel Rekap & NG Terbesar.
function fmtRibuan(n) {
  if (n === null || n === undefined || n === "" || Number.isNaN(Number(n))) return n ?? "";
  return Number(n).toLocaleString("id-ID", { maximumFractionDigits: 0 });
}
// Tahun awal fiskal (April-Maret) yang MEMUAT bulan tertentu.
// Januari-Maret masih ikut FY yang mulai April tahun SEBELUMNYA.
//   fyStartOf(2027, 2) -> 2026   |   fyStartOf(2026, 9) -> 2026
function fyStartOf(year, month1to12) {
  return month1to12 >= 4 ? year : year - 1;
}
// Supabase/PostgREST SECARA DEFAULT cuma balikin maksimal 1000 baris per
// request (biar tidak dipakai literal, batas ini konfigurasinya di sisi
// API project, BUKAN sesuatu yang bisa dilewati cuma dengan .limit() lebih
// besar). RPC detail per-baris yang di-query rentang 1 TAHUN PENUH (mis.
// dashboard_qc_repair_detail_range/dashboard_qc_ng_detail_range dipakai di
// fetchQcLineModelMap) gampang punya lebih dari 1000 baris kalau volume
// datanya besar (repair bisa ribuan baris/bulan) -- akibatnya baris-baris
// bulan belakangan (mis. Jun-Sep) diam-diam KEPOTONG, sehingga chart
// "Straightpass Month" per-Line cuma keisi 1-2 bulan pertama walau data
// aslinya (tabel Rekap Repair, yang query-nya cuma 1 bulan sekali jalan)
// lengkap. Helper ini menambal itu dengan menarik SEMUA baris lewat
// paginasi .range() berulang sampai halaman yang balik lebih pendek dari
// ukuran halaman (tandanya sudah baris terakhir).
async function fetchAllRpcRows(rpcName, params, pageSize = 1000) {
  let allRows = [];
  let from = 0;
  let lastError = null;
  while (true) {
    const { data, error } = await supabaseClient.rpc(rpcName, params).range(from, from + pageSize - 1);
    if (error) { lastError = error; break; }
    const rows = data || [];
    allRows = allRows.concat(rows);
    if (rows.length < pageSize) break; // halaman terakhir
    from += pageSize;
  }
  return { data: allRows, error: lastError };
}
// Warna batang chart Kapasitas Harian -- disamakan persis dengan
// halaman plan produksi (sudah dihapus) supaya part yang sama berwarna sama.
const PLAN_LINE_COLORS = ["#5b8def", "#f2a541", "#e05a5a", "#31b06a", "#8f6bd6", "#2fb8c6"];

// ---------- Garis acuan CAPACITY di grafik Plan Harian ----------
// Tiga garis: kapasitas standar, standar + OT 3 jam, dan standar + OT 2 jam
// + Shift 1. Angka di bawah cuma CADANGAN -- yang dipakai sehari-hari
// diambil dari tabel production_capa_line (bisa diubah lewat tombol
// "⚙️ Capacity" di tab Plan Harian). Cadangan ini terpakai hanya kalau
// tabelnya belum dibuat (migration_capa_line.sql belum dijalankan) atau
// isinya masih kosong, supaya grafiknya tidak pernah tampil tanpa garis.
const CAPA_DEFAULT = {
  "E-02": { capa_standar: 360, capa_ot3: 420, capa_ot2_shift1: 460 },
  "E-03": { capa_standar: 480, capa_ot3: 550, capa_ot2_shift1: 600 },
  "E-04": { capa_standar: 480, capa_ot3: 576, capa_ot2_shift1: 640 },
  "E-05": { capa_standar: 480, capa_ot3: 550, capa_ot2_shift1: 600 },
  "E-06": { capa_standar: 412, capa_ot3: 480, capa_ot2_shift1: 534 },
  "E-07": { capa_standar: 520, capa_ot3: 625, capa_ot2_shift1: 695 },
};
// Urutan & tampilan ketiga garis (dipakai grafik DAN form isiannya).
const CAPA_JENIS = [
  { kunci: "capa_standar",    nama: "Capa Standar",                   warna: "#16a34a" },
  { kunci: "capa_ot3",        nama: "Capa Standar + OT 3 Jam",        warna: "#2563eb" },
  { kunci: "capa_ot2_shift1", nama: "Capa Standar + OT 2 Jam + Shift 1", warna: "#dc2626" },
];

// ---------- Sub "Kapasitas Line" (sheet Plan Produksi) ----------
// Kolomnya: kapasitas normal/hari, man power, kapasitas hari Jum'at,
// kapasitas per jam. Disimpan di tabel yang sama (production_capa_line),
// kolom terpisah -- lihat migration_capa_line_v2.sql.
const LINE_JENIS = [
  { kunci: "kapasitas",         nama: "Kapasitas",         satuan: "pcs/hari" },
  { kunci: "man_power",         nama: "Man Power",         satuan: "orang" },
  { kunci: "kapasitas_jumat",   nama: "Kapasitas Hari Jum'at", satuan: "pcs" },
  { kunci: "kapasitas_per_jam", nama: "Kapasitas Per Jam", satuan: "pcs/jam" },
];
const LINE_DEFAULT = {
  "E-02": { kapasitas: 240, man_power: 3, kapasitas_jumat: 270, kapasitas_per_jam: 25 },
  "E-03": { kapasitas: 600, man_power: 4, kapasitas_jumat: 568, kapasitas_per_jam: 32 },
  "E-04": { kapasitas: 640, man_power: 4, kapasitas_jumat: 608, kapasitas_per_jam: 32 },
  "E-05": { kapasitas: 600, man_power: 4, kapasitas_jumat: 568, kapasitas_per_jam: 32 },
  "E-06": { kapasitas: 534, man_power: 4, kapasitas_jumat: 502, kapasitas_per_jam: 32 },
  "E-07": { kapasitas: 260, man_power: 5, kapasitas_jumat: 225, kapasitas_per_jam: 35 },
};

// ---------- Sub "Master Part" (sheet Plan Produksi) ----------
// watari = line lain yang boleh dipakai part ini. 'NO' = tidak ada.
// Nanti dipakai buat menghitung plan harian & pembagian shift.
const MASTER_PART_DEFAULT = [
  { part_number: "14110-52P00",   default_line: "E-02", cycle_time: 105,   watari: "NO" },
  { part_number: "14110-73R10",   default_line: "E-02", cycle_time: 119,   watari: "NO" },
  { part_number: "14110-73R20",   default_line: "E-02", cycle_time: 119,   watari: "NO" },
  { part_number: "14110-74U00",   default_line: "E-02", cycle_time: 113,   watari: "NO" },
  { part_number: "25051-BZ060",   default_line: "E-03", cycle_time: 102.9, watari: "NO" },
  { part_number: "25051-BZ260",   default_line: "E-05", cycle_time: 102.9, watari: "E-03" },
  { part_number: "25051-0Y050",   default_line: "E-05", cycle_time: 102.9, watari: "NO" },
  { part_number: "25051-0Y060",   default_line: "E-05", cycle_time: 102.9, watari: "NO" },
  { part_number: "25051-BZ140",   default_line: "E-06", cycle_time: 102.9, watari: "E-03,E-04,E-05,E-06" },
  { part_number: "25051-BZ140-T", default_line: "E-03", cycle_time: 102.9, watari: "E-03,E-04,E-06" },
  { part_number: "25051-BZ150-T", default_line: "E-04", cycle_time: 102.9, watari: "E-05" },
  { part_number: "25051-BZ110",   default_line: "E-06", cycle_time: 105,   watari: "NO" },
  { part_number: "25051-BZ010",   default_line: "E-06", cycle_time: 105,   watari: "NO" },
  { part_number: "25051-BZ180",   default_line: "E-06", cycle_time: 105,   watari: "NO" },
  { part_number: "14110-74U50",   default_line: "E-07", cycle_time: 92,    watari: "NO" },
];


// Default hover/tooltip GLOBAL untuk semua chart Chart.js di dashboard ini.
// Tooltip HARUS muncul cuma kalau kursor tepat di atas batang atau tepat di
// garis/titik (intersect: true) -- ini perilaku standar/umum, bukan "muncul
// begitu kursor ada di kolom yang sama". Supaya titik garis yang radius
// visualnya kecil (1-3px) tetap gampang "kena" walau kursor tidak persis
// 100% di pixel titiknya, area sentuh (hitRadius) diperbesar -- ini TIDAK
// mengubah tampilan visual titik (radius gambar tetap sama persis seperti
// yang sudah di-set tiap chart), cuma memperbesar area tak-kasat-mata yang
// dianggap "menyentuh" titik itu.
if (typeof Chart !== "undefined") {
  Chart.defaults.interaction = { mode: "nearest", intersect: true };
  Chart.defaults.elements.point.hitRadius = 8;
}

function dashboardExhaust() {
  return {
    session: null, profile: null, mobileNavOpen: false, sidebarCollapsed: AppPref.sidebarAwal(true),
    loading: true,
    activeTab: "bulanan", // bulanan | tahunan | kualitas | attendance
    theme: localStorage.getItem("theme_v1") || "light",
    fmtNum,
        isAdmin() { return this.profile?.role === "admin"; },
    // Tab yang dibatasi lewat TAB_UNTUK_SEMUA (lihat atas file).
    // Tab yang tidak terdaftar di sana selalu boleh dibuka.
    bolehLihatTab(tab) {
      if (TAB_UNTUK_SEMUA[tab] !== false) return true;
      return this.isAdmin();
    },
    // Akun tamu: hanya lihat Dashboard Exhaust, semua menu lain disembunyikan.
    isGuest() { return (this.profile?.role || "").toLowerCase() === "guest"; },
    // Viewer: karyawan yang cuma boleh buka Dashboard Exhaust + Attendance.
    isViewer() { return (this.profile?.role || "").toLowerCase() === "viewer"; },

    isLeaderOrAdmin() { if (!this.profile) return false; const r = (this.profile.role||"").toLowerCase(); const j = (this.profile.jabatan||"").toLowerCase(); return ["admin","leader"].includes(r) || ["admin","leader"].includes(j); },
    destroyBulananCharts() {
      Object.keys(this.bulananCharts).forEach((id) => {
        try { this.bulananCharts[id].destroy(); } catch (e) { /* noop */ }
        delete this.bulananCharts[id];
      });
    },
    destroyTahunanCharts() {
      Object.keys(this.tahunanCharts).forEach((id) => {
        try { this.tahunanCharts[id].destroy(); } catch (e) { /* noop */ }
        delete this.tahunanCharts[id];
      });
    },
    destroyKualitasCharts() {
      Object.keys(this.qcCharts).forEach((id) => {
        try { this.qcCharts[id].destroy(); } catch (e) { /* noop */ }
        delete this.qcCharts[id];
      });
    },
    destroyAttendanceCharts() {
      Object.keys(this.attendanceCharts).forEach((id) => {
        try { this.attendanceCharts[id].destroy(); } catch (e) { /* noop */ }
        delete this.attendanceCharts[id];
      });
    },
    // Tab Dekidaka (method2 dekidaka*) sudah dihapus dari sini -- lihat
    // catatan di assets/dashboard-exhaust.css.
    async setTab(tab) {
      // Tab khusus Administrator: tolak di sini juga, bukan cuma
      // disembunyikan tombolnya.
      if (!this.bolehLihatTab(tab)) return;
      if (this.activeTab === "bulanan" && tab !== "bulanan") this.destroyBulananCharts();
      if (this.activeTab === "tahunan" && tab !== "tahunan") this.destroyTahunanCharts();
      if (this.activeTab === "kualitas" && tab !== "kualitas") this.destroyKualitasCharts();
      if (this.activeTab === "attendance" && tab !== "attendance") this.destroyAttendanceCharts();
      this.activeTab = tab;
      if (tab === "performance") { this.perfDilihat[this.perfLine] = true; this.$nextTick(() => this.perfComputeIframeHeight()); return; }
      if (tab === "plan_harian") { await this.fetchPlanHarian(); return; }
      // Tab langsung digambar pakai data yang sudah ada di memori (hasil
      // prefetch di init() / kunjungan sebelumnya), baru kemudian fetch
      // -- jadi tidak ada layar "Memuat data" saat pindah tab.
      if (tab === "bulanan") {
        this.$nextTick(() => this.renderBulananCharts());
        const wasLoaded = this.bulananLoaded;
        await this.fetchBulanan({ silent: true });
        if (!wasLoaded && this.activeTab === "bulanan") this.$nextTick(() => this.renderBulananCharts());
      }
      if (tab === "tahunan") {
        this.$nextTick(() => this.renderTahunanCharts());
        const wasLoaded = this.tahunanLoaded;
        await this.fetchTahunan({ silent: true });
        if (!wasLoaded && this.activeTab === "tahunan") this.$nextTick(() => this.renderTahunanCharts());
      }
      if (tab === "kualitas") {
        await this.loadKualitas({ instant: true });
      }
      if (tab === "attendance") {
        await Promise.all([this.fetchAttendance(), this.fetchAttendanceDayCard(), this.fetchAttendanceLeave()]);
        this.$nextTick(() => this.renderAttendanceCharts());
        // Balik ke tab Attendance sementara toggle-nya masih di Tahunan
        // (mis. pindah tab lalu balik lagi) -- render ulang chart Rekap
        // Tahunan juga, fetch dulu kalau datanya belum ada.
        if (this.attendanceViewMode === "tahunan") {
          await this.fetchAttendanceTahunan();
          this.$nextTick(() => this.renderAttendanceTahunanChart());
        }
      }
    },
    async onTahunanYearChange() {
      // Seperti tab Kontrol Downtime: chart lama TETAP tampil selama data
      // tahun baru diambil (fetch silent, tanpa skeleton), lalu diganti
      // SEKALI begitu data siap -- tidak ada kedip / "Memuat data".
      this.tahunanLoaded = false;
      await this.fetchTahunan({ silent: true });
      this.qcColFilters = { ...this.qcColFilters, tahunanDowntime: {}, tahunanNg: {}, tahunanRepair: {} };
      this.$nextTick(() => this.renderTahunanCharts());
    },
    toggleTheme() {
      this.theme = this.theme === "dark" ? "light" : "dark";
      localStorage.setItem("theme_v1", this.theme);
      document.documentElement.setAttribute("data-theme", this.theme);
      if (this.activeTab === "bulanan") this.$nextTick(() => this.renderBulananCharts());
      if (this.activeTab === "tahunan") this.$nextTick(() => this.renderTahunanCharts());
      if (this.activeTab === "attendance") {
        this.$nextTick(() => {
          this.renderAttendanceCharts();
          if (this.attendanceViewMode === "tahunan") this.renderAttendanceTahunanChart();
        });
      }
    },
    // ---------------------------------------------------------------
    // DATA DUMMY "Bulanan" -- sementara statis, tinggal diganti hasil
    // query Supabase (RPC / view rollup bulanan) begitu tabelnya siap.
    // ---------------------------------------------------------------
    // ---------------------------------------------------------------
    // Data "Bulanan" -- diisi dari fetchBulanan() (RPC Supabase, lihat
    // migration_dashboard_bulanan.sql). Skeleton kosong dulu supaya
    // template tidak error sebelum data datang.
    // ---------------------------------------------------------------
    bulananLoading: false, // skeleton "Memuat data" dinonaktifkan -- konten langsung tampil
    bulananLoaded: false,
    // Line (dxyLineFilterBulanan) yang dipakai waktu fetchBulanan()
    // terakhir sukses -- disimpan supaya bulananLoaded=true tidak cukup
    // jadi penanda "data masih relevan" kalau user ganti Line di dropdown
    // Bulanan (lihat fetchBulanan()). dxyLineFilterBulanan TERPISAH dari
    // dxyLineFilter (punya tab Tahunan) -- ganti Line di 1 tab TIDAK
    // mempengaruhi Line di tab satunya.
    _bulananLoadedLine: null,
    // Periode yang lagi dipilih di tab Bulanan (bulan + tahun berjalan default)
    bulananMonth: new Date().getMonth() + 1,
    bulananYear: new Date().getFullYear(),
    // Periode yang lagi dipilih di tab Kontrol Attendance.
    attendanceMonth: new Date().getMonth() + 1,
    attendanceYear: new Date().getFullYear(),
    // Toggle tampilan di tab Kontrol Attendance: 'bulanan' (default, semua
    // yang sudah ada) atau 'tahunan' (Grafik Rekap Tahunan, lihat
    // fetchAttendanceTahunan()).
    attendanceViewMode: "bulanan",
    // Data grafik "Rekap Tahunan" (tab Kontrol Attendance -> Tahunan).
    // fyStartYear = attendanceYear (dropdown "Tahun" yang sama dipakai
    // Bulanan & Tahunan) -- FY = April attendanceYear s/d Maret
    // attendanceYear+1. Diisi oleh fetchAttendanceTahunan().
    attendanceTahunanLoading: false,
    attendanceTahunanLoaded: false,
    _attendanceTahunanLoadedYear: null,
    attendanceTahunan: {
      labels: [],   // "Apr", "Mei", ... "Mar" (12 bulan FY)
      totalMp: [],  // Total MP per bulan (angka yg diinput user di awal bulan)
      avgHadir: [], // rata-rata Hadir per hari, 1 bulan penuh
      avgRasio: [], // rata-rata % Kehadiran per hari, 1 bulan penuh
    },
    // Tanggal yang lagi dipilih untuk daftar Izin/Sakit/Cuti/Mangkir (4
    // kolom di bawah). Default = HARI INI (format YYYY-MM-DD, dipakai
    // langsung oleh <input type="date">).
    // localDateStr (bukan toISOString) -- toISOString pakai UTC, jadi jam
    // 00:00-06:59 WIB tanggalnya mundur ke hari kemarin.
    attendanceDate: localDateStr(new Date()),
    attendance: {
      rate: 0, total: 0, hadir: 0, cuti: 0, absen: 0, ot: 0, shift1: 0, shift2: 0,
      // Trend kehadiran harian (tanggal 1-31), diisi oleh fetchAttendance().
      // hadir = dari attendance_log. izin/sakit/cuti/mangkir = jumlah ORANG
      // per hari dari attendance_leave (cuti dihitung "nyala" tiap hari di
      // antara tanggal mulai-selesai). Dipakai di chart batang bertumpuk
      // "Trend Kehadiran Harian" -- tiap array warnanya beda.
      dailyTrend: {
        total: Array.from({ length: 31 }, () => null),
        hadir: Array.from({ length: 31 }, () => null),
        izin: Array.from({ length: 31 }, () => null),
        sakit: Array.from({ length: 31 }, () => null),
        cuti: Array.from({ length: 31 }, () => null),
        mangkir: Array.from({ length: 31 }, () => null),
        persen: Array.from({ length: 31 }, () => null),
      },
      // 4 daftar terpisah -- Izin / Sakit / Cuti / Mangkir. Diisi oleh
      // fetchAttendanceLeave() dari tabel attendance_leave (lihat
      // migration_attendance_leave.sql), difilter per this.attendanceDate.
      // Bentuk tiap baris:
      // izin/sakit:  { nik, nama, tanggal, alasan }
      // cuti:        { nik, nama, tanggal, tanggalSelesai, jumlahHari, jenisCuti, keterangan }
      // mangkir:     { nik, nama, tanggal, keterangan }
      izinList: [],
      sakitList: [],
      cutiList: [],
      mangkirList: [],
    },
    qcMonth: new Date().getMonth() + 1,
    qcYear: new Date().getFullYear(),
    // Filter Line (picker) KHUSUS tab Kontrol Kualitas -- "ALL" = tampilkan
    // semua line (perilaku lama, tidak berubah). Kalau diganti ke salah
    // satu line: chart *Perline (NG Inline/NG Trial/Straightpass) tetap
    // menampilkan SEMUA line, cuma line yang dipilih di-highlight (line
    // lain dipudarkan) -- datanya TIDAK difilter/dihilangkan. Sedangkan
    // chart *Model (NG Inline/NG Trial/Straightpass) beneran DISARING:
    // cuma model yang ada di line itu yang ditampilkan. Lihat
    // fetchQcLineModelMap() & renderKualitasCharts() untuk detail
    // mekanismenya, termasuk catatan keterbatasan data Straightpass Model.
    qcLineFilter: AppPref.lineFavorit() || "ALL",
    // Filter tanggal untuk tabel "Downtime Terbesar per Line" -- tabel ini
    // SELALU per-tanggal (default hari ini, bisa diganti lewat date picker).
    // Sama seperti qcNgInlineDetailDate dkk -- sengaja diisi tanggal 1
    // bulan berjalan, BUKAN hari-ini-persis, supaya nilainya tidak sudah
    // "sama dengan hari ini" saat kalender dibuka (kalau sudah sama,
    // <input type="date"> tidak akan fire event sama sekali waktu user
    // klik tanggal hari ini, karena buat browser itu bukan "perubahan").
    bulananDate: localDateStr(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
    // Mode tabel "Downtime Line": FALSE (default) = tampil SEBULAN PENUH,
    // TRUE = tampil 1 tanggal spesifik (bulananDate) -- persis pola
    // qcNgInlineUseDate di tab Kontrol Kualitas.
    bulananDowntimeUseDate: false,
    bulananDtLoading: false,
    // ---------------------------------------------------------------
    // Tab "Kontrol Kualitas" -- kolom NG Inline sudah disambungkan ke
    // RPC asli (dashboard_qc_ng_*, lihat migration_dashboard_kualitas.sql).
    // Kolom NG Trial & Straightpass masih placeholder kosong.
    // ---------------------------------------------------------------
    // Default: field tanggal diisi DIAM-DIAM dengan tanggal 1 di bulan yang
    // lagi dipilih -- ini SEMATA-MATA supaya saat kalender bawaan browser
    // dibuka, dia terbuka pas di bulan yang benar (Juli misalnya), bukan
    // di bulan hari-ini-beneran (browser defaultnya begitu kalau field
    // kosong total). Tampilan tetap terlihat kosong di layar (lihat CSS
    // .qc-rekap-mode .dxy-input { color: transparent } saat belum dipakai).
    // Status mode "sebulan" vs "1 tanggal" TIDAK ditentukan dari isi/kosong
    // field ini lagi, tapi dari flag qcNgInlineUseDate: true hanya kalau
    // user BENERAN klik/pilih tanggal (event @change).
    // PENTING: field ini sengaja TIDAK dibiarkan string kosong ("") --
    // kalau kosong total, <input type="date"> bawaan Chrome punya bug:
    // klik PERTAMA ke tanggal hari-ini-beneran di kalender tidak dianggap
    // "berubah" (karena hari ini sudah otomatis ke-highlight duluan oleh
    // browser saat field kosong), jadi user harus pilih tanggal lain dulu
    // baru tanggal hari ini bisa kepilih. Diisi tanggal 1 bulan berjalan
    // supaya selalu ada nilai konkret -- tampilan tetap tersembunyi via
    // CSS di atas, jadi tidak kelihatan bedanya di layar.
    qcNgInlineDetailDate: localDateStr(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
    qcNgInlineUseDate: false,
    qcNgTrialDetailDate: localDateStr(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
    qcNgTrialUseDate: false,
    qcStraightpassDetailDate: localDateStr(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
    qcNgInlineLoaded: false,
    qcNgInline: {
      monthLabels: [], qtyByMonth: [], valueByMonth: [],
      perlineQty: [], perlineValue: [],
      permodelQty: [], permodelValue: [],
      dailyQty: [], dailyValue: [],
      detailRows: [],
    },
    qcNgTrialLoaded: false,
    qcNgTrial: {
      monthLabels: [], qtyByMonth: [], valueByMonth: [],
      perlineQty: [], perlineValue: [],
      permodelQty: [], permodelValue: [],
      dailyQty: [], dailyValue: [],
      detailRows: [],
    },
    // Repair -- cuma butuh 1 tabel (Rekap Repair), tidak ada
    // grafik Month/Perline/Model/Daily seperti NG Inline/Trial.
    qcRepairDetailDate: localDateStr(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
    qcRepairUseDate: false,
    qcRepair: { detailRows: [], perlineQty: [], permodelQty: [] },
    // Cache biar setTab('kualitas') tidak fetch ulang ke Supabase tiap kali
    // tab dibuka/dipindah balik (dulu 3 fungsi ini fetch ulang terus,
    // makanya sempat kosong beberapa detik tiap buka tab -- lihat pola
    // qcNgInlineLoaded/qcNgTrialLoaded di atas, sama persis).
    qcRepairDetailLoaded: false,
    qcRepairPerlineModelLoaded: false,
    // ---- Filter per-kolom untuk tabel Rekap NG Inline / NG Trial / Repair ----
    // qcFilterOpen: null kalau tidak ada dropdown yang terbuka, atau string
    // "namaTabel:namaKolom" (mis. "ngInline:partNo") kalau sedang terbuka --
    // cuma 1 dropdown yang bisa terbuka dalam satu waktu (gaya Excel).
    qcFilterOpen: null,
    qcFilterSearch: "",
    qcFilterPos: { top: 0, left: 0 },
    // qcColFilters[namaTabel][namaKolom] = array nilai yang DIPILIH untuk
    // ditampilkan. Kalau key kolom tidak ada di object ini, artinya belum
    // ada filter aktif (tampilkan semua nilai) -- ini beda dengan array
    // kosong [] yang artinya user sengaja "Kosongkan" semua pilihan.
    qcColFilters: { ngInline: {}, ngTrial: {}, repair: {}, bulananDowntime: {}, bulananTopProblem: {}, tahunanDowntime: {}, tahunanNg: {}, tahunanRepair: {} },
    // State modal detail "Downtime Terbesar" per Line (double-klik row di
    // tabel bulananTopProblem, tab Bulanan). Lihat openProblemDetail().
    dxyProblemDetail: { open: false, loading: false, problem: "", rows: [] },
    dxyProblemDetailPos: { top: 0, left: 0 },
    // Definisi kolom tabel Rekap (dipakai buat render header+body via
    // x-for, dan juga buat tahu kolom apa saja yang bisa difilter).
    // dateOnly:true khusus kolom Tanggal -- kolom ini cuma tampil kalau
    // mode "1 tanggal" (bukan tampilan sebulan), sama seperti sebelumnya.
    qcNgInlineCols() {
      return [
        { key: "tanggal", label: "Tanggal", width: "52px", dateOnly: true },
        { key: "model", label: "Model", width: "48px" },
        { key: "line", label: "Line", width: "36px" },
        { key: "partNo", label: "Part No", width: "13%" },
        { key: "area", label: "Area", width: "13%" },
        { key: "ngProses", label: "NG Proses", width: "17%" },
        { key: "qty", label: "Qty", width: "36px" },
        { key: "ngKategori", label: "NG Kategori", width: "18%" },
        { key: "value", label: "Value", width: "15%" },
      ];
    },
    qcNgTrialCols() {
      // Struktur kolom sama persis dengan NG Inline.
      return this.qcNgInlineCols();
    },
    qcRepairCols() {
      return [
        { key: "tanggal", label: "Tanggal", width: "52px", dateOnly: true },
        { key: "model", label: "Model", width: "48px" },
        { key: "line", label: "Line", width: "36px" },
        { key: "partNo", label: "Part No", width: "16%" },
        { key: "qty", label: "Qty", width: "36px" },
        { key: "area", label: "Area", width: "16%" },
        { key: "point", label: "Point", width: "12%" },
        { key: "repairKategori", label: "Repair Kategori", width: "22%" },
      ];
    },
    // Data mentah (belum dipad ke minimal 8 baris) per tabel -- dipakai
    // sebagai sumber daftar nilai unik untuk dropdown filter & buat
    // difilter sebelum ditampilkan.
    qcRawRowsFor(table) {
      if (table === "ngInline") return this.qcNgInline.detailRows || [];
      if (table === "ngTrial") return this.qcNgTrial.detailRows || [];
      if (table === "repair") return this.qcRepair.detailRows || [];
      if (table === "bulananDowntime") return this.dxyDowntimeFlatBulanan();
      if (table === "bulananTopProblem") return this.bulanan.downtimeTerbesarBulan || [];
      if (table === "tahunanDowntime") return this.dxyDowntimeFlatTahunan();
      if (table === "tahunanNg") return this.dxyNgFlatTahunan();
      if (table === "tahunanRepair") return this.dxyRepairFlatTahunan();
      return [];
    },
    qcColsFor(table) {
      if (table === "ngInline") return this.qcNgInlineCols();
      if (table === "ngTrial") return this.qcNgTrialCols();
      if (table === "repair") return this.qcRepairCols();
      if (table === "bulananDowntime") {
        return [
          { key: "mesin", label: "Line" },
          { key: "pic", label: "PIC" },
          { key: "problem", label: "Problem" },
          { key: "area", label: "Area" },
          { key: "countermeasure", label: "Countermeasure" },
          { key: "status", label: "Status" },
          { key: "shift", label: "Shift" },
          { key: "menit", label: "Menit" },
        ];
      }
      if (table === "bulananTopProblem") {
        return [
          { key: "problem", label: "Problem" },
          { key: "menit", label: "Menit" },
          { key: "frekuensi", label: "Frekuensi" },
        ];
      }
      if (table === "tahunanDowntime") {
        return [
          { key: "mesin", label: "Line" },
          { key: "pic", label: "PIC" },
          { key: "problem", label: "Problem" },
          { key: "value", label: "Menit" },
        ];
      }
      if (table === "tahunanNg") {
        return [
          { key: "kategori", label: "NG Kategori" },
          { key: "qty", label: "Qty" },
          { key: "value", label: "Value" },
        ];
      }
      if (table === "tahunanRepair") {
        return [
          { key: "kategori", label: "Repair Kategori" },
          { key: "qty", label: "Qty" },
        ];
      }
      return [];
    },
    // Terapkan semua filter kolom yang aktif punya tabel tsb ke array baris.
    qcApplyColFilters(table, rows) {
      const filters = this.qcColFilters[table] || {};
      const activeCols = Object.keys(filters);
      if (activeCols.length === 0) return rows;
      return rows.filter((row) => activeCols.every((col) => (filters[col] || []).includes(String(row[col] ?? ""))));
    },
    // Buka/tutup dropdown filter untuk kolom tertentu. Posisi dropdown
    // dihitung dari posisi header (<th>) yang diklik supaya dropdown
    // muncul persis di bawahnya, walau tabelnya ada di dalam box yang
    // discroll (dropdown sendiri di-teleport ke <body> jadi tidak
    // kepotong overflow:hidden/auto box tabel).
    qcToggleFilterDropdown(table, col, evt) {
      const key = table + ":" + col;
      if (this.qcFilterOpen === key) {
        this.qcFilterOpen = null;
        return;
      }
      this.qcFilterSearch = "";
      this.qcFilterOpen = key;
      const th = evt.currentTarget || (evt.target && evt.target.closest("th"));
      this.$nextTick(() => {
        if (!th) return;
        const rect = th.getBoundingClientRect();
        const box = this.$refs.qcFilterBox;
        const boxHeight = box ? box.offsetHeight : 260;
        const boxWidth = box ? box.offsetWidth : 200;
        // Selalu muncul di ATAS header. Kalau ruang di atas nggak cukup
        // (header-nya deket banget ke ujung atas layar), baru turun
        // sedikit supaya tetap kelihatan penuh, bukan kepotong.
        let top = rect.top - boxHeight - 6;
        if (top < 8) top = 8;
        let left = rect.left;
        if (left + boxWidth > window.innerWidth - 8) left = window.innerWidth - boxWidth - 8;
        if (left < 8) left = 8;
        this.qcFilterPos = { top, left };
      });
    },
    qcColFilterActive(table, col) {
      return Object.prototype.hasOwnProperty.call(this.qcColFilters[table] || {}, col);
    },
    // Label kolom yang dropdown-nya lagi kebuka -- ditampilkan sebagai
    // judul kecil di dalam dropdown (mis. "Filter: Part No") supaya tetap
    // jelas ini filter kolom apa, walau header sendiri tidak dikasih ikon.
    qcFilterColLabel() {
      if (!this.qcFilterOpen) return "";
      const [table, col] = this.qcFilterOpen.split(":");
      const colDef = this.qcColsFor(table).find((c) => c.key === col);
      return colDef ? colDef.label : col;
    },
    // Ringkasan kolom-kolom yang lagi difilter untuk 1 tabel -- dipakai
    // buat badge kecil "N filter" di sebelah judul panel Rekap.
    qcActiveFilterChips(table) {
      const filters = this.qcColFilters[table] || {};
      const cols = this.qcColsFor(table);
      return Object.keys(filters).map((key) => {
        const colDef = cols.find((c) => c.key === key);
        return { key, label: colDef ? colDef.label : key };
      });
    },
    qcResetFilters(table) {
      this.qcColFilters = { ...this.qcColFilters, [table]: {} };
    },
    // Daftar nilai unik (mentah, belum difilter kolom lain) untuk kolom
    // yang dropdown-nya sedang terbuka, disaring lagi oleh kotak pencarian.
    qcFilterValues() {
      if (!this.qcFilterOpen) return [];
      const [table, col] = this.qcFilterOpen.split(":");
      const rows = this.qcRawRowsFor(table);
      const set = new Set();
      rows.forEach((row) => set.add(String(row[col] ?? "")));
      let values = Array.from(set).sort((a, b) => a.localeCompare(b, "id", { numeric: true }));
      const q = (this.qcFilterSearch || "").trim().toLowerCase();
      if (q) values = values.filter((v) => v.toLowerCase().includes(q));
      return values;
    },
    qcIsValueChecked(val) {
      if (!this.qcFilterOpen) return false;
      const [table, col] = this.qcFilterOpen.split(":");
      const filters = this.qcColFilters[table] || {};
      if (!Object.prototype.hasOwnProperty.call(filters, col)) return true; // belum difilter = semua tercentang
      return (filters[col] || []).includes(val);
    },
    qcToggleFilterValue(val) {
      if (!this.qcFilterOpen) return;
      const [table, col] = this.qcFilterOpen.split(":");
      const rows = this.qcRawRowsFor(table);
      const allValues = Array.from(new Set(rows.map((row) => String(row[col] ?? ""))));
      const filters = this.qcColFilters[table];
      let current = Object.prototype.hasOwnProperty.call(filters, col) ? filters[col].slice() : allValues.slice();
      if (current.includes(val)) current = current.filter((v) => v !== val);
      else current.push(val);
      if (current.length === allValues.length) delete filters[col]; // kembali ke "semua" -> hapus filter
      else filters[col] = current;
      this.qcColFilters = { ...this.qcColFilters, [table]: { ...filters } };
    },
    qcSelectAllFilter() {
      if (!this.qcFilterOpen) return;
      const [table, col] = this.qcFilterOpen.split(":");
      const filters = { ...this.qcColFilters[table] };
      delete filters[col];
      this.qcColFilters = { ...this.qcColFilters, [table]: filters };
    },
    qcClearAllFilter() {
      if (!this.qcFilterOpen) return;
      const [table, col] = this.qcFilterOpen.split(":");
      this.qcColFilters = { ...this.qcColFilters, [table]: { ...this.qcColFilters[table], [col]: [] } };
    },
    // Straightpass Perline/Model -- data stroke & NG per line/model dari
    // RPC baru dashboard_qc_produksi_perline/permodel, dihitung jadi
    // persentase (stroke-ng)/stroke*100, formula sama persis dengan
    // kartu Straightpass utama (lihat fetchTahunan()).
    qcStraightpassLoaded: false,
    qcStraightpass: { perlineActual: [], permodelActual: [], dailyRepairQty: [], dailyPercent: [] },
    // Deret Straightpass 12 bulan untuk tahun fiskal TAB KUALITAS sendiri.
    // Dulu chart ini memakai this.tahunan (milik tab Tahunan), sehingga
    // ganti tahun di tab Tahunan ikut mengubah chart di sini. Sekarang tab
    // Kualitas punya datanya sendiri, jadi dua tab benar-benar terpisah.
    qcFyLoadedKey: "",
    qcFy: { monthLabels: [], actual: [], repairQty: [], target: 95 },
    // Peta Line -> Model (qty/value per kombinasi line+model, SELALU untuk
    // 1 bulan penuh yang lagi dipilih qcMonth/qcYear -- TIDAK ikut toggle
    // tanggal/sebulan punya panel Rekap manapun). Dipakai khusus buat fitur
    // picker Line di chart *Model (lihat qcLineFilter). Struktur:
    // { ngInline: { "E-02": { "YR9": {qty,value}, ... }, ... }, ngTrial: {...}, repair: {...} }
    qcLineModelMap: { ngInline: {}, ngTrial: {}, repair: {} },
    // Peta Line -> tren 12 bulan (qty/value per bulan FY Apr..Mar, per
    // line) -- dipakai chart "Month" (paling atas tiap kolom) supaya ikut
    // berubah kalau Line picker diganti. Struktur:
    // { ngInline: { "E-02": { qtyByMonth: [12], valueByMonth: [12] }, ... }, ngTrial: {...}, repair: {...} }
    qcLineMonthMap: { ngInline: {}, ngTrial: {}, repair: {} },
    // Peta Line -> harian (qty/value per tanggal 1-31 bulan yang lagi
    // dipilih, per line) -- dipakai chart "*Daily" (NG Inline/NG Trial/
    // Straightpass) supaya ikut berubah kalau Line picker diganti. Sama
    // seperti qcLineModelMap, cuma "repair" yang punya keterbatasan (lihat
    // catatan di fetchQcLineModelMap()). Struktur:
    // { ngInline: { "E-02": { qtyByDay: [31], valueByDay: [31] }, ... }, ngTrial: {...}, repair: {...} }
    qcLineDayMap: { ngInline: {}, ngTrial: {}, repair: {} },
    qcLineModelMapLoaded: false,
    // Nama bulan singkat (tanpa tahun) -- dipakai sebagai overlay teks di
    // field tanggal panel Rekap selama mode "sebulan" masih aktif, biar
    // fieldnya nggak keliatan kosong melompong.
    get qcMonthShortLabel() {
      const bulanId = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
      return bulanId[this.qcMonth - 1];
    },
    // Sama seperti qcMonthShortLabel di atas, tapi ini punya tab Bulanan
    // sendiri (bulananMonth/bulananYear) -- supaya label "Juli"/"Agustus"
    // di panel-panel tab Bulanan (mis. Downtime Terbesar) selalu ikut
    // Bulan/Tahun yang lagi dipilih di tab Bulanan, bukan ikut tab
    // Kontrol Kualitas.
    get bulananMonthLabel() {
      const bulanId = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
      return bulanId[this.bulananMonth - 1];
    },
    // Dipanggil saat dropdown Bulan/Tahun di tab Kontrol Kualitas berubah.
    onQcPeriodChange() {
      // Tab Kontrol Kualitas BERDIRI SENDIRI: ganti Bulan/Tahun di sini
      // TIDAK ikut mengubah tahun di tab Tahunan. Dulu keduanya disamakan
      // otomatis (tahunanYear diikutkan ke tahun fiskal pilihan QC), tapi
      // itu bikin bingung karena tab lain ikut berpindah tanpa diminta.
      // Tiap tab sekarang punya pilihan periodenya masing-masing.
      // Balik ke mode "sebulan" (ikut bulan+tahun yang baru dipilih), dan
      // isi ulang field tanggal ke tanggal 1 bulan baru itu -- diam-diam,
      // cuma supaya kalender kebuka di bulan yang benar kalau nanti diklik.
      const firstOfMonth = localDateStr(new Date(this.qcYear, this.qcMonth - 1, 1));
      this.qcNgInlineDetailDate = firstOfMonth;
      this.qcNgInlineUseDate = false;
      this.qcNgTrialDetailDate = firstOfMonth;
      this.qcNgTrialUseDate = false;
      this.qcRepairDetailDate = firstOfMonth;
      this.qcRepairUseDate = false;
      this.qcStraightpassDetailDate = firstOfMonth;
      // Filter per-kolom di-reset supaya tidak "nyangkut" ke data bulan/
      // tahun yang baru (mis. Part No yang cuma ada di bulan sebelumnya).
      this.qcFilterOpen = null;
      this.qcColFilters = { ngInline: {}, ngTrial: {}, repair: {} };
      this.qcNgInlineLoaded = false;
      this.qcNgTrialLoaded = false;
      this.qcRepairDetailLoaded = false;
      this.qcRepairPerlineModelLoaded = false;
      this.qcStraightpassLoaded = false;
      this.qcFyLoadedKey = "";          // FY tab Kualitas ikut dimuat ulang
      this.qcLineModelMapLoaded = false;
      // Semua fetch + render sekarang lewat loadKualitas() -- skeleton
      // tampil selama memuat, chart digambar SEKALI (tidak kedip).
      this.loadKualitas();
    },
    // Ambil data kolom "NG Inline" (Month/Perline/Model/Daily/Rekap) dari
    // RPC dashboard_qc_ng_* dengan p_type_ng = 'NG PRODUKSI'.
    // Lihat migration_dashboard_kualitas.sql untuk definisi RPC-nya.
    async fetchQcNgInline() {
      if (this.qcNgInlineLoaded) return;
      try {
        const fyStartYear = fyStartOf(this.qcYear, this.qcMonth);
        const fyStart = new Date(fyStartYear, 3, 1);
        const fyEnd = new Date(fyStartYear + 1, 3, 1);
        const monthStart = new Date(this.qcYear, this.qcMonth - 1, 1);
        const monthEnd = new Date(this.qcYear, this.qcMonth, 1);
        const TYPE_NG = "NG PRODUKSI";

        const [monthRes, perlineRes, permodelRes, dailyRes] = await Promise.all([
          supabaseClient.rpc("dashboard_qc_ng_month", { p_type_ng: TYPE_NG, p_start: fyStart.toISOString(), p_end: fyEnd.toISOString() }),
          supabaseClient.rpc("dashboard_qc_ng_perline", { p_type_ng: TYPE_NG, p_start: monthStart.toISOString(), p_end: monthEnd.toISOString() }),
          supabaseClient.rpc("dashboard_qc_ng_permodel", { p_type_ng: TYPE_NG, p_start: monthStart.toISOString(), p_end: monthEnd.toISOString() }),
          supabaseClient.rpc("dashboard_qc_ng_daily", { p_type_ng: TYPE_NG, p_start: monthStart.toISOString(), p_end: monthEnd.toISOString() }),
        ]);
        if (monthRes.error) console.error("dashboard_qc_ng_month:", monthRes.error);
        if (perlineRes.error) console.error("dashboard_qc_ng_perline:", perlineRes.error);
        if (permodelRes.error) console.error("dashboard_qc_ng_permodel:", permodelRes.error);
        if (dailyRes.error) console.error("dashboard_qc_ng_daily:", dailyRes.error);

        const monthRows = monthRes.data || [];
        const perlineRows = perlineRes.data || [];
        const permodelRows = permodelRes.data || [];
        const dailyRows = dailyRes.data || [];

        // 12 bulan FY berjalan (Apr..Mar), selaras dengan tahunan.monthLabels
        const fyMonths = [];
        for (let i = 0; i < 12; i++) fyMonths.push(new Date(fyStartYear, 3 + i, 1));
        const findMonthRow = (d) => monthRows.find((r) => r.bulan === localDateStr(d));
        let qtyByMonth = fyMonths.map((d) => { const r = findMonthRow(d); return r ? Number(r.qty) || 0 : null; });
        let valueByMonth = fyMonths.map((d) => { const r = findMonthRow(d); return r ? Number(r.value) || 0 : null; });

        // Kalau FY ini dipasang data manual (Master Data > Dashboard FY),
        // angka Month NG Inline ikut manual juga -- supaya SAMA dengan tab
        // Tahunan (yang sudah menerapkan override ini di
        // dxyRebuildTahunanSeries). Sebelum ini, chart NG Inline di tab
        // Kualitas TIDAK PERNAH ikut override, jadi beda angka dengan tab
        // Tahunan tiap kali sebuah FY diaktifkan datanya manual. Dibungkus
        // try/catch supaya tetap jalan normal kalau migration_fy_override.sql
        // belum dijalankan.
        let ovHeadQc = null;
        try {
          const { data: ovHeadData, error: ovHeadErr } = await supabaseClient
            .from("fy_override").select("*").eq("fy", fyStartYear).maybeSingle();
          if (!ovHeadErr && ovHeadData) ovHeadQc = ovHeadData;   // utk kolom FY sebelumnya
          if (!ovHeadErr && ovHeadData && ovHeadData.aktif) {
            const { data: ovBulanData } = await supabaseClient
              .from("fy_override_bulan").select("bulan,ng_qty,ng_value").eq("fy", fyStartYear);
            const byBulan = new Map((ovBulanData || []).map((r) => [Number(r.bulan), r]));
            const ambil = (nama) => Array.from({ length: 12 }, (_, i) => {
              const r = byBulan.get(i + 1);
              const v = r ? r[nama] : null;
              return v === null || v === undefined ? null : Number(v);
            });
            qtyByMonth = ambil("ng_qty");
            valueByMonth = ambil("ng_value");
          }
        } catch (e) { /* tabel belum ada -> pakai hitungan sistem seperti biasa */ }

        const perlineQty = QC_LINES.map((line) => { const r = perlineRows.find((x) => x.mesin === line); return r ? Number(r.qty) || 0 : 0; });
        const perlineValue = QC_LINES.map((line) => { const r = perlineRows.find((x) => x.mesin === line); return r ? Number(r.value) || 0 : 0; });

        const permodelQty = QC_MODELS.map((model) => { const r = permodelRows.find((x) => x.model === model); return r ? Number(r.qty) || 0 : 0; });
        const permodelValue = QC_MODELS.map((model) => { const r = permodelRows.find((x) => x.model === model); return r ? Number(r.value) || 0 : 0; });

        // Tanggal 1-31 bulan yang dipilih
        const daysInMonth = new Date(this.qcYear, this.qcMonth, 0).getDate();
        const findDayRow = (day) => dailyRows.find((r) => r.tanggal === localDateStr(new Date(this.qcYear, this.qcMonth - 1, day)));
        // Tanggal yang belum lewat (belum ada datanya sama sekali) dikosongkan (null),
        // bukan diisi 0 -- 0 hanya untuk tanggal yang sudah lewat dan memang tidak ada NG.
        const todayLocal = new Date();
        todayLocal.setHours(0, 0, 0, 0);
        const dailyQty = Array.from({ length: 31 }, (_, i) => {
          const day = i + 1;
          if (day > daysInMonth) return null;
          if (new Date(this.qcYear, this.qcMonth - 1, day) > todayLocal) return null;
          const r = findDayRow(day);
          return r ? Number(r.qty) || 0 : 0;
        });
        const dailyValue = Array.from({ length: 31 }, (_, i) => {
          const day = i + 1;
          if (day > daysInMonth) return null;
          if (new Date(this.qcYear, this.qcMonth - 1, day) > todayLocal) return null;
          const r = findDayRow(day);
          return r ? Number(r.value) || 0 : 0;
        });

        this.qcNgInline = {
          monthLabels: this.tahunan.monthLabels && this.tahunan.monthLabels.length ? this.tahunan.monthLabels.slice(2) : ["Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des","Jan","Feb","Mar"],
          qtyByMonth, valueByMonth,
          // Angka FY sebelumnya (diisi tangan di Master Data) + tahun fiskal
          // yang sedang dilihat -- dipakai chart Month utk dua kolom kiri.
          fyStartYear,
          fyPrevQty: angkaManual(ovHeadQc && ovHeadQc.ng_qty_fy_prev),
          fyPrevValue: angkaManual(ovHeadQc && ovHeadQc.ng_value_fy_prev),
          perlineQty, perlineValue,
          permodelQty, permodelValue,
          dailyQty, dailyValue,
          detailRows: this.qcNgInline.detailRows,
        };
        this.qcNgInlineLoaded = true;
        await this.fetchQcNgInlineDetail();
      } catch (e) {
        console.error("Gagal memuat data NG Inline (Kontrol Kualitas):", e);
      }
    },
    // Ambil rincian baris NG untuk tabel "Rekap NG Inline".
    // Otomatis, TANPA tombol/mode manual:
    // - qcNgInlineDetailDate KOSONG -> tampil SEBULAN PENUH (qcMonth/qcYear),
    //   pakai RPC baru dashboard_qc_ng_detail_range.
    // - qcNgInlineDetailDate DIISI  -> tampil 1 hari itu saja, pakai RPC
    //   lama dashboard_qc_ng_detail.
    async fetchQcNgInlineDetail() {
      try {
        const isBulan = !this.qcNgInlineUseDate;
        let data, error;
        if (isBulan) {
          const monthStart = new Date(this.qcYear, this.qcMonth - 1, 1);
          const monthEnd = new Date(this.qcYear, this.qcMonth, 1);
          ({ data, error } = await supabaseClient.rpc("dashboard_qc_ng_detail_range", {
            p_type_ng: "NG PRODUKSI",
            p_start: localDateStr(monthStart),
            p_end: localDateStr(monthEnd),
          }));
        } else {
          ({ data, error } = await supabaseClient.rpc("dashboard_qc_ng_detail", {
            p_type_ng: "NG PRODUKSI",
            p_tanggal: this.qcNgInlineDetailDate,
          }));
        }
        if (error) { console.error("dashboard_qc_ng_detail" + (isBulan ? "_range" : "") + ":", error); return; }
        this.qcNgInline.detailRows = (data || []).map((r) => ({
          // r.tanggal dari Supabase berformat "YYYY-MM-DD" -- ditampilkan
          // ringkas "DD/MM" karena kolomnya sempit (cuma dipakai/terlihat
          // saat tampilan sebulan, ketika input tanggal dikosongkan).
          tanggal: r.tanggal ? r.tanggal.slice(8, 10) + "/" + r.tanggal.slice(5, 7) : "",
          model: r.model || "", line: r.mesin || "", partNo: r.part_number || "",
          area: r.area || "", ngProses: r.ng_proses || "", qty: r.qty ?? "",
          ngKategori: r.ng_kategori || "", value: r.value ?? "",
        }));
      } catch (e) {
        console.error("Gagal memuat detail NG Inline:", e);
      }
    },
    // Ambil data kolom "NG Trial" (Month/Perline/Model/Daily/Rekap) dari
    // RPC dashboard_qc_ng_* yang SAMA dengan NG Inline, bedanya cuma
    // p_type_ng = 'NG TRIAL' (dikonfirmasi lewat query ke ng_inline_log).
    async fetchQcNgTrial() {
      if (this.qcNgTrialLoaded) return;
      try {
        const fyStartYear = fyStartOf(this.qcYear, this.qcMonth);
        const fyStart = new Date(fyStartYear, 3, 1);
        const fyEnd = new Date(fyStartYear + 1, 3, 1);
        const monthStart = new Date(this.qcYear, this.qcMonth - 1, 1);
        const monthEnd = new Date(this.qcYear, this.qcMonth, 1);
        const TYPE_NG = "NG TRIAL";

        const [monthRes, perlineRes, permodelRes, dailyRes] = await Promise.all([
          supabaseClient.rpc("dashboard_qc_ng_month", { p_type_ng: TYPE_NG, p_start: fyStart.toISOString(), p_end: fyEnd.toISOString() }),
          supabaseClient.rpc("dashboard_qc_ng_perline", { p_type_ng: TYPE_NG, p_start: monthStart.toISOString(), p_end: monthEnd.toISOString() }),
          supabaseClient.rpc("dashboard_qc_ng_permodel", { p_type_ng: TYPE_NG, p_start: monthStart.toISOString(), p_end: monthEnd.toISOString() }),
          supabaseClient.rpc("dashboard_qc_ng_daily", { p_type_ng: TYPE_NG, p_start: monthStart.toISOString(), p_end: monthEnd.toISOString() }),
        ]);
        if (monthRes.error) console.error("dashboard_qc_ng_month (trial):", monthRes.error);
        if (perlineRes.error) console.error("dashboard_qc_ng_perline (trial):", perlineRes.error);
        if (permodelRes.error) console.error("dashboard_qc_ng_permodel (trial):", permodelRes.error);
        if (dailyRes.error) console.error("dashboard_qc_ng_daily (trial):", dailyRes.error);

        const monthRows = monthRes.data || [];
        const perlineRows = perlineRes.data || [];
        const permodelRows = permodelRes.data || [];
        const dailyRows = dailyRes.data || [];

        const fyMonths = [];
        for (let i = 0; i < 12; i++) fyMonths.push(new Date(fyStartYear, 3 + i, 1));
        const findMonthRow = (d) => monthRows.find((r) => r.bulan === localDateStr(d));
        const qtyByMonth = fyMonths.map((d) => { const r = findMonthRow(d); return r ? Number(r.qty) || 0 : null; });
        const valueByMonth = fyMonths.map((d) => { const r = findMonthRow(d); return r ? Number(r.value) || 0 : null; });

        const perlineQty = QC_LINES.map((line) => { const r = perlineRows.find((x) => x.mesin === line); return r ? Number(r.qty) || 0 : 0; });
        const perlineValue = QC_LINES.map((line) => { const r = perlineRows.find((x) => x.mesin === line); return r ? Number(r.value) || 0 : 0; });

        const permodelQty = QC_MODELS.map((model) => { const r = permodelRows.find((x) => x.model === model); return r ? Number(r.qty) || 0 : 0; });
        const permodelValue = QC_MODELS.map((model) => { const r = permodelRows.find((x) => x.model === model); return r ? Number(r.value) || 0 : 0; });

        const daysInMonth = new Date(this.qcYear, this.qcMonth, 0).getDate();
        const findDayRow = (day) => dailyRows.find((r) => r.tanggal === localDateStr(new Date(this.qcYear, this.qcMonth - 1, day)));
        const todayLocal = new Date();
        todayLocal.setHours(0, 0, 0, 0);
        const dailyQty = Array.from({ length: 31 }, (_, i) => {
          const day = i + 1;
          if (day > daysInMonth) return null;
          if (new Date(this.qcYear, this.qcMonth - 1, day) > todayLocal) return null;
          const r = findDayRow(day);
          return r ? Number(r.qty) || 0 : 0;
        });
        const dailyValue = Array.from({ length: 31 }, (_, i) => {
          const day = i + 1;
          if (day > daysInMonth) return null;
          if (new Date(this.qcYear, this.qcMonth - 1, day) > todayLocal) return null;
          const r = findDayRow(day);
          return r ? Number(r.value) || 0 : 0;
        });

        // Angka FY sebelumnya utk dua kolom ringkasan di chart Month.
        // Dibungkus try/catch supaya tetap jalan kalau tabelnya belum ada.
        let ovHeadTrial = null;
        try {
          const { data: hT } = await supabaseClient
            .from("fy_override").select("*").eq("fy", fyStartYear).maybeSingle();
          ovHeadTrial = hT || null;
        } catch (e) { /* tabel belum ada -> kolom FY sebelumnya dibiarkan kosong */ }

        this.qcNgTrial = {
          monthLabels: this.tahunan.monthLabels && this.tahunan.monthLabels.length ? this.tahunan.monthLabels.slice(2) : ["Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des","Jan","Feb","Mar"],
          qtyByMonth, valueByMonth,
          fyStartYear,
          fyPrevQty: angkaManual(ovHeadTrial && ovHeadTrial.ng_trial_qty_fy_prev),
          fyPrevValue: angkaManual(ovHeadTrial && ovHeadTrial.ng_trial_value_fy_prev),
          perlineQty, perlineValue,
          permodelQty, permodelValue,
          dailyQty, dailyValue,
          detailRows: this.qcNgTrial.detailRows,
        };
        this.qcNgTrialLoaded = true;
        await this.fetchQcNgTrialDetail();
      } catch (e) {
        console.error("Gagal memuat data NG Trial (Kontrol Kualitas):", e);
      }
    },
    // Ambil rincian baris NG untuk tabel "Rekap NG Trial". Sama persis
    // logikanya dengan fetchQcNgInlineDetail(), bedanya p_type_ng = 'NG TRIAL'.
    async fetchQcNgTrialDetail() {
      try {
        const isBulan = !this.qcNgTrialUseDate;
        let data, error;
        if (isBulan) {
          const monthStart = new Date(this.qcYear, this.qcMonth - 1, 1);
          const monthEnd = new Date(this.qcYear, this.qcMonth, 1);
          ({ data, error } = await supabaseClient.rpc("dashboard_qc_ng_detail_range", {
            p_type_ng: "NG TRIAL",
            p_start: localDateStr(monthStart),
            p_end: localDateStr(monthEnd),
          }));
        } else {
          ({ data, error } = await supabaseClient.rpc("dashboard_qc_ng_detail", {
            p_type_ng: "NG TRIAL",
            p_tanggal: this.qcNgTrialDetailDate,
          }));
        }
        if (error) { console.error("dashboard_qc_ng_detail" + (isBulan ? "_range" : "") + " (trial):", error); return; }
        this.qcNgTrial.detailRows = (data || []).map((r) => ({
          tanggal: r.tanggal ? r.tanggal.slice(8, 10) + "/" + r.tanggal.slice(5, 7) : "",
          model: r.model || "", line: r.mesin || "", partNo: r.part_number || "",
          area: r.area || "", ngProses: r.ng_proses || "", qty: r.qty ?? "",
          ngKategori: r.ng_kategori || "", value: r.value ?? "",
        }));
      } catch (e) {
        console.error("Gagal memuat detail NG Trial:", e);
      }
    },
    // Ambil rincian baris Repair untuk tabel "Rekap Repair".
    // Cuma ada 1 RPC (dashboard_qc_repair_detail_range), dipakai baik
    // untuk mode "sebulan" maupun "1 tanggal" -- kalau 1 tanggal, p_start
    // & p_end dibuat selisih pas 1 hari.
    // Kolom Model di-lookup dari ng_model_parts (sama seperti popup Repair
    // di machine-page.js -> repairPartNoModelMap). Kolom Area masih
    // dikosongkan (belum ada sumbernya di database).
    async fetchQcRepairDetail() {
      if (this.qcRepairDetailLoaded) return;
      try {
        let start, end;
        if (this.qcRepairUseDate) {
          start = new Date(this.qcRepairDetailDate);
          end = new Date(this.qcRepairDetailDate);
          end.setDate(end.getDate() + 1);
        } else {
          start = new Date(this.qcYear, this.qcMonth - 1, 1);
          end = new Date(this.qcYear, this.qcMonth, 1);
        }
        const { data, error } = await supabaseClient.rpc("dashboard_qc_repair_detail_range", {
          p_start: localDateStr(start),
          p_end: localDateStr(end),
        });
        if (error) { console.error("dashboard_qc_repair_detail_range:", error); return; }
        this.qcRepair.detailRows = (data || []).map((r) => ({
          tanggal: r.tanggal ? r.tanggal.slice(8, 10) + "/" + r.tanggal.slice(5, 7) : "",
          model: r.model || "", line: r.mesin || "", partNo: r.part_number || "",
          qty: r.qty ?? "", area: "", point: r.point_label || "",
          repairKategori: r.kategori_repair || "",
        }));
        this.qcRepairDetailLoaded = true;
      } catch (e) {
        console.error("Gagal memuat detail Repair:", e);
      }
    },
    // Ambil Qty Repair per line & per model (SELALU per bulan yang lagi
    // dipilih, TIDAK ikut toggle tanggal/sebulan panel "Rekap Repair" --
    // sama seperti Perline/Model NG Inline/Trial yang juga selalu
    // per-bulan). Dipakai buat bar "Qty Repair" di chart Straightpass
    // Perline/Model.
    async fetchQcRepairPerlineModel() {
      if (this.qcRepairPerlineModelLoaded) return;
      try {
        const monthStart = new Date(this.qcYear, this.qcMonth - 1, 1);
        const monthEnd = new Date(this.qcYear, this.qcMonth, 1);
        const [perlineRes, permodelRes] = await Promise.all([
          // p_start/p_end sekarang timestamptz (ISO string), BUKAN date
          // string lagi -- karena dashboard_qc_repair_perline/permodel
          // sudah baca dari production_log.repair (timestamptz waktu_awal),
          // sama seperti dashboard_qc_produksi_perline/permodel di bawah.
          // Lihat migration_straightpass_repair_source.sql.
          supabaseClient.rpc("dashboard_qc_repair_perline", { p_start: monthStart.toISOString(), p_end: monthEnd.toISOString() }),
          supabaseClient.rpc("dashboard_qc_repair_permodel", { p_start: monthStart.toISOString(), p_end: monthEnd.toISOString() }),
        ]);
        if (perlineRes.error) { console.error("dashboard_qc_repair_perline:", perlineRes.error); return; }
        if (permodelRes.error) { console.error("dashboard_qc_repair_permodel:", permodelRes.error); return; }
        const perlineRows = perlineRes.data || [];
        const permodelRows = permodelRes.data || [];
        this.qcRepair.perlineQty = QC_LINES.map((line) => { const r = perlineRows.find((x) => x.mesin === line); return r ? Number(r.qty) || 0 : 0; });
        this.qcRepair.permodelQty = QC_MODELS.map((model) => { const r = permodelRows.find((x) => x.model === model); return r ? Number(r.qty) || 0 : 0; });
        this.qcRepairPerlineModelLoaded = true;
      } catch (e) {
        console.error("Gagal memuat Qty Repair per line/model:", e);
      }
    },
    // Ambil stroke & NG per line/model (RPC baru dashboard_qc_produksi_*),
    // gabungkan dengan NG per line/model dari NG Inline (this.qcNgInline,
    // sudah kefetch lewat fetchQcNgInline()) untuk hitung persentase
    // Straightpass per line/model -- rumus sama persis kartu utama:
    // (Stroke - NG) / Stroke * 100.
    // Straightpass 12 bulan untuk FY yang sedang dipilih di TAB KUALITAS.
    // Rumus & sumber datanya sama persis dengan chart Straight Pass di tab
    // Tahunan, cuma tahun fiskalnya ikut qcYear/qcMonth -- bukan tahunanYear.
    async fetchQcFyStraightpass() {
      const fyStartYear = fyStartOf(this.qcYear, this.qcMonth);
      if (this.qcFyLoadedKey === String(fyStartYear)) return;
      try {
        const fyStart = new Date(fyStartYear, 3, 1);
        const fyEnd = new Date(fyStartYear + 1, 3, 1);
        const [prodRes, repairRes] = await Promise.all([
          supabaseClient.rpc("dashboard_bulanan_produksi", { p_start: fyStart.toISOString(), p_end: fyEnd.toISOString() }),
          supabaseClient.rpc("dashboard_qc_repair_month", { p_start: fyStart.toISOString(), p_end: fyEnd.toISOString() }),
        ]);
        // dashboard_bulanan_produksi & dashboard_qc_repair_month mengembalikan
        // SATU BARIS PER (bulan, mesin) -- persis seperti di tab Tahunan --
        // jadi harus dijumlah dulu per bulan (semua Line) sebelum dipakai.
        // Sebelum ini kode langsung .find() baris pertama yang cocok per
        // bulan (cuma 1 Line kebagian), sehingga stroke & qty repair yang
        // dipakai untuk %Straightpass jadi kekecilan/salah dan beda dengan
        // angka di tab Tahunan (yang sudah menjumlahkan lewat collapseByLine).
        const collapseByLine = (rows) => {
          const map = new Map();
          for (const r of rows) {
            if (!map.has(r.bulan)) map.set(r.bulan, { bulan: r.bulan });
            const acc = map.get(r.bulan);
            for (const k of Object.keys(r)) {
              if (k === "bulan" || k === "mesin") continue;
              acc[k] = (acc[k] || 0) + (Number(r[k]) || 0);
            }
          }
          return Array.from(map.values());
        };
        const prodRows = collapseByLine(prodRes.data || []);
        const repairRows = collapseByLine(repairRes.data || []);

        const monthLabelId = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
        const fyMonths = [];
        for (let i = 0; i < 12; i++) fyMonths.push(new Date(fyStartYear, 3 + i, 1));
        const findRow = (rows, d) => rows.find((r) => r.bulan === localDateStr(d));

        let actual = fyMonths.map((d) => {
          const row = findRow(prodRows, d);
          const rep = findRow(repairRows, d);
          if (!row || !row.stroke) return null;
          const repairQty = rep ? Number(rep.qty) || 0 : 0;
          return Number((((Number(row.stroke) - repairQty) / Number(row.stroke)) * 100).toFixed(1));
        });
        let repairQty = fyMonths.map((d) => {
          const rep = findRow(repairRows, d);
          return rep ? Number(rep.qty) || 0 : null;
        });

        // Kalau FY ini dipasang data manual (Master Data > Dashboard FY),
        // angkanya ikut manual -- supaya sama dengan tab Tahunan.
        let ovHeadSp = null;
        try {
          const [hRes, bRes] = await Promise.all([
            supabaseClient.from("fy_override").select("*").eq("fy", fyStartYear).maybeSingle(),
            supabaseClient.from("fy_override_bulan").select("bulan,sp_actual,sp_repair_qty").eq("fy", fyStartYear),
          ]);
          if (!hRes.error && hRes.data) ovHeadSp = hRes.data;   // utk kolom FY sebelumnya
          if (!hRes.error && hRes.data && hRes.data.aktif) {
            const peta = new Map((bRes.data || []).map((r) => [Number(r.bulan), r]));
            const ambil = (nama) => Array.from({ length: 12 }, (_, i) => {
              const r = peta.get(i + 1);
              const v = r ? r[nama] : null;
              return v === null || v === undefined ? null : Number(v);
            });
            actual = ambil("sp_actual");
            repairQty = ambil("sp_repair_qty");
          }
        } catch (e) { /* tabel belum ada -> pakai hitungan sistem */ }

        this.qcFy = {
          monthLabels: fyMonths.map((d) => monthLabelId[d.getMonth()]),
          actual, repairQty, target: 95,
          fyStartYear,
          fyPrevSp: angkaManual(ovHeadSp && ovHeadSp.sp_fy_prev),
          fyPrevRepair: angkaManual(ovHeadSp && ovHeadSp.sp_repair_fy_prev),
        };
        this.qcFyLoadedKey = String(fyStartYear);
      } catch (e) {
        console.error("Gagal mengambil Straightpass FY tab Kualitas:", e);
      }
    },
    async fetchQcStraightpassBreakdown() {
      if (this.qcStraightpassLoaded) return;
      try {
        const monthStart = new Date(this.qcYear, this.qcMonth - 1, 1);
        const monthEnd = new Date(this.qcYear, this.qcMonth, 1);
        const [perlineRes, permodelRes, dailyProdRes, dailyRepairRes] = await Promise.all([
          supabaseClient.rpc("dashboard_qc_produksi_perline", { p_start: monthStart.toISOString(), p_end: monthEnd.toISOString() }),
          supabaseClient.rpc("dashboard_qc_produksi_permodel", { p_start: monthStart.toISOString(), p_end: monthEnd.toISOString() }),
          supabaseClient.rpc("dashboard_qc_produksi_daily", { p_start: monthStart.toISOString(), p_end: monthEnd.toISOString() }),
          supabaseClient.rpc("dashboard_qc_repair_daily", { p_start: monthStart.toISOString(), p_end: monthEnd.toISOString() }),
        ]);
        if (perlineRes.error) { console.error("dashboard_qc_produksi_perline:", perlineRes.error); return; }
        if (permodelRes.error) { console.error("dashboard_qc_produksi_permodel:", permodelRes.error); return; }
        if (dailyProdRes.error) { console.error("dashboard_qc_produksi_daily:", dailyProdRes.error); return; }
        if (dailyRepairRes.error) { console.error("dashboard_qc_repair_daily:", dailyRepairRes.error); return; }

        const perlineRows = perlineRes.data || [];
        const permodelRows = permodelRes.data || [];
        // Qty Repair per line/model -- SUDAH difetch lewat
        // fetchQcRepairPerlineModel() (dipanggil sebelum fungsi ini di
        // setTab()/onQcPeriodChange()), tinggal dipakai dari this.qcRepair.
        const repairPerlineQty = this.qcRepair.perlineQty || [];
        const repairPermodelQty = this.qcRepair.permodelQty || [];

        // % Straightpass = (Stroke - Qty Repair) / Stroke * 100 -- rumus
        // BARU. NG (production_log.ng maupun NG Inline) TIDAK dipakai lagi
        // di rumus ini sama sekali.
        const perlineActual = QC_LINES.map((line, i) => {
          const r = perlineRows.find((x) => x.mesin === line);
          if (!r || !r.stroke) return null;
          const repairQty = Number(repairPerlineQty[i]) || 0;
          return Number((((Number(r.stroke) - repairQty) / Number(r.stroke)) * 100).toFixed(1));
        });
        const permodelActual = QC_MODELS.map((model, i) => {
          const r = permodelRows.find((x) => x.model === model);
          if (!r || !r.stroke) return null;
          const repairQty = Number(repairPermodelQty[i]) || 0;
          return Number((((Number(r.stroke) - repairQty) / Number(r.stroke)) * 100).toFixed(1));
        });

        // --- Daily (1-31): % Straightpass harian = (Stroke - Qty Repair)
        // / Stroke * 100. Null untuk hari yang belum tiba / di luar jumlah
        // hari bulan itu, pola sama seperti dailyQty/dailyValue di
        // fetchQcNgInline().
        const dailyProdRows = dailyProdRes.data || [];
        const dailyRepairRows = dailyRepairRes.data || [];
        const daysInMonthQc = new Date(this.qcYear, this.qcMonth, 0).getDate();
        const findProdDay = (day) => dailyProdRows.find((r) => r.tanggal === localDateStr(new Date(this.qcYear, this.qcMonth - 1, day)));
        const findRepairDay = (day) => dailyRepairRows.find((r) => r.tanggal === localDateStr(new Date(this.qcYear, this.qcMonth - 1, day)));
        const todayLocal = new Date();
        todayLocal.setHours(0, 0, 0, 0);
        const dailyRepairQty = Array.from({ length: 31 }, (_, i) => {
          const day = i + 1;
          if (day > daysInMonthQc) return null;
          if (new Date(this.qcYear, this.qcMonth - 1, day) > todayLocal) return null;
          const r = findRepairDay(day);
          return r ? Number(r.qty) || 0 : 0;
        });
        const dailyPercent = Array.from({ length: 31 }, (_, i) => {
          const day = i + 1;
          if (day > daysInMonthQc) return null;
          if (new Date(this.qcYear, this.qcMonth - 1, day) > todayLocal) return null;
          const r = findProdDay(day);
          if (!r || !r.stroke) return null;
          const repairQty = Number(dailyRepairQty[i]) || 0;
          return Number((((Number(r.stroke) - repairQty) / Number(r.stroke)) * 100).toFixed(1));
        });

        this.qcStraightpass = { perlineActual, permodelActual, dailyRepairQty, dailyPercent };
        this.qcStraightpassLoaded = true;
      } catch (e) {
        console.error("Gagal memuat breakdown Straightpass:", e);
      }
    },
    // Peta Line -> Model (qty & value per kombinasi line+model, bulan yang
    // lagi dipilih) DAN Peta Line -> tren 12 bulan (buat chart "Month" di
    // paling atas tiap kolom), sekaligus dalam SATU fetch -- keduanya
    // dihitung dari baris mentah yang SAMA (RPC detail_range, rentang 1
    // TAHUN FISKAL PENUH Apr..Mar, bukan cuma 1 bulan) supaya cukup 1x
    // request tapi bisa melayani 2 kebutuhan (breakdown bulan berjalan +
    // tren 12 bulan). SENGAJA terpisah dari qcNgInline.detailRows/
    // qcNgTrial.detailRows/qcRepair.detailRows punya masing-masing panel
    // Rekap, karena baris-baris itu bisa ke-toggle jadi 1 tanggal saja
    // (qcNgInlineUseDate dkk), sedangkan peta di sini harus selalu
    // representasi bulan/tahun penuh, sama seperti data Perline/Model/
    // Month yang lain.
    //
    // Catatan keterbatasan (Straightpass Model & Straightpass Month):
    // repair.qty di peta ini AKURAT per line+model/per line+bulan (dari
    // repair_log asli), tapi dashboard TIDAK punya data "stroke" per
    // kombinasi line+model ataupun per line+bulan (RPC produksi yang ada
    // cuma per-line ATAU per-model/bulan, tidak silang keduanya) -- jadi
    // kalau Line difilter, chart Straightpass Model/Month cuma bisa
    // MENYARING model/bar Qty Repair yang tampil, sementara angka %-nya
    // tetap dari data gabungan semua line, bukan murni line itu saja.
    // Sudah dikonfirmasi ke user dan diterima sebagai batasan.
    async fetchQcLineModelMap() {
      if (this.qcLineModelMapLoaded) return;
      try {
        const fyStartYear = fyStartOf(this.qcYear, this.qcMonth);
        const fyStart = new Date(fyStartYear, 3, 1);
        const fyEnd = new Date(fyStartYear + 1, 3, 1);
        // PENTING: pakai fetchAllRpcRows (paginasi), BUKAN supabaseClient.rpc()
        // langsung -- rentangnya 1 tahun fiskal penuh, dan khususnya data
        // Repair volumenya bisa jauh di atas batas 1000-baris/request bawaan
        // Supabase. Lihat catatan lengkap di definisi fetchAllRpcRows().
        const [ngInlineRes, ngTrialRes, repairRes] = await Promise.all([
          fetchAllRpcRows("dashboard_qc_ng_detail_range", { p_type_ng: "NG PRODUKSI", p_start: localDateStr(fyStart), p_end: localDateStr(fyEnd) }),
          fetchAllRpcRows("dashboard_qc_ng_detail_range", { p_type_ng: "NG TRIAL", p_start: localDateStr(fyStart), p_end: localDateStr(fyEnd) }),
          fetchAllRpcRows("dashboard_qc_repair_detail_range", { p_start: localDateStr(fyStart), p_end: localDateStr(fyEnd) }),
        ]);
        if (ngInlineRes.error) console.error("dashboard_qc_ng_detail_range (NG PRODUKSI, line-model map):", ngInlineRes.error);
        if (ngTrialRes.error) console.error("dashboard_qc_ng_detail_range (NG TRIAL, line-model map):", ngTrialRes.error);
        if (repairRes.error) console.error("dashboard_qc_repair_detail_range (line-model map):", repairRes.error);

        // Index bulan-FY (0 = April fyStartYear .. 11 = Maret fyStartYear+1)
        // dari string tanggal "YYYY-MM-DD" -- dibaca lewat slice (BUKAN lewat
        // `new Date(...)`) supaya tidak kena pergeseran zona waktu browser,
        // sama seperti pola yang sudah dipakai di tempat lain (mis. mapping
        // detailRows tanggal.slice(8,10)+"/"+tanggal.slice(5,7)).
        const fyIndexOf = (tgl) => {
          const y = parseInt((tgl || "").slice(0, 4), 10);
          const m = parseInt((tgl || "").slice(5, 7), 10);
          if (!y || !m) return -1;
          return (y - fyStartYear) * 12 + (m - 4);
        };
        const curYearStr = String(this.qcYear);
        const curMonthStr = String(this.qcMonth).padStart(2, "0");
        const isCurrentMonth = (tgl) => (tgl || "").slice(0, 4) === curYearStr && (tgl || "").slice(5, 7) === curMonthStr;

        // Dari baris mentah 1-tahun-fiskal, turunkan 3 peta sekaligus:
        // modelMap = { line: { model: {qty,value} } } & dayMap = { line: { qtyByDay:[31], valueByDay:[31] } }
        // TAPI keduanya cuma baris bulan yang lagi dipilih (qcMonth/qcYear);
        // monthMap = { line: { qtyByMonth:[12], valueByMonth:[12] } } dari SEMUA 12 bulan.
        const build = (rows, hasValue) => {
          const modelMap = {};
          const monthMap = {};
          const dayMap = {};
          (rows || []).forEach((r) => {
            const line = r.mesin || "";
            if (!line) return;
            const model = r.model || "";
            const qty = Number(r.qty) || 0;
            const value = hasValue ? Number(r.value) || 0 : 0;
            const idx = fyIndexOf(r.tanggal);
            if (idx >= 0 && idx < 12) {
              if (!monthMap[line]) monthMap[line] = { qtyByMonth: Array(12).fill(0), valueByMonth: Array(12).fill(0) };
              monthMap[line].qtyByMonth[idx] += qty;
              if (hasValue) monthMap[line].valueByMonth[idx] += value;
            }
            if (model && isCurrentMonth(r.tanggal)) {
              if (!modelMap[line]) modelMap[line] = {};
              if (!modelMap[line][model]) modelMap[line][model] = { qty: 0, value: 0 };
              modelMap[line][model].qty += qty;
              if (hasValue) modelMap[line][model].value += value;
            }
            if (isCurrentMonth(r.tanggal)) {
              const day = parseInt((r.tanggal || "").slice(8, 10), 10);
              if (day >= 1 && day <= 31) {
                if (!dayMap[line]) dayMap[line] = { qtyByDay: Array(31).fill(0), valueByDay: Array(31).fill(0) };
                dayMap[line].qtyByDay[day - 1] += qty;
                if (hasValue) dayMap[line].valueByDay[day - 1] += value;
              }
            }
          });
          return { modelMap, monthMap, dayMap };
        };
        const ngiBuilt = build(ngInlineRes.data, true);
        const ngtBuilt = build(ngTrialRes.data, true);
        const repBuilt = build(repairRes.data, false);

        this.qcLineModelMap = { ngInline: ngiBuilt.modelMap, ngTrial: ngtBuilt.modelMap, repair: repBuilt.modelMap };
        this.qcLineMonthMap = { ngInline: ngiBuilt.monthMap, ngTrial: ngtBuilt.monthMap, repair: repBuilt.monthMap };
        // dayMap dipakai buat chart *Daily per-Line (NG Inline/NG Trial akurat
        // penuh Qty+Value; Straightpass cuma bar "Qty Repair" yang akurat
        // per-line, garis "% Straightpass" TETAP gabungan semua line --
        // sama seperti keterbatasan Month/Model, lihat catatan di atas --
        // karena dashboard belum punya data stroke harian per-line.
        this.qcLineDayMap = { ngInline: ngiBuilt.dayMap, ngTrial: ngtBuilt.dayMap, repair: repBuilt.dayMap };
        this.qcLineModelMapLoaded = true;
      } catch (e) {
        console.error("Gagal memuat peta Line-Model (Kontrol Kualitas):", e);
      }
    },
    // ---------------------------------------------------------------
    // Data "Bulanan" (harian, tanggal 1-31) -- diisi dari fetchBulanan()
    // lewat RPC Supabase baru (lihat migration_dashboard_bulanan_harian.sql).
    // Skeleton kosong dulu supaya template tidak error sebelum data datang.
    // ---------------------------------------------------------------
    bulanan: {
      dayLabels: [],               // ["1","2",...,"31"] sesuai jumlah hari di bulan terpilih
      productivity: { value: 0, actual: [], target: 100, avg: 0 },   // % per hari
      availability: { value: 0, actual: [], target: null, avg: 0 },   // % per hari; target: null = tanpa garis Target
      downtimeHarian: { labels: [], values: [], total: 0 },             // menit per hari 1-31
      downtimeExhaust: { labels: [], values: [] },                      // menit per bulan (FY Apr-Mar), ikut filter Line Bulanan
      downtimeSupporting: { labels: [], act: [] },             // per PIC: PE, MESIN, QC, PC-SUPP, PROD, PRESS
      downtimeLine: { labels: [], act: [] },                   // per line: E-02..E-07
      weekly: [],                  // 5 entri: { labels: [E-02..E-07], values: [...] }
      downtimeTerbesar: [],        // per line: { mesin, rows: [{pic,problem,area,countermeasure,status,shift,menit}] }
      downtimeTerbesarBulan: [],   // rekap 1 bulan penuh per Problem: { problem, menit, frekuensi }
    },
    bulananCharts: {},
    // Default = FY yang sedang berjalan (Jan-Mar masih FY tahun lalu).
    tahunanYear: fyStartOf(new Date().getFullYear(), new Date().getMonth() + 1),
    tahunanYearOptions: [2025, 2026, 2027],
    tahunanLoading: false, // skeleton "Memuat data" dinonaktifkan -- konten langsung tampil
    tahunanLoaded: false,
    tahunan: {
      monthLabels: [],
      // target Productivity di tab Tahunan berupa ARRAY (per bulan), jadi
      // nilai awalnya array kosong supaya .slice() aman sebelum data masuk
      productivity: { value: 0, actual: [], target: [] },   // target per bulan (array)
      availability: { value: 0, actual: [], target: null },   // target: null = tanpa garis Target
      ngInline: { qty: 0, value: 0, qtyByMonth: [], valueByMonth: [] },
      straightpass: { value: 0, actual: [], qty: [], repairQty: [], target: 95 },
      downtimeExhaust: { labels: [], values: [] },
      downtimeSupporting: { labels: [], plan: [], act: [] },
      downtimeLine: { labels: [], plan: [], act: [] },
      downtimeTerbesar: [],
      ngInlineTerbesar: [],
      repairTerbesar: [],
    },
    tahunanCharts: {},
    qcCharts: {},
    qcChartsLoading: false, // skeleton di kotak chart Kontrol Kualitas
    qcHasData: false,       // sudah pernah sukses load minimal sekali
    _qcLoadToken: 0,
    attendanceCharts: {},
    // Tab Performance: line yang lagi ditampilkan di <iframe> (lihat
    // template x-if="activeTab === 'performance'").
    perfLine: AppPref.lineFavorit() || "E-02",
    // Tinggi <iframe> tab Performance, DIHITUNG LANGSUNG via JS sebagai
    // px pasti (bukan calc(100vh - Npx) yg gampang meleset & nyisain area
    // kosong di bawah card) -- px pasti dari window.innerHeight supaya
    // tidak nebak-nebak tinggi header/nav di atasnya.
    perfIframeHeight: 560,
    perfDilihat: {},   // line yang iframe-nya sudah dibuka (tetap hidup)
    // CATATAN: pernah dicoba tinggi iframe mengikuti tinggi ISI-nya
    // (diukur dari luar + ResizeObserver) supaya tidak ada ruang kosong
    // menggantung di tab Tahunan. DIBATALKAN: saat file dibuka langsung
    // dari komputer (file://), isi iframe tidak boleh diukur dari halaman
    // induk, jadi ukurannya terkunci di angka pertama (saat isinya masih
    // kosong) dan panelnya malah kepotong. Jangan diulang tanpa cara ukur
    // yang tidak bergantung akses lintas-dokumen (mis. postMessage dari
    // machines/e-0X.html sendiri).
    perfComputeIframeHeight() {
      const nav = document.getElementById("perfSubNav");
      if (!nav) return;
      const top = nav.getBoundingClientRect().bottom;
      const h = Math.max(560, Math.floor(window.innerHeight - top - 16));
      this.perfIframeHeight = h;
    },
    // Print & Export PDF Dekidaka (dulu di sini) sudah dihapus --
    // tombol itu sekarang cuma ada di modal "Lihat Dekidaka"
    // (assets/machine-page.js), tidak diduplikat lagi di sini.
    tahunanInsights: [],
    // dxyLineFilter: KHUSUS tab Tahunan (dropdown Line di baris filter
    // Tahunan, dipakai dxyRebuildTahunanSeries/chart-chart Tahunan/3
    // tabel Terbesar Tahunan).
    dxyLineFilter: AppPref.lineFavorit() || "ALL",
    // dxyLineFilterBulanan: KHUSUS tab Bulanan (dropdown Line di baris
    // filter Bulanan) -- SENGAJA dipisah dari dxyLineFilter di atas
    // supaya ganti Line di 1 tab TIDAK ikut mengubah Line di tab
    // satunya. Dulu keduanya pakai 1 variabel yang sama (dxyLineFilter),
    // makanya kelihatan "nge-link".
    dxyLineFilterBulanan: AppPref.lineFavorit() || "ALL",
    MACHINES_REF: MACHINES,
    async init() {
      this.session = await requireAuth();
      if (!await requireStaff(this.session)) return;
      if (!this.session) return;
      const { data } = await supabaseClient.from("profiles").select("*").eq("id", this.session.user.id).maybeSingle();
      this.profile = data;
      this.loading = false;
      // ?tab=... -> langsung buka tab itu, mis.
      // dashboard-exhaust.html?tab=plan_harian. Berguna untuk tautan/
      // bookmark ke tab tertentu tanpa harus klik tabnya dulu.
      try {
        const minta = new URLSearchParams(window.location.search).get("tab");
        if (minta && this.bolehLihatTab(minta)) this.activeTab = minta;
      } catch (e) { /* alamat aneh -> abaikan, pakai tab bawaan */ }
      if (this.activeTab === "bulanan") await this.setTab("bulanan");
      if (this.activeTab === "tahunan") await this.setTab("tahunan");
      if (this.activeTab === "plan_harian") await this.setTab("plan_harian");
      this.initRealtime();
      // Tab Performance: iframe-nya pakai tinggi px pasti (lihat
      // perfComputeIframeHeight) supaya gak nyisain area kosong di bawah
      // card putih -- dihitung ulang tiap window di-resize, tapi CUMA
      // kalau tab Performance lagi aktif.
      window.addEventListener("resize", () => { if (this.activeTab === "performance") this.perfComputeIframeHeight(); });
      // Masuk/keluar layar penuh (F11) mengubah 100vh, tapi browser kadang
      // belum selesai menata ulang saat event-nya tiba -- grafik Plan Harian
      // bisa tertinggal memakai ukuran canvas yang lama. Digambar ulang satu
      // frame setelahnya, saat ukuran barunya sudah pasti.
      // (Tumpang tindih tabelnya sendiri sudah dicegah lewat overflow:hidden
      // di .plan-grid-top / .plan-shift-grid, lihat assets/style.css.)
      document.addEventListener("fullscreenchange", () => {
        if (this.activeTab !== "plan_harian") return;
        requestAnimationFrame(() => this.renderPlanKapasitas());
      });
      // PREFETCH: begitu tab pertama selesai, data tab Tahunan & Kontrol
      // Kualitas diambil diam-diam di belakang. Jadi saat user pindah ke
      // tab itu, datanya sudah ada di memori dan chart langsung tampil
      // (tidak ada "Memuat data"). Tidak menggambar apa pun selama tab
      // tersebut belum dibuka.
      this.prefetchOtherTabs();
    },
    async prefetchOtherTabs() {
      try {
        await this.fetchTahunan({ silent: true });
        if (this.activeTab === "tahunan") this.$nextTick(() => this.renderTahunanCharts());
        if (this.activeTab !== "kualitas") await this.loadKualitas({ silent: true });
        if (this.activeTab !== "bulanan") await this.fetchBulanan({ silent: true });
      } catch (e) {
        console.error("Prefetch tab lain gagal:", e);
      }
    },
    // =========================================================
    // REALTIME -- begitu ADA SIAPA SAJA (device manapun, line manapun)
    // simpan/ubah/hapus data Produksi/Downtime/Non-Produksi/NG Inline/
    // Repair, dashboard ini otomatis refresh angka & tabelnya TANPA
    // reload. Tabelnya sama seperti yang sudah didaftarkan realtime-nya
    // untuk halaman line (lihat migration_enable_realtime.sql -- SQL-nya
    // TIDAK perlu dijalankan ulang kalau sudah pernah, tabelnya sama).
    //
    // Dashboard ini isinya SEMUA hasil RPC rekap (bulanan/tahunan/kualitas),
    // bukan baca tabel mentah langsung, jadi begitu ada perubahan, cara
    // paling aman & benar adalah fetch ULANG rekapnya dari RPC (bukan
    // ubah angka di JS) -- makanya di bawah ini cache "*Loaded" tab yang
    // bersangkutan di-reset lalu tab yang SEDANG DIBUKA user di-fetch
    // ulang otomatis. Tab lain yang tidak sedang dibuka cukup ditandai
    // "belum loaded" -- otomatis fetch fresh nanti begitu user pindah
    // ke tab itu (lewat setTab(), tidak perlu proses tambahan).
    // =========================================================
    _rtChannel: null,
    _rtDebounceTimers: {},
    // Kumpulkan beberapa event yang datang beruntun (mis. sync offline
    // banyak baris sekaligus dari beberapa line, atau autosave Qty/Repair
    // yang nulis beberapa kali berturut-turut) jadi 1 kali refresh saja,
    // biar tidak spam request RPC ke Supabase. Delay dinaikkan dari 600ms
    // -> 3000ms: bedanya di layar cuma "nunggu 2-3 detik lebih" (tetap
    // kerasa live), tapi kalau lagi ramai input bareng di beberapa line,
    // jumlah refresh yang beneran jalan jauh lebih sedikit -- ini salah
    // satu penyumbang boros Egress (lihat catatan RT_TABLE_GROUP juga).
    debouncedRealtimeFetch(key, fn, delayMs = 3000) {
      clearTimeout(this._rtDebounceTimers[key]);
      this._rtDebounceTimers[key] = setTimeout(fn, delayMs);
    },
    initRealtime() {
      if (this._rtChannel) return; // sudah jalan, jangan dobel subscribe
      this._rtSubscribe();
      // Dashboard ini biasa dibiarkan terbuka BERJAM-JAM di banyak device
      // (PC/HP line), termasuk saat tab-nya di-minimize atau user pindah
      // ke tab/app lain. Selama koneksi realtime masih tersambung, tab
      // yang "nganggur" begitu tetap ikut kehitung kuota Realtime Messages
      // walau tidak ada satu pun orang yang sedang melihatnya. Supaya
      // tidak boros percuma: begitu tab disembunyikan (visibilitychange),
      // koneksi realtime DILEPAS; begitu dibuka lagi, disambung ulang DAN
      // data tab yang lagi aktif ditarik sekali (jaga-jaga ada perubahan
      // yang lewat selama tidak terpantau).
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
          if (this._rtChannel) {
            RealtimeHub.close(this._rtChannel);
            this._rtChannel = null;
          }
        } else if (!this._rtChannel) {
          this._rtSubscribe();
          this.handleRealtimeChange("semua");
        }
      });
      // Tutup koneksi realtime rapi-rapi kalau tab ditutup/pindah halaman.
      window.addEventListener("beforeunload", () => {
        if (this._rtChannel) RealtimeHub.close(this._rtChannel);
      });
    },
    // Buka/sambungkan channel realtime -- dipisah dari initRealtime() supaya
    // bisa dipanggil lagi begitu tab aktif kembali (lihat visibilitychange
    // di atas), tanpa daftar event listener beforeunload/visibilitychange
    // dobel.
    _rtSubscribe() {
      // Lewat RealtimeHub (assets/realtime.js): Supabase Realtime atau Pusher.
      const specs = Object.keys(RT_TABLE_GROUP).map((table) => {
        const group = RT_TABLE_GROUP[table];
        return {
          table,
          onChange: () => {
            // Timer TERPISAH per kelompok tabel (bukan 1 timer bersama utk
            // semua tabel seperti dulu) -- supaya perubahan production_log
            // yang sering (autosave Qty/Repair) tidak ikut memicu tarik-
            // ulang cache Kualitas (ng_inline/repair, termasuk peta 1 tahun
            // yang berat) yang sama sekali tidak terpengaruh, dan
            // sebaliknya.
            this.debouncedRealtimeFetch("refresh_" + group, () => this.handleRealtimeChange(group));
          },
        };
      });
      this._rtChannel = RealtimeHub.subscribe("rt_dashboard_exhaust", specs);
    },
    // Tandai cache yang BENERAN dipengaruhi kelompok tabel yang berubah
    // sebagai basi, lalu refetch tab yang lagi dibuka (tab lain dibiarkan,
    // otomatis fetch fresh nanti begitu user pindah ke tab itu). group:
    // "produksi" (production_log*) | "downtime" (downtime_log/dandori_log)
    // | "kualitas" (ng_inline_log/repair_log/repair_views) | "semua"
    // (dipakai saat reconnect setelah tab sempat disembunyikan -- lihat
    // initRealtime() -- karena tidak tahu tabel mana saja yang berubah
    // selama koneksi lepas, jadi aman-nya invalidasi semua).
    handleRealtimeChange(group) {
      const produksi = group === "produksi" || group === "semua";
      const downtime = group === "downtime" || group === "semua";
      const kualitas = group === "kualitas" || group === "semua";
      if (produksi || downtime) {
        this.bulananLoaded = false;
        this.tahunanLoaded = false;
      }
      if (kualitas) {
        this.tahunanLoaded = false; // tab Tahunan juga tampilkan NG Inline & Straightpass
        this.qcNgInlineLoaded = false;
        this.qcNgTrialLoaded = false;
        this.qcRepairDetailLoaded = false;
        this.qcRepairPerlineModelLoaded = false;
        this.qcLineModelMapLoaded = false;
      }
      if (produksi || kualitas) {
        // % Straightpass = (stroke - qty repair) / stroke -- butuh
        // production_log (stroke) MAUPUN repair_log (qty repair).
        this.qcStraightpassLoaded = false;
        this.qcFyLoadedKey = "";
      }
      this.refetchActiveTab();
    },
    async refetchActiveTab() {
      // PENTING: sengaja TIDAK memanggil destroyXCharts() di sini.
      // renderXCharts() sudah destroy+recreate tiap chart SATU-PER-SATU,
      // tepat saat data baru siap -- jadi transisinya halus. Kalau semua
      // chart di-destroy duluan di sini (sebelum data baru datang),
      // panelnya sempat kosong dulu baru terisi lagi -> itu yang bikin
      // "berkedip blank". fetchBulanan/fetchTahunan juga dipanggil dengan
      // {silent:true} supaya skeleton "Memuat data..." tidak muncul lagi
      // (konten lama tetap terlihat sampai data baru selesai diambil).
      if (this.activeTab === "bulanan") {
        await this.fetchBulanan({ silent: true });
        this.$nextTick(() => this.renderBulananCharts());
      } else if (this.activeTab === "tahunan") {
        await this.fetchTahunan({ silent: true });
        this.$nextTick(() => this.renderTahunanCharts());
      } else if (this.activeTab === "kualitas") {
        await this.loadKualitas({ silent: true });
      }
    },
    // Muat data tab Kontrol Kualitas, lalu gambar chart-nya SEKALI saja.
    // Riwayat: versi awal fetch 7x BERURUTAN lalu render di akhir (lama
    // kosong). Versi berikutnya render tiap kelompok data selesai -- cepat
    // tapi chart berganti 5-6x = "kedip". Sekarang dibuat seperti tab
    // Tahunan/Downtime:
    //   - Belum pernah ada data (buka pertama kali) atau ganti periode
    //     -> tampil skeleton shimmer di kotak chart, fetch PARALEL, lalu
    //        chart digambar SEKALI begitu semua data siap.
    //   - Balik ke tab ini (data lama masih di memori) -> chart LANGSUNG
    //     digambar dari memori, fetch ulang diam-diam di belakang, lalu
    //     digambar ulang SEKALI di akhir.
    //   - Refresh realtime -> chart yang tampil dibiarkan, digambar ulang
    //     SEKALI setelah data baru siap.
    // Token dipakai supaya kalau ada load yang lebih baru (klik cepat /
    // ganti bulan beruntun), load lama tidak ikut menggambar.
    // "Sidik jari" semua data yang dipakai chart Kontrol Kualitas (tanpa
    // detailRows tabel Rekap), untuk cek apakah chart perlu digambar ulang.
    qcChartSignature() {
      const skip = (k, v) => (k === "detailRows" ? undefined : v);
      const t = this.qcFy || {};
      return JSON.stringify([
        this.qcLineFilter, this.qcNgInline, this.qcNgTrial, this.qcRepair,
        this.qcStraightpass, this.qcLineMonthMap, this.qcLineModelMap,
        t.monthLabels, t.actual, t.repairQty,
      ], skip);
    },
    _qcRenderedSig: "",
    async loadKualitas(opts = {}) {
      const token = ++this._qcLoadToken;
      // Tanpa skeleton sama sekali: kalau chart belum ada di layar (buka
      // tab), langsung digambar pakai data yang ada di memori (hasil
      // prefetch / kunjungan sebelumnya), lalu diganti SEKALI di akhir
      // kalau datanya berubah. Kalau chart sudah tampil (ganti bulan /
      // realtime), chart lama dibiarkan sampai data baru siap.
      const useSkeleton = false;
      if (opts.instant || Object.keys(this.qcCharts).length === 0) {
        this.$nextTick(() => this.renderKualitasCharts());
      }
      try {
        await Promise.all([
          this.fetchQcFyStraightpass(),
          this.fetchQcNgInline(),
          this.fetchQcNgTrial(),
          this.fetchQcRepairDetail(),
          // Straightpass butuh this.qcRepair.perlineQty/permodelQty --
          // makanya tetap di-chain setelah Repair Perline/Model.
          this.fetchQcRepairPerlineModel().then(() => this.fetchQcStraightpassBreakdown()),
          this.fetchQcLineModelMap(),
        ]);
      } finally {
        if (token === this._qcLoadToken) {
          this.qcHasData = true;
          // Data baru PERSIS sama dengan yang sedang tampil (sering terjadi
          // saat balik ke tab / refresh realtime yang tidak mengubah angka
          // QC) -> chart tidak disentuh sama sekali.
          const unchanged = !useSkeleton
            && Object.keys(this.qcCharts).length > 0
            && this.qcChartSignature() === this._qcRenderedSig;
          if (unchanged) {
            this.qcChartsLoading = false;
          } else if (this.activeTab === "kualitas") {
            // Gambar dulu di bawah skeleton, baru skeleton dilepas --
            // jadi transisinya langsung dari shimmer ke chart jadi.
            this.$nextTick(() => {
              this.renderKualitasCharts();
              this.qcChartsLoading = false;
            });
          } else {
            this.qcChartsLoading = false;
          }
        }
      }
    },
    // -----------------------------------------------------------------
    // Ambil data Bulanan (HARIAN, tanggal 1-31) dari Supabase.
    //
    // !! PENTING -- RPC di bawah ini BELUM ADA di database dan perlu
    // dibuat lewat migration_dashboard_bulanan_harian.sql (lihat file
    // terpisah yang aku siapkan). Nama function/parameter di sini adalah
    // KONTRAK yang dipakai frontend -- kalau nama RPC di Supabase kamu
    // beda, tinggal samakan salah satu sisi (frontend atau SQL).
    //
    // RPC yang dipakai:
    //   dashboard_harian_produksi(p_start, p_end)
    //     -> per baris: { tanggal, wh_menit, target_std_menit, downtime_menit }
    //   dashboard_harian_downtime_by_pic(p_start, p_end)
    //     -> per baris: { pic, act_menit }               PIC: PE/MESIN/QC/PC-SUPP/PROD/PRESS
    //   dashboard_harian_downtime_by_line(p_start, p_end)
    //     -> per baris: { mesin, act_menit }              mesin: E-02..E-07
    //   dashboard_bulanan_weekly(p_start, p_end)          (RPC lama, dipakai ulang)
    //     -> per baris: { minggu_mulai, mesin, downtime_menit }
    //   dashboard_harian_top_problems(p_mesin, p_start, p_end, p_limit)
    //     -> per baris: { pic, problem, area, countermeasure, status, shift, total_menit }
    //   dashboard_bulanan_problem_detail_by_line(p_problem, p_start, p_end)  [BARU]
    //     -> per baris: { mesin, total_menit, frekuensi }   dipakai modal
    //        detail "Downtime Terbesar" (double-klik row Problem, tab
    //        Bulanan) -- lihat openProblemDetail(). Contoh SQL disiapkan
    //        terpisah, belum dibuat di Supabase.
    // -----------------------------------------------------------------
    async fetchBulanan(opts = {}) {
      if (this.bulananLoaded && this._bulananLoadedLine === this.dxyLineFilterBulanan) return;
      // silent=true dipakai oleh refresh realtime -- data tetap diambil ulang,
      // tapi TIDAK menampilkan skeleton "Memuat data..." (yang bikin seluruh
      // panel sempat blank/kedip karena x-if melepas-lalu-pasang ulang DOM).
      // Konten lama tetap tampil sampai data baru siap, baru diganti halus.
      // (skeleton dinonaktifkan: bulananLoading tidak di-set true lagi)
      try {
        const year = this.bulananYear;
        const month = this.bulananMonth; // 1-12
        const periodStart = new Date(year, month - 1, 1);
        const periodEnd = new Date(year, month, 1); // eksklusif, awal bulan berikutnya
        const nHari = daysInMonth(year, month);
        const dayLabels = Array.from({ length: nHari }, (_, i) => String(i + 1));

        // Line yang lagi dipilih di dropdown LINE tab Bulanan
        // (dxyLineFilterBulanan -- terpisah dari dxyLineFilter Tahunan) --
        // "ALL" = semua line digabung (perilaku lama), selain itu =
        // filter cuma 1 line itu saja. mesinFilter dikirim ke RPC yang
        // support p_mesin (Productivity/Availability/Downtime Harian,
        // Downtime Supporting, Downtime Terbesar sebulan). Untuk chart
        // "Downtime Line" (donut) & "Weekly" -- datanya TETAP semua
        // line, cuma line terpilih di-highlight di renderBulananCharts().
        const mesinFilter = this.dxyLineFilterBulanan !== "ALL" ? this.dxyLineFilterBulanan : null;

        // Range FY (Apr..Mar) yang MEMUAT bulan/tahun yang lagi dipilih di
        // tab Bulanan -- dipakai KHUSUS buat chart "Downtime Exhaust" (12
        // bulan), supaya bisa ikut filter Line (mesinFilter) yang sama
        // dengan chart-chart lain di tab ini. SENGAJA fetch terpisah dari
        // tab Tahunan (bukan pakai this.tahunan.downtimeExhaust) karena
        // filter Line-nya beda variabel (dxyLineFilterBulanan).
        const fyStartYear = month >= 4 ? year : year - 1;
        const fyStart = new Date(fyStartYear, 3, 1);
        const fyEnd = new Date(fyStartYear + 1, 3, 1);

        const prevFyStartBln = new Date(fyStartYear - 1, 3, 1);
        const [prodRes, picRes, lineRes, weeklyRes, topProblemSummaryRes, dtExhaustRes, dtExhaustPrevRes] = await Promise.all([
          supabaseClient.rpc("dashboard_harian_produksi", { p_start: periodStart.toISOString(), p_end: periodEnd.toISOString(), p_mesin: mesinFilter }),
          supabaseClient.rpc("dashboard_harian_downtime_by_pic", { p_start: periodStart.toISOString(), p_end: periodEnd.toISOString(), p_mesin: mesinFilter }),
          supabaseClient.rpc("dashboard_harian_downtime_by_line", { p_start: periodStart.toISOString(), p_end: periodEnd.toISOString() }),
          supabaseClient.rpc("dashboard_bulanan_weekly", { p_start: periodStart.toISOString(), p_end: periodEnd.toISOString() }),
          supabaseClient.rpc("dashboard_bulanan_top_problems_summary", { p_start: periodStart.toISOString(), p_end: periodEnd.toISOString(), p_limit: 10, p_mesin: mesinFilter }),
          supabaseClient.rpc("dashboard_harian_produksi", { p_start: fyStart.toISOString(), p_end: fyEnd.toISOString(), p_mesin: mesinFilter }),
          // FY SEBELUMNYA -- untuk garis pembanding per bulan di chart
          // Downtime Exhaust. Satu panggilan tambahan, ikut filter Line.
          supabaseClient.rpc("dashboard_harian_produksi", { p_start: prevFyStartBln.toISOString(), p_end: fyStart.toISOString(), p_mesin: mesinFilter }),
        ]);
        const prodRows = prodRes.data || [];
        const dayKeyStr = (day) => localDateStr(new Date(year, month - 1, day));
        const findRow = (rows, day) => rows.find((r) => r.tanggal === dayKeyStr(day));

        // ===== Productivity harian: DIAMBIL DARI INPUT MANUAL =====
        // Sumbernya tabel productivity_manual (diisi di Master Data > tab
        // Productivity), BUKAN lagi dihitung dari target_std_menit/wh_menit.
        // Rumusnya sama persis dengan yang tampil di form Master Data:
        //   Efficiency   = Total Earned / Total Operation
        //   Productivity = Efficiency / Koefisien tahun ybs * 100 (%)
        // Angkanya gabungan semua line, jadi TIDAK ikut filter Line.
        const pvLastDay = new Date(year, month, 0).getDate();
        const [pvManualRes, koefRes, tgRes] = await Promise.all([
          supabaseClient.from("productivity_manual").select("*")
            .gte("tanggal", localDateStr(new Date(year, month - 1, 1)))
            .lte("tanggal", localDateStr(new Date(year, month - 1, pvLastDay))),
          supabaseClient.from("koefisien_kawat").select("tahun,nilai"),
          supabaseClient.from("productivity_target").select("tahun,bulan,target"),
        ]);
        // Data manual tab Tahunan (Master Data > Dashboard FY). Kalau FY ini
        // diaktifkan di sana, SEMUA chart Tahunan memakai angka itu -- bukan
        // hasil hitungan RPC di atas. Dibungkus try/catch supaya dashboard
        // tetap jalan normal kalau migration_fy_override.sql belum dijalankan.
        let ovHead = null, ovBulan = [], ovKategori = [], ovPrev = null;
        try {
          const [hRes, bRes, kRes] = await Promise.all([
            supabaseClient.from("fy_override").select("*").eq("fy", fyStartYear).maybeSingle(),
            supabaseClient.from("fy_override_bulan").select("*").eq("fy", fyStartYear).order("bulan"),
            supabaseClient.from("fy_override_kategori").select("*").eq("fy", fyStartYear),
          ]);
          if (!hRes.error && hRes.data) {
            // Angka ringkasan FY SEBELUMNYA diisi tangan dan SELALU dipakai,
            // tidak peduli saklar "pakai data manual" menyala atau tidak --
            // saklar itu urusan angka 12 bulan, bukan kolom FY sebelumnya.
            ovPrev = hRes.data;
            if (hRes.data.aktif) {
              ovHead = hRes.data;
              ovBulan = bRes.data || [];
              ovKategori = kRes.data || [];
            }
          }
        } catch (e) { /* tabel belum ada -> pakai hitungan sistem seperti biasa */ }
        const pvManualRows = pvManualRes.data || [];
        const koefTahun = ((koefRes.data || []).find((r) => Number(r.tahun) === Number(year)) || {}).nilai;
        const PV_EARN = ["earned_massprod", "earned_semi_massprod", "earned_non_massprod"];
        const PV_OPER = ["operation_massprod", "operation_semi_massprod", "operation_non_massprod"];
        // Jumlah beberapa kolom dalam 1 baris; null kalau semuanya kosong
        // (hari yang belum diisi jangan jadi 0 -- biar titiknya bolong di chart).
        const pvSumCols = (row, cols) => {
          let s = 0, ada = false;
          for (const c of cols) {
            const v = row[c];
            if (v !== null && v !== undefined && Number.isFinite(Number(v))) { s += Number(v); ada = true; }
          }
          return ada ? s : null;
        };
        const productivityActual = dayLabels.map((_, i) => {
          const tgl = dayKeyStr(i + 1);
          const row = pvManualRows.find((r) => String(r.tanggal).slice(0, 10) === tgl);
          if (!row) return null;
          const e = pvSumCols(row, PV_EARN), o = pvSumCols(row, PV_OPER);
          if (e === null || !o || !koefTahun) return null;
          return Number((((e / o) / Number(koefTahun)) * 100).toFixed(1));
        });
        const availabilityActual = dayLabels.map((_, i) => {
          const row = findRow(prodRows, i + 1);
          if (!row || !row.wh_menit) return null;
          return Number((((row.wh_menit - row.downtime_menit) / row.wh_menit) * 100).toFixed(1));
        });
        const lastRow = [...prodRows].reverse().find((r) => r.wh_menit > 0) || null;
        // Nilai "terakhir" Productivity = hari terakhir yang sudah ada angkanya
        const productivityValue = [...productivityActual].reverse().find((v) => v !== null) ?? 0;
        const availabilityValue = lastRow ? Number((((lastRow.wh_menit - lastRow.downtime_menit) / lastRow.wh_menit) * 100).toFixed(1)) : 0;

        // Downtime harian 1-31 (menit)
        const downtimeHarianValues = dayLabels.map((_, i) => {
          const row = findRow(prodRows, i + 1);
          return row ? Math.round(Number(row.downtime_menit) || 0) : 0;
        });

        // Downtime Supporting (per PIC) & Downtime Line (per mesin) -- total sebulan
        const picRows = picRes.data || [];
        const lineRows = lineRes.data || [];
        const PIC_ORDER = ["PE", "MESIN", "DIES", "QC", "PC-SUPP", "PROD", "PRESS"];
        const downtimeSupporting = {
          labels: PIC_ORDER,
          act: PIC_ORDER.map((p) => { const r = picRows.find((x) => x.pic === p); return r ? Math.round(Number(r.act_menit)) : 0; }),
        };
        const downtimeLine = {
          labels: MACHINES.map((m) => m.key),
          act: MACHINES.map((m) => { const r = lineRows.find((x) => x.mesin === m.key); return r ? Math.round(Number(r.act_menit)) : 0; }),
        };

        // Weekly Breakdown (ISO week, Senin-Minggu) untuk bulan terpilih.
        // Selalu tampilkan semua minggu kalender di bulan ini, sampai Week 5,
        // supaya layout konsisten walau bulan tsb cuma punya 4 minggu.
        const weeklyRows = weeklyRes.data || [];
        const isoWeekStart = (d) => {
          const day = d.getDay(); // 0=Minggu .. 6=Sabtu
          const diffToMonday = (day + 6) % 7; // Senin = 0
          const ws = new Date(d);
          ws.setDate(d.getDate() - diffToMonday);
          ws.setHours(0, 0, 0, 0);
          return ws;
        };
        const weekStartSet = new Set();
        for (let d = new Date(periodStart); d < periodEnd; d.setDate(d.getDate() + 1)) {
          weekStartSet.add(localDateStr(isoWeekStart(d)));
        }
        const weekStarts = Array.from(weekStartSet).sort();
        const sumDowntime = (ws, m) => {
          const r = weeklyRows.find((x) => x.minggu_mulai === ws && x.mesin === m.key);
          return r ? Math.round(Number(r.downtime_menit)) : 0;
        };
        // Grid Weekly DIFIX 5 kolom (Week 1-5). Kalau bulan kalender ini
        // ternyata punya lebih dari 5 minggu (mis. tanggal 1 jatuh di hari
        // Sabtu sehingga sisa beberapa hari terakhir masuk ke minggu ke-6),
        // sisa minggu ke-5 dan seterusnya itu DIGABUNG jadi satu bucket
        // "Week 5" (dijumlahkan), bukan dibuat kolom ke-6.
        const weekStartsCapped = weekStarts.slice(0, 4); // Week 1-4 apa adanya
        const weekStartsMergedInto5 = weekStarts.slice(4); // Week 5 dst -> digabung
        const weekly = weekStartsCapped.map((ws) => ({
          labels: MACHINES.map((m) => m.key),
          values: MACHINES.map((m) => sumDowntime(ws, m)),
        }));
        if (weekStartsMergedInto5.length > 0) {
          weekly.push({
            labels: MACHINES.map((m) => m.key),
            values: MACHINES.map((m) => weekStartsMergedInto5.reduce((sum, ws) => sum + sumDowntime(ws, m), 0)),
          });
        }
        while (weekly.length < 5) weekly.push({ labels: MACHINES.map((m) => m.key), values: MACHINES.map(() => 0) });

        // Downtime Terbesar per line -- DEFAULT tampil SEBULAN PENUH
        // (persis pola "Rekap NG Inline" di tab Kontrol Kualitas). Kalau
        // user sudah pilih tanggal spesifik (bulananDowntimeUseDate true),
        // pakai rentang 1 hari itu saja. bulananDate tetap dijaga selalu
        // terisi (default hari ini / tanggal 1 bulan aktif) supaya kalau
        // date-picker dibuka, kalendernya langsung di bulan yang benar.
        if (!this.bulananDate) this.bulananDate = localDateStr(periodStart);
        let dtStart, dtEnd;
        if (this.bulananDowntimeUseDate) {
          dtStart = new Date(this.bulananDate + "T00:00:00");
          dtEnd = new Date(dtStart);
          dtEnd.setDate(dtEnd.getDate() + 1);
        } else {
          dtStart = periodStart;
          dtEnd = periodEnd;
        }
        const downtimeTerbesar = await this.fetchDowntimeTerbesarFor(dtStart, dtEnd);

        // Downtime Terbesar SEBULAN (digabung semua line, per Problem) --
        // untuk panel baru yang sejajar dengan tabel Downtime Line.
        const downtimeTerbesarBulan = ((topProblemSummaryRes && topProblemSummaryRes.data) || []).map((r) => ({
          problem: r.problem || "",
          menit: Math.round(Number(r.total_menit) || 0),
          frekuensi: Number(r.frekuensi) || 0,
        }));

        // Rata-rata Productivity & Availability (dari hari yg sudah ada data),
        // dan Total Downtime Harian (menit) sebulan -- ditampilkan di pojok
        // kanan atas masing-masing chart.
        const avgOf = (arr) => {
          const nums = arr.filter((v) => v !== null && v !== undefined);
          if (!nums.length) return 0;
          return Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1));
        };
        // Rata-rata Productivity SENGAJA tidak memakai avgOf(): dihitung dari
        // TOTAL sebulan (jumlah Earned sebulan / jumlah Operation sebulan),
        // sama persis dengan cara tab Tahunan menghitung angka per bulannya.
        // Kalau pakai rata-rata angka harian, hari dengan produksi kecil jadi
        // dianggap setara dengan hari besar -- angkanya beda dengan Tahunan.
        // Target Productivity bulan ini (dari Master Data). Kalau belum
        // diisi, tetap 100 seperti perilaku lama.
        const tgRow = (tgRes.data || []).find((r) => Number(r.tahun) === Number(year) && Number(r.bulan) === Number(month));
        const productivityTarget = tgRow && Number.isFinite(Number(tgRow.target)) ? Number(tgRow.target) : 100;
        const productivityAvg = (() => {
          let earned = 0, oper = 0, ada = false;
          for (const row of pvManualRows) {
            for (const c of PV_EARN) if (Number.isFinite(Number(row[c]))) { earned += Number(row[c]); ada = true; }
            for (const c of PV_OPER) if (Number.isFinite(Number(row[c]))) { oper += Number(row[c]); ada = true; }
          }
          if (!ada || !oper || !koefTahun) return 0;
          return Number((((earned / oper) / Number(koefTahun)) * 100).toFixed(1));
        })();
        const availabilityAvg = avgOf(availabilityActual);
        const downtimeHarianTotal = downtimeHarianValues.reduce((a, b) => a + b, 0);

        // Downtime Exhaust (12 bulan FY Apr..Mar) -- data & filter Line-nya
        // TERPISAH dari tab Tahunan, sengaja fetch ulang di sini (dtExhaustRes)
        // supaya ikut mesinFilter (dxyLineFilterBulanan), sama seperti
        // chart-chart lain di tab ini. Dipakai RPC HARIAN (dashboard_harian_
        // produksi) -- BUKAN dashboard_bulanan_produksi -- karena RPC bulanan
        // tidak mendukung parameter p_mesin (filter per-Line). Baris-baris
        // harian se-FY dijumlahkan sendiri per bulan di sini.
        const dtExhaustRows = (dtExhaustRes && dtExhaustRes.data) || [];
        const monthLabelId = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
        const fyMonths = [];
        for (let i = 0; i < 12; i++) fyMonths.push(new Date(fyStartYear, 3 + i, 1));
        const downtimeExhaust = {
          labels: fyMonths.map((d) => monthLabelId[d.getMonth()]),
          values: fyMonths.map((d) => {
            const y = d.getFullYear(), m = d.getMonth();
            const sum = dtExhaustRows
              .filter((r) => { const rd = new Date(r.tanggal + "T00:00:00"); return rd.getFullYear() === y && rd.getMonth() === m; })
              .reduce((a, r) => a + (Number(r.downtime_menit) || 0), 0);
            return Math.round(sum);
          }),
        };
        // Kalau FY ini memakai data manual (Master Data > Dashboard FY),
        // chart Downtime Exhaust di sini ikut memakai angka manual itu juga
        // -- supaya sama persis dengan tab Tahunan.
        //   Semua Line -> angka bulanan di fy_override_bulan
        //   1 Line     -> dijumlah dari fy_override_kategori (jenis 'line')
        let ovHeadBln = null;
        try {
          const { data: ovH } = await supabaseClient
            .from("fy_override").select("*").eq("fy", fyStartYear).maybeSingle();
          ovHeadBln = ovH || null;   // dipakai juga utk kolom FY sebelumnya
          if (ovH && ovH.aktif) {
            if (!mesinFilter) {
              const { data: ovB } = await supabaseClient
                .from("fy_override_bulan").select("bulan,downtime_exhaust_menit").eq("fy", fyStartYear);
              const peta = new Map((ovB || []).map((r) => [Number(r.bulan), r.downtime_exhaust_menit]));
              downtimeExhaust.values = fyMonths.map((_, i) => {
                const v = peta.get(i + 1);
                return v === null || v === undefined ? 0 : Math.round(Number(v));
              });
            } else {
              const { data: ovK } = await supabaseClient
                .from("fy_override_kategori").select("bulan,act_menit")
                .eq("fy", fyStartYear).eq("jenis", "line").eq("kode", mesinFilter);
              const peta = new Map();
              for (const r of ovK || []) peta.set(Number(r.bulan), (peta.get(Number(r.bulan)) || 0) + (Number(r.act_menit) || 0));
              downtimeExhaust.values = fyMonths.map((_, i) => Math.round(peta.get(i + 1) || 0));
            }
          }
        } catch (e) { /* tabel belum ada -> pakai angka sistem seperti biasa */ }

        // Dua kolom ringkasan "FY '25" & "FY '26" di paling kiri Downtime
        // Exhaust -- sama seperti di tab Tahunan. FY sebelumnya diisi tangan
        // di Master Data; FY berjalan = rata-rata menit per bulan.
        // Garis pembanding: downtime per bulan FY sebelumnya.
        const dtPrevRows = (dtExhaustPrevRes && dtExhaustPrevRes.data) || [];
        const dtPrevBulan = Array.from({ length: 12 }, (_, i) => {
          const d = new Date(fyStartYear - 1, 3 + i, 1);
          const y = d.getFullYear(), m = d.getMonth();
          const baris = dtPrevRows.filter((r) => {
            const rd = new Date(r.tanggal + "T00:00:00");
            return rd.getFullYear() === y && rd.getMonth() === m;
          });
          if (!baris.length) return null;
          return Math.round(baris.reduce((a, r) => a + (Number(r.downtime_menit) || 0), 0));
        });

        downtimeExhaust.labels = [
          fyTickLabel(fyStartYear - 1), fyTickLabel(fyStartYear), ...downtimeExhaust.labels,
        ];
        downtimeExhaust.values = [
          angkaManual(ovHeadBln && ovHeadBln.downtime_fy_prev_menit),
          rataBulanan(downtimeExhaust.values),
          ...downtimeExhaust.values,
        ];
        downtimeExhaust.prevValues = [null, null, ...dtPrevBulan];
        downtimeExhaust.prevLabel = "FY '" + String(fyStartYear - 1).slice(-2);

        this.bulanan = {
          dayLabels,
          productivity: { value: productivityValue, actual: productivityActual, target: productivityTarget, avg: productivityAvg },
          // Availability SENGAJA tanpa garis Target -- target: null
          availability: { value: availabilityValue, actual: availabilityActual, target: null, avg: availabilityAvg },
          downtimeHarian: { labels: dayLabels, values: downtimeHarianValues, total: downtimeHarianTotal },
          downtimeExhaust,
          downtimeSupporting,
          downtimeLine,
          weekly,
          downtimeTerbesar,
          downtimeTerbesarBulan,
        };
        this.bulananLoaded = true;
        this._bulananLoadedLine = this.dxyLineFilterBulanan;
      } catch (e) {
        console.error("Gagal mengambil data Bulanan (harian):", e);
      } finally {
        if (!opts.silent) this.bulananLoading = false;
      }
    },
    async fetchTahunan(opts = {}) {
      if (this.tahunanLoaded) return;
      // (skeleton dinonaktifkan: tahunanLoading tidak di-set true lagi)
      try {
        // Fiscal year: April -> Maret. Tahun mulai FY dipilih dari dropdown Tahunan.
        const fyStartYear = this.tahunanYear;
        const fyStart = new Date(fyStartYear, 3, 1);
        const fyEnd = new Date(fyStartYear + 1, 3, 1);
        const prevFyStart = new Date(fyStartYear - 1, 3, 1);

        const [prodRes, ngRes, planByPicRes, lineRes, repairMonthRes, pvManualRes, koefRes, tgRes] = await Promise.all([
          supabaseClient.rpc("dashboard_bulanan_produksi", { p_start: prevFyStart.toISOString(), p_end: fyEnd.toISOString() }),
          // NG Inline: DISAMAKAN dengan sumber data tab Kontrol Kualitas
          // (dashboard_qc_ng_month, p_type_ng = 'NG PRODUKSI') supaya
          // angkanya konsisten di kedua tab -- dulu pakai RPC lain
          // (dashboard_bulanan_ng_inline) yang datanya beda sendiri.
          supabaseClient.rpc("dashboard_qc_ng_month", { p_type_ng: "NG PRODUKSI", p_start: fyStart.toISOString(), p_end: fyEnd.toISOString() }),
          // Downtime Supporting: Plan/Target TETAP total pabrik (tidak ada
          // target per-Line di database) -- lihat dashboard_tahunan_downtime_plan_by_pic.
          // Actual-nya diambil terpisah per-Line di bawah (downtimeActPerLineRes).
          supabaseClient.rpc("dashboard_tahunan_downtime_plan_by_pic", { p_start: fyStart.toISOString(), p_end: fyEnd.toISOString() }),
          supabaseClient.rpc("dashboard_bulanan_downtime_by_line", { p_start: fyStart.toISOString(), p_end: fyEnd.toISOString() }),
          // Qty Repair per bulan (semua line) -- dipakai rumus % Straightpass
          // yang BARU: (Stroke - Qty Repair) / Stroke * 100. NG (ngRes di
          // atas) TIDAK dipakai lagi di rumus ini -- ngRes tetap dipakai
          // hanya untuk kartu "NG Inline" yang terpisah (tidak diubah).
          supabaseClient.rpc("dashboard_qc_repair_month", { p_start: prevFyStart.toISOString(), p_end: fyEnd.toISOString() }),
          // Productivity manual harian (Master Data > tab Productivity),
          // 1 FY penuh. Di chart Tahunan dijumlahkan per bulan dulu.
          supabaseClient.from("productivity_manual").select("*")
            .gte("tanggal", localDateStr(fyStart))
            .lt("tanggal", localDateStr(fyEnd)),
          supabaseClient.from("koefisien_kawat").select("tahun,nilai"),
          supabaseClient.from("productivity_target").select("tahun,bulan,target"),
        ]);
        // Data manual tab Tahunan (Master Data > Dashboard FY). Kalau FY ini
        // diaktifkan di sana, SEMUA chart Tahunan memakai angka itu -- bukan
        // hasil hitungan RPC di atas. Dibungkus try/catch supaya dashboard
        // tetap jalan normal kalau migration_fy_override.sql belum dijalankan.
        let ovHead = null, ovBulan = [], ovKategori = [], ovPrev = null;
        try {
          const [hRes, bRes, kRes] = await Promise.all([
            supabaseClient.from("fy_override").select("*").eq("fy", fyStartYear).maybeSingle(),
            supabaseClient.from("fy_override_bulan").select("*").eq("fy", fyStartYear).order("bulan"),
            supabaseClient.from("fy_override_kategori").select("*").eq("fy", fyStartYear),
          ]);
          if (!hRes.error && hRes.data) {
            // Angka ringkasan FY SEBELUMNYA diisi tangan dan SELALU dipakai,
            // tidak peduli saklar "pakai data manual" menyala atau tidak --
            // saklar itu urusan angka 12 bulan, bukan kolom FY sebelumnya.
            ovPrev = hRes.data;
            if (hRes.data.aktif) {
              ovHead = hRes.data;
              ovBulan = bRes.data || [];
              ovKategori = kRes.data || [];
            }
          }
        } catch (e) { /* tabel belum ada -> pakai hitungan sistem seperti biasa */ }
        // Downtime Terbesar: ikut 1 tahun fiskal yang dipilih (bukan bulan berjalan)
        const topRes = await Promise.all(MACHINES.map((m) =>
          supabaseClient.rpc("dashboard_bulanan_top_problems", { p_mesin: m.key, p_start: fyStart.toISOString(), p_end: fyEnd.toISOString(), p_limit: 5 })
        ));
        // NG Inline Terbesar & Repair Terbesar per Line: sama polanya seperti
        // topRes di atas (1 RPC per Line), supaya hasilnya bisa langsung
        // difilter per-Line di client (dxyLineFilter) tanpa refetch --
        // lihat dxyNgFlatTahunan()/dxyRepairFlatTahunan(). NG Inline pakai
        // type_ng "NG PRODUKSI" (sama seperti kartu NG Inline lain).
        const ngTopRes = await Promise.all(MACHINES.map((m) =>
          supabaseClient.rpc("dashboard_tahunan_ng_kategori_perline", { p_type_ng: "NG PRODUKSI", p_mesin: m.key, p_start: fyStart.toISOString(), p_end: fyEnd.toISOString(), p_limit: 5 })
        ));
        const repairTopRes = await Promise.all(MACHINES.map((m) =>
          supabaseClient.rpc("dashboard_tahunan_repair_kategori_perline", { p_mesin: m.key, p_start: fyStart.toISOString(), p_end: fyEnd.toISOString(), p_limit: 5 })
        ));
        // Downtime Supporting (Actual) per Line -- pola sama seperti topRes:
        // 1 RPC per Line, supaya chart Downtime Supporting bisa ikut Line
        // yang dipilih tanpa refetch (lihat dxyRebuildTahunanSeries()).
        const downtimeActPerLineRes = await Promise.all(MACHINES.map((m) =>
          supabaseClient.rpc("dashboard_tahunan_downtime_act_by_pic_perline", { p_mesin: m.key, p_start: fyStart.toISOString(), p_end: fyEnd.toISOString() })
        ));
        // Downtime Exhaust: SENGAJA memakai RPC HARIAN (dashboard_harian_produksi),
        // sumber yang PERSIS SAMA dengan chart Downtime Exhaust di tab Kontrol
        // Downtime -- supaya angkanya tidak beda antara dua tab. Diambil 1 RPC
        // per Line supaya bisa ikut filter Line tanpa refetch.
        // Panggilan pertama p_mesin = null: PERSIS seperti yang dilakukan tab
        // Kontrol Downtime waktu filter Line = "Semua Line", supaya angkanya
        // dijamin identik (bukan hasil menjumlah 6 Line sendiri).
        const dtExhaustAllRes = await supabaseClient.rpc("dashboard_harian_produksi",
          { p_start: fyStart.toISOString(), p_end: fyEnd.toISOString(), p_mesin: null });
        const dtExhaustPerLineRes = await Promise.all(MACHINES.map((m) =>
          supabaseClient.rpc("dashboard_harian_produksi", { p_start: fyStart.toISOString(), p_end: fyEnd.toISOString(), p_mesin: m.key })
        ));

        // Simpan semua data MENTAH (per bulan+mesin, atau per-line) supaya
        // bisa dihitung ulang tiap kali dxyLineFilter berubah TANPA refetch
        // ke Supabase -- lihat dxyRebuildTahunanSeries().
        this.tahunanRaw = {
          prodRows: prodRes.data || [],
          ngRows: ngRes.data || [],
          repairMonthRows: repairMonthRes.data || [],
          planByPic: planByPicRes.data || [],
          actByPicPerLine: MACHINES.map((m, idx) => ({ mesin: m.key, rows: (downtimeActPerLineRes[idx] && downtimeActPerLineRes[idx].data) || [] })),
          dtExhaustAll: (dtExhaustAllRes && dtExhaustAllRes.data) || [],
          dtExhaustPerLine: MACHINES.map((m, idx) => ({ mesin: m.key, rows: (dtExhaustPerLineRes[idx] && dtExhaustPerLineRes[idx].data) || [] })),
          lineRows: lineRes.data || [],
          // Productivity manual (Master Data > tab Productivity) + koefisien
          // per tahun. Dipakai chart Productivity di tab Tahunan: tiap bulan
          // dihitung dari TOTAL sebulan, bukan rata-rata angka harian.
          pvManualRows: pvManualRes.data || [],
          koefRows: koefRes.data || [],
          targetRows: tgRes.data || [],
          fyStartYear, fyStart, fyEnd, prevFyStart,
          ovHead, ovBulan, ovKategori, ovPrev,
        };

        // Downtime Terbesar per line -- selalu tampilkan 5 baris ke bawah,
        // baris kosong jadi placeholder kalau datanya belum sampai 5.
        const downtimeTerbesar = MACHINES.map((m, idx) => {
          const rows = ((topRes[idx] && topRes[idx].data) || []).map((r) => ({ pic: r.pic, problem: r.problem, value: Math.round(Number(r.total_menit)) }));
          const rowsPadded = [...rows];
          while (rowsPadded.length < 5) rowsPadded.push({ pic: "", problem: "", value: "" });
          return { mesin: m.key, rows, rowsPadded };
        });

        this.tahunan = {
          downtimeTerbesar,
          // NG Inline Terbesar per Line -- dari dashboard_tahunan_ng_kategori_perline
          // (ng_inline_log, type_ng = "NG PRODUKSI"). Struktur per-baris:
          // { mesin, rows: [{ kategori, qty, value }], rowsPadded }
          ngInlineTerbesar: MACHINES.map((m, idx) => {
            const rows = ((ngTopRes[idx] && ngTopRes[idx].data) || []).map((r) => ({
              kategori: r.ng_kategori, qty: Math.round(Number(r.qty)) || 0, value: Math.round(Number(r.value)) || 0,
            }));
            const rowsPadded = [...rows];
            while (rowsPadded.length < 5) rowsPadded.push({ kategori: "", qty: "", value: "" });
            return { mesin: m.key, rows, rowsPadded };
          }),
          // Repair Terbesar per Line -- dari dashboard_tahunan_repair_kategori_perline
          // (repair_log). Struktur per-baris: { mesin, rows: [{ kategori, qty }], rowsPadded }
          repairTerbesar: MACHINES.map((m, idx) => {
            const rows = ((repairTopRes[idx] && repairTopRes[idx].data) || []).map((r) => ({
              kategori: r.kategori_repair, qty: Math.round(Number(r.qty)) || 0,
            }));
            const rowsPadded = [...rows];
            while (rowsPadded.length < 5) rowsPadded.push({ kategori: "", qty: "" });
            return { mesin: m.key, rows, rowsPadded };
          }),
        };
        // Hitung Productivity/Availability/Straightpass/NG Inline/Downtime
        // Exhaust/Supporting/Line dari data mentah (this.tahunanRaw) sesuai
        // dxyLineFilter yang aktif sekarang. Fungsi ini yang dipanggil ULANG
        // (tanpa refetch) tiap kali dropdown Line di tab Tahunan diganti.
        this.dxyRebuildTahunanSeries();
        this.tahunanLoaded = true;
        this.computeTahunanInsights();
      } catch (e) {
        console.error("Gagal mengambil data Tahunan:", e);
      } finally {
        if (!opts.silent) this.tahunanLoading = false;
      }
    },
    // Hitung ulang semua series chart Tahunan (Productivity, Availability,
    // Straightpass, NG Inline total, Downtime Exhaust/Supporting/Line) dari
    // data mentah this.tahunanRaw, sesuai Line yang lagi difilter
    // (dxyLineFilter). Dipanggil sekali di akhir fetchTahunan(), dan
    // dipanggil ULANG tiap kali dropdown Line berubah -- tanpa refetch ke
    // Supabase, konsisten dengan gaya filter Tahunan yang sudah ada.
    dxyRebuildTahunanSeries() {
      const raw = this.tahunanRaw;
      if (!raw) return;
      const lineFilter = this.dxyLineFilter;
      const { fyStartYear, fyStart, fyEnd, prevFyStart } = raw;

      // Gabungkan rows-per-(bulan,mesin) jadi rows-per-bulan sesuai Line
      // yang dipilih. "ALL" -> dijumlah semua Line. Line tertentu -> ambil
      // baris Line itu saja. Generic: semua field numerik ikut dijumlah.
      const collapseByLine = (rows) => {
        const map = new Map();
        for (const r of rows) {
          if (lineFilter !== "ALL" && r.mesin !== lineFilter) continue;
          if (!map.has(r.bulan)) map.set(r.bulan, { bulan: r.bulan });
          const acc = map.get(r.bulan);
          for (const k of Object.keys(r)) {
            if (k === "bulan" || k === "mesin") continue;
            acc[k] = (acc[k] || 0) + (Number(r[k]) || 0);
          }
        }
        return Array.from(map.values());
      };

      const prodRows = collapseByLine(raw.prodRows);
      // ngRows sekarang dari dashboard_qc_ng_month (sama seperti Kontrol
      // Kualitas) -- datanya SUDAH total pabrik per bulan (tidak ada kolom
      // "mesin" per-Line), jadi TIDAK dilewatkan ke collapseByLine (kalau
      // dilewatkan, saat Line filter dipilih baris ini malah kosong sama
      // sekali). Konsekuensinya: kartu NG Inline di tab Tahunan sekarang
      // selalu menampilkan total semua Line, tidak ikut filter Line lagi
      // -- ini disengaja demi angka yang konsisten dengan Kontrol Kualitas.
      const ngRows = raw.ngRows;
      const repairMonthRows = collapseByLine(raw.repairMonthRows);
      const monthKeyStr = (d) => localDateStr(d);

      // 12 bulan FY berjalan (Apr..Mar)
      const fyMonths = [];
      for (let i = 0; i < 12; i++) fyMonths.push(new Date(fyStartYear, 3 + i, 1));
      // 12 bulan FY sebelumnya -- dipakai garis pembanding Downtime Exhaust.
      const prevFyMonthsDt = [];
      for (let i = 0; i < 12; i++) prevFyMonthsDt.push(new Date(fyStartYear - 1, 3 + i, 1));
      const monthLabelId = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];

      // Rata-rata sederhana: jumlah angka bulanan dibagi JUMLAH BULAN YANG
      // ADA ANGKANYA. Bulan yang belum berjalan / belum diisi tidak ikut
      // membagi, jadi angkanya tidak ikut turun gara-gara bulan kosong.
      const rataRata = (arr) => {
        const v = (arr || []).filter((x) => x !== null && x !== undefined && Number.isFinite(Number(x)));
        if (!v.length) return null;
        return Number((v.reduce((a, b) => a + Number(b), 0) / v.length).toFixed(1));
      };
      // Untuk yang satuannya JUMLAH (NG, Qty Repair, Downtime), kolom FY
      // diisi RATA-RATA PER BULAN, bukan total setahun. Kalau total, angkanya
      // dua belas kali lipat angka bulanan di sebelahnya -- batang bulanannya
      // tergencet jadi garis tipis dan tidak terbaca lagi.
      // Bulan yang belum berjalan (kosong / nol) tidak ikut membagi.
      const rataPerBulan = (arr) => {
        const v = (arr || []).filter((x) => x !== null && x !== undefined && Number.isFinite(Number(x)) && Number(x) !== 0);
        return v.length ? Math.round(v.reduce((a, b) => a + Number(b), 0) / v.length) : null;
      };

      const findRow = (rows, d) => rows.find((r) => r.bulan === monthKeyStr(d));
      const sumInRange = (rows, start, end, field) =>
        rows.filter((r) => { const rd = new Date(r.bulan + "T00:00:00"); return rd >= start && rd < end; })
            .reduce((a, r) => a + (Number(r[field]) || 0), 0);

      // ===== Productivity per bulan: DARI INPUT MANUAL =====
      // Tiap bulan dihitung dari TOTAL sebulan (jumlah Earned sebulan dibagi
      // jumlah Operation sebulan), BUKAN rata-rata angka harian -- supaya
      // hari dengan produksi besar tidak dianggap setara dengan hari kecil.
      //   Productivity = (Total Earned / Total Operation) / Koefisien * 100
      // Koefisien diambil sesuai TAHUN KALENDER bulan itu (FY Apr..Mar
      // melintasi 2 tahun, jadi Jan-Mar pakai koefisien tahun berikutnya).
      // Angka manual ini gabungan semua line -> tidak ikut filter Line.
      const PV_EARN = ["earned_massprod", "earned_semi_massprod", "earned_non_massprod"];
      const PV_OPER = ["operation_massprod", "operation_semi_massprod", "operation_non_massprod"];
      const pvManualRows = raw.pvManualRows || [];
      const koefRows = raw.koefRows || [];
      const koefFor = (th) => {
        const r = koefRows.find((x) => Number(x.tahun) === Number(th));
        return r && Number.isFinite(Number(r.nilai)) ? Number(r.nilai) : null;
      };
      // Dibuat jadi fungsi supaya rumus yang SAMA PERSIS bisa dipakai untuk
      // FY berjalan dan FY sebelumnya -- bukan disalin dua kali.
      const hitungProductivity = (months) => months.map((d) => {
        const y = d.getFullYear(), m = d.getMonth() + 1;
        let earned = 0, oper = 0, ada = false;
        for (const row of pvManualRows) {
          const t = String(row.tanggal).slice(0, 10);
          if (Number(t.slice(0, 4)) !== y || Number(t.slice(5, 7)) !== m) continue;
          for (const c of PV_EARN) if (Number.isFinite(Number(row[c]))) { earned += Number(row[c]); ada = true; }
          for (const c of PV_OPER) if (Number.isFinite(Number(row[c]))) { oper += Number(row[c]); ada = true; }
        }
        const k = koefFor(y);
        if (!ada || !oper || !k) return null;
        return Number((((earned / oper) / k) * 100).toFixed(1));
      });
      const productivityActual = hitungProductivity(fyMonths);
      // Garis Target Productivity, diambil dari tabel productivity_target
      // (diisi di Master Data > Productivity > Target Productivity Bulanan).
      // Tiap bulan punya angkanya sendiri, jadi garisnya bertangga -- bukan
      // satu garis datar. Bulan yang belum diisi memakai 100.
      const targetRows = raw.targetRows || [];
      const productivityTarget = fyMonths.map((d) => {
        const r = targetRows.find((x) => Number(x.tahun) === d.getFullYear() && Number(x.bulan) === d.getMonth() + 1);
        return r && Number.isFinite(Number(r.target)) ? Number(r.target) : 100;
      });
      const availabilityActual = fyMonths.map((d) => {
        const row = findRow(prodRows, d);
        if (!row || !row.wh_menit) return null;
        return Number((((row.wh_menit - row.downtime_menit) / row.wh_menit) * 100).toFixed(1));
      });
      // % Straightpass = (Stroke - Qty Repair) / Stroke * 100 -- rumus
      // BARU, NG tidak dipakai lagi di sini sama sekali.
      const straightpassActual = fyMonths.map((d) => {
        const row = findRow(prodRows, d);
        const repairRow = findRow(repairMonthRows, d);
        if (!row || !row.stroke) return null;
        const repairQty = repairRow ? Number(repairRow.qty) || 0 : 0;
        return Number((((row.stroke - repairQty) / row.stroke) * 100).toFixed(1));
      });
      const straightpassQty = fyMonths.map((d) => {
        const row = findRow(prodRows, d);
        return row ? Number(row.stroke) : null;
      });
      // Qty Repair per bulan (BUKAN stroke) -- dipakai buat bar chart
      // utama Straight Pass, disamakan gaya sama chart Perline/Model:
      // bar Qty Repair (kiri) + garis % Straightpass (kanan) + garis
      // Target putus-putus.
      const straightpassRepairQty = fyMonths.map((d) => {
        const repairRow = findRow(repairMonthRows, d);
        return repairRow ? Number(repairRow.qty) || 0 : null;
      });

      // Bulan berjalan (bulan terakhir yang ada datanya)
      const lastRow = [...prodRows].reverse().find((r) => r.wh_menit > 0) || null;
      const lastNgRow = ngRows.length ? ngRows[ngRows.length - 1] : null;
      const lastRepairMonthRow = repairMonthRows.length ? repairMonthRows[repairMonthRows.length - 1] : null;
      // Nilai "terakhir" Productivity = bulan terakhir yang sudah ada angkanya
      const productivityValue = [...productivityActual].reverse().find((v) => v !== null) ?? 0;
      const availabilityValue = lastRow ? Number((((lastRow.wh_menit - lastRow.downtime_menit) / lastRow.wh_menit) * 100).toFixed(1)) : 0;
      const straightpassValue = lastRow && lastRow.stroke
        ? Number((((lastRow.stroke - (lastRepairMonthRow ? Number(lastRepairMonthRow.qty) || 0 : 0)) / lastRow.stroke) * 100).toFixed(1))
        : 0;

      // Downtime Exhaust: FY-1, FY, lalu 12 bulan Apr..Mar
      // Dropdown menulis "FY 2026" untuk Apr 2026..Mar 2027, jadi dua kolom
      // ringkasan ini ikut patokan yang sama: FY sebelumnya lalu FY berjalan.
      // Ditulis sebagai ARRAY ["FY", "2025"] supaya Chart.js memecahnya jadi
      // DUA BARIS -- kalau satu baris, "FY 2025" dan "FY 2026" saling
      // bersentuhan dengan "Apr" di kartu yang sempit.
      // Tahunnya dipendekkan jadi dua angka ("'25"). Di kartu NG Inline &
      // Straight Pass yang punya sumbu kiri DAN kanan, ruang per kolom
      // tinggal sedikit -- "2025" dan "2026" masih saling bersentuhan.
      const fyTick = (th) => ["FY", "'" + String(th).slice(-2)];
      const dtExhaustLabels = [
        fyTick(fyStartYear - 1),
        fyTick(fyStartYear),
        ...fyMonths.map((d) => monthLabelId[d.getMonth()]),
      ];
      // Dijumlah dari baris HARIAN (dashboard_harian_produksi) -- sumber yang
      // sama dengan tab Kontrol Downtime, supaya angkanya tidak beda.
      const dtRowsFilter = lineFilter === "ALL"
        ? (raw.dtExhaustAll || [])
        : (((raw.dtExhaustPerLine || []).find((x) => x.mesin === lineFilter) || { rows: [] }).rows);
      const dtExhaustBulan = fyMonths.map((d) => {
        const y = d.getFullYear(), m = d.getMonth();
        const sum = dtRowsFilter
          .filter((r) => { const rd = new Date(r.tanggal + "T00:00:00"); return rd.getFullYear() === y && rd.getMonth() === m; })
          .reduce((a, r) => a + (Number(r.downtime_menit) || 0), 0);
        return Math.round(sum);
      });
      // Downtime per bulan FY SEBELUMNYA -- untuk garis pembanding.
      // Diambil dari prodRows (dashboard_bulanan_produksi) yang memang sudah
      // mencakup DUA tahun fiskal, jadi tidak perlu query tambahan. prodRows
      // juga sudah ikut filter Line lewat collapseByLine di atas.
      const dtExhaustBulanPrev = prevFyMonthsDt.map((d) => {
        const row = findRow(prodRows, d);
        return row && row.downtime_menit !== null && row.downtime_menit !== undefined
          ? Math.round(Number(row.downtime_menit)) : null;
      });

      // Dua kolom ringkasan = RATA-RATA MENIT PER BULAN (bukan total setahun),
      // supaya sejajar dengan batang bulanan di sebelahnya.
      const dtExhaustValues = [
        // FY sebelumnya: pakai angka yang diketik di Master Data kalau ada.
        (() => {
          const m = (raw.ovPrev && raw.ovPrev.downtime_fy_prev_menit);
          if (m !== null && m !== undefined && m !== "" && Number.isFinite(Number(m))) return Math.round(Number(m));
          return null;
        })(),
        rataPerBulan(dtExhaustBulan),
        ...dtExhaustBulan,
      ];

      // Downtime Supporting (by PIC): Plan/Target TETAP total pabrik (tidak
      // ikut filter Line, karena tidak ada target per-Line di database).
      // Actual dijumlah dari Line yang lagi dipilih saja (atau semua Line
      // kalau dxyLineFilter === "ALL").
      const PIC_ORDER = ["PE", "MESIN", "DIES", "QC", "PC-SUPP", "PROD", "PRESS"];
      const actRowsForFilter = lineFilter === "ALL"
        ? raw.actByPicPerLine.flatMap((x) => x.rows)
        : ((raw.actByPicPerLine.find((x) => x.mesin === lineFilter) || { rows: [] }).rows);
      const actByPic = new Map();
      for (const r of actRowsForFilter) actByPic.set(r.pic, (actByPic.get(r.pic) || 0) + (Number(r.act_menit) || 0));
      const downtimeSupporting = {
        labels: PIC_ORDER,
        plan: PIC_ORDER.map((p) => { const r = raw.planByPic.find((x) => x.pic === p); return r ? Math.round(Number(r.plan_menit)) : 0; }),
        act: PIC_ORDER.map((p) => Math.round(actByPic.get(p) || 0)),
      };

      // Downtime Line: sudah per-Line dari sononya (dashboard_bulanan_downtime_by_line).
      // Datanya TETAP semua Line (tidak dipotong) -- kalau 1 Line dipilih,
      // Line itu di-highlight full warna & Line lain di-dim (lihat logic
      // highlight di renderTahunanCharts -> dxyDowntimeLine), PERSIS pola
      // yang sama seperti tab Bulanan.
      const lineKeys = MACHINES.map((m) => m.key);
      const downtimeLine = {
        labels: lineKeys,
        plan: lineKeys.map((k) => { const r = raw.lineRows.find((x) => x.mesin === k); return r ? Math.round(Number(r.plan_menit)) : 0; }),
        act: lineKeys.map((k) => { const r = raw.lineRows.find((x) => x.mesin === k); return r ? Math.round(Number(r.act_menit)) : 0; }),
      };

      // ---- Dua kolom ringkasan di paling kiri: FY sebelumnya & FY berjalan ----
      // FY SEBELUMNYA diisi tangan di Master Data > Dashboard FY. Kalau
      // belum diisi, kolomnya dibiarkan KOSONG (bukan nol) supaya tidak
      // terbaca sebagai "hasilnya nol".
      // FY BERJALAN dihitung dari 12 bulan di sebelah kanannya: rata-rata
      // untuk yang satuannya persen, total untuk yang satuannya jumlah.
      const ovp = raw.ovPrev || {};
      const angkaOv = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
      const ngQtyBulan = fyMonths.map((d) => { const r = findRow(ngRows, d); return r ? Number(r.qty) : null; });
      const ngValBulan = fyMonths.map((d) => { const r = findRow(ngRows, d); return r ? Number(r.value) : null; });

      const hasil = {
        ...this.tahunan,
        monthLabels: dtExhaustLabels,
        productivity: {
          value: productivityValue,
          actual: [angkaOv(ovp.productivity_fy_prev), rataRata(productivityActual), ...productivityActual],
          target: [null, null, ...productivityTarget],
        },
        // Availability SENGAJA tanpa garis Target -- target: null
        availability: {
          value: availabilityValue,
          actual: [angkaOv(ovp.availability_fy_prev), rataRata(availabilityActual), ...availabilityActual],
          target: null,
        },
        ngInline: {
          qty: lastNgRow ? Number(lastNgRow.qty) : 0,
          value: lastNgRow ? Number(lastNgRow.value) : 0,
          qtyByMonth: [angkaOv(ovp.ng_qty_fy_prev), rataPerBulan(ngQtyBulan), ...ngQtyBulan],
          valueByMonth: [angkaOv(ovp.ng_value_fy_prev), rataPerBulan(ngValBulan), ...ngValBulan],
        },
        straightpass: {
          value: straightpassValue,
          actual: [angkaOv(ovp.sp_fy_prev), rataRata(straightpassActual), ...straightpassActual],
          qty: [null, rataPerBulan(straightpassQty), ...straightpassQty],
          repairQty: [angkaOv(ovp.sp_repair_fy_prev), rataPerBulan(straightpassRepairQty), ...straightpassRepairQty],
          target: 95,
        },
        downtimeExhaust: {
          labels: dtExhaustLabels,
          values: dtExhaustValues,
          // Garis pembanding FY sebelumnya. Dua slot pertama kosong karena
          // itu kolom ringkasan, bukan bulan.
          prevValues: [null, null, ...dtExhaustBulanPrev],
          prevLabel: "FY '" + String(fyStartYear - 1).slice(-2),
        },
        downtimeSupporting,
        downtimeLine,
      };

      // ===== Data manual dari Master Data > Dashboard FY =====
      // Kalau FY ini diaktifkan di sana, SEMUA chart Tahunan memakai angka
      // yang diketik manual -- semua hitungan di atas diabaikan. Dipakai
      // untuk FY lama yang angka sistemnya tidak sama dengan laporan.
      // Angka manual = total pabrik, jadi tidak ikut filter Line.
      const ov = raw.ovHead;
      if (ov) {
        const angka = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
        const byBulan = new Map((raw.ovBulan || []).map((r) => [Number(r.bulan), r]));
        // bulan 1 = April ... 12 = Maret, urutannya sama dengan fyMonths
        const kolom = (nama) => Array.from({ length: 12 }, (_, i) => {
          const r = byBulan.get(i + 1);
          return r ? angka(r[nama]) : null;
        });
        const terakhir = (arr) => [...arr].reverse().find((v) => v !== null) ?? 0;
        // Supporting & Line diisi PER BULAN -> angka di chart Tahunan
        // adalah JUMLAH 12 bulan.
        // Supporting juga punya rincian per Line: kalau filter Line aktif,
        // yang dipakai baris Line itu; kalau "Semua Line", yang dipakai
        // baris 'ALL' (total pabrik). Downtime Line selalu 'ALL'.
        const katVal = (jenis, kode, field, mesin) => {
          const m = mesin || "ALL";
          const total = (raw.ovKategori || [])
            .filter((x) => x.jenis === jenis && x.kode === kode && (x.mesin || "ALL") === m)
            .reduce((a, x) => a + (Number(x[field]) || 0), 0);
          return Math.round(total);
        };
        const mesinSupp = lineFilter === "ALL" ? "ALL" : lineFilter;

        const pAct = kolom("productivity_actual");
        const pTgt = kolom("productivity_target").map((v) => (v === null ? 100 : v));
        const aAct = kolom("availability_actual");
        const ngQ = kolom("ng_qty"), ngV = kolom("ng_value");
        const spA = kolom("sp_actual"), spQ = kolom("sp_qty"), spR = kolom("sp_repair_qty");
        const dtE = kolom("downtime_exhaust_menit");
        const fyTotal = dtE.reduce((a, v) => a + (v || 0), 0);

        hasil.productivity = { value: terakhir(pAct), actual: [null, null, ...pAct], target: [null, null, ...pTgt] };
        hasil.availability = { value: terakhir(aAct), actual: [null, null, ...aAct], target: null };
        hasil.ngInline = {
          qty: terakhir(ngQ), value: terakhir(ngV),
          qtyByMonth: [null, null, ...ngQ], valueByMonth: [null, null, ...ngV],
        };
        hasil.straightpass = {
          value: terakhir(spA), actual: [null, null, ...spA],
          qty: [null, null, ...spQ], repairQty: [null, null, ...spR], target: 95,
        };
        // Filter Line aktif -> pakai angka per Line (fy_override_kategori,
        // jenis 'line'), sama seperti tab Kontrol Downtime. "Semua Line" ->
        // pakai angka bulanan total pabrik.
        const dtBulanOv = lineFilter === "ALL"
          ? dtE.map((v) => (v === null ? 0 : Math.round(v)))
          : Array.from({ length: 12 }, (_, i) => {
              const r = (raw.ovKategori || []).find((x) =>
                x.jenis === "line" && x.kode === lineFilter &&
                Number(x.bulan) === i + 1 && (x.mesin || "ALL") === "ALL");
              return r && r.act_menit !== null && r.act_menit !== undefined ? Math.round(Number(r.act_menit)) : 0;
            });
        hasil.downtimeExhaust = {
          labels: dtExhaustLabels,
          values: [
            Math.round(Number(ov.downtime_fy_prev_menit) || 0),
            dtBulanOv.reduce((a, v) => a + v, 0),
            ...dtBulanOv,
          ],
        };
        hasil.downtimeSupporting = {
          labels: PIC_ORDER,
          plan: PIC_ORDER.map((p) => katVal("supporting", p, "plan_menit", mesinSupp)),
          act: PIC_ORDER.map((p) => katVal("supporting", p, "act_menit", mesinSupp)),
        };
        // Downtime Line SENGAJA tidak ikut filter -- semua Line tetap
        // tampil, Line yang dipilih cuma di-highlight (sama seperti
        // perilaku FY yang memakai data sistem).
        hasil.downtimeLine = {
          labels: lineKeys,
          plan: lineKeys.map((k) => katVal("line", k, "plan_menit", "ALL")),
          act: lineKeys.map((k) => katVal("line", k, "act_menit", "ALL")),
        };
      }

      this.tahunan = hasil;
    },
    // ---- Helper baru khusus redesign Tahunan (Smart Narrative) ----
    // Semua fungsi di bawah ini murni presentasi: membaca this.tahunan yang
    // sudah di-fetch, tidak melakukan query/RPC baru sama sekali.
    // true = chart Downtime Supporting kosong KARENA rincian per Line
    // pada FY yang memakai data manual belum diisi (bukan karena error).
    dxySuppKosong() {
      const t = this.tahunan || {};
      const s = t.downtimeSupporting;
      if (!s || !Array.isArray(s.act)) return false;
      if (this.dxyLineFilter === "ALL") return false;
      if (!(this.tahunanRaw && this.tahunanRaw.ovHead)) return false;   // FY data sistem -> bukan urusan ini
      return !s.act.some((v) => Number(v) > 0);
    },
    dxyPicColor(pic) {
      // DIES = #0891B2 (cyan). Dipilih lewat validator warna: jarak
      // terdekatnya ke 6 warna lain 12,1 (buta warna) & 12,4 (mata normal)
      // -- kandidat pink/amber gagal karena terlalu dekat ke PC-SUPP/PRESS.
      const map = { PE: "#2563EB", MESIN: "#F97316", DIES: "#0891B2", QC: "#8B5CF6", PROD: "#10B981", PRESS: "#EF4444", "PC-SUPP": "#14B8A6" };
      return map[pic] || "#6B7280";
    },
    // Status downtime terbesar: OPEN (merah) / PROGRESS (kuning) / CLOSE (hijau)
    dxyStatusClass(status) {
      const s = String(status || "").toUpperCase();
      if (s.includes("OPEN")) return "dxy-status-open";
      if (s.includes("PROG")) return "dxy-status-progress";
      if (s.includes("CLOSE") || s.includes("DONE")) return "dxy-status-closed";
      if (s.includes("BELUM")) return "dxy-status-empty";        // belum di-follow up
      if (s.includes("CORRECTIVE")) return "dxy-status-action";  // sudah ada tindakan
      return "dxy-status-progress";
    },
    // Lapisan tampilan saja: gabungkan rows semua line jadi 1 daftar rata,
    // lalu pad minimal 8 baris (default kosong). Kalau data asli lebih dari
    // 8 baris, semua tetap ditampilkan (tidak dipotong) -- scroll otomatis
    // muncul dari .dxy-table-scroll. Tidak ada logika/RPC data yang diubah.
    // Data mentah (rata, belum di-pad/filter kolom) untuk tabel "Downtime
    // Line" di tab Bulanan -- dipakai sekaligus oleh bulananDowntimeMergedRows()
    // dan sebagai sumber nilai unik dropdown filter (qcRawRowsFor).
    dxyDowntimeFlatBulanan() {
      const flat = [];
      (this.bulanan.downtimeTerbesar || []).forEach((line) => {
        // Status dirapikan DI SINI (bukan cuma di tampilan) supaya filter
        // kolom Status juga ikut rapi: "(kosong)"/kosong -> "Belum diisi",
        // "Correction Action" disatukan jadi "Corrective Action".
        (line.rows || []).forEach((row) => flat.push({ mesin: line.mesin, ...row, status: this.dxyNormalizeStatus(row.status) }));
      });
      return flat;
    },
    // Rata-rata vs Target (header Productivity tab Kontrol Downtime):
    // hijau + ▲ kalau rata-rata >= target, merah + ▼ kalau di bawah target,
    // warna biasa kalau belum ada data / target tidak diset.
    dxyAvgVsTargetState(avg, target) {
      const a = Number(avg), t = Number(target);
      if (!a || !t || Number.isNaN(a) || Number.isNaN(t)) return "none";
      return a >= t ? "up" : "down";
    },
    dxyAvgVsTargetColor(avg, target) {
      const st = this.dxyAvgVsTargetState(avg, target);
      return st === "up" ? "#059669" : st === "down" ? "#DC2626" : "var(--dxy-text)";
    },
    dxyAvgVsTargetText(avg, target) {
      const st = this.dxyAvgVsTargetState(avg, target);
      const icon = st === "up" ? "▲ " : st === "down" ? "▼ " : "";
      return icon + "Rata-rata " + fmtNum(avg) + "%";
    },
    // Rapikan teks Status downtime (lapisan tampilan, data asli di DB
    // tidak diubah).
    dxyNormalizeStatus(status) {
      const raw = String(status ?? "").trim();
      const key = raw.toLowerCase().replace(/[()\-]/g, "").replace(/\s+/g, " ").trim();
      if (!key || key === "kosong") return "Belum diisi";
      if (/^correct(ive|ion) action$/.test(key)) return "Corrective Action";
      return raw;
    },
    bulananDowntimeMergedRows() {
      const flat = this.qcApplyColFilters("bulananDowntime", this.dxyDowntimeFlatBulanan());
      const out = flat.slice();
      while (out.length < 10) {
        out.push({ mesin: "", pic: "", problem: "", area: "", countermeasure: "", status: "", shift: "", menit: "" });
      }
      return out;
    },
    // Panel "Downtime Terbesar" (sebulan, per Problem) -- sejajar Downtime
    // Line. Datanya sudah diurutkan terbesar->kecil oleh RPC, di sini
    // cuma diterapkan filter kolom (kalau ada) lalu di-pad.
    bulananDowntimeTerbesarBulanRows() {
      const flat = this.qcApplyColFilters("bulananTopProblem", this.bulanan.downtimeTerbesarBulan || []);
      return this.dxyPadMin(flat, { problem: "", menit: "", frekuensi: "" }, 10);
    },
    // Double-klik salah satu row di tabel "Downtime Terbesar" (rekap
    // sebulan, per Problem, semua line digabung) -> buka popup kecil
    // (floating, nempel di ATAS panel "Downtime Terbesar" -- lihat
    // positionProblemDetail()) berisi breakdown problem itu per Line
    // untuk bulan/tahun yang lagi aktif di tab Bulanan. RPC
    // "dashboard_bulanan_problem_detail_by_line" perlu ada di Supabase.
    async openProblemDetail(problem) {
      this.dxyProblemDetail = { open: true, loading: true, problem, rows: [] };
      this.$nextTick(() => this.positionProblemDetail());
      try {
        const periodStart = new Date(this.bulananYear, this.bulananMonth - 1, 1);
        const periodEnd = new Date(this.bulananYear, this.bulananMonth, 1); // eksklusif
        const { data, error } = await supabaseClient.rpc("dashboard_bulanan_problem_detail_by_line", {
          p_problem: problem,
          p_start: periodStart.toISOString(),
          p_end: periodEnd.toISOString(),
        });
        if (error) throw error;
        const rows = (data || [])
          .map((r) => ({ mesin: r.mesin || "", menit: Math.round(Number(r.total_menit) || 0), frekuensi: Number(r.frekuensi) || 0 }))
          .sort((a, b) => b.menit - a.menit);
        this.dxyProblemDetail = { open: true, loading: false, problem, rows };
      } catch (e) {
        console.error("Gagal mengambil detail Downtime per Line:", e);
        this.dxyProblemDetail = { open: true, loading: false, problem, rows: [] };
      }
      // Tinggi popup berubah setelah data selesai dimuat (loading -> rows) --
      // hitung ulang posisi supaya tetap nempel rapi di atas panel.
      this.$nextTick(() => this.positionProblemDetail());
    },
    // Hitung posisi popup (fixed top/left) supaya nempel di ATAS panel
    // "Downtime Terbesar" (x-ref="bulananTopProblemPanel"). Pola sama
    // seperti qcToggleFilterDropdown(): kalau ruang di atas nggak cukup,
    // popup turun ke bawah panel supaya tidak kepotong ujung layar.
    positionProblemDetail() {
      const panel = this.$refs.bulananTopProblemPanel;
      const box = this.$refs.dxyProblemDetailBox;
      if (!panel || !box) return;
      const rect = panel.getBoundingClientRect();
      const boxHeight = box.offsetHeight || 220;
      const boxWidth = box.offsetWidth || 260;
      let top = rect.top - boxHeight - 8;
      if (top < 8) top = Math.min(rect.bottom + 8, window.innerHeight - boxHeight - 8);
      let left = rect.left;
      if (left + boxWidth > window.innerWidth - 8) left = window.innerWidth - boxWidth - 8;
      if (left < 8) left = 8;
      this.dxyProblemDetailPos = { top, left };
    },
    closeProblemDetail() {
      this.dxyProblemDetail = { open: false, loading: false, problem: "", rows: [] };
    },
    // Dipanggil saat dropdown Bulan/Tahun di tab Kontrol Attendance berubah.
    // Kalau lagi di tampilan Tahunan, dropdown "Tahun" gerakkan Grafik
    // Rekap Tahunan (FY), bukan chart Bulanan.
    async onAttendancePeriodChange() {
      if (this.attendanceViewMode === "tahunan") {
        await this.fetchAttendanceTahunan();
        this.$nextTick(() => this.renderAttendanceTahunanChart());
        return;
      }
      await this.fetchAttendance();
      this.$nextTick(() => this.renderAttendanceCharts());
    },
    // Toggle Bulanan/Tahunan di tab Kontrol Attendance. Balik ke Bulanan
    // dari Tahunan perlu render ulang chart karena canvas-nya sempat
    // di-unmount (x-show tetap ada di DOM sebenarnya, jadi canvas TIDAK
    // di-unmount -- tapi tetap re-render untuk jaga-jaga ukurannya benar
    // setelah container disembunyikan/dimunculkan lagi). Pindah ke Tahunan
    // fetch data FY (kalau belum ada/tahunnya beda) baru render.
    async setAttendanceViewMode(mode) {
      if (this.attendanceViewMode === mode) return;
      this.attendanceViewMode = mode;
      if (mode === "bulanan") {
        this.$nextTick(() => this.renderAttendanceCharts());
      }
      if (mode === "tahunan") {
        await this.fetchAttendanceTahunan();
        this.$nextTick(() => this.renderAttendanceTahunanChart());
      }
    },
    // Ambil data 1 bulan (attendanceMonth/attendanceYear) khusus untuk
    // chart "Trend Kehadiran Harian" (batang bertumpuk per tanggal, tab
    // Kontrol Attendance). TIDAK lagi mengisi kartu ringkas "ATTENDANCE /
    // MORAL" -- kartu itu sekarang murni per-tanggal, diisi oleh
    // fetchAttendanceDayCard() (ikut date picker "Tanggal"), supaya
    // keduanya independen: ganti Bulan/Tahun cuma gerakkan chart, ganti
    // Tanggal cuma gerakkan kartu.
    // Sumber data:
    // - attendance_log (1 baris per HARI, isinya total_orang &
    //   overtime_jam dari Form Absensi Harian). Total Orang di sini
    //   di-CARRY-FORWARD (lihat totalCarryOn di bawah) -- sama seperti di
    //   kartu ringkas, supaya konsisten.
    // - attendance_leave (Form Ketidakhadiran, per-orang, jenis izin/
    //   sakit/cuti/mangkir) -- dipakai untuk MENGHITUNG OTOMATIS di sini:
    //     Cuti  = jumlah orang jenis 'cuti' yang aktif di tanggal itu
    //     Absen = jumlah Izin + Sakit + Mangkir di tanggal itu
    //     Hadir = Total Orang - Cuti - Absen
    //   Hasil hitungan ini CUMA dipakai buat chart -- tidak ditulis balik
    //   ke attendance_log.
    async fetchAttendance() {
      try {
        const year = this.attendanceYear, month = this.attendanceMonth;
        const nHari = daysInMonth(year, month);
        const firstDay = localDateStr(new Date(year, month - 1, 1));
        const lastDay = localDateStr(new Date(year, month - 1, nHari));
        const todayStr = localDateStr(new Date());

        const [logRes, seedLogRes, futureSeedLogRes, nonCutiRes, cutiRes] = await Promise.all([
          supabaseClient.from("attendance_log").select("*").gte("tanggal", firstDay).lte("tanggal", lastDay),
          // Total Orang jarang berubah -- ambil 1 baris log PALING BARU
          // sebelum awal bulan ini, buat "seed" nilai carry-forward di
          // tanggal 1 kalau bulan ini sendiri belum ada input di awal.
          supabaseClient.from("attendance_log").select("tanggal, total_orang").lt("tanggal", firstDay).gt("total_orang", 0).order("tanggal", { ascending: false }).limit(1).maybeSingle(),
          // Fallback KEBALIKANNYA: kalau sama sekali belum pernah ada input
          // SEBELUM awal bulan ini (mis. baru pertama kali diisi mulai
          // tanggal 3), tanggal 1-2 tetap butuh angka. Ambil baris log
          // PALING AWAL yang >= awal bulan (bisa di bulan ini atau bulan
          // depan) buat backward-fill tanggal-tanggal sebelum input
          // pertama itu, supaya Total Orang tidak nge-0.
          supabaseClient.from("attendance_log").select("tanggal, total_orang").gte("tanggal", firstDay).gt("total_orang", 0).order("tanggal", { ascending: true }).limit(1).maybeSingle(),
          supabaseClient.from("attendance_leave").select("*").neq("jenis", "cuti").gte("tanggal", firstDay).lte("tanggal", lastDay),
          supabaseClient.from("attendance_leave").select("*").eq("jenis", "cuti").lte("tanggal", lastDay).or(`tanggal_selesai.is.null,tanggal_selesai.gte.${firstDay}`),
        ]);
        const logRows = logRes.data || [];
        const nonCutiRows = nonCutiRes.data || [];
        const cutiRows = cutiRes.data || [];

        // Jumlah Cuti & Absen (Izin+Sakit+Mangkir) per tanggal, dari
        // attendance_leave -- dipakai per hari buat chart.
        const cutiCountOn = (ds) => cutiRows.filter((r) => r.tanggal <= ds && (r.tanggal_selesai || r.tanggal) >= ds).length;
        const absenCountOn = (ds) => nonCutiRows.filter((r) => r.tanggal === ds).length;

        // ---- Trend harian (tanggal 1-31, null utk tanggal yg belum ada) ----
        // CATATAN: sebelumnya ada filter "sembunyikan tanggal > hari ini"
        // (pola itu dipakai di modul lain yang datanya proyeksi/belum
        // tentu ada). Attendance TIDAK butuh itu -- semua data di sini
        // murni hasil input manual (Form Absensi Harian/Shift Mingguan),
        // jadi tanggal apa pun dalam bulan yang dipilih harus tetap
        // tampil kalau memang ada datanya, termasuk tanggal setelah hari
        // ini (mis. sengaja dites lebih awal, atau input untuk tanggal
        // mendatang).
        const validDay = (d) => d <= nHari;
        const dayStr = (d) => localDateStr(new Date(year, month - 1, d));
        const byDay = (fn) => Array.from({ length: 31 }, (_, i) => {
          const d = i + 1;
          return validDay(d) ? fn(dayStr(d)) : null;
        });

        // Total Orang: CARRY-FORWARD, sama seperti kartu ringkas (lihat
        // fetchAttendanceDayCard()) -- nilainya "bertahan" dari input
        // terakhir sampai ada input baru, bukan cuma muncul persis di
        // tanggal yang diinput. logRows diurutkan dulu supaya forward-fill
        // per tanggal jalan berurutan.
        const sortedLogRows = [...logRows].sort((a, b) => (a.tanggal < b.tanggal ? -1 : 1));
        const totalCarryOn = (() => {
          // Prioritas: seed dari sebelum bulan ini (carry-forward normal).
          // Kalau tidak ada (belum pernah diisi sama sekali sebelum bulan
          // ini), pakai backward-fill dari input pertama yang ada (bisa di
          // bulan ini) -- supaya tanggal sebelum input pertama itu tidak
          // tampil 0.
          let carry = Number(seedLogRes.data?.total_orang) || Number(futureSeedLogRes.data?.total_orang) || 0;
          let li = 0;
          const map = {};
          for (let d = 1; d <= nHari; d++) {
            const ds = dayStr(d);
            while (li < sortedLogRows.length && sortedLogRows[li].tanggal <= ds) {
              carry = Number(sortedLogRows[li].total_orang) || carry;
              li++;
            }
            map[ds] = carry;
          }
          return (ds) => map[ds] || 0;
        })();
        // Total Orang cukup diinput SEKALI (tanggal berapa saja dalam
        // sebulan) lewat Form Absensi Harian -- nilainya otomatis
        // carry-forward dan berlaku untuk SEMUA tanggal di bulan itu
        // (lihat totalCarryOn di atas). Hadir juga ikut dihitung otomatis
        // untuk SEMUA tanggal dari angka carry-forward itu -- TIDAK lagi
        // disyaratkan ada baris attendance_log persis di tanggal tsb.
        // (Sebelumnya ada gate "hasLogOn" yang bikin Hadir kosong/null di
        // tanggal yang belum diisi form harian -- itu sudah dihapus.)
        const totalByDay = byDay((ds) => totalCarryOn(ds));
        const izinByDay = byDay((ds) => nonCutiRows.filter((r) => r.jenis === "izin" && r.tanggal === ds).length);
        const sakitByDay = byDay((ds) => nonCutiRows.filter((r) => r.jenis === "sakit" && r.tanggal === ds).length);
        const mangkirByDay = byDay((ds) => nonCutiRows.filter((r) => r.jenis === "mangkir" && r.tanggal === ds).length);
        const cutiByDay = byDay((ds) => cutiCountOn(ds));
        // Hadir per hari = Total Orang (carry-forward, berlaku sebulan) -
        // Cuti - Absen hari itu. Dihitung otomatis untuk tanggal yang
        // SUDAH LEWAT atau HARI INI (tidak perlu isi form persis di
        // tanggal itu lagi). TAPI untuk tanggal yang BELUM LEWAT (masa
        // depan) tetap null -- karena kehadiran hari itu memang belum
        // "kejadian", jadi belum semestinya ditampilkan.
        const hadirByDay = byDay((ds) => ds > todayStr ? null : Math.max(0, totalCarryOn(ds) - cutiCountOn(ds) - absenCountOn(ds)));
        const persenByDay = Array.from({ length: 31 }, (_, i) => {
          const t = totalByDay[i], h = hadirByDay[i];
          if (h === null || h === undefined) return null;
          return t ? Math.round((h / t) * 100) : null;
        });

        this.attendance.dailyTrend = { total: totalByDay, hadir: hadirByDay, izin: izinByDay, sakit: sakitByDay, cuti: cutiByDay, mangkir: mangkirByDay, persen: persenByDay };
      } catch (e) {
        console.error("Gagal memuat data Attendance:", e);
      }
    },
    // ---------------------------------------------------------------
    // Grafik "Rekap Tahunan" (tab Kontrol Attendance -> Tahunan).
    // Fiscal year: April (attendanceYear) -> Maret (attendanceYear+1) --
    // pola fyMonths sama seperti tab Tahunan lain (fetchTahunan()).
    // Per bulan dihitung 3 angka:
    //   - Total MP   : angka Total Orang dari baris attendance_log PALING
    //                  AWAL yang tanggalnya JATUH DI DALAM bulan itu (ini
    //                  angka yang diinput user di Form Absensi Harian di
    //                  AWAL bulan -- BUKAN carry-forward di akhir bulan).
    //                  Kalau bulan itu belum ada input sama sekali (mis.
    //                  bulan yang belum kejadian), nilainya NULL -- tidak
    //                  fallback ke angka bulan lain.
    //   - Rata-rata Kehadiran : rata-rata Hadir per hari sepanjang bulan
    //                  itu (1 bulan penuh) -- sumber datanya SAMA seperti
    //                  chart "Trend Kehadiran Harian" di tampilan Bulanan
    //                  (attendance_log + attendance_leave), cuma di sini
    //                  dirata-rata jadi 1 angka per bulan.
    //   - Rasio Kehadiran     : rata-rata % Kehadiran per hari sepanjang
    //                  bulan itu, sumber sama juga.
    // Hari yang belum "kejadian" (tanggal > hari ini) TIDAK ikut dirata-
    // rata, sama seperti aturan Hadir di fetchAttendance().
    async fetchAttendanceTahunan() {
      // FY yang memuat Bulan/Tahun yang dipilih di dropdown (dipakai
      // bersama tampilan Bulanan) -- Jan-Mar ikut FY tahun sebelumnya.
      const fyStartYear = fyStartOf(this.attendanceYear, this.attendanceMonth);
      if (this.attendanceTahunanLoaded && this._attendanceTahunanLoadedYear === fyStartYear) return;
      this.attendanceTahunanLoading = true;
      try {
        const fyStart = new Date(fyStartYear, 3, 1); // 1 April fyStartYear
        const fyEndExclusive = new Date(fyStartYear + 1, 3, 1); // 1 April tahun berikutnya (exclusive)
        const fyStartStr = localDateStr(fyStart);
        const fyLastDayStr = localDateStr(new Date(fyEndExclusive.getTime() - 86400000));
        const todayStr = localDateStr(new Date());

        const [logRes, seedLogRes, nonCutiRes, cutiRes] = await Promise.all([
          supabaseClient.from("attendance_log").select("tanggal, total_orang").gte("tanggal", fyStartStr).lte("tanggal", fyLastDayStr).order("tanggal", { ascending: true }),
          // Seed carry-forward SEBELUM awal FY -- dipakai kalau bulan
          // pertama (April) belum ada input sama sekali di bulan itu.
          supabaseClient.from("attendance_log").select("tanggal, total_orang").lt("tanggal", fyStartStr).gt("total_orang", 0).order("tanggal", { ascending: false }).limit(1).maybeSingle(),
          supabaseClient.from("attendance_leave").select("tanggal, jenis").neq("jenis", "cuti").gte("tanggal", fyStartStr).lte("tanggal", fyLastDayStr),
          supabaseClient.from("attendance_leave").select("tanggal, tanggal_selesai").eq("jenis", "cuti").lte("tanggal", fyLastDayStr).or(`tanggal_selesai.is.null,tanggal_selesai.gte.${fyStartStr}`),
        ]);
        const logRows = logRes.data || [];
        const nonCutiRows = nonCutiRes.data || [];
        const cutiRows = cutiRes.data || [];

        const cutiCountOn = (ds) => cutiRows.filter((r) => r.tanggal <= ds && (r.tanggal_selesai || r.tanggal) >= ds).length;
        const absenCountOn = (ds) => nonCutiRows.filter((r) => r.tanggal === ds).length;

        // Carry-forward Total Orang HARIAN sepanjang 1 tahun fiskal penuh
        // (dipakai buat hitung Hadir/Rasio per hari) -- polanya sama
        // persis seperti totalCarryOn di fetchAttendance(), cuma
        // rentangnya 12 bulan sekaligus, bukan 1 bulan.
        let carry = Number(seedLogRes.data?.total_orang) || 0;
        let li = 0;
        const totalCarryMap = {};
        for (let d = new Date(fyStart); d < fyEndExclusive; d.setDate(d.getDate() + 1)) {
          const ds = localDateStr(d);
          while (li < logRows.length && logRows[li].tanggal <= ds) {
            carry = Number(logRows[li].total_orang) || carry;
            li++;
          }
          totalCarryMap[ds] = carry;
        }

        const monthLabelId = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
        const fyMonths = [];
        for (let i = 0; i < 12; i++) fyMonths.push(new Date(fyStartYear, 3 + i, 1));

        const labels = fyMonths.map((d) => monthLabelId[d.getMonth()]);
        const totalMp = [];
        const avgHadir = [];
        const avgRasio = [];

        fyMonths.forEach((mDate) => {
          const y = mDate.getFullYear(), m = mDate.getMonth() + 1;
          const nHari = daysInMonth(y, m);
          const firstDay = localDateStr(new Date(y, m - 1, 1));
          const lastDay = localDateStr(new Date(y, m - 1, nHari));

          // --- Total MP: baris attendance_log PALING AWAL yang tanggalnya
          // DI DALAM bulan ini (input user di awal bulan). Kalau bulan ini
          // belum ada input SAMA SEKALI (mis. belum kejadian/belum
          // diinput), biarkan null -- TIDAK fallback ke carry-forward lagi,
          // supaya bulan yang belum ada inputnya (mis. bulan depan) memang
          // kosong, bukan "kepinjem" angka bulan sebelumnya.
          const rowsInMonth = logRows.filter((r) => r.tanggal >= firstDay && r.tanggal <= lastDay && Number(r.total_orang) > 0);
          totalMp.push(rowsInMonth.length ? Number(rowsInMonth[0].total_orang) || 0 : null);

          // --- Rata-rata Kehadiran & Rasio Kehadiran: rata-rata harian
          // sepanjang bulan itu (hari yang sudah lewat/hari ini saja --
          // hari yang belum kejadian tidak ikut dirata-rata).
          let sumHadir = 0, countHadir = 0, sumRasio = 0, countRasio = 0;
          for (let d = 1; d <= nHari; d++) {
            const ds = localDateStr(new Date(y, m - 1, d));
            if (ds > todayStr) continue;
            const total = totalCarryMap[ds] || 0;
            const hadir = Math.max(0, total - cutiCountOn(ds) - absenCountOn(ds));
            sumHadir += hadir; countHadir++;
            if (total) { sumRasio += (hadir / total) * 100; countRasio++; }
          }
          avgHadir.push(countHadir ? Math.round(sumHadir / countHadir) : null);
          avgRasio.push(countRasio ? Math.round(sumRasio / countRasio) : null);
        });

        this.attendanceTahunan = { labels, totalMp, avgHadir, avgRasio };
        this.attendanceTahunanLoaded = true;
        this._attendanceTahunanLoadedYear = fyStartYear;
      } catch (e) {
        console.error("Gagal memuat data Rekap Tahunan Attendance:", e);
      } finally {
        this.attendanceTahunanLoading = false;
      }
    },
    // Dipanggil saat date picker "Tanggal" diganti. Ini yang menggerakkan
    // KARTU RINGKAS "ATTENDANCE / MORAL" (Total/Hadir/Cuti/Absen/O.T/
    // Rate/Shift1/Shift2) supaya nilainya PER TANGGAL itu -- bukan
    // rata-rata/jumlah sebulan lagi. Juga tetap memuat ulang 4 tabel
    // Izin/Sakit/Cuti/Mangkir seperti sebelumnya. Chart "Trend Kehadiran
    // Harian" TIDAK disentuh di sini -- itu tetap murni ikut dropdown
    // Bulan/Tahun (lihat onAttendancePeriodChange()).
    async onAttendanceDateChange() {
      await Promise.all([this.fetchAttendanceDayCard(), this.fetchAttendanceLeave()]);
    },
    // Ambil data 1 HARI (this.attendanceDate) buat kartu ringkas
    // "ATTENDANCE / MORAL":
    // - Total Orang: CARRY-FORWARD -- ambil dari baris attendance_log
    //   PALING BARU yang tanggal-nya <= tanggal dipilih (bukan cuma yang
    //   persis sama). Total Orang jarang berubah, jadi begini nilainya
    //   selalu ada di tiap tanggal, bukan cuma di tanggal yang persis
    //   diinput lewat Form Absensi Harian. Kalau BELUM ADA input sama
    //   sekali sebelum/persis tanggal itu (mis. input pertama baru mulai
    //   beberapa hari setelahnya), fallback ke input PALING AWAL setelah
    //   tanggal itu (backward-fill), supaya tetap ada angkanya.
    // - Overtime: TETAP per-hari persis (TIDAK carry-forward), dari baris
    //   attendance_log yang tanggal-nya PERSIS SAMA. OT itu angka harian,
    //   kalau hari itu belum diinput ya 0.
    // - Hadir Shift 1/2: dari attendance_shift_weekly -- cari baris yang
    //   RENTANG tanggal_mulai..tanggal_selesai-nya MENCAKUP tanggal yang
    //   dipilih (kalau ada beberapa yang overlap, pakai yang tanggal_mulai
    //   paling baru). Kalau tidak ada rentang yang cocok, tampil 0.
    // - Cuti = jumlah orang jenis 'cuti' yang aktif di tanggal itu.
    // - Absen = jumlah Izin + Sakit + Mangkir di tanggal itu.
    // - Hadir = Total Orang (carry-forward) - Cuti - Absen.
    // - Rate = Hadir / Total Orang * 100.
    async fetchAttendanceDayCard() {
      try {
        const d = this.attendanceDate;
        const todayStr = localDateStr(new Date());
        const [latestLogRes, dayLogRes, nonCutiRes, cutiRes, shiftRes] = await Promise.all([
          // Ambil baris attendance_log PALING BARU yang tanggalnya <= d.
          // Kalau ada input PERSIS di tanggal d, ini otomatis dapat baris
          // itu (jadi exact match tetap prioritas utama).
          // Baris dengan total_orang 0 dilewati: itu baris yang dibuat form
          // Overtime (Master Data) di tanggal yang belum punya Total Orang,
          // bukan berarti orangnya 0. Sama dengan aturan "|| carry" di chart.
          supabaseClient.from("attendance_log").select("tanggal, total_orang").lte("tanggal", d).gt("total_orang", 0).order("tanggal", { ascending: false }).limit(1).maybeSingle(),
          supabaseClient.from("attendance_log").select("overtime_jam").eq("tanggal", d).maybeSingle(),
          supabaseClient.from("attendance_leave").select("*").eq("tanggal", d).neq("jenis", "cuti"),
          supabaseClient.from("attendance_leave").select("*").eq("jenis", "cuti").lte("tanggal", d).or(`tanggal_selesai.is.null,tanggal_selesai.gte.${d}`),
          supabaseClient.from("attendance_shift_weekly").select("shift1_hadir, shift2_hadir").lte("tanggal_mulai", d).gte("tanggal_selesai", d).order("tanggal_mulai", { ascending: false }).limit(1).maybeSingle(),
        ]);
        const isExactMatch = latestLogRes.data?.tanggal === d;
        const isFutureDate = d > todayStr;
        // - Ada input PERSIS di tanggal d -> selalu dipakai (walau d itu
        //   tanggal "masa depan", mis. sengaja dites lebih awal).
        // - d <= hari ini & belum ada input persis -> carry-forward dari
        //   input terakhir sebelumnya (Total Orang jarang berubah).
        // - d > hari ini (belum "kejadian") & belum ada input persis ->
        //   kosong (null), karena memang belum masuk datanya.
        const totalOrang = isExactMatch
          ? Number(latestLogRes.data.total_orang) || 0
          : isFutureDate
          ? null
          : (latestLogRes.data ? Number(latestLogRes.data.total_orang) || 0 : null);
        const cutiCount = (cutiRes.data || []).length;
        const absenCount = (nonCutiRes.data || []).length;
        const hadir = totalOrang === null ? null : Math.max(0, totalOrang - cutiCount - absenCount);
        this.attendance.total = totalOrang;
        this.attendance.hadir = hadir;
        this.attendance.cuti = cutiCount;
        this.attendance.absen = absenCount;
        this.attendance.ot = Math.round((Number(dayLogRes.data?.overtime_jam) || 0) * 10) / 10;
        this.attendance.rate = totalOrang ? Math.round((hadir / totalOrang) * 100) : null;
        this.attendance.shift1 = Number(shiftRes.data?.shift1_hadir) || 0;
        this.attendance.shift2 = Number(shiftRes.data?.shift2_hadir) || 0;
      } catch (e) {
        console.error("Gagal memuat kartu Attendance per tanggal:", e);
      }
    },
    // Ambil data Izin/Sakit/Cuti/Mangkir (per-orang) dari attendance_leave
    // untuk tanggal this.attendanceDate, lalu sebar ke 4 list terpisah
    // sesuai bentuk yang dipakai template (lihat catatan di data()).
    // Cuti beda cara filter: bisa rentang beberapa hari (tanggal_selesai),
    // jadi ditampilkan kalau attendanceDate ada DI ANTARA tanggal mulai
    // dan tanggal_selesai -- bukan cuma cocok persis di 1 hari.
    async fetchAttendanceLeave() {
      const d = this.attendanceDate;
      const [nonCuti, cuti] = await Promise.all([
        supabaseClient.from("attendance_leave").select("*").eq("tanggal", d).neq("jenis", "cuti").order("nama", { ascending: true }),
        supabaseClient.from("attendance_leave").select("*").eq("jenis", "cuti").lte("tanggal", d).or(`tanggal_selesai.is.null,tanggal_selesai.gte.${d}`).order("nama", { ascending: true }),
      ]);
      if (nonCuti.error || cuti.error) {
        this.attendance.izinList = [];
        this.attendance.sakitList = [];
        this.attendance.cutiList = [];
        this.attendance.mangkirList = [];
        return;
      }
      const map = (r) => ({ nik: r.nik, nama: r.nama, tanggal: r.tanggal, tanggalSelesai: r.tanggal_selesai, jumlahHari: r.jumlah_hari, alasan: r.keterangan, jenisCuti: r.jenis_cuti, keterangan: r.keterangan });
      const data = nonCuti.data || [];
      this.attendance.izinList = data.filter((r) => r.jenis === "izin").map(map);
      this.attendance.sakitList = data.filter((r) => r.jenis === "sakit").map(map);
      this.attendance.mangkirList = data.filter((r) => r.jenis === "mangkir").map(map);
      this.attendance.cutiList = (cuti.data || []).map(map);
    },
    // Dipanggil saat dropdown Bulan/Tahun di tab Bulanan berubah
    async onBulananPeriodChange() {
      // TIDAK panggil destroyBulananCharts() di sini -- kalau dipanggil
      // sebelum await fetchBulanan() selesai, semua chart langsung
      // dihancurkan seketika (canvas blank), lalu ada jeda nunggu response
      // Supabase, baru chart baru dibuat -- itu yang bikin "kedip"/blank
      // terlihat. renderBulananCharts() sendiri SUDAH punya mekanisme
      // destroy per-chart tepat sebelum chart baru dibuat (lihat const
      // destroy = (id) => {...} di dalamnya), jadi tidak ada jeda blank.
      // Ini persis pola onQcPeriodChange() di tab Kontrol Kualitas, yang
      // juga tidak pernah panggil destroyKualitasCharts() saat ganti
      // periode -- destroy cuma perlu terjadi saat PINDAH TAB (lihat
      // setTab()), bukan saat ganti Bulan/Tahun/Line di tab yang sama.
      this.bulananLoaded = false; // paksa fetch ulang periode baru
      // TIDAK set bulananLoading = true di sini -- kalau di-set, Alpine
      // akan membongkar total <template x-if="!bulananLoading"> (skeleton
      // "Memuat data bulanan..." tampil, seluruh dashboard+chart lama
      // di-unmount), lalu mounting ulang dari nol begitu fetch selesai --
      // itu yang bikin efek "kedip seperti reload" saat ganti Bulan/Tahun.
      // Pola dashboard Kontrol Kualitas (onQcPeriodChange) tidak pernah
      // menyentuh flag loading yang membungkus template-nya sama sekali,
      // makanya transisinya mulus. Di sini kita samakan: dashboard tetap
      // ter-mount, fetchBulanan({silent:true}) cuma ganti data di balik
      // layar, lalu renderBulananCharts() destroy+redraw chart dengan
      // data baru tanpa DOM lain ikut hilang.
      // Balik ke mode "sebulan" tiap kali Bulan/Tahun diganti (persis pola
      // onQcPeriodChange di tab Kontrol Kualitas). Field tanggal cuma diisi
      // diam-diam ke hari ini (kalau bulan berjalan) atau tanggal 1 bulan
      // yang dipilih -- semata supaya kalender terbuka di bulan yang benar
      // kalau nanti diklik, BUKAN otomatis pindah ke mode per-tanggal.
      const today = new Date();
      if (this.bulananMonth === today.getMonth() + 1 && this.bulananYear === today.getFullYear()) {
        this.bulananDate = localDateStr(today);
      } else {
        this.bulananDate = localDateStr(new Date(this.bulananYear, this.bulananMonth - 1, 1));
      }
      this.bulananDowntimeUseDate = false;
      await this.fetchBulanan({ silent: true });
      this.qcColFilters = { ...this.qcColFilters, bulananDowntime: {}, bulananTopProblem: {} };
      this.$nextTick(() => this.renderBulananCharts());
    },
    // Dipanggil saat dropdown LINE di tab Bulanan berubah (E-02..E-07
    // atau "Semua Line"). Beda dengan Tahunan (yang filternya cukup di
    // JS/client-side tanpa refetch) -- di Bulanan datanya memang perlu
    // diambil ulang dari Supabase dengan p_mesin sesuai pilihan, supaya
    // Productivity/Availability/Downtime Harian/Supporting/Line/Weekly/
    // tabel Downtime Line/Downtime Terbesar semuanya ikut ke-filter.
    async onBulananLineFilterChange() {
      // TIDAK panggil destroyBulananCharts() di sini -- sama alasannya
      // dengan onBulananPeriodChange() di atas: destroy per-chart sudah
      // ditangani otomatis di dalam renderBulananCharts() tepat sebelum
      // chart baru dibuat, jadi tidak ada jeda blank sambil nunggu
      // fetchBulanan() selesai.
      this.bulananLoaded = false; // paksa fetch ulang dengan line baru
      // Sama seperti onBulananPeriodChange() -- TIDAK set bulananLoading
      // = true di sini supaya template dashboard tidak di-unmount/mount
      // ulang (efek "kedip seperti reload") saat ganti Line.
      await this.fetchBulanan({ silent: true });
      this.qcColFilters = { ...this.qcColFilters, bulananDowntime: {}, bulananTopProblem: {} };
      this.$nextTick(() => this.renderBulananCharts());
    },
    // Ambil SEMUA Downtime per line untuk rentang [start, end) tertentu --
    // dipakai untuk satu tanggal spesifik (tabel ini selalu per-tanggal,
    // tidak pernah agregat sebulan).
    // CATATAN FIX: sebelumnya p_limit dikunci ke 5 (cuma ambil 5 problem
    // terbesar per line per hari), sehingga kalau dalam 1 hari ada lebih
    // dari 5 kejadian downtime di satu line, sisanya tidak ikut ditampilkan
    // di tabel -- ini yang bikin total manual per-tanggal jadi lebih kecil
    // dari total sebenarnya (mismatch dengan chart "Downtime Line" yang
    // menjumlahkan tanpa batas). p_limit dinaikkan jadi angka besar supaya
    // efektif mengambil SEMUA baris di tanggal itu, bukan cuma top 5.
    async fetchDowntimeTerbesarFor(start, end) {
      // Cuma loop ke line yang lagi dipilih di dropdown LINE tab Bulanan
      // (dxyLineFilterBulanan). "ALL" -> tetap ke 6 line seperti biasa;
      // selain itu -> 1 line saja (lebih hemat request, dan otomatis
      // ke-filter). Fungsi ini cuma dipanggil dari alur Bulanan.
      const activeMachines = this.dxyLineFilterBulanan === "ALL" ? MACHINES : MACHINES.filter((m) => m.key === this.dxyLineFilterBulanan);
      const topRes = await Promise.all(activeMachines.map((m) =>
        supabaseClient.rpc("dashboard_harian_top_problems", { p_mesin: m.key, p_start: start.toISOString(), p_end: end.toISOString(), p_limit: 1000 })
      ));
      return activeMachines.map((m, idx) => {
        const rows = ((topRes[idx] && topRes[idx].data) || []).map((r) => ({
          pic: r.pic || "",
          problem: r.problem || "",
          area: r.area || "",
          countermeasure: r.countermeasure || "",
          status: r.status || "",
          shift: r.shift || "",
          menit: Math.round(Number(r.total_menit) || 0),
        }));
        const rowsPadded = [...rows];
        while (rowsPadded.length < 5) rowsPadded.push({ pic: "", problem: "", area: "", countermeasure: "", status: "", shift: "", menit: "" });
        return { mesin: m.key, rows, rowsPadded };
      });
    },
    // Dipanggil saat date-picker di header panel "Downtime Line" berubah,
    // ATAU saat tombol "✕" (kembali ke sebulan) diklik -- persis pola
    // fetchQcNgInlineDetail() di tab Kontrol Kualitas:
    // - bulananDowntimeUseDate FALSE (default) -> tampil SEBULAN PENUH,
    //   ikut bulananMonth/bulananYear yang lagi aktif.
    // - bulananDowntimeUseDate TRUE  -> tampil 1 tanggal itu saja
    //   (bulananDate).
    async onBulananDowntimeDateChange() {
      let start, end;
      if (this.bulananDowntimeUseDate) {
        if (!this.bulananDate) this.bulananDate = localDateStr(new Date(this.bulananYear, this.bulananMonth - 1, 1));
        start = new Date(this.bulananDate + "T00:00:00");
        end = new Date(start);
        end.setDate(end.getDate() + 1);
      } else {
        start = new Date(this.bulananYear, this.bulananMonth - 1, 1);
        end = new Date(this.bulananYear, this.bulananMonth, 1);
      }
      this.bulananDtLoading = true;
      try {
        this.bulanan.downtimeTerbesar = await this.fetchDowntimeTerbesarFor(start, end);
        this.qcColFilters = { ...this.qcColFilters, bulananDowntime: {} };
      } catch (e) {
        console.error("Gagal mengambil Downtime Terbesar untuk periode terpilih:", e);
      } finally {
        this.bulananDtLoading = false;
      }
    },
    // Batas min/max date picker supaya user cuma bisa pilih tanggal
    // di dalam bulan/tahun yang lagi aktif di tab Bulanan.
    bulananDateMin() {
      return localDateStr(new Date(this.bulananYear, this.bulananMonth - 1, 1));
    },
    bulananDateMax() {
      return localDateStr(new Date(this.bulananYear, this.bulananMonth, 0));
    },
    // Semua tabel "Terbesar" (Downtime/NG Inline/Repair) defaultnya
    // menampilkan minimal 8 baris -- kalau data asli kurang dari 8, sisanya
    // diisi baris kosong (placeholder "-"). Kalau data asli LEBIH dari 8,
    // baris otomatis nambah (tidak dipotong) dan tabel yang scroll.
    dxyPadMin(flat, emptyRow, minRows = 12) {
      const out = flat.slice();
      while (out.length < minRows) out.push({ ...emptyRow });
      return out;
    },
    // Baris tabel di tab Kontrol Kualitas: default minimal 8 baris kosong
    // (supaya area kotak Rekap yang tingginya sudah dikunci 198px terisi
    // pas sampai bawah, tidak ada sisa ruang kosong seperti saat masih
    // 5 baris). Kalau data asli lebih dari 8, semua tetap ditampilkan
    // dan scroll otomatis muncul dari .qc-rekap-scroll.
    qcNgInlineRows() {
      const base = this.qcLineFilter === "ALL" ? this.qcNgInline.detailRows : (this.qcNgInline.detailRows || []).filter((r) => r.line === this.qcLineFilter);
      const filtered = this.qcApplyColFilters("ngInline", base);
      return this.dxyPadMin(filtered, { tanggal: "", model: "", line: "", partNo: "", area: "", ngProses: "", qty: "", ngKategori: "", value: "" }, 8);
    },
    qcNgTrialRows() {
      const base = this.qcLineFilter === "ALL" ? this.qcNgTrial.detailRows : (this.qcNgTrial.detailRows || []).filter((r) => r.line === this.qcLineFilter);
      const filtered = this.qcApplyColFilters("ngTrial", base);
      return this.dxyPadMin(filtered, { tanggal: "", model: "", line: "", partNo: "", area: "", ngProses: "", qty: "", ngKategori: "", value: "" }, 8);
    },
    qcRepairRows() {
      const base = this.qcLineFilter === "ALL" ? this.qcRepair.detailRows : (this.qcRepair.detailRows || []).filter((r) => r.line === this.qcLineFilter);
      const filtered = this.qcApplyColFilters("repair", base);
      return this.dxyPadMin(filtered, { tanggal: "", model: "", line: "", partNo: "", qty: "", area: "", point: "", repairKategori: "" }, 8);
    },
    // ---- Data mentah (rata, sudah kena filter Line dari dropdown atas,
    // TAPI belum kena filter per-kolom & belum di-sort/pad) untuk 3 tabel
    // "Terbesar" di tab Tahunan -- dipakai bareng oleh dxyFiltered...()
    // dan sebagai sumber nilai unik dropdown filter (qcRawRowsFor). ----
    dxyDowntimeFlatTahunan() {
      let flat = [];
      (this.tahunan.downtimeTerbesar || []).forEach((line) => {
        const real = (line.rows || []).filter((r) => r.pic || r.problem || r.value !== "");
        if (real.length === 0) {
          flat.push({ mesin: line.mesin, pic: "", problem: "", value: "" });
        } else {
          real.forEach((r) => flat.push({ mesin: line.mesin, pic: r.pic, problem: r.problem, value: r.value }));
        }
      });
      if (this.dxyLineFilter !== "ALL") flat = flat.filter((r) => r.mesin === this.dxyLineFilter);
      return flat;
    },
    dxyNgFlatTahunan() {
      // Kalau 1 Line dipilih: tabel ini tidak punya kolom Line, jadi
      // langsung pakai top-5 kategori milik Line itu apa adanya.
      if (this.dxyLineFilter !== "ALL") {
        const line = (this.tahunan.ngInlineTerbesar || []).find((x) => x.mesin === this.dxyLineFilter);
        const real = ((line && line.rows) || []).filter((r) => r.kategori || r.qty !== "");
        return real.map((r) => ({ kategori: r.kategori, qty: r.qty, value: r.value }));
      }
      // "Semua Line": tabel ini TIDAK punya kolom Line, jadi kategori yang
      // sama dari Line berbeda (mis. "BOLONG" muncul di top-5 beberapa
      // Line) harus DIGABUNG (qty & value dijumlah), bukan ditumpuk mentah
      // sebagai baris terpisah -- kalau tidak, "BOLONG" bisa muncul 5x
      // berturut-turut dan kelihatan seolah 5 kategori berbeda.
      const merged = new Map();
      (this.tahunan.ngInlineTerbesar || []).forEach((line) => {
        const real = (line.rows || []).filter((r) => r.kategori || r.qty !== "");
        real.forEach((r) => {
          const key = r.kategori;
          const acc = merged.get(key) || { kategori: key, qty: 0, value: 0 };
          acc.qty += Number(r.qty) || 0;
          acc.value += Number(r.value) || 0;
          merged.set(key, acc);
        });
      });
      return Array.from(merged.values());
    },
    dxyRepairFlatTahunan() {
      // Kalau 1 Line dipilih: tabel ini tidak punya kolom Line, jadi
      // langsung pakai top-5 kategori milik Line itu apa adanya.
      if (this.dxyLineFilter !== "ALL") {
        const line = (this.tahunan.repairTerbesar || []).find((x) => x.mesin === this.dxyLineFilter);
        const real = ((line && line.rows) || []).filter((r) => r.kategori || r.qty !== "");
        return real.map((r) => ({ kategori: r.kategori, qty: r.qty }));
      }
      // "Semua Line": gabungkan kategori yang sama dari Line berbeda
      // (qty dijumlah) -- lihat penjelasan sama seperti dxyNgFlatTahunan().
      const merged = new Map();
      (this.tahunan.repairTerbesar || []).forEach((line) => {
        const real = (line.rows || []).filter((r) => r.kategori || r.qty !== "");
        real.forEach((r) => {
          const key = r.kategori;
          const acc = merged.get(key) || { kategori: key, qty: 0 };
          acc.qty += Number(r.qty) || 0;
          merged.set(key, acc);
        });
      });
      return Array.from(merged.values());
    },
    dxyFilteredTerbesar() {
      const flat = this.qcApplyColFilters("tahunanDowntime", this.dxyDowntimeFlatTahunan());
      flat.sort((a, c) => (Number(c.value) || 0) - (Number(a.value) || 0));
      // Default SELALU 12 baris (kotak dikunci pas 12 baris via CSS
      // .dxy-tahunan-terbesar-panel) -- kalau data asli < 12, sisanya
      // diisi baris kosong placeholder "-". Kalau data asli > 12, baris
      // TIDAK dipotong, tabel yang scroll (kotaknya tetap diam).
      return this.dxyPadMin(flat, { mesin: "", pic: "", problem: "", value: "" }, 12);
    },
    // ---- NG Inline Terbesar: struktur sama seperti dxyFilteredTerbesar,
    // tapi field-nya kategori/qty/value (bukan pic/problem/value) ----
    dxyFilteredNgTerbesar() {
      const flat = this.qcApplyColFilters("tahunanNg", this.dxyNgFlatTahunan());
      flat.sort((a, c) => (Number(c.value) || 0) - (Number(a.value) || 0));
      return this.dxyPadMin(flat, { mesin: "", kategori: "", qty: "", value: "" }, 12);
    },
    // ---- Repair Terbesar: sama seperti di atas, tapi tanpa kolom value
    // (menit dihapus) -- urutan berdasarkan qty terbesar ----
    dxyFilteredRepairTerbesar() {
      const flat = this.qcApplyColFilters("tahunanRepair", this.dxyRepairFlatTahunan());
      flat.sort((a, c) => (Number(c.qty) || 0) - (Number(a.qty) || 0));
      return this.dxyPadMin(flat, { mesin: "", kategori: "", qty: "" }, 12);
    },
    computeTahunanInsights() {
      const b = this.tahunan;
      const insights = [];
      const monthName = (i) => (b.monthLabels[i + 2] || "");

      // 1) Availability trend
      const availValid = b.availability.actual.map((v, i) => ({ v, i })).filter((x) => x.v !== null && x.v !== undefined);
      if (availValid.length >= 2) {
        const diff = availValid[availValid.length - 1].v - availValid[availValid.length - 2].v;
        if (Math.abs(diff) < 0.5) insights.push({ icon: "🟢", text: `Availability tetap <b>stabil</b> di angka ${b.availability.value}% sepanjang FY ${this.tahunanYear}.` });
        else if (diff > 0) insights.push({ icon: "🟢", text: `Availability <b>membaik</b> ${diff.toFixed(1)} poin di bulan ${monthName(availValid[availValid.length - 1].i)}.` });
        else insights.push({ icon: "🔴", text: `Availability <b>menurun</b> ${Math.abs(diff).toFixed(1)} poin di bulan ${monthName(availValid[availValid.length - 1].i)}.` });
      }

      // 2) Downtime Exhaust peak month
      const monthly = b.downtimeExhaust.values.slice(2);
      const validMonthly = monthly.map((v, i) => ({ v, i })).filter((x) => x.v !== null && x.v !== undefined && !Number.isNaN(x.v));
      if (validMonthly.length) {
        const peak = validMonthly.reduce((a, c) => (c.v > a.v ? c : a));
        insights.push({ icon: "🔴", text: `Downtime mencapai puncak pada bulan <b>${monthName(peak.i)}</b> (${fmtNum(peak.v)} menit).` });
      }

      // 3) Line dengan downtime terbesar
      const lineAct = (b.downtimeLine.labels || []).map((l, i) => ({ l, v: b.downtimeLine.act[i] || 0 }));
      if (lineAct.length) {
        const topLine = lineAct.reduce((a, c) => (c.v > a.v ? c : a));
        if (topLine.v > 0) insights.push({ icon: "🟡", text: `Line <b>${topLine.l}</b> menjadi penyumbang downtime terbesar (${fmtNum(topLine.v)} menit).` });
      }

      // 4) NG Inline perubahan bulan terakhir
      const ngValid = b.ngInline.qtyByMonth.map((v, i) => ({ v, i })).filter((x) => x.v !== null && x.v !== undefined);
      if (ngValid.length >= 2) {
        const last = ngValid[ngValid.length - 1].v, prev = ngValid[ngValid.length - 2].v;
        const pct = prev === 0 ? (last > 0 ? 100 : 0) : Math.round(((last - prev) / prev) * 100);
        if (pct > 5) insights.push({ icon: "🔵", text: `NG Inline <b>meningkat ${pct}%</b> dibanding bulan sebelumnya (${monthName(ngValid[ngValid.length - 1].i)}).` });
        else if (pct < -5) insights.push({ icon: "🔵", text: `NG Inline <b>menurun ${Math.abs(pct)}%</b> dibanding bulan sebelumnya (${monthName(ngValid[ngValid.length - 1].i)}).` });
      }

      // 5) Problem terbesar (sudah ikut tahun fiskal yang dipilih di dropdown)
      const flat = this.dxyFilteredTerbesarAll();
      if (flat.length) {
        const top = flat[0];
        insights.push({ icon: "🟠", text: `<b>${top.problem}</b> di line ${top.mesin} (PIC ${top.pic || "-"}) menjadi penyebab downtime terbesar di FY ${this.tahunanYear}.` });
      }

      // 6) Prioritas improvement
      if (lineAct.length && flat.length) {
        const topLine = lineAct.reduce((a, c) => (c.v > a.v ? c : a));
        insights.push({ icon: "⚡", text: `Prioritas improvement berikutnya: <b>${topLine.l}</b> &mdash; ${flat[0].problem}.` });
      }

      this.tahunanInsights = insights;
    },
    dxyFilteredTerbesarAll() {
      let flat = [];
      (this.tahunan.downtimeTerbesar || []).forEach((line) => {
        (line.rows || []).filter((r) => r.pic || r.problem).forEach((r) => flat.push({ mesin: line.mesin, pic: r.pic, problem: r.problem, value: r.value }));
      });
      flat.sort((a, c) => (Number(c.value) || 0) - (Number(a.value) || 0));
      return flat;
    },
    // ---- Chart Bulanan ----
    // ---- Chart Bulanan (harian 1-31), gaya visual sama seperti Tahunan ----
    renderBulananCharts() {
      // Palet tab Kontrol Downtime -- warna TERANG (sesuai permintaan,
      // palet kalem sempat dicoba tapi kurang cocok untuk tab ini).
      // Nama key tetap "CALM" supaya kode di bawah tidak perlu diubah;
      // cukup ganti kode warna di sini kalau mau diatur ulang.
      const CALM = {
        blue: "#2563EB", sage: "#10B981", sand: "#F97316",
        lavender: "#8B5CF6", rose: "#EF4444", teal: "#14B8A6",
        cyan: "#0891B2",       // DIES
        productivity: "#0EA5E9",
        blueLine: "#2563EB",   // garis & area Week 1-5
        sandLine: "#F97316",   // garis & area Downtime Harian
        accent: "#F97316",     // sorotan titik line terpilih di Weekly
      };
      const CALM_PIC = { PE: CALM.blue, MESIN: CALM.sand, DIES: CALM.cyan, QC: CALM.lavender, PROD: CALM.sage, PRESS: CALM.rose, "PC-SUPP": CALM.teal };
      if (typeof Chart === "undefined") return;
      const b = this.bulanan;
      const destroy = (id) => { if (this.bulananCharts[id]) { this.bulananCharts[id].destroy(); delete this.bulananCharts[id]; } };
      const safe = (fn, label) => { try { fn(); } catch (e) { console.error("Gagal render chart Bulanan:", label, e); } };
      const noAnim = { duration: 0 };

      const baseScales = (opts = {}) => ({
        x: { ticks: { color: "#000000", font: { size: 9 }, autoSkip: false, maxRotation: 0, minRotation: 0 }, grid: { display: false }, border: { display: true, color: cssVar("--border") } },
        y: { ticks: { color: "#000000", font: { size: 9 }, maxTicksLimit: 5 }, grid: { color: cssVar("--chart-grid"), drawTicks: false }, border: { display: true, color: cssVar("--border") }, beginAtZero: true, ...opts },
      });
      const legend = (show) => ({ display: show, position: "bottom", labels: { color: "#000000", boxWidth: 5, boxHeight: 5, usePointStyle: true, pointStyle: "circle", font: { size: 7.5 }, padding: 3 } });
      const tooltip = () => ({ backgroundColor: cssVar("--panel"), titleColor: cssVar("--text"), bodyColor: cssVar("--text"), borderColor: cssVar("--border"), borderWidth: 1, padding: 8, cornerRadius: 8 });

      const grad = (canvas, hex, alphaTop = 0.85, alphaBottom = 0.05) => {
        const ctx = canvas.getContext("2d");
        const h = canvas.height || 200;
        const g = ctx.createLinearGradient(0, 0, 0, h);
        const toRgba = (a) => {
          const n = parseInt(hex.replace("#", ""), 16);
          const r = (n >> 16) & 255, gg = (n >> 8) & 255, bl = n & 255;
          return `rgba(${r},${gg},${bl},${a})`;
        };
        g.addColorStop(0, toRgba(alphaTop));
        g.addColorStop(1, toRgba(alphaBottom));
        return g;
      };
      // Bar SOLID (tanpa gradasi) -- gradasi dihapus atas permintaan.
      const barBg = (canvas, hex, len) => Array.from({ length: len }, () => hex);

      // Bevel inset "relaxed" tapi lebih tegas: kontras bayangan kuat,
      // blur kecil. Menggantikan efek gradasi lama supaya batang tetap
      // terlihat bervolume walau warnanya solid rata.
      // Bevel batang sekarang dipasang GLOBAL (plugin "dxBarBevel" di
      // <head>) untuk SEMUA grafik batang. Fungsi ini sengaja dibiarkan
      // sebagai no-op supaya pemanggilan lama tidak dobel menggambar.
      const barBevelInset = () => ({ id: "dxNoopBevel_" + Math.random() });

      // Label angka di dalam tiap segmen doughnut (dipakai Supporting & Line)
      // Label angka pada donat. ANTI-TUMPUK:
      //   - potongan yang cukup lebar -> angka ditaruh DI DALAM potongan
      //   - potongan tipis            -> angka ditaruh DI LUAR lingkaran,
      //     dihubungkan garis penunjuk berwarna potongannya, lalu posisi
      //     vertikalnya digeser otomatis supaya tidak ada yang bertumpuk.
      const donutLeaderLabels = (formatter) => ({
        id: "dxbDonutInsideLabels",
        afterDraw(chart) {
          const { ctx, chartArea } = chart;
          const meta = chart.getDatasetMeta(0);
          const dataset = chart.data.datasets[0];
          if (!meta || !meta.data.length) return;
          const warnaArc = (i) => {
            const bg = dataset.backgroundColor;
            return Array.isArray(bg) ? bg[i] : bg;
          };

          const diDalam = [], diLuar = [];
          meta.data.forEach((arc, i) => {
            const val = Number(dataset.data[i]) || 0;
            if (!val) return;
            const { x: cx, y: cy, innerRadius, outerRadius, startAngle, endAngle } =
              arc.getProps(["x", "y", "innerRadius", "outerRadius", "startAngle", "endAngle"], true);
            const sudut = (startAngle + endAngle) / 2;
            const sweep = endAngle - startAngle;
            const rTengah = (innerRadius + outerRadius) / 2;
            const teks = formatter(val);
            const fontDalam = sweep < 0.22 ? 9.5 : 11;
            ctx.save();
            ctx.font = `700 ${fontDalam}px Inter, sans-serif`;
            const lebar = ctx.measureText(teks).width;
            ctx.restore();
            // Muat di dalam kalau panjang busur & tebal cincin mencukupi
            const panjangBusur = sweep * rTengah;
            const tebalCincin = outerRadius - innerRadius;
            const muat = panjangBusur >= lebar + 8 && tebalCincin >= fontDalam + 6;
            const dasar = { i, teks, cx, cy, outerRadius, sudut, warna: warnaArc(i) };
            if (muat) {
              diDalam.push({ ...dasar, font: fontDalam,
                x: cx + Math.cos(sudut) * rTengah, y: cy + Math.sin(sudut) * rTengah });
            } else {
              diLuar.push({ ...dasar, font: 9.5,
                xAnchor: cx + Math.cos(sudut) * (outerRadius + 2),
                yAnchor: cy + Math.sin(sudut) * (outerRadius + 2),
                kanan: Math.cos(sudut) >= 0 });
            }
          });

          // Angka di dalam potongan -- putih + outline gelap
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          diDalam.forEach((d) => {
            ctx.save();
            ctx.font = `700 ${d.font}px Inter, sans-serif`;
            ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,.45)";
            ctx.strokeText(d.teks, d.x, d.y);
            ctx.fillStyle = "#fff";
            ctx.fillText(d.teks, d.x, d.y);
            ctx.restore();
          });

          if (!diLuar.length) return;

          // Angka di luar -- dipisah kiri/kanan lalu digeser supaya tidak tumpuk
          const TINGGI = 12;
          const atas = (chartArea ? chartArea.top : 0) + 6;
          const bawah = (chartArea ? chartArea.bottom : chart.height) - 6;
          ["kanan", "kiri"].forEach((sisi) => {
            const daftar = diLuar.filter((d) => (sisi === "kanan" ? d.kanan : !d.kanan))
                                 .sort((a, b) => a.yAnchor - b.yAnchor);
            if (!daftar.length) return;
            daftar.forEach((d) => { d.y = d.yAnchor; });
            // dorong ke bawah kalau terlalu rapat
            for (let k = 1; k < daftar.length; k++) {
              if (daftar[k].y - daftar[k - 1].y < TINGGI) daftar[k].y = daftar[k - 1].y + TINGGI;
            }
            // kalau lewat batas bawah, dorong balik semuanya ke atas
            const lebihBawah = daftar[daftar.length - 1].y - bawah;
            if (lebihBawah > 0) daftar.forEach((d) => { d.y -= lebihBawah; });
            for (let k = daftar.length - 2; k >= 0; k--) {
              if (daftar[k + 1].y - daftar[k].y < TINGGI) daftar[k].y = daftar[k + 1].y - TINGGI;
            }
            if (daftar[0].y < atas) daftar.forEach((d) => { d.y += atas - daftar[0].y; });
          });

          diLuar.forEach((d) => {
            const arahX = d.kanan ? 1 : -1;
            const xSiku = d.cx + arahX * (d.outerRadius + 10);
            const xTeks = xSiku + arahX * 4;
            ctx.save();
            // garis penunjuk, warnanya ikut potongannya
            ctx.strokeStyle = d.warna || "#94A3B8";
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(d.xAnchor, d.yAnchor);
            ctx.lineTo(xSiku, d.y);
            ctx.lineTo(xTeks, d.y);
            ctx.stroke();
            // angka -- tinta gelap di atas latar panel, bukan warna seri
            ctx.font = `700 ${d.font}px Inter, sans-serif`;
            ctx.textAlign = d.kanan ? "left" : "right";
            ctx.textBaseline = "middle";
            ctx.lineWidth = 3; ctx.strokeStyle = "rgba(255,255,255,.85)";
            ctx.strokeText(d.teks, xTeks + arahX * 2, d.y);
            ctx.fillStyle = "#0F172A";
            ctx.fillText(d.teks, xTeks + arahX * 2, d.y);
            ctx.restore();
          });
        },
      });

      // Label angka di atas tiap batang (anti-tabrakan, sama seperti Tahunan)
      const barValueLabels = (formatter, datasetIndex = 0, sizeScale = 1) => ({
        id: "dxbBarValueLabels",
        afterDatasetsDraw(chart) {
          const { ctx, chartArea } = chart;
          const meta = chart.getDatasetMeta(datasetIndex);
          const dataset = chart.data.datasets[datasetIndex];
          if (!meta || !dataset || meta.type !== "bar" || !meta.data) return;
          const textColor = "#000000";
          const n = meta.data.length;
          const slotWidth = chartArea && n ? chartArea.width / n : 30;
          const fontSize = (slotWidth < 18 ? 6.5 : slotWidth < 26 ? 7.5 : slotWidth < 40 ? 8.5 : 9.5) * sizeScale;
          ctx.save();
          ctx.font = `700 ${fontSize}px Inter, sans-serif`;
          ctx.textAlign = "center"; ctx.fillStyle = textColor;
          // Kalau teksnya lebih lebar dari jatah 1 kolom, label diputar tegak
          // supaya tidak saling timpa (kasusnya: 31 tanggal x "103.6%").
          // Dicek sekali pakai label terpanjang, biar semua label seragam.
          let terlebar = 0;
          meta.data.forEach((bar, i) => {
            const v = Number(dataset.data[i]);
            if (v === null || v === undefined || Number.isNaN(v) || v === 0) return;
            terlebar = Math.max(terlebar, ctx.measureText(formatter(v)).width);
          });
          const putar = terlebar > slotWidth - 2;
          meta.data.forEach((bar, i) => {
            const val = Number(dataset.data[i]);
            if (val === null || val === undefined || Number.isNaN(val) || val === 0) return;
            const { x, y } = bar.getProps(["x", "y"], true);
            const txt = formatter(val);
            if (putar) {
              ctx.save();
              ctx.translate(x, y - 4);
              ctx.rotate(-Math.PI / 2);
              ctx.textAlign = "left"; ctx.textBaseline = "middle";
              ctx.fillText(txt, 0, 0);
              ctx.restore();
            } else {
              ctx.textBaseline = "bottom";
              ctx.fillText(txt, x, y - 3);
            }
          });
          ctx.restore();
        },
      });

      // Label angka di atas tiap titik pada chart area/line (mis. Weekly)
      const areaValueLabels = (formatter, datasetIndex = 0) => ({
        id: "dxbAreaValueLabels",
        afterDatasetsDraw(chart) {
          const { ctx, chartArea } = chart;
          const meta = chart.getDatasetMeta(datasetIndex);
          const dataset = chart.data.datasets[datasetIndex];
          if (!meta || !dataset || meta.type !== "line" || !meta.data) return;
          const textColor = "#000000";
          const n = meta.data.length;
          const slotWidth = chartArea && n ? chartArea.width / n : 30;
          const fontSize = slotWidth < 18 ? 6.5 : slotWidth < 26 ? 7.5 : slotWidth < 40 ? 8.5 : 9.5;
          ctx.save();
          ctx.font = `700 ${fontSize}px Inter, sans-serif`;
          ctx.textAlign = "center"; ctx.fillStyle = textColor;
          meta.data.forEach((point, i) => {
            const val = Number(dataset.data[i]);
            if (val === null || val === undefined || Number.isNaN(val) || val === 0) return; // angka 0 tidak dilabeli
            const { x, y } = point.getProps(["x", "y"], true);
            ctx.textBaseline = "bottom";
            ctx.fillText(formatter(val), x, y - 8);
          });
          ctx.restore();
        },
      });

      // Efek "menyala" (glow) di belakang tiap titik pada chart area/line
      const glowPoints = (colorFn, datasetIndex = 0) => ({
        id: "dxbGlowPoints",
        beforeDatasetsDraw(chart) {
          const meta = chart.getDatasetMeta(datasetIndex);
          if (!meta || !meta.data) return;
          const { ctx } = chart;
          meta.data.forEach((point, i) => {
            const { x, y } = point.getProps(["x", "y"], true);
            const hex = colorFn(i);
            if (!hex) return; // null = titik lagi dipudarkan, skip glow-nya
            const glowR = 7;
            ctx.save();
            const g = ctx.createRadialGradient(x, y, 0, x, y, glowR);
            g.addColorStop(0, hex + "40");   // pusat, tipis
            g.addColorStop(0.6, hex + "1A"); // meredup lebih cepat
            g.addColorStop(1, hex + "00");   // transparan penuh di tepi
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x, y, glowR, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          });
        },
      });

      // --- Productivity & Availability harian (%), bar gradient + target ---
      const kpiBigPct = (canvasId, labels, actual, target, hex, labelScale = 1) => {
        destroy(canvasId);
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        this.bulananCharts[canvasId] = new Chart(canvas, {
          data: {
            labels,
            datasets: [
              { order: 2, type: "bar", label: "Actual", data: actual, backgroundColor: barBg(canvas, hex, actual.length), borderRadius: 0, barPercentage: 0.65, categoryPercentage: 0.75, borderSkipped: false },
              // target = null -> garis Target tidak digambar sama sekali
              // (dipakai Availability). Selain itu tetap garis datar.
              ...(target === null || target === undefined ? [] : [
                { order: 1, type: "line", label: "Target", data: labels.map(() => target), borderColor: "#EF4444", borderDash: [4, 3], borderWidth: 1.5, pointRadius: 0, tension: 0 },
              ]),
            ],
          },
          options: {
            responsive: true, maintainAspectRatio: false, animation: noAnim,
            // Padding atas dilebihkan: kalau label angkanya diputar tegak
            // (31 tanggal), teksnya butuh ruang ke atas supaya tidak terpotong.
            layout: { padding: { top: 42 } },
            plugins: { legend: legend(true), tooltip: tooltip() },
            scales: baseScales({ suggestedMax: 100, ticks: { callback: (v) => v + "%", color: "#000000", font: { size: 9 }, maxTicksLimit: 5 } }),
          },
          plugins: [barValueLabels((v) => v + "%", 0, labelScale), barBevelInset(0)],
        });
      };
      safe(() => kpiBigPct("dxbProductivity", b.dayLabels, b.productivity.actual, b.productivity.target, CALM.productivity), "productivity");
      safe(() => kpiBigPct("dxbAvailability", b.dayLabels, b.availability.actual, b.availability.target, CALM.sage, 0.8), "availability");

      // --- Downtime Exhaust (FY, 12 bulan Apr..Mar) -- gaya sama persis
      // seperti chart "Downtime Exhaust" di tab Tahunan, TAPI datanya
      // di-fetch & difilter SENDIRI (lihat fetchBulanan() -> dtExhaustRes)
      // supaya ikut Line yang dipilih di tab ini (dxyLineFilterBulanan),
      // sama seperti Downtime Harian/Supporting/Line di sebelahnya. ---
      safe(() => {
        destroy("dxbDowntimeExhaust");
        const canvas = document.getElementById("dxbDowntimeExhaust");
        if (!canvas) return;
        const vals = b.downtimeExhaust.values;
        const labels = b.downtimeExhaust.labels;
        const prevVals = b.downtimeExhaust.prevValues || [];
        const adaPrev = prevVals.some((v) => v !== null && v !== undefined);

        // Dua penulis angka khusus chart ini: angka batang di BAWAH (dekat
        // sumbu) dan angka garis FY sebelumnya di ATAS titiknya. Ditulis di
        // sini, bukan dipakai bersama, supaya chart lain di tab ini tidak
        // ikut berubah.
        const angkaBatangBawah = (datasetIndex) => ({
          id: "dxbDtBarBase",
          afterDatasetsDraw(chart) {
            const { ctx, chartArea } = chart;
            const meta = chart.getDatasetMeta(datasetIndex);
            const ds = chart.data.datasets[datasetIndex];
            if (!meta || !ds || meta.type !== "bar" || !meta.data) return;
            const n = meta.data.length;
            const slot = chartArea && n ? chartArea.width / n : 30;
            const fs = slot < 18 ? 6.5 : slot < 26 ? 7.5 : slot < 40 ? 8.5 : 9.5;
            ctx.save();
            ctx.font = `700 ${fs}px Inter, sans-serif`;
            ctx.textAlign = "center"; ctx.fillStyle = "#000000"; ctx.textBaseline = "bottom";
            const baris = [];
            meta.data.forEach((bar, i) => {
              const v = Number(ds.data[i]);
              if (ds.data[i] === null || ds.data[i] === undefined || Number.isNaN(v) || v === 0) return;
              const { x, base } = bar.getProps(["x", "base"], true);
              const txt = fmtNum(v);
              const setengah = ctx.measureText(txt).width / 2 + 3;
              let r = 0;
              while (r < baris.length && x - setengah < baris[r]) r++;
              baris[r] = x + setengah;
              ctx.fillText(txt, x, base - 3 - r * (fs + 3));
            });
            ctx.restore();
          },
        });
        const angkaGarisAtas = (datasetIndex) => ({
          id: "dxbDtLineTop",
          afterDatasetsDraw(chart) {
            const { ctx, chartArea } = chart;
            const meta = chart.getDatasetMeta(datasetIndex);
            const ds = chart.data.datasets[datasetIndex];
            if (!meta || !ds || meta.type !== "line" || !meta.data) return;
            const n = meta.data.length;
            const slot = chartArea && n ? chartArea.width / n : 30;
            const fs = slot < 18 ? 6.5 : slot < 26 ? 7.5 : slot < 40 ? 8.5 : 9.5;
            ctx.save();
            ctx.font = `700 ${fs}px Inter, sans-serif`;
            ctx.textAlign = "center"; ctx.fillStyle = "#000000"; ctx.textBaseline = "bottom";
            meta.data.forEach((titik, i) => {
              const v = Number(ds.data[i]);
              if (ds.data[i] === null || ds.data[i] === undefined || Number.isNaN(v) || v === 0) return;
              const { x, y } = titik.getProps(["x", "y"], true);
              const atasAman = chartArea ? chartArea.top + fs : -Infinity;
              ctx.fillText(fmtNum(v), x, Math.max(atasAman, y - 5));
            });
            ctx.restore();
          },
        });

        this.bulananCharts.dxbDowntimeExhaust = new Chart(canvas, {
          data: {
            labels: labels,
            datasets: [
              { order: 2, type: "bar", label: "Downtime (menit)", data: vals, backgroundColor: barBg(canvas, CALM.sand, vals.length), borderRadius: 0, barPercentage: 0.6, categoryPercentage: 0.7 },
              ...(adaPrev ? [{
                order: 1, type: "line", label: b.downtimeExhaust.prevLabel || "FY lalu",
                data: prevVals, borderColor: "#6B7280", backgroundColor: "#6B7280",
                borderWidth: 1.5, pointRadius: 1.5, tension: 0.3, spanGaps: true,
              }] : []),
            ],
          },
          options: { responsive: true, maintainAspectRatio: false, animation: noAnim, layout: { padding: { top: adaPrev ? 30 : 20 } }, plugins: { legend: legend(true), tooltip: tooltip() }, scales: baseScales() },
          plugins: adaPrev
            ? [angkaBatangBawah(0), angkaGarisAtas(1), barBevelInset(0)]
            : [barValueLabels((v) => fmtNum(v)), barBevelInset(0)],
        });
      }, "downtimeExhaust");

      // --- Downtime harian 1-31: AREA (isi oranye transparan 20%) ---
      // Angka menit tetap tampil di ATAS tiap titik (hari yang 0 / belum
      // ada data tidak diberi angka, sama seperti versi batang dulu).
      // cubicInterpolationMode "monotone" supaya kurva halus tapi tidak
      // pernah "melengkung" di bawah 0 / melewati puncak aslinya.
      safe(() => {
        destroy("dxbDowntimeHarian");
        const canvas = document.getElementById("dxbDowntimeHarian");
        if (!canvas) return;
        const DT_COLOR = CALM.sandLine;
        const dtAreaLabels = {
          id: "dxbDowntimeHarianLabels",
          afterDatasetsDraw(chart) {
            const { ctx, chartArea } = chart;
            const meta = chart.getDatasetMeta(0);
            const dataset = chart.data.datasets[0];
            if (!meta || !dataset || !meta.data) return;
            const n = meta.data.length;
            const slotWidth = chartArea && n ? chartArea.width / n : 30;
            const fontSize = slotWidth < 18 ? 6.5 : slotWidth < 26 ? 7.5 : slotWidth < 40 ? 8.5 : 9.5;
            ctx.save();
            ctx.font = `700 ${fontSize}px Inter, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "bottom";
            ctx.fillStyle = "#000000";
            meta.data.forEach((point, i) => {
              const raw = dataset.data[i];
              const val = Number(raw);
              if (raw === null || raw === undefined || Number.isNaN(val) || val === 0) return;
              const { x, y } = point.getProps(["x", "y"], true);
              const ly = Math.max(y - 6, chartArea.top + fontSize);
              ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = 3; ctx.lineJoin = "round";
              ctx.strokeText(fmtNum(val), x, ly);
              ctx.fillText(fmtNum(val), x, ly);
            });
            ctx.restore();
          },
        };
        this.bulananCharts.dxbDowntimeHarian = new Chart(canvas, {
          type: "line",
          data: {
            labels: b.downtimeHarian.labels,
            datasets: [{
              label: "Downtime",
              data: b.downtimeHarian.values,
              fill: true,
              backgroundColor: DT_COLOR + "33",   // 33 hex = 20% opacity
              borderColor: DT_COLOR,
              borderWidth: 1.5,
              tension: 0.35,
              cubicInterpolationMode: "monotone",
              pointRadius: 2,
              pointHoverRadius: 4,
              pointBackgroundColor: DT_COLOR,
              pointBorderColor: cssVar("--panel") || "#fff",
              pointBorderWidth: 1,
            }],
          },
          options: { responsive: true, maintainAspectRatio: false, animation: noAnim, layout: { padding: { top: 20 } }, plugins: { legend: legend(true), tooltip: tooltip() }, scales: baseScales() },
          plugins: [dtAreaLabels],
        });
      }, "downtimeHarian");

      // --- Downtime Supporting & Downtime Line: BATANG ---
      // Dulu donat; sekarang batang vertikal bevel (bevel dipasang global oleh
      // plugin "dxBarBevel" di <head>), gaya sama dgn Downtime Exhaust.
      // Angka menit di ATAS tiap batang. Warna tiap batang = warna donat lama
      // (colorFn dipakai apa adanya). Legend dimatikan: nama PIC / line
      // sudah tampil di sumbu X, dan 1 dataset dgn warna per-batang akan
      // membuat legend bawaan Chart.js menampilkan satu warna saja.
      const donut = (canvasId, labels, values, colorFn) => {
        destroy(canvasId);
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const scales = baseScales();
        scales.x.ticks.font = { size: 8 };   // card sempit: "PC-SUPP" harus muat
        this.bulananCharts[canvasId] = new Chart(canvas, {
          type: "bar",
          data: {
            labels,
            datasets: [{
              type: "bar", label: "Downtime (menit)", data: values,
              backgroundColor: labels.map(colorFn),
              borderRadius: 0, barPercentage: 0.7, categoryPercentage: 0.8,
            }],
          },
          options: {
            responsive: true, maintainAspectRatio: false, animation: noAnim,
            layout: { padding: { top: 20 } },
            plugins: { legend: legend(false), tooltip: tooltip() },
            scales,
          },
          plugins: [barValueLabels((v) => fmtNum(v)), barBevelInset(0)],
        });
      };
      safe(() => donut("dxbDowntimeSupporting", b.downtimeSupporting.labels, b.downtimeSupporting.act, (pic) => CALM_PIC[pic] || "#B8BEC7"), "downtimeSupporting");
      safe(() => {
        const lineColors = [CALM.blue, CALM.sage, CALM.sand, CALM.lavender, CALM.rose, CALM.teal];
        // Line yang lagi dipilih (dxyLineFilterBulanan) di-highlight full
        // warna; line lain dipudarkan (alpha 40) -- sama pola dengan tab
        // Tahunan, tapi variabel filter-nya sengaja terpisah (KHUSUS
        // Bulanan) supaya tidak ikut berubah waktu Line di tab Tahunan
        // diganti. Kalau "ALL", semua tampil full warna seperti biasa.
        donut("dxbDowntimeLine", b.downtimeLine.labels, b.downtimeLine.act, (label, i) => {
          const base = lineColors[i % lineColors.length];
          if (this.dxyLineFilterBulanan !== "ALL" && label !== this.dxyLineFilterBulanan) return base + "40";
          return base;
        });
      }, "downtimeLine");
      // (colorFn di atas untuk Line dipanggil dgn (label, index) -- Array.map
      // sudah otomatis mengoper index sbg argumen ke-2, jadi aman dipakai.)

      // --- Weekly Breakdown: bar per line + Total ---
      b.weekly.forEach((w, idx) => {
        safe(() => {
          const canvasId = "dxbWeek" + (idx + 1);
          destroy(canvasId);
          const canvas = document.getElementById(canvasId);
          if (!canvas) return;
          const labels = w.labels;
          const values = w.values;
          // Titik untuk tiap line -- kalau ADA Line terpilih
          // (dxyLineFilterBulanan != ALL), titik line itu di-highlight
          // pakai warna BEDA (oranye, bukan biru bawaan) + lebih besar,
          // titik line lain dipudarkan (alpha 40, tetap biru).
          const HIGHLIGHT_COLOR = CALM.accent;
          const isHighlighted = (lbl) => this.dxyLineFilterBulanan === "ALL" || lbl === this.dxyLineFilterBulanan;
          const isPicked = (lbl) => this.dxyLineFilterBulanan !== "ALL" && lbl === this.dxyLineFilterBulanan;
          const pointColors = w.labels.map((lbl) => (isPicked(lbl) ? HIGHLIGHT_COLOR : (isHighlighted(lbl) ? CALM.blueLine : CALM.blueLine + "40")));
          const pointRadii = w.labels.map((lbl) => (isPicked(lbl) ? 5 : 2.5));
          this.bulananCharts[canvasId] = new Chart(canvas, {
            type: "line",
            data: {
              labels,
              datasets: [{
                data: values,
                fill: true,
                backgroundColor: grad(canvas, CALM.blueLine, 0.30, 0.02), // area transparan
                borderColor: CALM.blueLine,
                borderWidth: 1, // dikecilkan (sebelumnya 1.5)
                tension: 0.45, // kurva lebih halus
                pointRadius: pointRadii,
                pointHoverRadius: 4,
                pointBackgroundColor: pointColors,
                pointBorderColor: cssVar("--panel") || "#fff",
                pointBorderWidth: 1.5,
              }],
            },
            options: {
              responsive: true, maintainAspectRatio: false, animation: noAnim,
              layout: { padding: { top: 20 } },
              plugins: { legend: legend(false), tooltip: tooltip() },
              scales: baseScales(),
            },
            plugins: [glowPoints((i) => (isPicked(labels[i]) ? HIGHLIGHT_COLOR : (isHighlighted(labels[i]) ? CALM.blueLine : null))), areaValueLabels((v) => fmtNum(v))],
          });
        }, "week" + (idx + 1));
      });
    },
    renderTahunanCharts() {
      if (typeof Chart === "undefined") return;
      const b = this.tahunan;
      const destroy = (id) => { if (this.tahunanCharts[id]) { this.tahunanCharts[id].destroy(); delete this.tahunanCharts[id]; } };
      const noAnim = { duration: 0 };
      const safe = (fn, label) => { try { fn(); } catch (e) { console.error("Gagal render chart Tahunan:", label, e); } };

      const baseScales = () => ({
        x: { ticks: { color: "#000000", font: { size: 9 }, autoSkip: false, maxRotation: 0, minRotation: 0 }, grid: { display: false }, border: { display: true, color: cssVar("--border") } },
        y: { ticks: { color: "#000000", font: { size: 9 }, maxTicksLimit: 5 }, grid: { color: cssVar("--chart-grid"), drawTicks: false }, border: { display: true, color: cssVar("--border") }, beginAtZero: true },
      });
      const legend = (show) => ({ display: show, position: "bottom", labels: { color: "#000000", boxWidth: 5, boxHeight: 5, usePointStyle: true, pointStyle: "circle", font: { size: 7.5 }, padding: 3 } });
      const tooltip = () => ({ backgroundColor: cssVar("--panel"), titleColor: cssVar("--text"), bodyColor: cssVar("--text"), borderColor: cssVar("--border"), borderWidth: 1, padding: 10, cornerRadius: 8, displayColors: true, usePointStyle: true });

      const grad = (canvas, hex, alphaTop = 0.85, alphaBottom = 0.05) => {
        const ctx = canvas.getContext("2d");
        const h = canvas.height || 240;
        const g = ctx.createLinearGradient(0, 0, 0, h);
        const toRgba = (a) => {
          const n = parseInt(hex.replace("#", ""), 16);
          const r = (n >> 16) & 255, gg = (n >> 8) & 255, bl = n & 255;
          return `rgba(${r},${gg},${bl},${a})`;
        };
        g.addColorStop(0, toRgba(alphaTop));
        g.addColorStop(1, toRgba(alphaBottom));
        return g;
      };

      // Bar SOLID (tanpa gradasi) -- gradasi dihapus atas permintaan.
      // (fitur highlight per-bulan sudah dihapus atas permintaan; kolom
      // Bulan tidak lagi ada di filter bar).
      const barBg = (canvas, hex, len) => Array.from({ length: len }, () => hex);

      // Bevel inset "relaxed" tapi lebih tegas: kontras bayangan kuat,
      // blur kecil. Menggantikan efek gradasi lama supaya batang tetap
      // terlihat bervolume walau warnanya solid rata.
      // Bevel batang sekarang dipasang GLOBAL (plugin "dxBarBevel" di
      // <head>) untuk SEMUA grafik batang. Fungsi ini sengaja dibiarkan
      // sebagai no-op supaya pemanggilan lama tidak dobel menggambar.
      const barBevelInset = () => ({ id: "dxNoopBevel_" + Math.random() });

      // Label kecil ("Qty" / "Value" / "%") nempel di atas deretan angka
      // sumbu vertikal primary (kiri) & secondary (kanan) -- PERSIS sama
      // dengan axisUnitLabels di tab Kontrol Kualitas, supaya chart
      // NG Inline & Straight Pass di tab Tahunan juga punya nama sumbu.
      const axisUnitLabels = (primaryText, secondaryText) => ({
        id: "dxyTahunanAxisUnitLabels_" + Math.random(),
        afterDraw(chart) {
          const { ctx, chartArea, scales } = chart;
          if (!chartArea) return;
          ctx.save();
          ctx.font = "bold 8.5px Inter, sans-serif";
          ctx.fillStyle = "#000000";
          ctx.strokeStyle = "#000000";
          ctx.lineWidth = 0.6;
          ctx.textBaseline = "bottom";
          const labelY = chartArea.top - 14;
          if (primaryText && scales.y) {
            ctx.textAlign = "left";
            ctx.strokeText(primaryText, scales.y.left, labelY);
            ctx.fillText(primaryText, scales.y.left, labelY);
          }
          if (secondaryText && scales.y1) {
            ctx.textAlign = "right";
            ctx.strokeText(secondaryText, scales.y1.right, labelY);
            ctx.fillText(secondaryText, scales.y1.right, labelY);
          }
          ctx.restore();
        },
      });

      // --- Plugin: label angka DI DALAM tiap segmen donut (tanpa leader line) ---
      // (untuk Downtime Supporting & Line)
      // Label angka pada donat. ANTI-TUMPUK:
      //   - potongan yang cukup lebar -> angka ditaruh DI DALAM potongan
      //   - potongan tipis            -> angka ditaruh DI LUAR lingkaran,
      //     dihubungkan garis penunjuk berwarna potongannya, lalu posisi
      //     vertikalnya digeser otomatis supaya tidak ada yang bertumpuk.
      const donutLeaderLabels = (formatter) => ({
        id: "dxyDonutInsideLabels",
        afterDraw(chart) {
          const { ctx, chartArea } = chart;
          const meta = chart.getDatasetMeta(0);
          const dataset = chart.data.datasets[0];
          if (!meta || !meta.data.length) return;
          const warnaArc = (i) => {
            const bg = dataset.backgroundColor;
            return Array.isArray(bg) ? bg[i] : bg;
          };

          const diDalam = [], diLuar = [];
          meta.data.forEach((arc, i) => {
            const val = Number(dataset.data[i]) || 0;
            if (!val) return;
            const { x: cx, y: cy, innerRadius, outerRadius, startAngle, endAngle } =
              arc.getProps(["x", "y", "innerRadius", "outerRadius", "startAngle", "endAngle"], true);
            const sudut = (startAngle + endAngle) / 2;
            const sweep = endAngle - startAngle;
            const rTengah = (innerRadius + outerRadius) / 2;
            const teks = formatter(val);
            const fontDalam = sweep < 0.22 ? 9.5 : 11;
            ctx.save();
            ctx.font = `700 ${fontDalam}px Inter, sans-serif`;
            const lebar = ctx.measureText(teks).width;
            ctx.restore();
            // Muat di dalam kalau panjang busur & tebal cincin mencukupi
            const panjangBusur = sweep * rTengah;
            const tebalCincin = outerRadius - innerRadius;
            const muat = panjangBusur >= lebar + 8 && tebalCincin >= fontDalam + 6;
            const dasar = { i, teks, cx, cy, outerRadius, sudut, warna: warnaArc(i) };
            if (muat) {
              diDalam.push({ ...dasar, font: fontDalam,
                x: cx + Math.cos(sudut) * rTengah, y: cy + Math.sin(sudut) * rTengah });
            } else {
              diLuar.push({ ...dasar, font: 9.5,
                xAnchor: cx + Math.cos(sudut) * (outerRadius + 2),
                yAnchor: cy + Math.sin(sudut) * (outerRadius + 2),
                kanan: Math.cos(sudut) >= 0 });
            }
          });

          // Angka di dalam potongan -- putih + outline gelap
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          diDalam.forEach((d) => {
            ctx.save();
            ctx.font = `700 ${d.font}px Inter, sans-serif`;
            ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,.45)";
            ctx.strokeText(d.teks, d.x, d.y);
            ctx.fillStyle = "#fff";
            ctx.fillText(d.teks, d.x, d.y);
            ctx.restore();
          });

          if (!diLuar.length) return;

          // Angka di luar -- dipisah kiri/kanan lalu digeser supaya tidak tumpuk
          const TINGGI = 12;
          const atas = (chartArea ? chartArea.top : 0) + 6;
          const bawah = (chartArea ? chartArea.bottom : chart.height) - 6;
          ["kanan", "kiri"].forEach((sisi) => {
            const daftar = diLuar.filter((d) => (sisi === "kanan" ? d.kanan : !d.kanan))
                                 .sort((a, b) => a.yAnchor - b.yAnchor);
            if (!daftar.length) return;
            daftar.forEach((d) => { d.y = d.yAnchor; });
            // dorong ke bawah kalau terlalu rapat
            for (let k = 1; k < daftar.length; k++) {
              if (daftar[k].y - daftar[k - 1].y < TINGGI) daftar[k].y = daftar[k - 1].y + TINGGI;
            }
            // kalau lewat batas bawah, dorong balik semuanya ke atas
            const lebihBawah = daftar[daftar.length - 1].y - bawah;
            if (lebihBawah > 0) daftar.forEach((d) => { d.y -= lebihBawah; });
            for (let k = daftar.length - 2; k >= 0; k--) {
              if (daftar[k + 1].y - daftar[k].y < TINGGI) daftar[k].y = daftar[k + 1].y - TINGGI;
            }
            if (daftar[0].y < atas) daftar.forEach((d) => { d.y += atas - daftar[0].y; });
          });

          diLuar.forEach((d) => {
            const arahX = d.kanan ? 1 : -1;
            const xSiku = d.cx + arahX * (d.outerRadius + 10);
            const xTeks = xSiku + arahX * 4;
            ctx.save();
            // garis penunjuk, warnanya ikut potongannya
            ctx.strokeStyle = d.warna || "#94A3B8";
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(d.xAnchor, d.yAnchor);
            ctx.lineTo(xSiku, d.y);
            ctx.lineTo(xTeks, d.y);
            ctx.stroke();
            // angka -- tinta gelap di atas latar panel, bukan warna seri
            ctx.font = `700 ${d.font}px Inter, sans-serif`;
            ctx.textAlign = d.kanan ? "left" : "right";
            ctx.textBaseline = "middle";
            ctx.lineWidth = 3; ctx.strokeStyle = "rgba(255,255,255,.85)";
            ctx.strokeText(d.teks, xTeks + arahX * 2, d.y);
            ctx.fillStyle = "#0F172A";
            ctx.fillText(d.teks, xTeks + arahX * 2, d.y);
            ctx.restore();
          });
        },
      });

      // --- Plugin: label angka DI ATAS setiap batang (untuk semua bar chart) ---
      // Anti-tabrakan: kalau beberapa batang berdekatan dan labelnya lebar,
      // label otomatis ditumpuk ke "baris" berikutnya (sebanyak yang diperlukan)
      // supaya SEMUA angka tetap terlihat tanpa saling menimpa.
      const barValueLabels = (formatter, datasetIndex = 0, pos = "above") => ({
        id: "dxyBarValueLabels",
        afterDatasetsDraw(chart) {
          const { ctx, chartArea } = chart;
          const meta = chart.getDatasetMeta(datasetIndex);
          const dataset = chart.data.datasets[datasetIndex];
          if (!meta || !dataset || meta.type !== "bar" || !meta.data) return;
          const textColor = "#000000";
          const n = meta.data.length;
          const slotWidth = chartArea && n ? chartArea.width / n : 30;
          const fontSize = slotWidth < 24 ? 7.5 : slotWidth < 34 ? 8.5 : slotWidth < 46 ? 9.5 : 10.5;
          const rowStep = fontSize + 3;

          ctx.save();
          ctx.font = `700 ${fontSize}px Inter, sans-serif`;
          ctx.textAlign = "center";
          ctx.fillStyle = textColor;

          const rowsUp = [];   // batas kanan label terakhir per baris, untuk batang positif (menumpuk ke atas)
          const rowsDown = []; // idem untuk batang negatif (menumpuk ke bawah)
          // KHUSUS mode "base": dulu SEMUA label langsung digambar pas di
          // base-4 tanpa cek tabrakan sama sekali -- kalau beberapa batang
          // berdekatan sama-sama punya angka lebar (mis. "4,987.1"), label-
          // labelnya numpuk horizontal jadi 1 tulisan tidak terbaca. Sekarang
          // pakai mekanisme stacking yang SAMA seperti mode "above": kalau
          // label ini akan tabrakan sama label sebelumnya, naikkan ke baris
          // berikutnya (menjauh dari sumbu-x), bukan dipaksa di baris yang sama.
          const rowsBase = [];
          meta.data.forEach((bar, i) => {
            const raw = dataset.data[i];
            if (raw === null || raw === undefined) return;
            const val = Number(raw);
            if (Number.isNaN(val) || val === 0) return; // angka 0 (bulan yg belum berjalan) tidak dilabeli
            const { x, y, base } = bar.getProps(["x", "y", "base"], true);
            const label = formatter(val);
            if (label === "0" || label === "0%" || label === "") return;
            const halfW = ctx.measureText(label).width / 2 + 4;
            if (pos === "base") {
              let row = 0;
              while (row < rowsBase.length && x - halfW < rowsBase[row]) row++;
              rowsBase[row] = x + halfW;
              ctx.textBaseline = "bottom";
              ctx.fillText(label, x, base - 4 - row * rowStep);
              return;
            }
            const isUp = y <= base;
            const rows = isUp ? rowsUp : rowsDown;

            let row = 0;
            while (row < rows.length && x - halfW < rows[row]) row++;
            rows[row] = x + halfW;

            const rowGap = row * rowStep;
            const labelY = isUp ? Math.max(chartArea.top + fontSize, y - 6 - rowGap) : y + 14 + rowGap;
            ctx.textBaseline = isUp ? "bottom" : "top";
            ctx.fillText(label, x, labelY);
          });
          ctx.restore();
        },
      });


      // Label angka di atas titik garis yang TIDAK PERNAH skip label (semua angka
      // selalu ditampilkan, tidak boleh ada yang hilang gara-gara
      // mekanisme anti-tabrakan). Supaya tidak saling tumpuk, tinggi
      // label diselang-seling (zig-zag) antara baris genap & ganjil --
      // dipakai di chart Straight Pass (% Straightpass) & NG Inline (Value).
      const lineValueLabelsAll = (formatter, datasetIndex = 1) => ({
        id: "dxyLineValueLabelsAll_" + datasetIndex + "_" + Math.random(),
        afterDatasetsDraw(chart) {
          const { ctx, chartArea } = chart;
          const meta = chart.getDatasetMeta(datasetIndex);
          const dataset = chart.data.datasets[datasetIndex];
          if (!meta || !dataset || meta.type !== "line" || !meta.data) return;
          const textColor = "#000000";
          const n = meta.data.length;
          const slotWidth = chartArea && n ? chartArea.width / n : 30;
          const fontSize = slotWidth < 18 ? 6 : slotWidth < 24 ? 7 : slotWidth < 34 ? 8 : slotWidth < 46 ? 9 : 10;
          ctx.save();
          ctx.font = `700 ${fontSize}px Inter, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillStyle = textColor;
          const topSafe = chartArea ? chartArea.top + fontSize + 2 : -Infinity;
          // bottomSafe: jarak aman minimum dari dasar chart-area -- supaya
          // label garis (mis. "Value") tidak ketimpa/menimpa label angka
          // batang "Qty" yang digambar dekat sumbu-x (barValueLabels pos
          // "base"). Tanpa ini, kalau titik garis kebetulan turun dekat
          // sumbu-x (nilainya kecil di skala sumbu-Y1 sendiri), labelnya
          // numpuk persis di zona yang sama dengan label batang.
          const bottomSafe = chartArea ? chartArea.bottom - 20 : Infinity;
          meta.data.forEach((point, i) => {
            const raw = dataset.data[i];
            if (raw === null || raw === undefined) return;
            const val = Number(raw);
            if (Number.isNaN(val) || val === 0) return; // angka 0 (bulan yg belum berjalan) tidak dilabeli
            const label = formatter(val);
            if (label === "0" || label === "0%" || label === "") return;
            const { x, y } = point.getProps(["x", "y"], true);
            // Zig-zag: baris genap sedikit lebih dekat titik, baris ganjil
            // digeser lebih tinggi -- supaya 2 label bersebelahan tidak
            // saling menimpa walau titiknya rapat.
            const lift = i % 2 === 0 ? 6 : fontSize + 10;
            const labelY = Math.min(Math.max(y - lift, topSafe), bottomSafe);
            ctx.fillText(label, x, labelY);
          });
          ctx.restore();
        },
      });

      // --- Sparkline mini (di kartu KPI) ---
      const sparkline = (canvasId, data, hex) => {
        destroy(canvasId);
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const vals = data.filter((v) => v !== null && v !== undefined);
        this.tahunanCharts[canvasId] = new Chart(canvas, {
          type: "line",
          data: {
            labels: data.map((_, i) => i),
            datasets: [{ data, borderColor: hex, borderWidth: 2, pointRadius: 0, tension: 0.35, fill: true, backgroundColor: grad(canvas, hex, 0.28, 0), spanGaps: true }],
          },
          options: {
            responsive: true, maintainAspectRatio: false, animation: noAnim,
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            scales: { x: { display: false }, y: { display: false, beginAtZero: vals.length ? Math.min(...vals) >= 0 : true } },
            elements: { point: { radius: 0 } },
          },
        });
      };
      safe(() => sparkline("dxySparkProductivity", b.productivity.actual, "#2563EB"), "spark-productivity");
      safe(() => sparkline("dxySparkAvailability", b.availability.actual, "#10B981"), "spark-availability");
      safe(() => sparkline("dxySparkNg", b.ngInline.qtyByMonth, "#F43F5E"), "spark-ng");
      safe(() => sparkline("dxySparkStraightpass", b.straightpass.actual, "#14B8A6"), "spark-straightpass");

      // --- Grafik utama KPI (bar gradient + target garis putus-putus merah) ---
      // maxY (opsional): override sumbu-Y supaya ada ruang kosong di atas
      // bar/target buat label angka -- dipakai khusus chart Availability
      // (di-set 120) supaya label "100%" di bar/garis Target tidak
      // mepet/kepotong di puncak chart-area.
      const kpiBig = (canvasId, labels, actual, target, hex, labelPos = "above", maxY = null) => {
        destroy(canvasId);
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        this.tahunanCharts[canvasId] = new Chart(canvas, {
          data: {
            labels,
            datasets: [
              { order: 2, type: "bar", label: "Actual", data: actual, backgroundColor: barBg(canvas, hex, actual.length), borderRadius: 0, barPercentage: 0.6, categoryPercentage: 0.7, borderSkipped: false },
              // target boleh:
              //   null / undefined -> garis Target tidak digambar
              //   1 angka          -> garis datar
              //   array per kolom  -> garis bertangga (Productivity, yang
              //                       targetnya beda tiap bulan)
              ...(target === null || target === undefined ? [] : [
                { order: 1, type: "line", label: "Target",
                  data: Array.isArray(target) ? target : labels.map(() => target),
                  borderColor: "#EF4444", borderDash: [6, 4], borderWidth: 2, pointRadius: 0, tension: 0,
                  stepped: Array.isArray(target) ? "middle" : false },
              ]),
            ],
          },
          options: {
            responsive: true, maintainAspectRatio: false, animation: noAnim,
            layout: { padding: { top: 34 } },
            plugins: { legend: legend(true), tooltip: tooltip() },
            scales: maxY === null ? baseScales() : { ...baseScales(), y: { ...baseScales().y, max: maxY } },
          },
          plugins: [barValueLabels((v) => fmtNum(v), 0, labelPos), barBevelInset(0)],
        });
      };
      // Chart utama "🎯 Straight Pass" -- disamakan gaya sama chart
      // Straightpass Perline/Model: bar "Qty Repair" (kiri) + garis HITAM
      // "% Straightpass" (kanan) + garis merah putus-putus "Target".
      // Konfigurasi (termasuk axis "grace" & plugin label) SAMA PERSIS
      // dengan qcRepairStraightpassBar (Perline/Model) di tab Kontrol
      // Kualitas -- termasuk plugin label garis lineValueLabelsAll.
      const bigStraightpassDual = (canvasId, labels, repairQty, pctActual, target, hex) => {
        destroy(canvasId);
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const qty = repairQty || labels.map(() => null);
        const pct = pctActual || labels.map(() => null);
        this.tahunanCharts[canvasId] = new Chart(canvas, {
          data: {
            labels,
            datasets: [
              { order: 2, type: "bar", label: "Qty Repair", data: qty, backgroundColor: barBg(canvas, hex, qty.length), yAxisID: "y", borderRadius: 0, barPercentage: 0.6, categoryPercentage: 0.7, borderSkipped: false },
              { order: 1, type: "line", label: "% Straightpass", data: pct, borderColor: "#000000", backgroundColor: "#000000", yAxisID: "y1", borderWidth: 1.5, pointRadius: 1, tension: 0.3, spanGaps: true },
              { order: 1, type: "line", label: "Target", data: labels.map(() => target), borderColor: "#EF4444", borderDash: [6, 4], borderWidth: 2, pointRadius: 0, tension: 0, yAxisID: "y1" },
            ],
          },
          options: {
            responsive: true, maintainAspectRatio: false, animation: noAnim,
            layout: { padding: { top: 38 } },
            plugins: { legend: legend(true), tooltip: tooltip() },
            scales: {
              x: { ticks: { color: "#000000", font: { size: 9 }, autoSkip: false, maxRotation: 0, minRotation: 0 }, grid: { display: false }, border: { display: true, color: cssVar("--border") } },
              y: { position: "left", ticks: { color: "#000000", font: { size: 9 } }, grid: { color: cssVar("--chart-grid"), drawTicks: false }, border: { display: true, color: cssVar("--border") }, beginAtZero: true, grace: "12%" },
              y1: { position: "right", ticks: { color: "#000000", font: { size: 9 }, callback: (v) => v + "%" }, grid: { display: false }, border: { display: true, color: cssVar("--border") }, beginAtZero: true, suggestedMax: 100, grace: "8%" },
            },
          },
          plugins: [barValueLabels((v) => (v === null ? "" : fmtNum(v)), 0, "base"), lineValueLabelsAll((v) => (v === null ? "" : v + "%"), 1), axisUnitLabels("Qty", "%"), barBevelInset(0)],
        });
      };
      // Catatan: dua kolom pertama di b.monthLabels adalah ringkasan
      // "FY 2026" & "FY 2027" (dipakai Downtime Exhaust untuk total per
      // tahun fiskal). Untuk grafik-grafik lain kita buang 2 kolom ini,
      // cukup tampilkan 12 bulan (Apr..Mar). Ini murni di layer render,
      // data asli di this.tahunan tidak diubah.
      // Dua kolom pertama = ringkasan "FY 2025" & "FY 2026" (lihat
      // dxyRebuildTahunanSeries). Sekarang DITAMPILKAN lagi, jadi tidak
      // ada slice(2) di sini.
      safe(() => kpiBig("dxyBigProductivity", b.monthLabels, b.productivity.actual, b.productivity.target, "#2563EB"), "big-productivity");
      safe(() => kpiBig("dxyBigAvailability", b.monthLabels, b.availability.actual, b.availability.target, "#10B981", "above", 120), "big-availability");
      safe(() => bigStraightpassDual("dxyBigStraightpass", b.monthLabels, b.straightpass.repairQty, b.straightpass.actual, b.straightpass.target, "#14B8A6"), "big-straightpass");

      // --- NG Inline dual axis: Qty (bar oranye) + Value (area hitam tipis) ---
      safe(() => {
        destroy("dxyBigNg");
        const canvas = document.getElementById("dxyBigNg");
        if (!canvas) return;
        this.tahunanCharts.dxyBigNg = new Chart(canvas, {
          data: {
            labels: b.monthLabels,
            datasets: [
              { order: 2, type: "bar", label: "Qty", data: b.ngInline.qtyByMonth, backgroundColor: barBg(canvas, "#F43F5E", b.ngInline.qtyByMonth.length), yAxisID: "y", borderRadius: 0, barPercentage: 0.6, categoryPercentage: 0.7 },
              { order: 1, type: "line", label: "Value", data: b.ngInline.valueByMonth, borderColor: "#1D4ED8", backgroundColor: "rgba(29,78,216,0.1)", borderWidth: 1.5, fill: true, yAxisID: "y1", pointRadius: 1, tension: 0.3 },
            ],
          },
          options: {
            responsive: true, maintainAspectRatio: false, animation: noAnim,
            layout: { padding: { top: 38 } },
            plugins: { legend: legend(true), tooltip: tooltip() },
            scales: {
              x: baseScales().x,
              y: { position: "left", ticks: { color: "#000000", font: { size: 9 } }, grid: { color: cssVar("--chart-grid"), drawTicks: false }, border: { display: true, color: cssVar("--border") }, beginAtZero: true },
              y1: { position: "right", ticks: { color: "#000000", font: { size: 9 }, callback: (v) => fmtNum(Math.round(v / 1000)) }, grid: { display: false }, border: { display: true, color: cssVar("--border") }, beginAtZero: true },
            },
          },
          plugins: [barValueLabels((v) => fmtNum(v), 0, "base"), lineValueLabelsAll((v) => fmtNum(Math.round(v / 1000)), 1), axisUnitLabels("Qty", "Value"), barBevelInset(0)],
        });
      }, "ngInline");

      // --- Downtime Exhaust: bar gradient saja (Tren/Rata-rata/Puncak dihapus
      // sesuai permintaan -- tidak perlu hitung avg/peak lagi) ---
      safe(() => {
        destroy("dxyDowntimeExhaust");
        const canvas = document.getElementById("dxyDowntimeExhaust");
        if (!canvas) return;
        // Dua kolom pertama = ringkasan total per tahun fiskal
        // ("FY 2025" & "FY 2026"). Dulu sempat disembunyikan, sekarang
        // ditampilkan lagi atas permintaan.
        const vals = b.downtimeExhaust.values;
        const labels = b.downtimeExhaust.labels;
        // Garis pembanding FY sebelumnya (per bulan). Kalau ada, angka
        // batang FY berjalan PINDAH KE BAWAH supaya tidak berebut tempat
        // dengan angka garis yang ditulis di atas titiknya.
        const prevVals = b.downtimeExhaust.prevValues || [];
        const adaPrev = prevVals.some((v) => v !== null && v !== undefined);
        this.tahunanCharts.dxyDowntimeExhaust = new Chart(canvas, {
          data: {
            labels: labels,
            datasets: [
              { order: 2, type: "bar", label: "Downtime (menit)", data: vals, backgroundColor: barBg(canvas, "#F97316", vals.length), borderRadius: 0, barPercentage: 0.6, categoryPercentage: 0.7 },
              ...(adaPrev ? [{
                order: 1, type: "line", label: b.downtimeExhaust.prevLabel || "FY lalu",
                data: prevVals, borderColor: "#6B7280", backgroundColor: "#6B7280",
                borderWidth: 1.5, pointRadius: 1.5, tension: 0.3, spanGaps: true,
              }] : []),
            ],
          },
          options: { responsive: true, maintainAspectRatio: false, animation: noAnim, layout: { padding: { top: 34 } }, plugins: { legend: legend(true), tooltip: tooltip() }, scales: baseScales() },
          plugins: [
            barValueLabels((v) => fmtNum(v), 0, adaPrev ? "base" : "above"),
            ...(adaPrev ? [lineValueLabelsAll((v) => (v === null ? "" : fmtNum(v)), 1)] : []),
            barBevelInset(0),
          ],
        });
      }, "downtimeExhaust");

      // --- Downtime Supporting: pie per-PIC (proporsi Act menit) ---
      safe(() => {
        destroy("dxyDowntimeSupporting");
        const canvas = document.getElementById("dxyDowntimeSupporting");
        if (!canvas) return;
        // Semua nol (mis. rincian per Line belum diisi) -> jangan gambar
        // donat kosong, biarkan pesan penjelasan yang tampil.
        if (!b.downtimeSupporting.act.some((v) => Number(v) > 0)) return;
        const colors = b.downtimeSupporting.labels.map((pic) => this.dxyPicColor(pic));
        this.tahunanCharts.dxyDowntimeSupporting = new Chart(canvas, {
          type: "doughnut",
          data: {
            labels: b.downtimeSupporting.labels,
            datasets: [{ data: b.downtimeSupporting.act, backgroundColor: colors, borderColor: cssVar("--panel"), borderWidth: 2 }],
          },
          options: {
            responsive: true, maintainAspectRatio: false, animation: noAnim,
            layout: { padding: { left: 8, right: 8, top: 8, bottom: 8 } },
            cutout: "62%",
            interaction: { mode: "nearest", intersect: true },
            plugins: { legend: legend(true), tooltip: tooltip() },
          },
          plugins: [donutLeaderLabels((v) => fmtNum(v))],
        });
      }, "downtimeSupporting");

      // --- Downtime Line: pie diurutkan besar->kecil, warna berdasarkan ranking ---
      safe(() => {
        destroy("dxyDowntimeLine");
        const canvas = document.getElementById("dxyDowntimeLine");
        if (!canvas) return;
        const idx = b.downtimeLine.labels.map((_, i) => i);
        idx.sort((a, c) => (b.downtimeLine.act[c] || 0) - (b.downtimeLine.act[a] || 0));
        const labels = idx.map((i) => b.downtimeLine.labels[i]);
        const act = idx.map((i) => b.downtimeLine.act[i]);
        const rankColors = ["#EF4444", "#F97316", "#F59E0B"];
        const colors = idx.map((_, rank) => {
          const base = rankColors[rank] || "#2563EB";
          if (this.dxyLineFilter !== "ALL" && labels[rank] !== this.dxyLineFilter) return base + "40";
          return base;
        });
        this.tahunanCharts.dxyDowntimeLine = new Chart(canvas, {
          type: "doughnut",
          data: {
            labels,
            datasets: [{ data: act, backgroundColor: colors, borderColor: cssVar("--panel"), borderWidth: 2 }],
          },
          options: {
            responsive: true, maintainAspectRatio: false, animation: noAnim,
            layout: { padding: { left: 8, right: 8, top: 8, bottom: 8 } },
            cutout: "62%",
            interaction: { mode: "nearest", intersect: true },
            plugins: { legend: legend(true), tooltip: tooltip() },
          },
          plugins: [donutLeaderLabels((v) => fmtNum(v))],
        });
      }, "downtimeLine");
    },
    // Chart "Month" di tab Kontrol Kualitas (kolom NG Inline & Straightpass)
    // sengaja diisi data yang SAMA dengan grafik di tab Tahunan (NG Inline
    // & Straight Pass), bukan sumber data baru. Style & gradasi warna juga
    // disamakan supaya konsisten.
    renderKualitasCharts() {
      if (typeof Chart === "undefined") return;
      // Warna BATANG tab Kontrol Kualitas -- warna TERANG, senada dengan
      // tab Kontrol Downtime, tapi tetap beda jelas per kelompok:
      //   NG Inline    = merah rose (sama dengan chart NG Inline tab Tahunan)
      //   NG Trial     = cyan
      //   Straightpass = hijau tosca (batang Qty Repair) -- DISAMAKAN
      //                  dengan chart Straight Pass di tab Tahunan.
      // Garis (Value / % Straightpass / Target) tidak diubah.
      const QC_BAR = { ngInline: "#F43F5E", ngTrial: "#06B6D4", straightpass: "#14B8A6" };
      // Garis "% Straightpass" -- HITAM, disamakan dengan tab Tahunan.
      const SP_LINE = "#000000";
      this._qcRenderedSig = this.qcChartSignature();
      // Label 12 bulan FY milik TAB KUALITAS sendiri. Dulu di sini dipakai
      // this.tahunan (state tab Tahunan), sehingga ganti tahun di tab
      // Tahunan ikut menggeser chart di tab ini.
      const qcFyData = this.qcFy || { monthLabels: [], actual: [], repairQty: [], target: 95 };
      const qcMonthLabels = qcFyData.monthLabels || [];
      if (!qcMonthLabels.length) return;
      const destroy = (id) => { if (this.qcCharts[id]) { this.qcCharts[id].destroy(); delete this.qcCharts[id]; } };
      const noAnim = { duration: 0 };
      const safe = (fn, label) => { try { fn(); } catch (e) { console.error("Gagal render chart Kualitas:", label, e); } };

      const baseScales = () => ({
        x: { ticks: { color: "#000000", font: { size: 9 }, autoSkip: false, maxRotation: 0, minRotation: 0 }, grid: { display: false }, border: { display: true, color: cssVar("--border") } },
        y: { ticks: { color: "#000000", font: { size: 9 }, maxTicksLimit: 5 }, grid: { color: cssVar("--chart-grid"), drawTicks: false }, border: { display: true, color: cssVar("--border") }, beginAtZero: true },
      });
      const legend = (show) => ({ display: show, position: "bottom", labels: { color: "#000000", boxWidth: 5, boxHeight: 5, usePointStyle: true, pointStyle: "circle", font: { size: 7.5 }, padding: 3 } });
      const tooltip = () => ({ backgroundColor: cssVar("--panel"), titleColor: cssVar("--text"), bodyColor: cssVar("--text"), borderColor: cssVar("--border"), borderWidth: 1, padding: 10, cornerRadius: 8, displayColors: true, usePointStyle: true });
      // Bar SOLID (tanpa gradasi) -- gradasi dihapus atas permintaan.
      const barBg = (canvas, hex, len) => Array.from({ length: len }, () => hex);
      // Varian barBg KHUSUS chart *Perline -- warna batang line yang lagi
      // dipilih (qcLineFilter) tetap solid/penuh, batang line lainnya
      // dipudarkan (alpha rendah, warna FLAT tanpa gradasi). Kalau
      // qcLineFilter === "ALL" (atau tidak diisi), semua batang tetap
      // solid seperti biasa (perilaku lama, tidak berubah). Datanya
      // SENDIRI tidak difilter/disembunyikan -- cuma warnanya, sesuai
      // permintaan "di-highlight saja".
      const barBgHighlight = (canvas, hex, categories, highlightKey) => {
        return categories.map((cat) => {
          const isDimmed = highlightKey && highlightKey !== "ALL" && cat !== highlightKey;
          return isDimmed ? hex + "38" : hex;
        });
      };

      // Bevel inset "relaxed" tapi lebih tegas: kontras bayangan kuat,
      // blur kecil. Menggantikan efek gradasi lama supaya batang tetap
      // terlihat bervolume walau warnanya solid rata.
      // Bevel batang sekarang dipasang GLOBAL (plugin "dxBarBevel" di
      // <head>) untuk SEMUA grafik batang. Fungsi ini sengaja dibiarkan
      // sebagai no-op supaya pemanggilan lama tidak dobel menggambar.
      const barBevelInset = () => ({ id: "dxNoopBevel_" + Math.random() });
      const barValueLabels = (formatter, datasetIndex = 0, pos = "above") => ({
        id: "dxyQcBarValueLabels_" + datasetIndex + "_" + Math.random(),
        afterDatasetsDraw(chart) {
          const { ctx, chartArea } = chart;
          const meta = chart.getDatasetMeta(datasetIndex);
          const dataset = chart.data.datasets[datasetIndex];
          if (!meta || !dataset || meta.type !== "bar" || !meta.data) return;
          const textColor = "#000000";
          const n = meta.data.length;
          const slotWidth = chartArea && n ? chartArea.width / n : 30;
          const fontSize = slotWidth < 24 ? 7.5 : slotWidth < 34 ? 8.5 : slotWidth < 46 ? 9.5 : 10.5;
          ctx.save();
          ctx.font = `700 ${fontSize}px Inter, sans-serif`;
          ctx.textAlign = "center";
          ctx.fillStyle = textColor;
          meta.data.forEach((bar, i) => {
            const raw = dataset.data[i];
            if (raw === null || raw === undefined) return;
            const val = Number(raw);
            if (Number.isNaN(val) || val === 0) return; // angka 0 (bulan/hari yg belum ada data) tidak dilabeli
            const { x, y, base } = bar.getProps(["x", "y", "base"], true);
            if (pos === "base") {
              // Label di DASAR batang (dekat garis sumbu-x), supaya tidak
              // tabrakan sama label garis Value di atas chart.
              ctx.textBaseline = "bottom";
              ctx.fillText(formatter(val), x, base - 4);
              return;
            }
            const isUp = y <= base;
            ctx.textBaseline = isUp ? "bottom" : "top";
            ctx.fillText(formatter(val), x, isUp ? y - 6 : y + 14);
          });
          ctx.restore();
        },
      });


      // Label angka di atas titik garis yang TIDAK PERNAH skip label -- dipakai
      // khusus buat chart "% Straightpass" (Perline/Model) supaya SEMUA
      // model/line selalu tampil angkanya, walaupun kategorinya banyak dan
      // ada dua label yang berdekatan. Kalau 2 label bakal tabrakan
      // horizontal, label kedua
      // digeser naik (zig-zag antara baris genap & ganjil) alih-alih
      // dihilangkan. bottomSafe tetap dijaga supaya tidak numpuk dengan
      // label batang "Qty Repair" (barValueLabels pos "base") di dekat
      // sumbu-x.
      const lineValueLabelsAll = (formatter, datasetIndex = 1) => ({
        id: "dxyQcLineValueLabelsAll_" + datasetIndex + "_" + Math.random(),
        afterDatasetsDraw(chart) {
          const { ctx, chartArea } = chart;
          const meta = chart.getDatasetMeta(datasetIndex);
          const dataset = chart.data.datasets[datasetIndex];
          if (!meta || !dataset || meta.type !== "line" || !meta.data) return;
          const textColor = "#000000";
          const n = meta.data.length;
          const slotWidth = chartArea && n ? chartArea.width / n : 30;
          const fontSize = slotWidth < 18 ? 6 : slotWidth < 24 ? 7 : slotWidth < 34 ? 8 : slotWidth < 46 ? 9 : 10;
          ctx.save();
          ctx.font = `700 ${fontSize}px Inter, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillStyle = textColor;
          const topSafe = chartArea ? chartArea.top + fontSize + 2 : -Infinity;
          const bottomSafe = chartArea ? chartArea.bottom - 20 : Infinity;
          meta.data.forEach((point, i) => {
            const raw = dataset.data[i];
            if (raw === null || raw === undefined) return;
            const val = Number(raw);
            if (Number.isNaN(val) || val === 0) return; // angka 0 (bulan/hari yg belum ada data) tidak dilabeli
            const label = formatter(val);
            if (label === "0" || label === "0%" || label === "") return;
            const { x, y } = point.getProps(["x", "y"], true);
            // Zig-zag: baris genap sedikit lebih dekat titik, baris ganjil
            // digeser lebih tinggi -- supaya 2 label bersebelahan tidak
            // saling menimpa walau titiknya rapat.
            const lift = i % 2 === 0 ? 6 : fontSize + 10;
            const labelY = Math.min(Math.max(y - lift, topSafe), bottomSafe);
            ctx.fillText(label, x, labelY);
          });
          ctx.restore();
        },
      });

      // Label kecil ("Qty" / "Value" / "%") nempel di ATAS deretan angka
      // sumbu vertikal primary (kiri) & secondary (kanan) -- BUKAN judul
      // sumbu Chart.js bawaan (yang dirotasi 90° & makan lebar chart-area),
      // tapi teks kecil di pojok atas kiri/kanan area chart, PERSIS di atas
      // angka teratas kolom sumbunya masing-masing (chartArea.top adalah
      // batas atas area angka, jadi label ini nempel tepat di atasnya).
      const axisUnitLabels = (primaryText, secondaryText) => ({
        id: "dxyQcAxisUnitLabels_" + Math.random(),
        afterDraw(chart) {
          const { ctx, chartArea, scales } = chart;
          if (!chartArea) return;
          ctx.save();
          ctx.font = "bold 8.5px Inter, sans-serif";
          ctx.fillStyle = "#000000";
          ctx.strokeStyle = "#000000";
          // Karakter "%" secara bentuk glyph memang lebih tipis dibanding
          // huruf ("Qty"/"Value") walau font-weight-nya sama persis --
          // stroke tipis ini menebalkan tinta semua karakter secara merata
          // (termasuk simbol), supaya hitamnya terlihat senada/konsisten.
          ctx.lineWidth = 0.6;
          ctx.textBaseline = "bottom";
          const labelY = chartArea.top - 14;
          if (primaryText && scales.y) {
            ctx.textAlign = "left";
            ctx.strokeText(primaryText, scales.y.left, labelY);
            ctx.fillText(primaryText, scales.y.left, labelY);
          }
          if (secondaryText && scales.y1) {
            ctx.textAlign = "right";
            ctx.strokeText(secondaryText, scales.y1.right, labelY);
            ctx.fillText(secondaryText, scales.y1.right, labelY);
          }
          ctx.restore();
        },
      });

      // --- Month · NG Inline: sekarang pakai data ASLI dari RPC
      // dashboard_qc_ng_month (type_ng = 'NG PRODUKSI'), bukan lagi
      // numpang data gabungan dari tab Tahunan. Kalau Line picker != ALL,
      // dialihkan ke tren 12-bulan KHUSUS line itu (this.qcLineMonthMap),
      // supaya chart teratas ini ikut berubah sesuai line yang dipilih. ---
      safe(() => {
        destroy("qcNgInlineMonth");
        const canvas = document.getElementById("qcNgInlineMonth");
        if (!canvas) return;
        const ngi = this.qcNgInline;
        const lineFilterMonth = this.qcLineFilter || "ALL";
        const ngiMonthForLine = lineFilterMonth === "ALL" ? null : this.qcLineMonthMap.ngInline[lineFilterMonth];
        const monthQty0 = ngiMonthForLine ? ngiMonthForLine.qtyByMonth : ngi.qtyByMonth;
        const monthValue0 = ngiMonthForLine ? ngiMonthForLine.valueByMonth : ngi.valueByMonth;
        // Dua kolom ringkasan di paling kiri: FY sebelumnya (diisi tangan di
        // Master Data) & FY berjalan (rata-rata per bulan). Waktu filter Line
        // dipakai, kolom FY sebelumnya DIKOSONGKAN -- angka manualnya total
        // pabrik, bukan per Line, jadi salah kalau ditempel di satu Line.
        const fyTh = ngi.fyStartYear;
        const perLine = !!ngiMonthForLine;
        const monthLabelsNgi = Number.isFinite(Number(fyTh))
          ? [fyTickLabel(fyTh - 1), fyTickLabel(fyTh), ...ngi.monthLabels]
          : ngi.monthLabels;
        const monthQty = Number.isFinite(Number(fyTh))
          ? [perLine ? null : ngi.fyPrevQty, rataBulanan(monthQty0), ...monthQty0] : monthQty0;
        const monthValue = Number.isFinite(Number(fyTh))
          ? [perLine ? null : ngi.fyPrevValue, rataBulanan(monthValue0), ...monthValue0] : monthValue0;
        this.qcCharts.qcNgInlineMonth = new Chart(canvas, {
          data: {
            labels: monthLabelsNgi,
            datasets: [
              { order: 2, type: "bar", label: "Qty", data: monthQty, backgroundColor: barBg(canvas, QC_BAR.ngInline, monthQty.length), yAxisID: "y", borderRadius: 0, barPercentage: 0.6, categoryPercentage: 0.7 },
              { order: 1, type: "line", label: "Value", data: monthValue, borderColor: "#1D4ED8", backgroundColor: "rgba(29,78,216,0.1)", borderWidth: 1.5, fill: true, yAxisID: "y1", pointRadius: 1, tension: 0.3 },
            ],
          },
          options: {
            responsive: true, maintainAspectRatio: false, animation: noAnim,
            layout: { padding: { top: 38 } },
            plugins: { legend: legend(true), tooltip: tooltip() },
            scales: {
              x: baseScales().x,
              y: { position: "left", ticks: { color: "#000000", font: { size: 9 } }, grid: { color: cssVar("--chart-grid"), drawTicks: false }, border: { display: true, color: cssVar("--border") }, beginAtZero: true, grace: "12%" },
              y1: { position: "right", ticks: { color: "#000000", font: { size: 9 }, callback: (v) => fmtNum(Math.round(v / 1000)) }, grid: { display: false }, border: { display: true, color: cssVar("--border") }, beginAtZero: true, grace: "12%" },
            },
          },
          plugins: [barValueLabels((v) => fmtNum(v), 0, "base"), lineValueLabelsAll((v) => fmtNum(Math.round(v / 1000)), 1), axisUnitLabels("Qty", "Value"), barBevelInset(0)],
        });
      }, "qcNgInlineMonth");

      // --- Month · NG Trial: STRUKTUR sama persis dengan NG Inline (dual
      // axis), tapi warna bar pakai cyan -- disamakan dengan chart NG Trial
      // lain (Perline/Model/Daily) supaya seragam 1 kolom. Value tetap garis
      // biru (sama semua kolom NG). Data asli dari fetchQcNgTrial()
      // (p_type_ng = 'NG TRIAL'). ---
      safe(() => {
        destroy("qcNgTrialMonth");
        const canvas = document.getElementById("qcNgTrialMonth");
        if (!canvas) return;
        const ngt = this.qcNgTrial;
        const labels = qcMonthLabels;
        const lineFilterTrialMonth = this.qcLineFilter || "ALL";
        const ngtMonthForLine = lineFilterTrialMonth === "ALL" ? null : this.qcLineMonthMap.ngTrial[lineFilterTrialMonth];
        const trialQty0 = ngtMonthForLine ? ngtMonthForLine.qtyByMonth : (ngt.qtyByMonth && ngt.qtyByMonth.length ? ngt.qtyByMonth : labels.map(() => null));
        const trialValue0 = ngtMonthForLine ? ngtMonthForLine.valueByMonth : (ngt.valueByMonth && ngt.valueByMonth.length ? ngt.valueByMonth : labels.map(() => null));
        // Dua kolom ringkasan di paling kiri -- aturannya sama dengan chart
        // NG Inline Month: FY sebelumnya diisi tangan, FY berjalan dihitung,
        // dan kolom FY sebelumnya dikosongkan kalau filter Line dipakai.
        const fyThT = ngt.fyStartYear;
        const adaFyT = Number.isFinite(Number(fyThT));
        const perLineT = !!ngtMonthForLine;
        const labelsT = adaFyT ? [fyTickLabel(fyThT - 1), fyTickLabel(fyThT), ...labels] : labels;
        const trialQty = adaFyT
          ? [perLineT ? null : ngt.fyPrevQty, rataBulanan(trialQty0), ...trialQty0] : trialQty0;
        const trialValue = adaFyT
          ? [perLineT ? null : ngt.fyPrevValue, rataBulanan(trialValue0), ...trialValue0] : trialValue0;
        this.qcCharts.qcNgTrialMonth = new Chart(canvas, {
          data: {
            labels: labelsT,
            datasets: [
              { order: 2, type: "bar", label: "Qty", data: trialQty, backgroundColor: barBg(canvas, QC_BAR.ngTrial, trialQty.length), yAxisID: "y", borderRadius: 0, barPercentage: 0.6, categoryPercentage: 0.7 },
              { order: 1, type: "line", label: "Value", data: trialValue, borderColor: "#1D4ED8", backgroundColor: "rgba(29,78,216,0.1)", borderWidth: 1.5, fill: true, yAxisID: "y1", pointRadius: 1, tension: 0.3 },
            ],
          },
          options: {
            responsive: true, maintainAspectRatio: false, animation: noAnim,
            layout: { padding: { top: 38 } },
            plugins: { legend: legend(true), tooltip: tooltip() },
            scales: {
              x: baseScales().x,
              y: { position: "left", ticks: { color: "#000000", font: { size: 9 } }, grid: { color: cssVar("--chart-grid"), drawTicks: false }, border: { display: true, color: cssVar("--border") }, beginAtZero: true, grace: "12%" },
              y1: { position: "right", ticks: { color: "#000000", font: { size: 9 }, callback: (v) => fmtNum(Math.round(v / 1000)) }, grid: { display: false }, border: { display: true, color: cssVar("--border") }, beginAtZero: true, grace: "12%" },
            },
          },
          plugins: [barValueLabels((v) => fmtNum(v), 0, "base"), lineValueLabelsAll((v) => fmtNum(Math.round(v / 1000)), 1), axisUnitLabels("Qty", "Value"), barBevelInset(0)],
        });
      }, "qcNgTrialMonth");

      // --- Month · Straightpass: disamakan gaya sama chart Straightpass
      // Perline/Model -- bar "Qty Repair" (kiri) + garis hijau
      // "% Straightpass" (kanan) + garis merah putus-putus "Target".
      // Label bar di DASAR batang & label garis % pakai anti-tumpuk
      // (lineValueLabelsAll, label digeser zig-zag), sama persis
      // mekanismenya dengan qcRepairStraightpassBar (Perline/Model).
      // Kalau Line picker != ALL: bar "Qty Repair" dialihkan ke data akurat
      // per-line (this.qcLineMonthMap.repair) -- tapi garis "% Straightpass"
      // TETAP data gabungan semua line (keterbatasan data stroke per-line,
      // lihat catatan di fetchQcLineModelMap()).
      safe(() => {
        destroy("qcStraightpassMonth");
        const canvas = document.getElementById("qcStraightpassMonth");
        if (!canvas) return;
        // Sumbernya this.qcFy (milik tab Kualitas sendiri) -- BUKAN
        // this.tahunan, supaya ganti tahun di tab Tahunan tidak menggeser
        // chart ini. Deret qcFy sudah 12 bulan, jadi tidak perlu .slice(2).
        const f = qcFyData;
        const lineFilterSpMonth = this.qcLineFilter || "ALL";
        const repairMonthForLine = lineFilterSpMonth === "ALL" ? null : this.qcLineMonthMap.repair[lineFilterSpMonth];
        const repairQty0 = repairMonthForLine ? repairMonthForLine.qtyByMonth : (f.repairQty || []);
        const actual0 = f.actual || [];
        // Dua kolom ringkasan di paling kiri -- lihat penjelasan di chart
        // NG Inline Month. Qty Repair = rata-rata per bulan, % = rata-rata.
        const fyThSp = f.fyStartYear;
        const perLineSp = !!repairMonthForLine;
        const adaFySp = Number.isFinite(Number(fyThSp));
        const rataPersen = (arr) => {
          const v = (arr || []).filter((x) => x !== null && x !== undefined && Number.isFinite(Number(x)));
          return v.length ? Number((v.reduce((a, b) => a + Number(b), 0) / v.length).toFixed(1)) : null;
        };
        const labels = adaFySp ? [fyTickLabel(fyThSp - 1), fyTickLabel(fyThSp), ...qcMonthLabels] : qcMonthLabels;
        const repairQty = adaFySp
          ? [perLineSp ? null : f.fyPrevRepair, rataBulanan(repairQty0), ...repairQty0] : repairQty0;
        const actual = adaFySp
          ? [perLineSp ? null : f.fyPrevSp, rataPersen(actual0), ...actual0] : actual0;
        this.qcCharts.qcStraightpassMonth = new Chart(canvas, {
          data: {
            labels,
            datasets: [
              { order: 2, type: "bar", label: "Qty Repair", data: repairQty, backgroundColor: barBg(canvas, QC_BAR.straightpass, repairQty.length), yAxisID: "y", borderRadius: 0, barPercentage: 0.6, categoryPercentage: 0.7 },
              { order: 1, type: "line", label: "% Straightpass", data: actual, borderColor: SP_LINE, backgroundColor: SP_LINE, borderWidth: 1.5, yAxisID: "y1", pointRadius: 1, tension: 0.3, spanGaps: true },
              { order: 1, type: "line", label: "Target", data: labels.map(() => f.target), borderColor: "#EF4444", borderDash: [4, 3], borderWidth: 1.5, pointRadius: 0, tension: 0, yAxisID: "y1" },
            ],
          },
          options: {
            responsive: true, maintainAspectRatio: false, animation: noAnim,
            layout: { padding: { top: 38 } },
            plugins: { legend: legend(true), tooltip: tooltip() },
            scales: {
              x: { ticks: { color: "#000000", font: { size: 9 }, autoSkip: false, maxRotation: 0, minRotation: 0 }, grid: { display: false }, border: { display: true, color: cssVar("--border") } },
              y: { position: "left", ticks: { color: "#000000", font: { size: 9 } }, grid: { color: cssVar("--chart-grid"), drawTicks: false }, border: { display: true, color: cssVar("--border") }, beginAtZero: true, grace: "12%" },
              y1: { position: "right", ticks: { color: "#000000", font: { size: 9 }, callback: (v) => v + "%" }, grid: { display: false }, border: { display: true, color: cssVar("--border") }, beginAtZero: true, suggestedMax: 100, grace: "8%" },
            },
          },
          plugins: [barValueLabels((v) => (v === null ? "" : fmtNum(v)), 0, "base"), lineValueLabelsAll((v) => (v === null ? "" : v + "%"), 1), axisUnitLabels("Qty", "%"), barBevelInset(0)],
        });
      }, "qcStraightpassMonth");

      // Dual-axis: bar "Qty Repair" (kiri) + garis "% Straightpass" (kanan,
      // 0-100) -- dipakai di chart Straightpass Perline & Model.
      const qcRepairStraightpassBar = (canvasId, categories, qtyData, pctData, highlightKey = null) => {
        safe(() => {
          destroy(canvasId);
          const canvas = document.getElementById(canvasId);
          if (!canvas) return;
          const qty = qtyData || categories.map(() => null);
          const pct = pctData || categories.map(() => null);
          this.qcCharts[canvasId] = new Chart(canvas, {
            data: {
              labels: categories,
              datasets: [
                { order: 2, type: "bar", label: "Qty Repair", data: qty, backgroundColor: barBgHighlight(canvas, QC_BAR.straightpass, categories, highlightKey), yAxisID: "y", borderRadius: 0, barPercentage: 0.6, categoryPercentage: 0.7 },
                { order: 1, type: "line", label: "% Straightpass", data: pct, borderColor: SP_LINE, backgroundColor: SP_LINE, borderWidth: 1.5, yAxisID: "y1", pointRadius: 1, tension: 0.3, spanGaps: true },
              ],
            },
            options: {
              responsive: true, maintainAspectRatio: false, animation: noAnim,
              layout: { padding: { top: 38 } },
              plugins: { legend: legend(true), tooltip: tooltip() },
              scales: {
                // Font sumbu X dikecilkan khusus di chart ini (bukan pakai
                // baseScales().x apa adanya) -- karena chart ini dual-axis
                // (2 sumbu Y kiri-kanan), ruang buat kategori (E-02..E-07 /
                // 9 nama model) jadi lebih sempit dibanding chart NG yang
                // cuma 1 sumbu, jadi nama model gampang numpuk kalau
                // fontnya tidak diperkecil.
                x: { ticks: { color: "#000000", font: { size: 8 }, autoSkip: false, maxRotation: 0, minRotation: 0 }, grid: { display: false }, border: { display: true, color: cssVar("--border") } },
                // Judul sumbu ("Qty Repair" / "% Straightpass") DIHAPUS --
                // teks judul itu makan lebar chart-area, mengecilkan ruang
                // horizontal yang tersisa buat kategori. Info kategori mana
                // punya-siapa sudah cukup jelas dari warna + legend di bawah.
                y: { position: "left", ticks: { color: "#000000", font: { size: 9 } }, grid: { color: cssVar("--chart-grid"), drawTicks: false }, border: { display: true, color: cssVar("--border") }, beginAtZero: true, grace: "12%" },
                y1: { position: "right", ticks: { color: "#000000", font: { size: 9 }, callback: (v) => v + "%" }, grid: { display: false }, border: { display: true, color: cssVar("--border") }, beginAtZero: true, suggestedMax: 100, grace: "8%" },
              },
            },
            plugins: [barValueLabels((v) => (v === null ? "" : fmtNum(v)), 0, "base"), lineValueLabelsAll((v) => (v === null ? "" : v + "%"), 1), axisUnitLabels("Qty", "%"), barBevelInset(0)],
          });
        }, canvasId);
      };
      // Dual-axis: bar "Qty" (kiri) + garis area "Value" (kanan, Rp/1000)
      // -- dipakai di chart NG Inline/Trial Perline & Model.
      const qcQtyValueBar = (canvasId, categories, hexBar, qtyData, valueData, highlightKey = null) => {
        safe(() => {
          destroy(canvasId);
          const canvas = document.getElementById(canvasId);
          if (!canvas) return;
          const qty = qtyData || categories.map(() => null);
          const value = valueData || categories.map(() => null);
          this.qcCharts[canvasId] = new Chart(canvas, {
            data: {
              labels: categories,
              datasets: [
                { order: 2, type: "bar", label: "Qty", data: qty, backgroundColor: barBgHighlight(canvas, hexBar, categories, highlightKey), yAxisID: "y", borderRadius: 0, barPercentage: 0.6, categoryPercentage: 0.7 },
                { order: 1, type: "line", label: "Value", data: value, borderColor: "#1D4ED8", backgroundColor: "rgba(29,78,216,0.1)", borderWidth: 1.5, fill: true, yAxisID: "y1", pointRadius: 1, tension: 0.3, spanGaps: true },
              ],
            },
            options: {
              responsive: true, maintainAspectRatio: false, animation: noAnim,
              layout: { padding: { top: 38 } },
              plugins: { legend: legend(true), tooltip: tooltip() },
              scales: {
                x: { ticks: { color: "#000000", font: { size: 8 }, autoSkip: false, maxRotation: 0, minRotation: 0 }, grid: { display: false }, border: { display: true, color: cssVar("--border") } },
                y: { position: "left", ticks: { color: "#000000", font: { size: 9 } }, grid: { color: cssVar("--chart-grid"), drawTicks: false }, border: { display: true, color: cssVar("--border") }, beginAtZero: true, grace: "12%" },
                y1: { position: "right", ticks: { color: "#000000", font: { size: 9 }, callback: (v) => fmtNum(Math.round(v / 1000)) }, grid: { display: false }, border: { display: true, color: cssVar("--border") }, beginAtZero: true, grace: "12%" },
              },
            },
            plugins: [barValueLabels((v) => (v === null ? "" : fmtNum(v)), 0, "base"), lineValueLabelsAll((v) => (v === null ? "" : fmtNum(Math.round(v / 1000))), 1), axisUnitLabels("Qty", "Value"), barBevelInset(0)],
          });
        }, canvasId);
      };
      const ngi = this.qcNgInline;
      const ngt = this.qcNgTrial;
      const lineFilter = this.qcLineFilter || "ALL";

      // Susun ulang data chart *Model supaya cuma menampilkan model yang
      // BENERAN ada di line yang dipilih (lineFilter), pakai this.qcLineModelMap
      // (SELALU representasi 1 bulan penuh, lihat fetchQcLineModelMap()).
      // Kalau lineFilter "ALL", balikin data asli apa adanya (perilaku lama).
      const modelDataForLine = (mapKey, allQty, allValue) => {
        if (lineFilter === "ALL") return { categories: QC_MODELS, qty: allQty, value: allValue };
        const rowsForLine = (this.qcLineModelMap[mapKey] || {})[lineFilter] || {};
        const categories = QC_MODELS.filter((m) => rowsForLine[m]);
        if (categories.length === 0) return { categories: QC_MODELS, qty: allQty.map(() => 0), value: (allValue || []).map(() => 0) };
        const qty = categories.map((m) => rowsForLine[m].qty || 0);
        const value = categories.map((m) => rowsForLine[m].value || 0);
        return { categories, qty, value };
      };
      const ngiModel = modelDataForLine("ngInline", ngi.permodelQty, ngi.permodelValue);
      const ngtModel = modelDataForLine("ngTrial", ngt.permodelQty, ngt.permodelValue);

      // Straightpass Model: cuma SARING daftar model berdasarkan data Repair
      // per-line (akurat, dari repair_log asli) -- Qty Repair yang ditampilkan
      // pun jadi akurat per-line. Tapi %-nya TETAP dari data gabungan semua
      // line (this.qcStraightpass.permodelActual), karena dashboard belum
      // punya data stroke per kombinasi line+model (lihat catatan di
      // fetchQcLineModelMap()). Ini sudah dikonfirmasi & diterima sebagai
      // batasan sementara.
      let straightpassModelCategories = QC_MODELS;
      let straightpassModelQty = this.qcRepair.permodelQty;
      let straightpassModelPct = this.qcStraightpass.permodelActual;
      if (lineFilter !== "ALL") {
        const repairRowsForLine = (this.qcLineModelMap.repair || {})[lineFilter] || {};
        const modelsInLine = QC_MODELS.filter((m) => repairRowsForLine[m]);
        if (modelsInLine.length > 0) {
          straightpassModelCategories = modelsInLine;
          straightpassModelQty = modelsInLine.map((m) => repairRowsForLine[m].qty || 0);
          straightpassModelPct = modelsInLine.map((m) => {
            const idx = QC_MODELS.indexOf(m);
            return idx === -1 ? null : this.qcStraightpass.permodelActual[idx];
          });
        }
      }

      qcQtyValueBar("qcNgInlinePerline", QC_LINES, QC_BAR.ngInline, ngi.perlineQty, ngi.perlineValue, lineFilter);
      qcQtyValueBar("qcNgInlineModel", ngiModel.categories, QC_BAR.ngInline, ngiModel.qty, ngiModel.value);
      qcQtyValueBar("qcNgTrialPerline", QC_LINES, QC_BAR.ngTrial, ngt.perlineQty, ngt.perlineValue, lineFilter);
      qcQtyValueBar("qcNgTrialModel", ngtModel.categories, QC_BAR.ngTrial, ngtModel.qty, ngtModel.value);
      qcRepairStraightpassBar("qcStraightpassPerline", QC_LINES, this.qcRepair.perlineQty, this.qcStraightpass.perlineActual, lineFilter);
      qcRepairStraightpassBar("qcStraightpassModel", straightpassModelCategories, straightpassModelQty, straightpassModelPct);

      // --- Daily: tanggal 1-31, dual axis. NG Inline & NG Trial pakai
      // Qty (bar) + Value (garis); Straightpass pakai Qty (bar) + % (garis).
      // NG Inline sudah pakai data asli; NG Trial & Straightpass masih
      // dikosongkan dulu (belum ada RPC-nya). ---
      const QC_DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1));
      const qcDualAxisDaily = (canvasId, hexBar, hexLine, barLabel, lineLabel, lineIsPercent, dataBar, dataLine, opts = {}) => {
        safe(() => {
          destroy(canvasId);
          const canvas = document.getElementById(canvasId);
          if (!canvas) return;
          const barData = dataBar || QC_DAYS.map(() => null);
          const lineData = dataLine || QC_DAYS.map(() => null);
          // opts.isMoney -> dipakai buat garis Value (Rp): hitam, area
          // tipis transparan 30%, label angka di atas (dibagi 1000), dan
          // label Qty dipindah ke dalam batang supaya tidak tabrakan.
          const isMoney = !!opts.isMoney;
          this.qcCharts[canvasId] = new Chart(canvas, {
            data: {
              labels: QC_DAYS,
              datasets: [
                { order: 2, type: "bar", label: barLabel, data: barData, backgroundColor: barBg(canvas, hexBar, QC_DAYS.length), yAxisID: "y", borderRadius: 0, barPercentage: 0.6, categoryPercentage: 0.75 },
                { order: 1, type: "line", label: lineLabel, data: lineData, borderColor: isMoney ? "#1D4ED8" : hexLine, backgroundColor: isMoney ? "rgba(29,78,216,0.1)" : hexLine, borderWidth: 1.5, fill: isMoney, yAxisID: "y1", pointRadius: 1, tension: 0.3, spanGaps: true },
              ],
            },
            options: {
              responsive: true, maintainAspectRatio: false, animation: noAnim,
              layout: { padding: { top: 32 } },
              plugins: { legend: legend(true), tooltip: tooltip() },
              scales: {
                x: { ticks: { color: "#000000", font: { size: 8 }, autoSkip: false, maxRotation: 0, minRotation: 0 }, grid: { display: false }, border: { display: true, color: cssVar("--border") } },
                y: { position: "left", ticks: { color: "#000000", font: { size: 9 } }, grid: { color: cssVar("--chart-grid"), drawTicks: false }, border: { display: true, color: cssVar("--border") }, beginAtZero: true, grace: "12%" },
                y1: { position: "right", ticks: { color: "#000000", font: { size: 9 }, callback: (v) => (lineIsPercent ? v + "%" : isMoney ? fmtNum(Math.round(v / 1000)) : v) }, grid: { display: false }, border: { display: true, color: cssVar("--border") }, beginAtZero: true, grace: lineIsPercent ? "8%" : "12%", ...(lineIsPercent ? { suggestedMax: 100 } : {}) },
              },
            },
            plugins: [
              barValueLabels((v) => fmtNum(v), 0, opts.barLabelPos || (isMoney ? "base" : "above")),
              ...(lineIsPercent ? [lineValueLabelsAll((v) => v + "%", 1)] : []),
              ...(isMoney ? [lineValueLabelsAll((v) => fmtNum(Math.round(v / 1000)), 1)] : []),
              axisUnitLabels("Qty", lineIsPercent ? "%" : "Value"),
              barBevelInset(0),
            ],
          });
        }, canvasId);
      };
      // Daily per-Line: NG Inline & NG Trial akurat penuh (Qty+Value) dari
      // this.qcLineDayMap, karena baris mentahnya memang punya kolom mesin.
      // Straightpass cuma bar "Qty Repair" yang akurat per-line -- garis
      // "% Straightpass" TETAP data gabungan semua line (keterbatasan sama
      // seperti Month/Model, dashboard belum punya stroke harian per-line).
      const ngiDayForLine = lineFilter === "ALL" ? null : this.qcLineDayMap.ngInline[lineFilter];
      const ngtDayForLine = lineFilter === "ALL" ? null : this.qcLineDayMap.ngTrial[lineFilter];
      const repDayForLine = lineFilter === "ALL" ? null : this.qcLineDayMap.repair[lineFilter];
      const ngiDailyQty = ngiDayForLine ? ngiDayForLine.qtyByDay : ngi.dailyQty;
      const ngiDailyValue = ngiDayForLine ? ngiDayForLine.valueByDay : ngi.dailyValue;
      const ngtDailyQty = ngtDayForLine ? ngtDayForLine.qtyByDay : ngt.dailyQty;
      const ngtDailyValue = ngtDayForLine ? ngtDayForLine.valueByDay : ngt.dailyValue;
      const spDailyRepairQty = repDayForLine ? repDayForLine.qtyByDay : this.qcStraightpass.dailyRepairQty;
      qcDualAxisDaily("qcNgInlineDaily", QC_BAR.ngInline, "#8B5CF6", "Qty", "Value", false, ngiDailyQty, ngiDailyValue, { isMoney: true });
      qcDualAxisDaily("qcNgTrialDaily", QC_BAR.ngTrial, "#8B5CF6", "Qty", "Value", false, ngtDailyQty, ngtDailyValue, { isMoney: true });
      qcDualAxisDaily("qcStraightpassDaily", QC_BAR.straightpass, SP_LINE, "Qty Repair", "% Straightpass", true, spDailyRepairQty, this.qcStraightpass.dailyPercent, { barLabelPos: "base" });
    },
    // Chart Trend Kehadiran Harian (tanggal 1-31) di tab Kontrol Attendance.
    // Batang BERTUMPUK (stacked): Hadir + Izin + Sakit + Cuti + Mangkir,
    // tiap kategori warna beda -- ditumpuk per tanggal supaya kelihatan
    // dari total orang di hari itu, berapa yang hadir vs nggak masuk dan
    // alasannya apa. Plus garis "% Kehadiran" di sumbu kanan.
    renderAttendanceCharts() {
      if (typeof Chart === "undefined") return;
      const a = this.attendance;
      const destroy = (id) => { if (this.attendanceCharts[id]) { this.attendanceCharts[id].destroy(); delete this.attendanceCharts[id]; } };
      const safe = (fn, label) => { try { fn(); } catch (e) { console.error("Gagal render chart Attendance:", label, e); } };
      const noAnim = { duration: 0 };
      const legend = (show) => ({ display: show, position: "bottom", labels: { color: "#000000", boxWidth: 5, boxHeight: 5, usePointStyle: true, pointStyle: "circle", font: { size: 7.5 }, padding: 3 } });
      const tooltip = () => ({ backgroundColor: cssVar("--panel"), titleColor: cssVar("--text"), bodyColor: cssVar("--text"), borderColor: cssVar("--border"), borderWidth: 1, padding: 8, cornerRadius: 8 });
      const barBg = (hex, len) => Array.from({ length: len }, () => hex);
      const AT_DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1));
      // Label angka di TENGAH tiap segmen batang -- cuma muncul kalau
      // nilainya > 0 (biar nggak numpuk angka "0" di semua batang kosong).
      const dl = { display: (ctx) => (ctx.dataset.data[ctx.dataIndex] || 0) > 0, color: "#fff", anchor: "center", align: "center", font: { size: 8, weight: "bold" }, formatter: (v) => v };
      // Label angka % Kehadiran (garis hijau, sumbu kanan y1) -- ditaruh
      // di atas titik juga, warna hijau senada garisnya.
      const dlPersen = { display: (ctx) => ctx.dataset.data[ctx.dataIndex] !== null && ctx.dataset.data[ctx.dataIndex] !== undefined, color: "#10B981", anchor: "end", align: "top", offset: 4, font: { size: 8, weight: "bold" }, formatter: (v) => v + "%" };

      safe(() => {
        destroy("dxaTrendKehadiran");
        const canvas = document.getElementById("dxaTrendKehadiran");
        if (!canvas) return;
        // Sumbu kiri (jumlah orang) sekarang di-fix di angka 15 (bukan 60
        // lagi) -- karena garis Hadir sudah tidak ikut skala ini, sumbu ini
        // cuma perlu menampung batang Izin/Sakit/Cuti/Mangkir yang jumlahnya
        // biasanya kecil (0-15 orang). Efeknya batang-batang itu jadi jauh
        // lebih kelihatan proporsinya.
        const maxTotal = 15;
        const hadirColor = "#2563EB";
        // Angka Hadir TIDAK lagi digambar sebagai garis (biar tidak ikut
        // skala 0-15 dan "kabur" ke luar chart kalau nilainya besar,
        // misal 46). Sebagai gantinya, dipakai plugin custom di bawah yang
        // menggambar kotak/badge biru berisi angka Hadir di posisi TETAP
        // (bukan ngikut skala data Hadir asli). Baris badge ini dihitung
        // dari posisi sumbu %Kehadiran (y1) di nilai 100 -- jadi selalu
        // berada DI BAWAH baris label %Kehadiran, dengan jarak aman, dan
        // tidak akan pernah numpuk walau %Kehadiran-nya 100%.
        const hadirBadgePlugin = {
          id: "hadirBadgePlugin",
          afterDatasetsDraw(chart, _args, opts) {
            if (!opts || opts.display === false) return;
            const data = opts.data || [];
            const { ctx, chartArea, scales } = chart;
            const xScale = scales.x;
            const y1Scale = scales.y1;
            if (!xScale) return;
            ctx.save();
            ctx.font = "bold 8px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            // Posisi baris label %Kehadiran tertinggi (nilai 100) di atas
            // titiknya kira-kira setinggi ~16px (offset label + tinggi
            // font). Badge Hadir ditaruh 18px LEBIH BAWAH dari titik itu,
            // supaya ada jarak yang jelas (tidak mepet) di bawah label
            // %Kehadiran, sekaligus tetap di baris atas chart.
            const percentTopPixel = y1Scale ? y1Scale.getPixelForValue(100) : chartArea.top;
            const badgeY = Math.max(chartArea.top + 10, percentTopPixel + 18);
            data.forEach((val, i) => {
              if (val === null || val === undefined) return;
              const x = xScale.getPixelForValue(i);
              const label = String(val);
              const textWidth = ctx.measureText(label).width;
              const boxW = Math.max(textWidth + 6, 13);
              const boxH = 11;
              const x0 = x - boxW / 2, y0 = badgeY - boxH / 2;
              const r = 3;
              ctx.fillStyle = opts.color || hadirColor;
              ctx.beginPath();
              ctx.moveTo(x0 + r, y0);
              ctx.arcTo(x0 + boxW, y0, x0 + boxW, y0 + boxH, r);
              ctx.arcTo(x0 + boxW, y0 + boxH, x0, y0 + boxH, r);
              ctx.arcTo(x0, y0 + boxH, x0, y0, r);
              ctx.arcTo(x0, y0, x0 + boxW, y0, r);
              ctx.closePath();
              ctx.fill();
              ctx.fillStyle = "#ffffff";
              ctx.fillText(label, x, badgeY + 0.5);
            });
            ctx.restore();
          },
        };
        this.attendanceCharts.dxaTrendKehadiran = new Chart(canvas, {
          plugins: [hadirBadgePlugin],
          data: {
            labels: AT_DAYS,
            datasets: [
              { order: 2, type: "bar", label: "Izin", data: a.dailyTrend.izin, backgroundColor: barBg("#F59E0B", AT_DAYS.length), yAxisID: "y", stack: "att", borderRadius: 0, barPercentage: 0.6, categoryPercentage: 0.75, datalabels: dl },
              { order: 2, type: "bar", label: "Sakit", data: a.dailyTrend.sakit, backgroundColor: barBg("#F97316", AT_DAYS.length), yAxisID: "y", stack: "att", borderRadius: 0, barPercentage: 0.6, categoryPercentage: 0.75, datalabels: dl },
              { order: 2, type: "bar", label: "Cuti", data: a.dailyTrend.cuti, backgroundColor: barBg("#8B5CF6", AT_DAYS.length), yAxisID: "y", stack: "att", borderRadius: 0, barPercentage: 0.6, categoryPercentage: 0.75, datalabels: dl },
              { order: 2, type: "bar", label: "Mangkir", data: a.dailyTrend.mangkir, backgroundColor: barBg("#EF4444", AT_DAYS.length), yAxisID: "y", stack: "att", borderRadius: 3, barPercentage: 0.6, categoryPercentage: 0.75, datalabels: dl },
              { order: 1, type: "line", label: "% Kehadiran", data: a.dailyTrend.persen, borderColor: "#10B981", backgroundColor: "#10B981", borderWidth: 1.5, fill: false, yAxisID: "y1", pointRadius: 2, tension: 0.3, spanGaps: true, datalabels: dlPersen },
            ],
          },
          options: {
            responsive: true, maintainAspectRatio: false, animation: noAnim,
            layout: { padding: { top: 20 } },
            plugins: {
              legend: {
                ...legend(true),
                labels: {
                  ...legend(true).labels,
                  // Legend "Hadir" ditambahkan manual (bukan dari dataset
                  // asli, karena garis Hadir sudah dihapus dari chart).
                  // Klik legend ini toggle tampil/sembunyi badge Hadir.
                  generateLabels: (chart) => {
                    const items = Chart.defaults.plugins.legend.labels.generateLabels(chart);
                    const badgeOpts = chart.options.plugins.hadirBadgePlugin || {};
                    items.unshift({
                      text: "Hadir",
                      fillStyle: hadirColor,
                      strokeStyle: hadirColor,
                      pointStyle: "circle",
                      hidden: badgeOpts.display === false,
                      datasetIndex: -1,
                    });
                    return items;
                  },
                },
                onClick: (e, legendItem, legendEl) => {
                  if (legendItem.datasetIndex === -1) {
                    const chart = legendEl.chart;
                    const badgeOpts = chart.options.plugins.hadirBadgePlugin;
                    badgeOpts.display = badgeOpts.display === false;
                    chart.update();
                    return;
                  }
                  Chart.defaults.plugins.legend.onClick(e, legendItem, legendEl);
                },
              },
              tooltip: tooltip(),
              hadirBadgePlugin: { display: true, color: hadirColor, data: a.dailyTrend.hadir },
            },
            scales: {
              x: { stacked: true, ticks: { color: "#000000", font: { size: 8 }, autoSkip: false, maxRotation: 0, minRotation: 0 }, grid: { display: false }, border: { display: true, color: cssVar("--border") } },
              y: { stacked: true, position: "left", min: 0, max: maxTotal, ticks: { color: "#000000", font: { size: 9 }, precision: 0 }, grid: { color: cssVar("--chart-grid"), drawTicks: false }, border: { display: true, color: cssVar("--border") } },
              y1: { position: "right", min: 0, max: 110, ticks: { color: "#000000", font: { size: 9 }, stepSize: 20, callback: (v) => v + "%" }, grid: { display: false }, border: { display: true, color: cssVar("--border") } },
            },
          },
        });
      }, "trendKehadiran");
    },
    // Chart "Rekap Tahunan" (tab Kontrol Attendance -> Tahunan). Bar hijau
    // "Rata-rata Kehadiran" di sumbu kiri (jumlah orang) + garis teal
    // "Rasio Kehadiran" (%) di sumbu kanan -- "Total MP" TIDAK digambar
    // sebagai bar, tapi sebagai KOTAK/BADGE biru di posisi tetap (persis
    // pola hadirBadgePlugin di chart Trend Kehadiran Harian), karena Total
    // MP cuma angka input (bukan nilai yang perlu diukur skalanya di
    // sumbu). 12 kolom bulan (April - Maret), data dari fetchAttendanceTahunan().
    renderAttendanceTahunanChart() {
      if (typeof Chart === "undefined") return;
      const t = this.attendanceTahunan;
      const canvas = document.getElementById("dxaRekapTahunan");
      if (!canvas) return;
      if (this.attendanceCharts.dxaRekapTahunan) { this.attendanceCharts.dxaRekapTahunan.destroy(); delete this.attendanceCharts.dxaRekapTahunan; }
      try {
        const noAnim = { duration: 0 };
        const tooltip = { backgroundColor: cssVar("--panel"), titleColor: cssVar("--text"), bodyColor: cssVar("--text"), borderColor: cssVar("--border"), borderWidth: 1, padding: 8, cornerRadius: 8 };
        const barBg = (hex, len) => Array.from({ length: len }, () => hex);
        const mpColor = "#2563EB";

        // Label angka DI TENGAH batang "Rata-rata Kehadiran" (bukan di
        // atas lagi) -- warna putih supaya kontras di atas warna hijau.
        const barValueLabels = (datasetIndex) => ({
          id: "dxaRekapTahunanBarLabels_" + datasetIndex,
          afterDatasetsDraw(chart) {
            const meta = chart.getDatasetMeta(datasetIndex);
            const dataset = chart.data.datasets[datasetIndex];
            if (!meta || !dataset || meta.type !== "bar" || !meta.data) return;
            const { ctx } = chart;
            ctx.save();
            ctx.font = "700 9px Inter, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = "#ffffff";
            meta.data.forEach((bar, i) => {
              const raw = dataset.data[i];
              if (raw === null || raw === undefined) return;
              const { x, y, base } = bar.getProps(["x", "y", "base"], true);
              ctx.fillText(String(raw), x, (y + base) / 2);
            });
            ctx.restore();
          },
        });
        // Label % DI ATAS tiap titik garis (Rasio Kehadiran).
        const lineValueLabels = (datasetIndex) => ({
          id: "dxaRekapTahunanLineLabels",
          afterDatasetsDraw(chart) {
            const meta = chart.getDatasetMeta(datasetIndex);
            const dataset = chart.data.datasets[datasetIndex];
            if (!meta || !dataset || meta.type !== "line" || !meta.data) return;
            const { ctx } = chart;
            ctx.save();
            ctx.font = "700 9px Inter, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "bottom";
            ctx.fillStyle = "#0D9488";
            meta.data.forEach((point, i) => {
              const raw = dataset.data[i];
              if (raw === null || raw === undefined) return;
              const { x, y } = point.getProps(["x", "y"], true);
              ctx.fillText(raw + "%", x, y - 6);
            });
            ctx.restore();
          },
        });

        // Kotak/badge biru "Total MP" -- POLA SAMA PERSIS seperti
        // hadirBadgePlugin di chart Trend Kehadiran Harian (renderAttendanceCharts()):
        // digambar di posisi Y TETAP (bukan ngikut skala sumbu), 1 badge
        // per bulan, bulan yang datanya null (belum ada input) di-skip
        // otomatis -- jadi bulan yang belum diisi memang kosong.
        const totalMpBadgePlugin = {
          id: "totalMpBadgePlugin",
          afterDatasetsDraw(chart, _args, opts) {
            if (!opts || opts.display === false) return;
            const data = opts.data || [];
            const { ctx, chartArea, scales } = chart;
            const xScale = scales.x;
            if (!xScale) return;
            ctx.save();
            ctx.font = "bold 9px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            // Badge digambar DI ATAS area plot (di zona padding atas
            // chart, sebelum chartArea mulai) -- supaya SELALU berada di
            // atas garis %Kehadiran & labelnya, berapa pun tingginya nilai
            // % itu, bukan ngikut skala manapun. Butuh layout.padding.top
            // yang cukup lebar (lihat options di bawah) supaya kotak ini
            // tidak kepotong tepi atas kanvas.
            const badgeY = chartArea.top - 12;
            data.forEach((val, i) => {
              if (val === null || val === undefined) return;
              const x = xScale.getPixelForValue(i);
              const label = String(val);
              const textWidth = ctx.measureText(label).width;
              const boxW = Math.max(textWidth + 8, 20);
              const boxH = 14;
              const x0 = x - boxW / 2, y0 = badgeY - boxH / 2;
              const r = 4;
              ctx.fillStyle = opts.color || mpColor;
              ctx.beginPath();
              ctx.moveTo(x0 + r, y0);
              ctx.arcTo(x0 + boxW, y0, x0 + boxW, y0 + boxH, r);
              ctx.arcTo(x0 + boxW, y0 + boxH, x0, y0 + boxH, r);
              ctx.arcTo(x0, y0 + boxH, x0, y0, r);
              ctx.arcTo(x0, y0, x0 + boxW, y0, r);
              ctx.closePath();
              ctx.fill();
              ctx.fillStyle = "#ffffff";
              ctx.fillText(label, x, badgeY + 0.5);
            });
            ctx.restore();
          },
        };

        this.attendanceCharts.dxaRekapTahunan = new Chart(canvas, {
          data: {
            labels: t.labels,
            datasets: [
              { order: 2, type: "bar", label: "Rata-rata Kehadiran", data: t.avgHadir, backgroundColor: barBg("#10B981", t.labels.length), yAxisID: "y", borderRadius: 4, barPercentage: 0.5, categoryPercentage: 0.6 },
              { order: 1, type: "line", label: "Rasio Kehadiran", data: t.avgRasio, borderColor: "#14B8A6", backgroundColor: "#14B8A6", borderWidth: 2, fill: false, yAxisID: "y1", pointRadius: 3, pointBackgroundColor: "#14B8A6", tension: 0.3, spanGaps: true },
            ],
          },
          plugins: [totalMpBadgePlugin, barValueLabels(0), lineValueLabels(1)],
          options: {
            responsive: true, maintainAspectRatio: false, animation: noAnim,
            // padding.top digedein khusus di chart ini -- badge "Total MP"
            // digambar di zona ini (di atas chartArea), jadi butuh ruang
            // lebih dari chart lain yang cuma pakai 20.
            layout: { padding: { top: 34 } },
            plugins: {
              legend: {
                display: true, position: "bottom",
                labels: {
                  color: "#000000", boxWidth: 5, boxHeight: 5, usePointStyle: true, pointStyle: "circle", font: { size: 8.5 }, padding: 6,
                  // Legend "Total MP" ditambahkan manual (bukan dari
                  // dataset asli, karena Total MP digambar lewat plugin
                  // badge, bukan dataset bar/line) -- klik legend ini
                  // toggle tampil/sembunyi badge-nya.
                  generateLabels: (chart) => {
                    const items = Chart.defaults.plugins.legend.labels.generateLabels(chart);
                    const badgeOpts = chart.options.plugins.totalMpBadgePlugin || {};
                    items.unshift({
                      text: "Total MP",
                      fillStyle: mpColor,
                      strokeStyle: mpColor,
                      pointStyle: "rect",
                      hidden: badgeOpts.display === false,
                      datasetIndex: -1,
                    });
                    return items;
                  },
                },
                onClick: (e, legendItem, legendEl) => {
                  if (legendItem.datasetIndex === -1) {
                    const chart = legendEl.chart;
                    const badgeOpts = chart.options.plugins.totalMpBadgePlugin;
                    badgeOpts.display = badgeOpts.display === false;
                    chart.update();
                    return;
                  }
                  Chart.defaults.plugins.legend.onClick(e, legendItem, legendEl);
                },
              },
              tooltip,
              totalMpBadgePlugin: { display: true, color: mpColor, data: t.totalMp },
            },
            scales: {
              x: { ticks: { color: "#000000", font: { size: 9 }, autoSkip: false, maxRotation: 0, minRotation: 0 }, grid: { display: false }, border: { display: true, color: cssVar("--border") } },
              y: { position: "left", beginAtZero: true, ticks: { color: "#000000", font: { size: 9 }, precision: 0 }, grid: { color: cssVar("--chart-grid"), drawTicks: false }, border: { display: true, color: cssVar("--border") }, title: { display: true, text: "Orang", color: "#000000", font: { size: 9, weight: "bold" } } },
              y1: { position: "right", min: 0, max: 110, ticks: { color: "#000000", font: { size: 9 }, stepSize: 20, callback: (v) => v + "%" }, grid: { display: false }, border: { display: true, color: cssVar("--border") }, title: { display: true, text: "%", color: "#000000", font: { size: 9, weight: "bold" } } },
            },
          },
        });
      } catch (e) {
        console.error("Gagal render chart Rekap Tahunan Attendance:", e);
      }
    },
    // ══════════════════════════════════════
    // PLAN HARIAN
    // ══════════════════════════════════════
    planTanggal: localDateStr(new Date()), // tanggal lokal WIB, bukan UTC
    planRows: [],
    planBacklogRows: [],
    planActualRows: [],
    planPartMaster: [],   // daftar part number dari master (dipakai supaya
                          // barisnya tetap tampil walau belum ada plan)
    planLoading: false,

    // ---------- Edit plan DI TEMPAT (tanpa pindah halaman) ----------
    // Dulu tombol "Edit Plan" melempar ke plan-produksi.html. Halaman itu
    // sudah dihapus: sekarang kolom "Plan per Line" di tabel atas yang
    // berubah jadi kotak isian, lalu disimpan langsung dari sini.
    //
    // Yang diketik user = total plan satu part di satu line untuk hari itu.
    // Tabel Shift 1/2 MENGIKUTI angka itu (hanya baca, tidak bisa diketik).
    // Backlog per part juga bisa diubah di kolom Backlog tabel atas.
    planEditMode: false,
    planSaving: false,
    planDraft: {},        // "part|mesin" -> isi kotak (teks)
    planDraftBacklog: {}, // "part" -> isi kotak (teks)
    planMsg: "",
    planMsgError: false,

    planKunci(part, mesin) { return part + "|" + mesin; },
    // Angka plan yang TERSIMPAN untuk satu part/line pada satu shift.
    planAngkaTersimpan(part, mesin, shift) {
      return this.planRows
        .filter((r) => r.part_number === part && r.mesin === mesin && r.shift === shift)
        .reduce((a, r) => a + (Number(r.qty_rencana) || 0), 0);
    },
    // Total satu part/line untuk hari itu (shift 1 + shift 2).
    planTotalTersimpan(part, mesin) {
      return this.planAngkaTersimpan(part, mesin, 1) + this.planAngkaTersimpan(part, mesin, 2);
    },
    planBacklogTersimpan(part) {
      const row = this.planBacklogRows.find((b) => b.part_number === part);
      return Number(row && row.backlog) || 0;
    },

    // ⚠ ATURAN PEMBAGIAN KE SHIFT -- MASIH SEMENTARA.
    // User bilang pembagiannya "ada sistemnya" dan akan dijelaskan nanti.
    // Sampai aturan itu diberikan, dipakai aturan sementara berikut:
    //   - kalau part/line ini SUDAH punya angka di kedua shift, perbandingan
    //     lamanya dipertahankan (mis. 600:400 -> 1.000 jadi 600:400);
    //   - kalau belum ada sama sekali, dibagi rata; sisa pembagian ganjil
    //     masuk ke Shift 1.
    // SELURUH logika pembagian HANYA ada di fungsi ini -- begitu aturan
    // aslinya diberikan, cukup ganti isi fungsi ini saja, tidak ada tempat
    // lain yang perlu disentuh.
    planBagiKeShift(total, part, mesin) {
      const t = Math.max(0, Math.round(Number(total) || 0));
      if (t === 0) return { 1: 0, 2: 0 };
      const s1 = this.planAngkaTersimpan(part, mesin, 1);
      const s2 = this.planAngkaTersimpan(part, mesin, 2);
      const lama = s1 + s2;
      if (lama > 0) {
        const a = Math.round((s1 / lama) * t);
        return { 1: a, 2: t - a };
      }
      const a = Math.ceil(t / 2);
      return { 1: a, 2: t - a };
    },

    planMulaiEdit() {
      if (!this.isAdmin()) return;
      // Draft diisi dari angka yang sekarang tersimpan, jadi kotak isian
      // langsung menampilkan nilai berjalan (bukan kosong).
      const draft = {}, draftB = {};
      this.planPartList.forEach((part) => {
        MACHINES.forEach((m) => {
          const v = this.planTotalTersimpan(part, m.key);
          draft[this.planKunci(part, m.key)] = v > 0 ? String(v) : "";
        });
        const b = this.planBacklogTersimpan(part);
        draftB[part] = b > 0 ? String(b) : "";
      });
      this.planDraft = draft;
      this.planDraftBacklog = draftB;
      this.planMsg = "";
      this.planEditMode = true;
    },
    planBatalEdit() {
      this.planEditMode = false;
      this.planDraft = {};
      this.planDraftBacklog = {};
      this.planMsg = "";
    },
    planDraftGet(part, mesin) { return this.planDraft[this.planKunci(part, mesin)] ?? ""; },
    planDraftSet(part, mesin, v) { this.planDraft[this.planKunci(part, mesin)] = v; },
    planBacklogDraftGet(part) { return this.planDraftBacklog[part] ?? ""; },
    planBacklogDraftSet(part, v) { this.planDraftBacklog[part] = v; },

    // Simpan HANYA yang berubah. Angka yang dikosongkan / diisi 0 berarti
    // barisnya dihapus, bukan disimpan sebagai 0 -- supaya tabel tidak
    // penuh baris nol yang tidak berarti apa-apa.
    async planSimpanEdit() {
      if (this.planSaving) return;
      this.planSaving = true;
      this.planMsg = "";
      try {
        const upPlan = [], delPlan = [];
        Object.keys(this.planDraft).forEach((k) => {
          const [part, mesin] = k.split("|");
          const baru = Math.max(0, Math.round(Number(this.planDraft[k]) || 0));
          const lama = this.planTotalTersimpan(part, mesin);
          if (baru === lama) return;
          // Satu angka per line dipecah jadi baris per shift, karena
          // production_plan_harian menyimpannya per shift.
          const bagi = this.planBagiKeShift(baru, part, mesin);
          [1, 2].forEach((shift) => {
            const q = bagi[shift] || 0;
            if (q > 0) upPlan.push({ tanggal: this.planTanggal, part_number: part, mesin, shift, qty_rencana: q });
            else if (this.planAngkaTersimpan(part, mesin, shift) > 0) delPlan.push({ part, mesin, shift });
          });
        });

        const upBack = [], delBack = [];
        Object.keys(this.planDraftBacklog).forEach((part) => {
          const baru = Math.max(0, Math.round(Number(this.planDraftBacklog[part]) || 0));
          const lama = this.planBacklogTersimpan(part);
          if (baru === lama) return;
          if (baru > 0) upBack.push({ tanggal: this.planTanggal, part_number: part, backlog: baru });
          else delBack.push(part);
        });

        if (!upPlan.length && !delPlan.length && !upBack.length && !delBack.length) {
          // Tidak ada yang diubah -> keluar diam-diam dari mode edit.
          this.planMsg = "";
          this.planEditMode = false;
          return;
        }

        if (upPlan.length) {
          const { error } = await supabaseClient.from("production_plan_harian")
            .upsert(upPlan, { onConflict: "tanggal,part_number,mesin,shift" });
          if (error) throw error;
        }
        for (const d of delPlan) {
          const { error } = await supabaseClient.from("production_plan_harian")
            .delete().eq("tanggal", this.planTanggal).eq("part_number", d.part)
            .eq("mesin", d.mesin).eq("shift", d.shift);
          if (error) throw error;
        }
        if (upBack.length) {
          const { error } = await supabaseClient.from("production_plan_backlog")
            .upsert(upBack, { onConflict: "tanggal,part_number" });
          if (error) throw error;
        }
        for (const part of delBack) {
          const { error } = await supabaseClient.from("production_plan_backlog")
            .delete().eq("tanggal", this.planTanggal).eq("part_number", part);
          if (error) throw error;
        }

        this.planEditMode = false;
        this.planDraft = {};
        this.planDraftBacklog = {};
        // Pemberitahuan "Tersimpan (N perubahan)" dihapus (permintaan).
        // Pesan GAGAL simpan sengaja tetap ada -- tanpa itu, simpan yang
        // ditolak server (mis. tidak punya hak) jadi tidak kelihatan sama
        // sekali dan angkanya diam-diam tidak tersimpan.
        this.planMsgError = false;
        this.planMsg = "";
        await this.fetchPlanHarian();
      } catch (e) {
        this.planMsgError = true;
        this.planMsg = "Gagal simpan: " + (e && e.message ? e.message : e);
      } finally {
        this.planSaving = false;
      }
    },

    async fetchPlanHarian() {
      this.planLoading = true;
      // Master part number cukup diambil sekali per sesi -- isinya jarang
      // berubah, dan dipakai tiap ganti tanggal.
      if (!this.planPartMaster.length) {
        try {
          const { data } = await supabaseClient.from("part_numbers").select("value");
          this.planPartMaster = [...new Set((data || []).map((r) => r.value).filter(Boolean))].sort();
        } catch (e) { this.planPartMaster = []; }
      }
      // Kapasitas & master part tidak bergantung tanggal, jadi cukup
      // diambil sekali per sesi (dan tiap kali selesai disimpan).
      if (!this.planCapaRows.length) await this.fetchPlanCapa();
      if (!this.planMasterPartRows.length) await this.fetchPlanMasterPart();
      try {
        const [planRes, backlogRes, actRes] = await Promise.all([
          supabaseClient.from('production_plan_harian').select('*').eq('tanggal', this.planTanggal),
          supabaseClient.from('production_plan_backlog').select('*').eq('tanggal', this.planTanggal),
          supabaseClient.rpc('plan_produksi_actual', { p_tanggal: this.planTanggal }),
        ]);
        this.planRows        = planRes.data   || [];
        this.planBacklogRows = backlogRes.data || [];
        this.planActualRows  = actRes.data    || [];
      } finally {
        this.planLoading = false;
      }
      // Digambar setelah tabelnya selesai dirender, supaya canvas-nya
      // sudah ada dan ukurannya sudah pasti.
      this.$nextTick(() => this.renderPlanKapasitas());
    },

    // ---------- Kapasitas (CAPACITY) per line ----------
    // planCapaRows diisi dari tabel production_capa_line. Kalau tabelnya
    // belum dibuat / masih kosong, planCapaDariDefault = true dan angka
    // cadangan CAPA_DEFAULT yang dipakai, jadi grafiknya tetap bergaris.
    planCapaRows: [],
    planCapaDariDefault: true,
    planCapaOpen: false,
    planCapaDraft: {},
    planCapaSaving: false,
    planCapaMsg: "",
    planCapaMsgError: false,
    // Sub mana yang sedang dibuka di form: harian / line / part
    planCapaTab: "harian",
    // Sub "Kapasitas Line" & "Master Part"
    planLineDraft: {},
    planMasterPartRows: [],
    planMasterPartDariDefault: true,
    planPartDraft: {},

    async fetchPlanCapa() {
      try {
        const { data, error } = await supabaseClient.from("production_capa_line").select("*");
        if (error) throw error;
        this.planCapaRows = data || [];
        this.planCapaDariDefault = this.planCapaRows.length === 0;
      } catch (e) {
        // Tabelnya belum ada (migration_capa_line.sql belum dijalankan)
        // -> jangan bikin tab ini gagal tampil, cukup pakai cadangan.
        this.planCapaRows = [];
        this.planCapaDariDefault = true;
      }
    },
    async fetchPlanMasterPart() {
      try {
        const { data, error } = await supabaseClient.from("production_master_part").select("*");
        if (error) throw error;
        this.planMasterPartRows = data || [];
        this.planMasterPartDariDefault = this.planMasterPartRows.length === 0;
      } catch (e) {
        this.planMasterPartRows = [];
        this.planMasterPartDariDefault = true;
      }
    },
    // ----- pembaca angka: dari database kalau ada, kalau tidak dari cadangan -----
    planLineVal(mesin, kunci) {
      const row = this.planCapaRows.find((r) => r.mesin === mesin);
      // 0 dianggap "belum diisi" -> pakai cadangan, supaya kolom baru yang
      // defaultnya 0 (sebelum migration v2 diisi) tidak tampil nol semua.
      if (row && Number(row[kunci])) return Number(row[kunci]);
      const d = LINE_DEFAULT[mesin];
      return d ? Number(d[kunci]) || 0 : 0;
    },
    planPartRow(part) {
      return this.planMasterPartRows.find((r) => r.part_number === part)
        || MASTER_PART_DEFAULT.find((r) => r.part_number === part)
        || null;
    },
    planPartVal(part, kunci) {
      const r = this.planPartRow(part);
      if (!r) return kunci === "watari" ? "NO" : (kunci === "default_line" ? "" : 0);
      const v = r[kunci];
      return v === null || v === undefined || v === "" ? (kunci === "watari" ? "NO" : "") : v;
    },
    // Daftar part di form = master part_numbers digabung dengan part yang
    // sudah tersimpan/ada di cadangan, jadi part baru ikut muncul sendiri.
    get planPartFormList() {
      const kumpul = new Set([
        ...this.planPartMaster,
        ...this.planMasterPartRows.map((r) => r.part_number),
        ...MASTER_PART_DEFAULT.map((r) => r.part_number),
      ]);
      return [...kumpul].filter(Boolean).sort();
    },
    // Cycle time ditulis gaya Indonesia (102,9) biar sama dengan sheet.
    planCtTeks(v) {
      const n = Number(v);
      if (!n) return "";
      return String(Math.round(n * 100) / 100).replace(".", ",");
    },
    // 'e-03 , E04' -> 'E-03'. Yang tidak berbentuk E-0x dibuang.
    planWatariBersih(teks) {
      const s = String(teks ?? "").trim();
      if (!s || /^(no|tidak|-)$/i.test(s)) return "NO";
      const pakai = [...new Set(
        s.toUpperCase().split(/[,;/\s]+/)
          .map((t) => t.replace(/^E-?0?(\d)$/, "E-0$1"))
          .filter((t) => /^E-0[2-7]$/.test(t))
      )];
      return pakai.length ? pakai.join(",") : "NO";
    },
    // Satu angka kapasitas: dari tabel kalau ada, kalau tidak dari cadangan.
    planCapaVal(mesin, kunci) {
      const row = this.planCapaRows.find((r) => r.mesin === mesin);
      if (row && row[kunci] !== null && row[kunci] !== undefined) return Number(row[kunci]) || 0;
      const d = CAPA_DEFAULT[mesin];
      return d ? Number(d[kunci]) || 0 : 0;
    },
    get planCapaJenis() { return CAPA_JENIS; },
    get planLineJenis() { return LINE_JENIS; },
    get planCapaMesin() { return MACHINES.map((m) => m.key); },
    get planCapaSubTabs() {
      return [
        { kunci: "harian", nama: "Capacity Harian" },
        { kunci: "line",   nama: "Kapasitas Line" },
        { kunci: "part",   nama: "Master Part" },
      ];
    },

    planCapaBuka() {
      // Ketiga draft diisi dari angka yang sedang dipakai, jadi form-nya
      // langsung terisi (bukan kosong) dan tinggal diubah yang perlu.
      // Semua sub disiapkan sekaligus supaya pindah-pindah sub tidak
      // menghapus ketikan yang belum disimpan.
      const dCapa = {}, dLine = {};
      this.planCapaMesin.forEach((mk) => {
        dCapa[mk] = {}; dLine[mk] = {};
        CAPA_JENIS.forEach((j) => { dCapa[mk][j.kunci] = String(this.planCapaVal(mk, j.kunci)); });
        LINE_JENIS.forEach((j) => { dLine[mk][j.kunci] = String(this.planLineVal(mk, j.kunci)); });
      });
      const dPart = {};
      this.planPartFormList.forEach((part) => {
        dPart[part] = {
          default_line: String(this.planPartVal(part, "default_line") || ""),
          cycle_time: this.planCtTeks(this.planPartVal(part, "cycle_time")),
          watari: String(this.planPartVal(part, "watari") || "NO"),
        };
      });
      this.planCapaDraft = dCapa;
      this.planLineDraft = dLine;
      this.planPartDraft = dPart;
      this.planCapaMsg = "";
      this.planCapaMsgError = false;
      this.planCapaOpen = true;
    },
    planCapaTutup() {
      if (this.planCapaSaving) return;
      this.planCapaOpen = false;
      this.planCapaDraft = {};
      this.planLineDraft = {};
      this.planPartDraft = {};
    },
    planCapaDraftSet(mesin, kunci, nilai) {
      if (!this.planCapaDraft[mesin]) this.planCapaDraft[mesin] = {};
      this.planCapaDraft[mesin][kunci] = String(nilai ?? "").replace(/[^0-9]/g, "");
    },
    planLineDraftSet(mesin, kunci, nilai) {
      if (!this.planLineDraft[mesin]) this.planLineDraft[mesin] = {};
      this.planLineDraft[mesin][kunci] = String(nilai ?? "").replace(/[^0-9]/g, "");
    },
    planPartDraftSet(part, kunci, nilai) {
      if (!this.planPartDraft[part]) this.planPartDraft[part] = {};
      // cycle_time: koma & titik dua-duanya diterima (sheet pakai koma).
      this.planPartDraft[part][kunci] = kunci === "cycle_time"
        ? String(nilai ?? "").replace(/[^0-9.,]/g, "")
        : String(nilai ?? "");
    },
    // Satu tombol Simpan untuk ketiga sub: yang disimpan SELURUH isi form,
    // bukan cuma sub yang sedang terlihat -- jadi kalau mengubah dua sub
    // lalu menekan Simpan, dua-duanya ikut tersimpan.
    async planCapaSimpan() {
      this.planCapaSaving = true;
      this.planCapaMsg = "";
      this.planCapaMsgError = false;
      try {
        const barisLine = this.planCapaMesin.map((mk) => {
          const isi = { mesin: mk };
          CAPA_JENIS.forEach((j) => {
            isi[j.kunci] = Math.max(0, Math.round(Number(this.planCapaDraft[mk]?.[j.kunci]) || 0));
          });
          LINE_JENIS.forEach((j) => {
            isi[j.kunci] = Math.max(0, Math.round(Number(this.planLineDraft[mk]?.[j.kunci]) || 0));
          });
          return isi;
        });
        const { error: errLine } = await supabaseClient
          .from("production_capa_line")
          .upsert(barisLine, { onConflict: "mesin" });
        if (errLine) throw errLine;

        const barisPart = Object.keys(this.planPartDraft).map((part) => {
          const d = this.planPartDraft[part] || {};
          const ct = Number(String(d.cycle_time ?? "").replace(",", ".")) || 0;
          return {
            part_number: part,
            // Line kosong dikirim null, bukan "" -- kolomnya bertipe
            // machine_type, dan "" ditolak Postgres.
            default_line: /^E-0[2-7]$/.test(d.default_line || "") ? d.default_line : null,
            cycle_time: Math.max(0, Math.round(ct * 100) / 100),
            watari: this.planWatariBersih(d.watari),
          };
        });
        if (barisPart.length) {
          const { error: errPart } = await supabaseClient
            .from("production_master_part")
            .upsert(barisPart, { onConflict: "part_number" });
          if (errPart) throw errPart;
        }

        await Promise.all([this.fetchPlanCapa(), this.fetchPlanMasterPart()]);
        this.planCapaOpen = false;
        this.planCapaDraft = {};
        this.planLineDraft = {};
        this.planPartDraft = {};
        // Tanpa pemberitahuan: form-nya menutup sendiri dan garis di grafik
        // langsung pindah, jadi hasilnya sudah kelihatan.
        this.planMsgError = false;
        this.planMsg = "";
        this.$nextTick(() => this.renderPlanKapasitas());
      } catch (e) {
        const pesan = (e && e.message ? e.message : String(e));
        this.planCapaMsgError = true;
        // Pesan Postgres untuk tabel/kolom yang belum ada susah dimengerti,
        // jadi diterjemahkan ke langkah yang harus dilakukan.
        this.planCapaMsg = /does not exist|schema cache|relation|column/i.test(pesan)
          ? "Tabel/kolomnya belum ada di database. Jalankan migration_capa_line.sql lalu migration_capa_line_v2.sql di Supabase > SQL Editor, baru simpan lagi."
          : "Gagal simpan: " + pesan;
      } finally {
        this.planCapaSaving = false;
      }
    },

    planKapasitasChart: null,
    // Warna batang per part number. 6 warna dasar dipakai bergantian; tiap
    // kali daftarnya habis, putarannya berikutnya dibuat lebih muda/tua
    // sedikit supaya dua part yang memakai warna dasar sama tetap bisa
    // dibedakan walau partnya lebih dari enam.
    planWarnaPart(i) {
      const dasar = PLAN_LINE_COLORS[i % PLAN_LINE_COLORS.length];
      const putaran = Math.floor(i / PLAN_LINE_COLORS.length);
      if (putaran === 0) return dasar;
      // Dicampur manual di sini (bukan color-mix CSS): warna ini dipakai
      // sebagai fillStyle canvas, dan canvas tidak mengerti color-mix().
      const campur = putaran % 2 === 1 ? [255, 255, 255] : [31, 41, 55];
      const kadar = Math.min(0.55, 0.26 + 0.14 * Math.floor((putaran - 1) / 2));
      const n = parseInt(dasar.slice(1), 16);
      const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
        .map((c, k) => Math.round(c * (1 - kadar) + campur[k] * kadar));
      return "rgb(" + rgb.join(",") + ")";
    },
    // Grafik = TUMPUKAN QTY PER PART NUMBER di tiap line (pcs), bukan lagi
    // satu batang total per line dan bukan persen. Jadi sekali lihat
    // ketahuan line mana yang paling penuh DAN part apa saja isinya.
    renderPlanKapasitas() {
      const canvas = document.getElementById("dxPlanKapasitas");
      if (!canvas || typeof Chart === "undefined") return;
      if (this.planKapasitasChart) this.planKapasitasChart.destroy();
      this.planKapasitasChart = null;
      // Grafik tetap digambar walau semua angkanya 0, supaya nama line
      // (E-02..E-07) selalu kelihatan.
      const mesinKeys = MACHINES.map((m) => m.key);
      // Hanya part yang HARI INI ada rencananya yang jadi batang; kalau
      // semua part master ikut, legendanya penuh part yang nilainya 0.
      const partAda = this.planPartList.filter((part) =>
        mesinKeys.some((mk) => this.planNumCellPlan(part, mk) > 0)
      );
      const datasets = partAda.map((part, i) => ({
        label: part,
        data: mesinKeys.map((mk) => this.planNumCellPlan(part, mk)),
        backgroundColor: this.planWarnaPart(i),
        borderWidth: 0,
        borderRadius: 0,
        // Batang sengaja dibuat lebih ramping (dulu 0.7 x 0.9): lebarnya
        // kini ~35% dari jatah kolom, jadi garis CAPACITY di belakangnya
        // tetap kelihatan.
        barPercentage: 0.7,
        categoryPercentage: 0.5,
      }));

      // ----- 3 garis acuan CAPACITY -----
      // Dipasang di sumbu Y terpisah (yCapa) yang TIDAK ditumpuk. Kalau
      // ikut sumbu batang yang stacked:true, garisnya ikut ditumpuk juga
      // (hijau+biru+merah saling menambah) -- itu salah. Batas atas kedua
      // sumbu disamakan manual di bawah supaya tingginya tetap sebanding.
      const capaData = CAPA_JENIS.map((j) => ({
        jenis: j,
        angka: mesinKeys.map((mk) => this.planCapaVal(mk, j.kunci)),
      }));
      capaData.forEach(({ jenis, angka }) => {
        datasets.push({
          type: "line",
          label: jenis.nama,
          data: angka,
          yAxisID: "yCapa",
          borderColor: jenis.warna,
          backgroundColor: jenis.warna,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: false,
          tension: 0,
          order: 0,       // digambar di ATAS batang
        });
      });

      // Batas atas sumbu: setinggi mana pun yang paling tinggi antara
      // tumpukan plan dan garis kapasitas, dibulatkan ke atas biar rapi.
      const tinggiTumpukan = mesinKeys.map((mk, i) =>
        partAda.reduce((a, part) => a + this.planNumCellPlan(part, mesinKeys[i]), 0)
      );
      const tertinggi = Math.max(0, ...tinggiTumpukan, ...capaData.flatMap((c) => c.angka));
      const langkah = tertinggi > 1000 ? 100 : 50;
      const batasAtas = tertinggi > 0 ? Math.ceil((tertinggi * 1.08) / langkah) * langkah : 10;

      this.planKapasitasChart = new Chart(canvas, {
        type: "bar",
        data: { labels: mesinKeys, datasets },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            title: {
              display: true,
              text: "CAPACITY",
              color: cssVar("--text"),
              font: { size: 18, weight: "800" },
              padding: { top: 2, bottom: 8 },
            },
            // Legenda dihidupkan lagi: dengan tumpukan per part, warnanya
            // harus bisa dibaca namanya.
            legend: {
              display: datasets.length > 0,
              position: "top",
              align: "start",
              labels: {
                color: cssVar("--chart-tick"), font: { size: 10 },
                boxWidth: 9, boxHeight: 9, padding: 7, usePointStyle: true, pointStyle: "rect",
              },
            },
            tooltip: {
              backgroundColor: cssVar("--panel"), titleColor: cssVar("--text"), bodyColor: cssVar("--text"),
              borderColor: cssVar("--border"), borderWidth: 1, padding: 10,
              // Part yang 0 di line itu tidak perlu ikut muncul di tooltip.
              filter: (item) => Number(item.raw) > 0,
              callbacks: {
                label: (item) => {
                  const v = Math.round(Number(item.raw) || 0);
                  // Garis kapasitas: tambahi tulisan "kapasitas" supaya
                  // tidak terbaca sebagai angka plan.
                  const ekor = item.dataset.type === "line" ? " pcs (kapasitas)" : " pcs";
                  return " " + item.dataset.label + ": " + v + ekor;
                },
              },
            },
          },
          scales: {
            x: { stacked: true, ticks: { color: cssVar("--chart-tick"), font: { size: 10 } }, grid: { display: false }, border: { display: false } },
            y: { stacked: true, ticks: { color: cssVar("--chart-tick"), font: { size: 10 } }, grid: { color: cssVar("--chart-grid"), drawTicks: false }, border: { display: false }, beginAtZero: true, max: batasAtas },
            // Sumbu khusus garis kapasitas: tidak ditumpuk, tidak
            // ditampilkan, tapi batas atasnya SAMA dengan sumbu Y batang
            // supaya garis dan batang bisa dibandingkan langsung.
            yCapa: { display: false, stacked: false, beginAtZero: true, max: batasAtas, grid: { display: false } },
          },
        },
        // Angka QTY ditulis di tengah tiap potongan tumpukan (per part),
        // bukan total batangnya. Potongan yang terlalu tipis dilewati
        // supaya angkanya tidak tumpang tindih -- nilainya tetap kebaca
        // lewat tooltip.
        plugins: [{
          id: "dxPlanQtyLabels",
          afterDatasetsDraw(chart) {
            const ctx = chart.ctx;
            ctx.save();
            ctx.font = "700 10px Inter, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = "#ffffff";
            chart.data.datasets.forEach((ds, di) => {
              // Garis kapasitas dilewati -- angkanya bukan plan, dan
              // elemen garis tidak punya "base" seperti batang.
              if (ds.type === "line") return;
              const meta = chart.getDatasetMeta(di);
              if (!meta || meta.hidden || !meta.data) return;
              meta.data.forEach((bar, i) => {
                const v = Math.round(Number(ds.data[i]) || 0);
                if (v <= 0) return;
                const tinggi = Math.abs(bar.base - bar.y);
                if (tinggi < 13) return;
                ctx.fillText(String(v), bar.x, (bar.base + bar.y) / 2);
              });
            });
            ctx.restore();
          },
        }],
      });
    },

    // ---------- Plan Harian ----------
    // Perhitungan di bawah dulu disamakan persis dengan halaman plan-produksi
    // (sudah dihapus, editnya sekarang di tab ini). Beda-beda yang dulu bikin
    // angkanya tidak sama dan sudah diluruskan:
    //   1. daftar part di tabel Shift dulu cuma dari plan; sekarang ikut
    //      memasukkan part yang ADA AKTUALNYA tapi tidak direncanakan
    //   2. pemisah ribuan dulu pakai id-ID (1.234), sekarang en-US (1,234)
    //   3. beberapa total yang nilainya 0 dulu tampil kosong, sekarang "0"
    //   4. perbandingan shift dulu longgar (==), sekarang ketat (===)
    // fmtNum bawaan dashboard tidak dipakai di sini karena dibatasi 1 desimal,
    // sedangkan plan harian selalu bilangan bulat.
    planFmt(n) {
      if (n === null || n === undefined || Number.isNaN(Number(n))) return "-";
      return Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
    },

    get planPartList() {
      // SELURUH part number master selalu tampil, ditambah part yang
      // direncanakan atau ada aktualnya walau tidak ada di master. Dengan
      // begitu daftar barisnya tetap sama tiap hari, dan part yang belum
      // ada planya kelihatan kosong (bukan hilang dari tabel).
      const fromPlan = this.planRows.map((r) => r.part_number);
      const fromAct = this.planActualRows.map((r) => r.part_number);
      return [...new Set([...this.planPartMaster, ...fromPlan, ...fromAct])].filter(Boolean).sort();
    },

    // Ada isinya atau tidak -- dipakai untuk memilih antara tabel
    // dan pesan "belum ada plan".
    get planAdaData() {
      return this.planRows.length > 0 || this.planActualRows.length > 0;
    },

    // Tanggal yang sedang dilihat, ditulis lengkap ("Senin, 19 Okt 2026")
    // supaya tidak perlu menebak dari angka "19" saja.
    get planTanggalLabel() {
      const d = new Date(this.planTanggal + "T00:00:00");
      if (Number.isNaN(d.getTime())) return this.planTanggal;
      const hari = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"][d.getDay()];
      const bulan = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"][d.getMonth()];
      return `${hari}, ${d.getDate()} ${bulan} ${d.getFullYear()}`;
    },
    get planHariIni() {
      return this.planTanggal === localDateStr(new Date());
    },
    // Pindah tanggal mundur/maju 1 hari lewat tombol, tanpa buka date picker.
    planGeserHari(n) {
      const d = new Date(this.planTanggal + "T00:00:00");
      if (Number.isNaN(d.getTime())) return;
      d.setDate(d.getDate() + n);
      this.planTanggal = localDateStr(d);
      this.fetchPlanHarian();
    },

    // ---------- angka mentah (tanpa format) ----------
    planNumPlan(part) {
      return this.planRows.filter((r) => r.part_number === part).reduce((a, r) => a + (Number(r.qty_rencana) || 0), 0);
    },
    planNumAct(part) {
      return this.planActualRows.filter((r) => r.part_number === part).reduce((a, r) => a + (Number(r.qty_aktual) || 0), 0);
    },
    planNumColPlan(mesin) {
      return this.planRows.filter((r) => r.mesin === mesin).reduce((a, r) => a + (Number(r.qty_rencana) || 0), 0);
    },
    planNumColAct(mesin) {
      return this.planActualRows.filter((r) => r.mesin === mesin).reduce((a, r) => a + (Number(r.qty_aktual) || 0), 0);
    },
    get planTotalPlan() {
      return this.planRows.reduce((a, r) => a + (Number(r.qty_rencana) || 0), 0);
    },
    get planTotalAct() {
      return this.planActualRows.reduce((a, r) => a + (Number(r.qty_aktual) || 0), 0);
    },
    get planTotalBacklog() {
      return this.planBacklogRows.reduce((a, r) => a + (Number(r.backlog) || 0), 0);
    },

    // ---------- pencapaian (%) ----------
    // Plan 0 -> tidak ada target, jadi persennya tidak dihitung (null),
    // bukan 0% (yang bikin seolah-olah gagal).
    planPct(act, plan) {
      if (!plan) return null;
      return Math.round((act / plan) * 100);
    },
    planPctText(act, plan) {
      const p = this.planPct(act, plan);
      return p === null ? "-" : p + "%";
    },
    planPctClass(act, plan) {
      const p = this.planPct(act, plan);
      if (p === null) return "";
      return p >= 100 ? "ach-ok" : p >= 90 ? "ach-warn" : "ach-bad";
    },
    // Lebar bar mini di kolom pencapaian (dipotong di 100% biar rapi).
    planPctBar(act, plan) {
      const p = this.planPct(act, plan);
      return (p === null ? 0 : Math.max(0, Math.min(100, p))) + "%";
    },
    get planAchTotal() { return this.planPct(this.planTotalAct, this.planTotalPlan); },
    get planAchTotalText() { return this.planPctText(this.planTotalAct, this.planTotalPlan); },
    get planAchTotalClass() { return this.planPctClass(this.planTotalAct, this.planTotalPlan); },
    get planSelisihTotal() { return this.planTotalAct - this.planTotalPlan; },
    // Angka bertanda (+120 / -300) supaya arah selisihnya langsung kebaca.
    planFmtSigned(n) {
      const v = Number(n) || 0;
      return (v > 0 ? "+" : "") + this.planFmt(v);
    },

    // ---------- kolom Aktual & pencapaian di tabel utama ----------
    planActRow(part) {
      const v = this.planNumAct(part);
      return v > 0 ? this.planFmt(v) : "";
    },
    planActColTotal(mesin) {
      return this.planFmt(this.planNumColAct(mesin));
    },
    planActGrandTotal() {
      return this.planFmt(this.planTotalAct);
    },
    // Angka mentah 1 sel (part x line). planCell() di bawahnya memakai ini
    // juga, supaya tabel dan grafik pasti membaca sumber yang sama.
    planNumCellPlan(part, mesin) {
      return this.planRows
        .filter((r) => r.part_number === part && r.mesin === mesin)
        .reduce((a, r) => a + (Number(r.qty_rencana) || 0), 0);
    },
    planCell(part, mesin) {
      const sum = this.planNumCellPlan(part, mesin);
      return sum > 0 ? this.planFmt(sum) : "";
    },
    planRowTotal(part) {
      const sum = this.planRows.filter((r) => r.part_number === part).reduce((a, r) => a + (Number(r.qty_rencana) || 0), 0);
      return this.planFmt(sum);
    },
    planColTotal(mesin) {
      const sum = this.planRows.filter((r) => r.mesin === mesin).reduce((a, r) => a + (Number(r.qty_rencana) || 0), 0);
      return this.planFmt(sum);
    },
    planBacklog(part) {
      const row = this.planBacklogRows.find((b) => b.part_number === part);
      return row && row.backlog > 0 ? this.planFmt(row.backlog) : "";
    },
    planBacklogTotal() {
      const sum = this.planBacklogRows.reduce((a, r) => a + (Number(r.backlog) || 0), 0);
      return sum > 0 ? this.planFmt(sum) : "0";
    },
    planGrandTotal() {
      const sum = this.planRows.reduce((a, r) => a + (Number(r.qty_rencana) || 0), 0);
      return this.planFmt(sum);
    },

    // ---------- tabel Shift 1 / Shift 2 ----------
    // Sama seperti tabel utama: semua part master selalu tampil di kedua
    // shift, supaya barisnya konsisten dan gampang dibandingkan.
    planShiftParts(shift) {
      const fromPlan = this.planRows.filter((r) => r.shift === shift).map((r) => r.part_number);
      const fromAct = this.planActualRows.filter((r) => r.shift === shift).map((r) => r.part_number);
      return [...new Set([...this.planPartMaster, ...fromPlan, ...fromAct])].filter(Boolean).sort();
    },
    planShiftCell(part, mesin, shift) {
      const row = this.planRows.find((r) => r.part_number === part && r.mesin === mesin && r.shift === shift);
      return row && row.qty_rencana > 0 ? this.planFmt(row.qty_rencana) : "";
    },
    planActCell(part, mesin, shift) {
      const row = this.planActualRows.find((r) => r.part_number === part && r.mesin === mesin && r.shift === shift);
      return row && row.qty_aktual > 0 ? this.planFmt(row.qty_aktual) : "";
    },
    planShiftTotals(part, shift) {
      const plan = this.planRows.filter((r) => r.part_number === part && r.shift === shift).reduce((a, r) => a + (Number(r.qty_rencana) || 0), 0);
      const act = this.planActualRows.filter((r) => r.part_number === part && r.shift === shift).reduce((a, r) => a + (Number(r.qty_aktual) || 0), 0);
      return { plan, act };
    },
    planBalance(part, shift) {
      const { plan, act } = this.planShiftTotals(part, shift);
      return this.planFmtSigned(act - plan);
    },
    planBalanceClass(part, shift) {
      const { plan, act } = this.planShiftTotals(part, shift);
      if (plan === 0 && act === 0) return "";
      return act >= plan ? "balance-ok" : "balance-bad";
    },
    // Baris TOTAL di tabel Shift -- sebelumnya tidak ada, jadi total per
    // line per shift harus dijumlah sendiri dari layar.
    planShiftColTotal(mesin, shift, kind) {
      const sum = kind === "plan"
        ? this.planRows.filter((r) => r.mesin === mesin && r.shift === shift).reduce((a, r) => a + (Number(r.qty_rencana) || 0), 0)
        : this.planActualRows.filter((r) => r.mesin === mesin && r.shift === shift).reduce((a, r) => a + (Number(r.qty_aktual) || 0), 0);
      return sum > 0 ? this.planFmt(sum) : "";
    },
    planShiftGrand(shift, kind) {
      return kind === "plan"
        ? this.planRows.filter((r) => r.shift === shift).reduce((a, r) => a + (Number(r.qty_rencana) || 0), 0)
        : this.planActualRows.filter((r) => r.shift === shift).reduce((a, r) => a + (Number(r.qty_aktual) || 0), 0);
    },
    planShiftBalanceTotal(shift) {
      return this.planFmtSigned(this.planShiftGrand(shift, "act") - this.planShiftGrand(shift, "plan"));
    },
    planShiftBalanceTotalClass(shift) {
      const plan = this.planShiftGrand(shift, "plan");
      const act = this.planShiftGrand(shift, "act");
      if (plan === 0 && act === 0) return "";
      return act >= plan ? "balance-ok" : "balance-bad";
    },
    planShiftAchText(shift) {
      return this.planPctText(this.planShiftGrand(shift, "act"), this.planShiftGrand(shift, "plan"));
    },
    planShiftAchClass(shift) {
      return this.planPctClass(this.planShiftGrand(shift, "act"), this.planShiftGrand(shift, "plan"));
    },

    logout,
  };
}
