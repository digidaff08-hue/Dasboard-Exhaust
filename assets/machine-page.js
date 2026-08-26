// =========================================================
// Framework baru — Start/Finish presisi per-shift.
// Konsep: Dandori/Downtime/Break itu ATRIBUT (kolom durasi) di baris
// produksi yang sama, bukan baris terpisah. Non-Produksi berdiri sendiri
// sebagai baris terpisah (meeting, watari, 5S, dll). Klik Mulai/Selesai
// pakai jam sistem, tidak bisa diketik manual (kecuali mode edit koreksi).
// =========================================================

// ---------- Offline queue (localStorage) ----------
const OFFLINE_QUEUE_KEY = "offline_queue_v2";
function loadOfflineQueue() {
  try { const raw = localStorage.getItem(OFFLINE_QUEUE_KEY); return raw ? JSON.parse(raw) : []; }
  catch { return []; }
}
function saveOfflineQueue(q) {
  try { localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(q)); } catch {}
}
function enqueueOffline(table, payload) {
  const q = loadOfflineQueue();
  q.push({ localId: "local_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8), table, payload, created_at: new Date().toISOString() });
  saveOfflineQueue(q);
}
async function trySyncOfflineQueue() {
  let q = loadOfflineQueue();
  if (q.length === 0) return { synced: 0 };
  let synced = 0; const remaining = [];
  for (const item of q) {
    try {
      const { error } = await supabaseClient.from(item.table).insert(item.payload);
      if (error) throw error;
      synced++;
    } catch { remaining.push(item); }
  }
  saveOfflineQueue(remaining);
  return { synced };
}
function isNetworkError(err) {
  if (!navigator.onLine) return true;
  return /fetch|network|failed to fetch/i.test((err && err.message) || String(err));
}

const MACHINE_OPTIONS = [
  { key: "E-02", label: "E-02" }, { key: "E-03", label: "E-03" },
  { key: "E-04", label: "E-04" }, { key: "E-05", label: "E-05" },
  { key: "E-06", label: "E-06" }, { key: "E-07", label: "E-07" },
];

// ---------- Combobox custom (ganti <datalist>) ----------
document.addEventListener("alpine:init", () => {
  Alpine.data("comboBox", (getOptions, getValue, setValue, onChange) => ({
    open: false, query: "",
    init() {
      this.query = getValue() || "";
      this.$watch(() => getValue(), (v) => { if (v !== this.query) this.query = v || ""; });
    },
    filtered() {
      const q = (this.query || "").toLowerCase();
      const opts = getOptions() || [];
      if (!q) return opts.slice(0, 50);
      return opts.filter((o) => o.toLowerCase().includes(q)).slice(0, 50);
    },
    select(opt) { this.query = opt; setValue(opt); if (onChange) onChange(opt); this.open = false; },
    onInput() { setValue(this.query); if (onChange) onChange(this.query); this.open = true; },
  }));
});

// ---------- Jadwal Shift & Break (tetap) ----------
const SHIFT1_WEEKDAY = [[9,30,9,40],[12,5,12,45],[14,30,14,40],[16,0,16,15],[18,15,18,30]];
const SHIFT1_FRIDAY  = [[9,30,9,40],[11,40,12,50],[14,30,14,40],[16,30,16,45],[18,15,18,30]];
const SHIFT2_ALL     = [[21,30,21,40],[23,40,0,20],[2,20,2,30],[4,30,5,0]];

function mkDate(base, h, m, addDay = 0) {
  const x = new Date(base); x.setDate(x.getDate() + addDay); x.setHours(h, m, 0, 0); return x;
}

// Tentukan shift (1/2) yang mencakup 'now', beserta batas nominal mulainya
// (dipakai buat menjepit perhitungan jeda supaya tidak lompat hari/shift).
function shiftPeriodFor(now) {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const s1start = mkDate(base, 7, 0), s1end = mkDate(base, 19, 30);
  if (now >= s1start && now < s1end) return { shift: 1, start: s1start, end: s1end };
  if (now >= s1end) {
    const s2end = mkDate(base, 7, 0, 1);
    return { shift: 2, start: s1end, end: s2end };
  }
  const prevBase = mkDate(base, 0, 0, -1);
  const prevS2start = mkDate(prevBase, 19, 30);
  return { shift: 2, start: prevS2start, end: s1start };
}

function breakWindowsForPeriod(period) {
  const dateAnchor = new Date(period.start); dateAnchor.setHours(0, 0, 0, 0);
  const out = [];
  if (period.shift === 1) {
    const sched = dateAnchor.getDay() === 5 ? SHIFT1_FRIDAY : SHIFT1_WEEKDAY;
    sched.forEach(([sh, sm, eh, em]) => out.push({ start: mkDate(dateAnchor, sh, sm), end: mkDate(dateAnchor, eh, em) }));
  } else {
    SHIFT2_ALL.forEach(([sh, sm, eh, em]) => {
      out.push({
        start: mkDate(dateAnchor, sh, sm, sh < 19 ? 1 : 0),
        end: mkDate(dateAnchor, eh, em, eh < 19 ? 1 : 0),
      });
    });
  }
  return out;
}

// Berapa menit dari [wa,wk] yang jatuh di jadwal break resmi (otomatis).
function computeBreakMinutes(waIso, wkIso) {
  const wa = new Date(waIso), wk = new Date(wkIso);
  const period = shiftPeriodFor(wa);
  const windows = breakWindowsForPeriod(period);
  let total = 0;
  windows.forEach((w) => {
    const os = Math.max(w.start.getTime(), wa.getTime());
    const oe = Math.min(w.end.getTime(), wk.getTime());
    if (oe > os) total += (oe - os) / 60000;
  });
  return Math.round(total);
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function fmtNum(n) {
  if (n === null || n === undefined || n === "") return "-";
  const num = Number(n);
  if (Number.isNaN(num)) return "-";
  return num.toLocaleString("en-US", { maximumFractionDigits: 1 });
}
function fmtDecimal(n, digits = 2) {
  if (n === null || n === undefined || n === "") return "-";
  const num = Number(n);
  if (Number.isNaN(num)) return "-";
  return num.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function fmtRupiah(n) {
  if (n === null || n === undefined || n === "") return "-";
  const num = Number(n);
  if (Number.isNaN(num)) return "-";
  return "Rp " + num.toLocaleString("id-ID", { maximumFractionDigits: 0 });
}
function fmtClock(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}
function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
// PENTING: date.toISOString().slice(0,10) mengonversi ke UTC dulu -- karena
// WIB = UTC+7, tengah malam lokal jadi jam 17:00 hari sebelumnya di UTC,
// sehingga tanggalnya terpotong mundur 1 hari. Pakai ini untuk tanggal lokal.
function localDateStr(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
// Jam lokal 'HH:MM' -- dipakai sebagai default field Jam di form NG Inline & Repair.
function localTimeStr(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
// Gabungkan tanggal ('YYYY-MM-DD') + jam ('HH:MM') jadi ISO string timestamptz,
// dipakai backend buat mencocokkan ke baris produksi (production_log_id).
function tanggalJamToIso(tanggal, jam) {
  if (!tanggal || !jam) return null;
  const d = new Date(`${tanggal}T${jam}:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

// =========================================================
// Kompres foto (NG Inline dll) di browser SEBELUM upload ke Supabase
// Storage. Foto dari kamera HP biasanya 3-8 MB -- untuk bukti NG di
// dashboard itu jauh lebih besar dari yang dibutuhkan (bikin upload
// lambat/gagal di sinyal pabrik yang lemah + boros kuota storage).
// Di sini foto di-resize (sisi terpanjang maks 1280px, proporsional,
// tidak diperbesar kalau aslinya sudah kecil) lalu disimpan ulang
// sebagai JPEG kualitas 0.72 -- hasilnya biasanya ~100-300 KB, masih
// jelas terbaca untuk keperluan dokumentasi NG.
// Kalau proses kompres gagal (mis. format file aneh / browser lama),
// foto ASLI tetap dipakai apa adanya -- jangan sampai gagal kompres
// bikin user tidak bisa simpan NG Inline sama sekali.
function compressImageFile(file, { maxDim = 1280, quality = 0.72 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type || !file.type.startsWith("image/")) {
      resolve(file); // bukan gambar (jarang terjadi, input accept="image/*") -- lewati saja
      return;
    }
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width >= height) { height = Math.round((height * maxDim) / width); width = maxDim; }
        else { width = Math.round((width * maxDim) / height); height = maxDim; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; } // gagal encode -- fallback ke file asli
          // Kalau hasil kompres malah lebih besar dari aslinya (jarang,
          // biasanya file kecil/sudah dikompres sebelumnya), pakai aslinya saja.
          if (blob.size >= file.size) { resolve(file); return; }
          const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
          resolve(new File([blob], newName, { type: "image/jpeg" }));
        },
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(file); }; // gagal load -- fallback ke file asli
    img.src = objectUrl;
  });
}

// =========================================================
// Komponen utama
// =========================================================
function machinePage(machineKey, machineLabel, extraFields, routingMax, kategoriOptions, stationConfig) {
  // State viewer 3D (Three.js) disimpan di variabel closure biasa (BUKAN
  // properti reactive Alpine) karena objek internal Three.js (matrix,
  // buffer, dsb) punya property non-configurable yang bentrok kalau
  // dibungkus Proxy reaktif Alpine -> error "read-only ... proxy".
  let repairThreeState = null;
  const repairGeometryCache = new Map(); // view.id -> { object: THREE.Mesh|THREE.Group, box: THREE.Box3 } (biar ganti part gak fetch ulang file 3D-nya)
  // Warna garis las (Point bentuk jalur/path) -- merah normal, oranye
  // saat digambar (drag berlangsung), oranye-terang saat kursor lagi
  // nempel/hover di garisnya (lihat buildWeldLineMarker & setRepairHover).
  const WELD_LINE_COLOR = "#dc2626";
  const WELD_LINE_HOVER_COLOR = "#fb923c";
  const WELD_LINE_DRAW_COLOR = "#fbbf24";
  const WELD_LINE_OPACITY_VIEW = 0;     // Mode Lihat biasa -- INVISIBLE total, cuma nongol pas di-hover
  const WELD_LINE_OPACITY_EDIT = 0.55;  // Mode Edit Point -- tetap keliatan (tipis) biar admin bisa kelola
  const WELD_LINE_HOVER_OPACITY = 1;    // pas kursor/jari nempel -- nyala jelas, di mode manapun
  // Point yang lagi DIPILIH (buat Geser/Ukuran/Edit Titik) -- warna hijau,
  // selalu nyala jelas, beda dari merah biasa & oranye hover, biar keliatan
  // jelas Point mana yang lagi diedit (lihat selectRepairPoint & buildWeldLineMarker).
  const WELD_LINE_SELECTED_COLOR = "#16a34a";
  const WELD_LINE_OPACITY_SELECTED = 0.95;
  const VERTEX_HANDLE_COLOR = "#2563eb"; // bola kecil biru -- handle buat geser 1 titik jalur (Edit Titik)
  const BBOX_HANDLE_COLOR = "#f97316"; // kotak kecil oranye -- handle Ukuran gaya Excel/PowerPoint (sudut & tengah sisi)
  return {
    session: null, profile: null, tab: "produksi_new", loading: true,
    errorMsg: "", successMsg: "",
    extraFields, routingMax: routingMax || 0,
    kategoriOptions: kategoriOptions || ["MESIN", "DIES", "OTHER"],
    stationConfig: stationConfig || { mode: "none" },
    tandemVariant: null,
    mobileNavOpen: false,
    sidebarCollapsed: true,
    theme: localStorage.getItem("theme_v1") || "light",
    toggleTheme() {
      this.theme = this.theme === "dark" ? "light" : "dark";
      localStorage.setItem("theme_v1", this.theme);
      document.documentElement.setAttribute("data-theme", this.theme);
      this.$nextTick(() => {
        this.renderPerfChart(this.activePerfSection);
        this.renderPerfPie(this.activePerfSection);
      });
    },
    isOnline: navigator.onLine, pendingCount: 0, syncing: false,
    nowTick: Date.now(), // detak tiap detik, dipakai buat jam "sampai sekarang" yang live

    lines: {}, // per stasiun: state machine produksi
    productionRows: [], downtimeRows: [], nonProduksiRows: [], planningRows: [],

    // ---- Input Produksi BARU (form ringkas, terpisah dari yang lama) ----
    produksiNewRows: [], produksiNewEditingId: null, produksiNewSaving: false,
    produksiNewForm: {
      waktu_awal: "", waktu_akhir: "", part_number: "", qty: "",
      break_menit: "", dandori_menit: "", waktu_problem_menit: "", total_repair_menit: "",
    },
    partNumberList: [], problemList: [], causeList: [], areaList: [], nonProduksiTypeList: [],
    newPartNumberValue: "", newProblemValue: "", newCauseValue: "", newAreaValue: "", newNonProduksiTypeValue: "",
    picOptions: ["DIES", "MESIN", "PE", "PROD", "PC-SUPP", "QC", "PRESS"],
    newProblemPic: "", newCauseProblemId: "",
    statusOptions: ["Temporary Action", "Permanent Action"],
    machineOptions: MACHINE_OPTIONS, partNumbersByLine: {},

    // ---- NG Inline (cascading: Line -> Model -> Part No / Area -> NG Proses) ----
    ngInlineRows: [], ngModelList: [], ngPartNoList: [], ngAreaOptions: [],
    ngTypeOptions: ["NG PRODUKSI", "NG TRIAL"],
    ngPicOptions: ["AGUS WIBOWO", "IIN FAJRIN MUNIR", "DAFIT ARISTIANTO", "ASEP SUPRIYATNA", "IMAM BAROKAH", "LAMIJO"],
    ngKategoriOptions: [
      "BOLONG", "KERIPUT", "KEROPOS", "WELD MELESET", "UNDERCUT", "AKURASI",
      "DOUBLE WELDING", "WELDING KECIL", "WELDING KURANG", "WELDING OVER",
      "PENDEK", "CRACK", "MATI LISTRIK", "OTHER",
    ],
    ngForm: { tanggal: localDateStr(new Date()), jam: localTimeStr(new Date()), type_ng: "", pic: "", model: "", part_number: "", area_id: "", area: "", ng_proses: "", qty: "", harga: 0, ng_kategori: "", reason: "" },
    ngFotoFile: null, ngFotoPreviewUrl: "", ngSaving: false, ngFotoCompressing: false,
    editingNgId: null, ngExistingFotoUrl: "",

    editingDowntimeId: null, dtForm: {},
    editingNonProduksiId: null, nonProduksiEditForm: {},
    riwayatFilter: { dari: "", sampai: "", part_number: "" },
    downtimeFilterProductionId: null, downtimeFilterLabel: "",

    // ---- Repair (klik titik di gambar part -> popup Qty + Kategori) ----
    repairViews: [], repairActiveViewId: null, repairPoints: [],
    repairKategoriOptions: [], newRepairKategoriValue: "",
    repairPartNoByModel: {},
    repairPartNoModelMap: {},
    repairLogRows: [],
    repairForm: { tanggal: localDateStr(new Date()), jam: localTimeStr(new Date()), part_number: "", qty: "", kategori_repair: "" },
    repairModalOpen: false, repairModalPoint: null, repairSaving: false,
    editingRepairId: null,
    // Mode admin buat naruh titik baru di Master Data
    repairEditMode: false, repairDrawShape: "freehand", repairNewViewLabel: "", repairNewViewFile: null, repairViewUploading: false,
    repairNewViewColor: "#9aa4ad",
    // Point yang lagi dipilih buat di-edit (Geser/Ukuran/Edit Titik), dan
    // sub-mode aksi yang lagi aktif buat Point itu (lihat selectRepairPoint,
    // setRepairActionMode, dan toolbar di HTML: repair-point-toolbar).
    repairSelectedPointId: null, repairPointActionMode: null, // null | 'move' | 'reshape'
    // State viewer 3D (Three.js) -- diisi runtime, bukan reactive data biasa
    repairModelLoading: false,

    // ---- Performance dashboard (3 seksi independen) ----
    perf: {
      tahunan: { anchor: localDateStr(new Date()), loading: false, loaded: false, data: null, trend: [], chart: null, pieChart: null, top5: [], byCategory: [] },
      bulanan: { anchor: localDateStr(new Date()), loading: false, loaded: false, data: null, trend: [], chart: null, pieChart: null, top5: [], byCategory: [] },
      harian: { anchor: localDateStr(new Date()), loading: false, loaded: false, data: null, trend: [], chart: null, pieChart: null, top5: [], byCategory: [] },
    },

    isLeaderOrAdmin() {
      return this.profile && ["admin", "leader"].includes(this.profile.role);
    },

    async init() {
      this.session = await requireAuth();
      if (!this.session) return;
      window.addEventListener("online", () => { this.isOnline = true; this.syncNow(); });
      window.addEventListener("offline", () => { this.isOnline = false; });
      setInterval(() => this.syncNow(), 20000);
      setInterval(() => { this.nowTick = Date.now(); }, 1000);

      try {
        const { data: profile, error: pErr } = await supabaseClient.from("profiles").select("*").eq("id", this.session.user.id).maybeSingle();
        if (pErr) throw pErr;
        this.profile = profile;

        this.ensureLines();
        await Promise.all([
          this.fetchProduction(), this.fetchDowntime(), this.fetchNonProduksi(),
          this.fetchPlanning(), this.fetchPartNumbers(), this.fetchProblems(), this.fetchCauses(), this.fetchAreas(), this.fetchNonProduksiTypes(),
          this.fetchNgModelsForLine(), this.fetchNgInline(), this.fetchProduksiNew(),
          this.fetchRepairViews(), this.fetchRepairKategori(), this.fetchRepairLog(), this.fetchRepairPartNoOptions(),
        ]);
        this.restoreLocalState();
        await this.fetchProduksiPartNumberOptions();
        this.watchAndAutosave();
        this.refreshPendingCount();
        await this.fetchMesinSettings();
        // Data Performance (Tahunan/Bulanan/Harian) SENGAJA TIDAK dimuat di sini.
        // Sebelumnya fetchAllPerf() dipanggil otomatis di init(), padahal itu
        // memicu puluhan request RPC sekaligus (tiap hari dalam sebulan +
        // tiap bulan/tahun + top5 + kategori, dikali 3 seksi) SETIAP kali
        // halaman line dibuka -- walau tab Performance belum tentu dibuka
        // user. Ini penyebab utama loading awal jadi sangat lama.
        // Sekarang data itu baru diambil saat tab/seksi Performance benar-benar
        // dibuka (lihat openPerformanceTab() & setActivePerfSection()).
        this.$watch("tandemVariant", () => {
          // Ganti varian tandem -> data performance lama sudah tidak relevan
          // (beda stasiun). Reset status "loaded" supaya diambil ulang saat
          // seksi yang bersangkutan dibuka lagi, bukan langsung fetch semua.
          Object.values(this.perf).forEach((st) => { st.loaded = false; st.data = null; });
          if (this.tab === "performance") this.fetchPerfSection(this.activePerfSection);
        });
        await this.syncNow();
        this.initRealtime();
      } catch (err) {
        this.flash("Gagal memuat halaman: " + (err.message || err), true);
      } finally {
        this.loading = false;
      }
    },

    // =========================================================
    // REALTIME — biar semua tab/HP yang lagi buka line yang sama otomatis
    // ke-update begitu ADA SIAPA SAJA (device manapun) simpan/ubah/hapus
    // data Produksi/Downtime/Non-Produksi/NG Inline/Repair, TANPA reload.
    // Pakai Supabase Realtime (postgres_changes) -- perlu tabelnya sudah
    // didaftarkan ke publication `supabase_realtime` (lihat
    // migration_enable_realtime.sql, jalankan sekali di Supabase).
    // =========================================================
    _rtChannel: null,
    _rtDebounceTimers: {},
    // Kumpulkan beberapa event yang datang beruntun (mis. sync offline
    // banyak baris sekaligus) jadi 1 kali fetch saja, biar tidak spam.
    debouncedRealtimeFetch(key, fn, delayMs = 400) {
      clearTimeout(this._rtDebounceTimers[key]);
      this._rtDebounceTimers[key] = setTimeout(fn, delayMs);
    },
    initRealtime() {
      if (this._rtChannel) return; // sudah jalan, jangan dobel subscribe
      const mesinFilter = `mesin=eq.${machineKey}`;
      const REALTIME_TABLE_FETCHERS = {
        production_log: () => this.fetchProduction(),
        production_log_new: () => this.fetchProduksiNew(),
        downtime_log: () => this.fetchDowntime(),
        dandori_log: () => this.fetchNonProduksi(),
        ng_inline_log: () => this.fetchNgInline(),
        repair_log: () => this.fetchRepairLog(),
        repair_views: () => this.fetchRepairViews(),
      };
      let channel = supabaseClient.channel("rt_machine_" + machineKey);
      Object.keys(REALTIME_TABLE_FETCHERS).forEach((table) => {
        channel = channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table, filter: mesinFilter },
          () => {
            this.debouncedRealtimeFetch(table, REALTIME_TABLE_FETCHERS[table]);
            // Data berubah -> angka di tab Performance yang sudah pernah
            // dibuka user jadi basi, refresh juga (di-debounce terpisah).
            this.debouncedRealtimeFetch("perf_after_" + table, () => this.refreshLoadedPerf(), 800);
          }
        );
      });
      // repair_points tidak punya kolom "mesin" langsung (nempel ke
      // view_id -> repair_views.mesin), jadi difilter manual di JS: cuma
      // proses kalau view_id-nya memang salah satu part 3D milik line ini.
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "repair_points" },
        (payload) => {
          const viewId = (payload.new && payload.new.view_id) || (payload.old && payload.old.view_id);
          if (!viewId) return;
          if (!this.repairViews.some((v) => v.id === viewId)) return; // bukan part 3D milik line ini
          this.debouncedRealtimeFetch("repair_points_" + viewId, async () => {
            if (viewId === this.repairActiveViewId) {
              await this.fetchRepairPoints(viewId);
              this.rebuildRepairMarkers();
            }
          });
        }
      );
      this._rtChannel = channel.subscribe();
      // Tutup koneksi realtime rapi-rapi kalau tab ditutup/pindah halaman.
      window.addEventListener("beforeunload", () => {
        if (this._rtChannel) supabaseClient.removeChannel(this._rtChannel);
      });
    },

    flash(msg, isError = false) {
      if (isError) { this.errorMsg = msg; this.successMsg = ""; } else { this.successMsg = msg; this.errorMsg = ""; }
      setTimeout(() => { this.errorMsg = ""; this.successMsg = ""; }, 4000);
    },

    refreshPendingCount() {
      this.pendingCount = loadOfflineQueue().filter((i) => i.payload.mesin === machineKey).length;
    },
    async syncNow() {
      if (this.syncing || !navigator.onLine) return;
      this.syncing = true;
      const { synced } = await trySyncOfflineQueue();
      this.syncing = false;
      this.refreshPendingCount();
      if (synced > 0) {
        this.flash(synced + " data offline berhasil disinkron.");
        await Promise.all([this.fetchProduction(), this.fetchDowntime(), this.fetchNonProduksi()]);
      }
    },

    // ================= STASIUN =================
    stationList() {
      const cfg = this.stationConfig;
      if (cfg.mode === "fixed") return cfg.stations.map((id) => ({ id, label: id }));
      if (cfg.mode === "variant") {
        if (!this.tandemVariant) return [];
        return cfg.variants[this.tandemVariant].map((id) => ({ id, label: id }));
      }
      return [{ id: "_single", label: null }];
    },
    dbStasiun(stationId) { return stationId === "_single" ? null : stationId; },
    setTandemVariant(v) { this.tandemVariant = v; this.ensureLines(); },

    freshLine() {
      return {
        state: "idle", // idle | awaiting_gap | awaiting_actual_start | running | nonproduksi_running | edit
        entryStart: null, entryEnd: null,
        editingId: null,
        form: { part_number: "", qty: "", manpower: "", repair: "" },
        gapInfo: null, // {gapStart, gapEnd}
        gapForm: { nonproduksi_nama: "" },
        gapAddedList: [], // daftar nama non-produksi yang sudah ditambahkan berurutan (K -> B1 -> A)
        afterFinishChoice: false, // munculkan pilihan Setup / Non-Produksi
        nonProdForm: { nama: "" },
        nonProdActiveStart: null,
        routingType: null, routingNumbers: [],
      };
    },
    ensureLines() {
      this.stationList().forEach((st) => { if (!this.lines[st.id]) this.lines[st.id] = this.freshLine(); });
    },
    routingRange() { return Array.from({ length: this.routingMax }, (_, i) => i + 1); },
    setRoutingType(stationId, type) { this.lines[stationId].routingType = type; this.lines[stationId].routingNumbers = []; },
    toggleRoutingNumber(stationId, n) {
      const l = this.lines[stationId]; const i = l.routingNumbers.indexOf(n);
      if (i === -1) l.routingNumbers.push(n); else l.routingNumbers.splice(i, 1);
    },

    // Cari waktu_akhir TERAKHIR (produksi ATAU non-produksi) di stasiun ini.
    lastEventEnd(stationId) {
      const want = this.dbStasiun(stationId);
      const prodEnds = this.productionRows.filter((r) => (r.stasiun || null) === want && !r._pending).map((r) => new Date(r.waktu_akhir));
      const npEnds = this.nonProduksiRows.filter((r) => (r.stasiun || null) === want && !r._pending).map((r) => new Date(r.waktu_akhir));
      const all = [...prodEnds, ...npEnds];
      if (all.length === 0) return null;
      return new Date(Math.max(...all.map((d) => d.getTime())));
    },

    // ================= TOMBOL MULAI PRODUKSI =================
    clickMulai(stationId) {
      const line = this.lines[stationId];
      const now = new Date();

      if (line.state === "nonproduksi_running") {
        this.finalizeNonProduksi(stationId, now);
        return;
      }

      if (line.state !== "idle") return;

      const last = this.lastEventEnd(stationId);
      const period = shiftPeriodFor(now);
      const clampedStart = last && last > period.start ? last : period.start;

      if (clampedStart < now) {
        line.gapInfo = { gapStart: clampedStart.toISOString(), gapEnd: now.toISOString() };
        line.state = "awaiting_gap";
      } else {
        this.openPartSelection(stationId, now.toISOString());
      }
    },

    // Batal klasifikasi jeda -- kembalikan stasiun ke keadaan semula (idle)
    cancelGapNonProduksi(stationId) {
      const line = this.lines[stationId];
      line.gapInfo = null;
      line.gapForm = { nonproduksi_nama: "" };
      line.gapAddedList = [];
      line.state = "idle";
    },
    async confirmGapNonProduksi(stationId) {
      const line = this.lines[stationId];
      const nama = line.gapForm.nonproduksi_nama;
      if (!nama) { this.flash("Pilih jenis non-produksi dulu.", true); return; }
      const waktuAkhir = new Date().toISOString();
      const payload = {
        mesin: machineKey, stasiun: this.dbStasiun(stationId),
        waktu_awal: line.gapInfo.gapStart, waktu_akhir: waktuAkhir,
        kategori: "OTHER", part_dari: null, part_ke: nama, keterangan: nama,
      };
      await this.saveNonProduksiRow(payload);
      line.gapInfo = null; line.gapForm.nonproduksi_nama = ""; line.gapAddedList = [];
      this.openPartSelection(stationId, waktuAkhir);
    },
    // Tambah beberapa jenis Non-Produksi berurutan sebelum mulai produksi
    // (mis. K -> B1 -> A -> baru Produksi), tanpa harus langsung lanjut ke
    // pilih Part Number setiap kali.
    async addAnotherGapNonProduksi(stationId) {
      const line = this.lines[stationId];
      const nama = line.gapForm.nonproduksi_nama;
      if (!nama) { this.flash("Pilih jenis non-produksi dulu.", true); return; }
      const waktuAkhir = new Date().toISOString();
      const payload = {
        mesin: machineKey, stasiun: this.dbStasiun(stationId),
        waktu_awal: line.gapInfo.gapStart, waktu_akhir: waktuAkhir,
        kategori: "OTHER", part_dari: null, part_ke: nama, keterangan: nama,
      };
      await this.saveNonProduksiRow(payload);
      if (!line.gapAddedList) line.gapAddedList = [];
      line.gapAddedList.push(nama);
      // Buka segmen baru, mulai dari sekarang, tetap di layar yang sama.
      line.gapInfo = { gapStart: waktuAkhir, gapEnd: waktuAkhir };
      line.gapForm.nonproduksi_nama = "";
    },

    openPartSelection(stationId, startIso) {
      const line = this.lines[stationId];
      line.entryStart = startIso; line.entryEnd = null;
      line.form = { part_number: "", qty: "", manpower: "", repair: "" };
      line.routingType = null; line.routingNumbers = [];
      line.state = "awaiting_actual_start";
    },

    choosePlannedPart(stationId, planItem) {
      this.lines[stationId].form.part_number = planItem.part_number;
      this.lines[stationId].form.qty = planItem.qty_rencana ?? "";
      this.lines[stationId]._planningId = planItem.id;
      this.autofillManpower(stationId, planItem.part_number);
    },

    // Isi Jumlah MP otomatis dari Std MP part number itu (kalau ada) —
    // operator tetap bisa revisi manual kalau beda dari standar.
    autofillManpower(stationId, partNumberValue) {
      const entry = this.partNumberList.find((p) => p.value === partNumberValue);
      if (entry && entry.std_mp !== null && entry.std_mp !== undefined && entry.std_mp !== "") {
        this.lines[stationId].form.manpower = entry.std_mp;
      }
    },
    // Std MP part ini belum diisi di Master Data -> autofill gak ada yang
    // ditarik, jadi field Jumlah MP harus tetap ditampilkan supaya operator
    // isi manual (biar gak kesimpen kosong ke Supabase).
    mpAutofillMissing(stationId) {
      const pn = this.lines[stationId]?.form?.part_number;
      if (!pn) return false;
      const entry = this.partNumberList.find((p) => p.value === pn);
      return !entry || entry.std_mp === null || entry.std_mp === undefined || entry.std_mp === "";
    },

    confirmActualStart(stationId) {
      const line = this.lines[stationId];
      if (!line.form.part_number) { this.flash("Pilih Part Number dulu.", true); return; }
      line.actualStartConfirmedAt = new Date().toISOString();
      line.state = "running";
    },

    stopProduksi(stationId) {
      const line = this.lines[stationId];
      line.entryEnd = new Date().toISOString();
      line.state = "finished";
      line.afterFinishChoice = true;
    },

    cancelLine(stationId) { this.lines[stationId] = this.freshLine(); },

    async chooseSetupNext(stationId) {
      const line = this.lines[stationId];
      if (line.form.qty === "" || line.form.qty === null || Number(line.form.qty) < 0) {
        this.flash("Qty Aktual wajib diisi sebelum lanjut.", true);
        return;
      }
      await this.commitProductionRow(stationId);
      line.afterFinishChoice = false;
      this.openPartSelection(stationId, line.entryEnd || new Date().toISOString());
    },
    async chooseNonProduksiNext(stationId) {
      const line = this.lines[stationId];
      if (line.form.qty === "" || line.form.qty === null || Number(line.form.qty) < 0) {
        this.flash("Qty Aktual wajib diisi sebelum lanjut.", true);
        return;
      }
      await this.commitProductionRow(stationId);
      const endTime = line.entryEnd || new Date().toISOString();
      line.afterFinishChoice = false;
      line.state = "nonproduksi_running";
      line.nonProdActiveStart = endTime;
      line.nonProdForm = { nama: "" };
    },

    async finalizeNonProduksi(stationId, now) {
      const line = this.lines[stationId];
      const nama = line.nonProdForm.nama;
      if (!nama) { this.flash("Pilih jenis non-produksi dulu sebelum lanjut.", true); return; }
      const payload = {
        mesin: machineKey, stasiun: this.dbStasiun(stationId),
        waktu_awal: line.nonProdActiveStart, waktu_akhir: now.toISOString(),
        kategori: "OTHER", part_dari: null, part_ke: nama, keterangan: nama,
      };
      await this.saveNonProduksiRow(payload);
      line.state = "idle";
      this.openPartSelection(stationId, payload.waktu_akhir);
    },

    // Tutup non-produksi (mis. Meeting Akhir Shift) TANPA membuka fase
    // produksi baru — dipakai untuk mengakhiri operasi mesin di shift ini.
    async endNonProduksiAndStop(stationId) {
      const line = this.lines[stationId];
      const nama = line.nonProdForm.nama;
      if (!nama) { this.flash("Pilih jenis non-produksi dulu.", true); return; }
      const payload = {
        mesin: machineKey, stasiun: this.dbStasiun(stationId),
        waktu_awal: line.nonProdActiveStart, waktu_akhir: new Date().toISOString(),
        kategori: "OTHER", part_dari: null, part_ke: nama, keterangan: nama,
      };
      await this.saveNonProduksiRow(payload);
      this.lines[stationId] = this.freshLine();
      this.flash("Shift ditutup — mesin dianggap tidak beroperasi sampai Mulai Produksi ditekan lagi.");
    },

    // Break Edit form otomatis dihitung ulang dari jadwal break resmi shift
    // (sama seperti alur normal Mulai/Selesai Produksi), tiap kali Waktu
    // Awal/Akhir di form Edit diubah.
    recalcEditBreak(stationId) {
      const f = this.lines[stationId].editForm;
      if (!f.waktu_awal || !f.waktu_akhir) return;
      const wa = new Date(f.waktu_awal), wk = new Date(f.waktu_akhir);
      if (Number.isNaN(wa.getTime()) || Number.isNaN(wk.getTime()) || wk < wa) return;
      f.break_menit = computeBreakMinutes(wa.toISOString(), wk.toISOString());
    },

    async commitProductionRow(stationId) {
      const line = this.lines[stationId];
      const dandoriMenit = Math.round((new Date(line.actualStartConfirmedAt) - new Date(line.entryStart)) / 60000);
      const breakMenit = computeBreakMinutes(line.entryStart, line.entryEnd);
      const extra = {};
      this.extraFields.forEach((f) => { if (line.form[f.key]) extra[f.key] = line.form[f.key]; });
      if (this.routingMax > 0) { extra.routing_type = line.routingType; extra.routing_numbers = line.routingNumbers; }

      const payload = {
        mesin: machineKey, stasiun: this.dbStasiun(stationId),
        waktu_awal: line.entryStart, waktu_akhir: line.entryEnd,
        part_number: line.form.part_number, qty: line.form.qty === "" ? null : Number(line.form.qty),
        manpower: line.form.manpower === "" ? null : Number(line.form.manpower),
        repair: line.form.repair === "" ? null : Number(line.form.repair),
        dandori_menit: dandoriMenit, downtime_menit: 0, break_menit: breakMenit,
        ng: null, extra: extra,
      };
      if (line.form.part_number) this.learnPartNumber(line.form.part_number);

      try {
        if (!navigator.onLine) throw new Error("offline");
        const { error } = await supabaseClient.from("production_log").insert(payload);
        if (error) throw error;
        if (line._planningId) {
          await supabaseClient.from("production_planning").update({ status: "selesai" }).eq("id", line._planningId);
        }
        this.flash("Data produksi tersimpan.");
        await Promise.all([this.fetchProduction(), this.fetchPlanning()]);
        this.refreshLoadedPerf();
      } catch (err) {
        if (isNetworkError(err)) {
          enqueueOffline("production_log", payload);
          this.refreshPendingCount();
          this.productionRows.unshift({ ...payload, id: "pending_" + Date.now(), _pending: true });
          this.flash("Tidak ada jaringan — data disimpan di HP, disinkron otomatis nanti.");
        } else {
          this.flash("Gagal menyimpan produksi: " + (err.message || err), true);
        }
      }
    },

    async saveNonProduksiRow(payload) {
      try {
        if (!navigator.onLine) throw new Error("offline");
        payload.created_by = this.session.user.id;
        const { error } = await supabaseClient.from("dandori_log").insert(payload);
        if (error) throw error;
        await this.fetchNonProduksi();
      } catch (err) {
        if (isNetworkError(err)) {
          enqueueOffline("dandori_log", payload);
          this.refreshPendingCount();
          this.nonProduksiRows.unshift({ ...payload, id: "pending_" + Date.now(), _pending: true });
        } else {
          this.flash("Gagal menyimpan non-produksi: " + (err.message || err), true);
        }
      }
    },

    // ================= FETCH =================
    async fetchProduction() {
      const { data, error } = await supabaseClient.from("production_log").select("*").eq("mesin", machineKey).order("waktu_awal", { ascending: false }).limit(500);
      if (error) { this.flash("Gagal memuat data produksi: " + error.message, true); return; }
      const ids = (data || []).map((r) => r.id);
      // NG Inline dicocokkan ke baris produksi lewat production_log_id
      // (auto-link berdasar jam kejadian -- lihat migration_ng_repair_link_produksi.sql).
      // Baris lama (sebelum migrasi ini) belum punya link, jadi tampil 0 di sini.
      const ngInlineRes = ids.length
        ? await supabaseClient.from("ng_inline_log").select("production_log_id, qty").in("production_log_id", ids)
        : { data: [] };
      const ngInlineByRow = {};
      (ngInlineRes.data || []).forEach((r) => {
        ngInlineByRow[r.production_log_id] = (ngInlineByRow[r.production_log_id] || 0) + (Number(r.qty) || 0);
      });
      this.productionRows = (data || []).map((r) => ({ ...r, ngInlineQty: ngInlineByRow[r.id] || 0 }));
    },
    // Diklik dari angka Downtime di tabel Riwayat — loncat ke tab Downtime,
    // difilter cuma nampilin downtime yang nempel di baris produksi itu.
    viewDowntimeForProduction(row) {
      this.downtimeFilterProductionId = row.id;
      this.downtimeFilterLabel = (row.part_number || "-") + " (" + this.fmt(row.waktu_awal) + ")";
      this.tab = "downtime";
    },
    clearDowntimeFilter() {
      this.downtimeFilterProductionId = null;
      this.downtimeFilterLabel = "";
    },
    downtimeRowsFiltered() {
      if (!this.downtimeFilterProductionId) return this.downtimeRows;
      return this.downtimeRows.filter((r) => r.production_log_id === this.downtimeFilterProductionId);
    },

    // ================= PERFORMANCE (Tahunan/Bulanan/Harian) =================
    activePerfSection: "harian", // cuma 1 aktif sekaligus -- muat 1 halaman
    perfDayRows: [],
    async fetchPerfDayRows() {
      const st = this.perf.harian;
      const { start, end } = this.perfBounds("hari", st.anchor, 0);
      const stasiunList = (this.stationConfig.mode === "variant" && this.tandemVariant)
        ? this.stationConfig.variants[this.tandemVariant]
        : null;
      let q = supabaseClient.from("production_log")
        .select("id, stasiun, waktu_awal, waktu_akhir, part_number, qty, repair, dandori_menit, downtime_menit, break_menit")
        .eq("mesin", machineKey)
        .gte("waktu_awal", start.toISOString())
        .lt("waktu_awal", end.toISOString());
      if (stasiunList) q = q.in("stasiun", stasiunList);
      const { data, error } = await q.order("waktu_awal", { ascending: true });
      if (error) { this.perfDayRows = []; return; }

      const ids = (data || []).map((r) => r.id);
      // NG Inline dicocokkan ke baris produksi lewat production_log_id
      // (auto-link berdasar jam kejadian -- lihat migration_ng_repair_link_produksi.sql).
      // Baris lama (sebelum migrasi ini) belum punya link, jadi tampil 0 di sini.
      // Repair diambil LANGSUNG dari kolom production_log.repair (diisi di form
      // Input Produksi NEW) -- BUKAN dari tabel repair_log (menu Repair 3D terpisah).
      const ngInlineRes = ids.length
        ? await supabaseClient.from("ng_inline_log").select("production_log_id, qty").in("production_log_id", ids)
        : { data: [] };
      const ngInlineByRow = {};
      (ngInlineRes.data || []).forEach((r) => {
        ngInlineByRow[r.production_log_id] = (ngInlineByRow[r.production_log_id] || 0) + (Number(r.qty) || 0);
      });

      this.perfDayRows = (data || [])
        .map((r) => ({ ...r, ngInlineQty: ngInlineByRow[r.id] || 0, repairQty: Number(r.repair) || 0 }))
        .sort((a, b) => {
          const s = String(a.stasiun || "").localeCompare(String(b.stasiun || ""));
          if (s !== 0) return s;
          return new Date(a.waktu_awal) - new Date(b.waktu_awal);
        });
    },
    setActivePerfSection(section) {
      this.activePerfSection = section;
      if (!this.perf[section].loaded && !this.perf[section].loading) {
        this.fetchPerfSection(section);
      }
      this.$nextTick(() => { this.renderPerfChart(section); this.renderPerfPie(section); });
    },
    mesinSettings: { gsph_target_mode: "fixed", gsph_target_fixed: 0 },
    mesinSettingsDraft: { gsph_target_mode: "fixed", gsph_target_fixed: 0 },
    async fetchMesinSettings() {
      const { data, error } = await supabaseClient.from("mesin_settings").select("*").eq("mesin", machineKey).maybeSingle();
      if (!error && data) {
        this.mesinSettings = data;
        this.mesinSettingsDraft = { gsph_target_mode: data.gsph_target_mode, gsph_target_fixed: data.gsph_target_fixed };
      }
    },
    async saveMesinSettings() {
      const payload = {
        mesin: machineKey,
        gsph_target_mode: this.mesinSettingsDraft.gsph_target_mode,
        gsph_target_fixed: Number(this.mesinSettingsDraft.gsph_target_fixed) || 0,
        updated_by: this.session.user.id,
      };
      const { error } = await supabaseClient.from("mesin_settings").upsert(payload, { onConflict: "mesin" });
      if (error) { this.flash("Gagal simpan setting: " + error.message, true); return; }
      this.mesinSettings = payload;
      this.flash("Target GSPH disimpan.");
      this.refreshLoadedPerf();
    },
    // Konfigurasi tiap seksi: satuan waktu & berapa periode ditampilkan di grafik tren.
    PERF_CONFIG: {
      tahunan: { unit: "year" },
      bulanan: { unit: "month" },
      harian: { unit: "day" },
    },
    // Susun daftar periode utk grafik, sesuai mode:
    //  - tahunan : 3 tahun terakhir + PEMBATAS + Jan..Des tahun terpilih
    //  - bulanan : tiap hari dlm bulan terpilih
    //  - harian  : hanya hari itu (Target vs Aktual)
    buildPerfPeriods(section, anchorStr) {
      const d = new Date(anchorStr + "T00:00:00");
      const out = [];
      if (section === "tahunan") {
        const y = d.getFullYear();
        for (let i = 2; i >= 0; i--) {
          const yy = y - i;
          out.push({
            start: new Date(yy, 0, 1), end: new Date(yy + 1, 0, 1),
            label: String(yy), kind: "year",
          });
        }
        out.push({ separator: true, label: "", kind: "sep" });
        const NAMA_BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
        for (let m = 0; m < 12; m++) {
          out.push({
            start: new Date(y, m, 1), end: new Date(y, m + 1, 1),
            label: NAMA_BULAN[m], kind: "month",
          });
        }
        return out;
      }
      if (section === "bulanan") {
        const y = d.getFullYear(), m = d.getMonth();
        const jumlahHari = new Date(y, m + 1, 0).getDate();
        for (let day = 1; day <= jumlahHari; day++) {
          out.push({
            start: new Date(y, m, day), end: new Date(y, m, day + 1),
            label: String(day), kind: "day",
          });
        }
        return out;
      }
      // harian -- cuma 1 batang (hari itu)
      out.push({
        start: new Date(d.getFullYear(), d.getMonth(), d.getDate()),
        end: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1),
        label: d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }),
        kind: "day",
      });
      return out;
    },
    perfBounds(unit, anchorStr, offset = 0) {
      const d = new Date(anchorStr + "T00:00:00");
      if (unit === "year") {
        const y = d.getFullYear() + offset;
        return { start: new Date(y, 0, 1), end: new Date(y + 1, 0, 1) };
      }
      if (unit === "month") {
        const y = d.getFullYear(), m = d.getMonth() + offset;
        return { start: new Date(y, m, 1), end: new Date(y, m + 1, 1) };
      }
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset);
      return { start, end: new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset + 1) };
    },
    perfPeriodLabel(unit, start) {
      if (unit === "year") return String(start.getFullYear());
      if (unit === "month") return start.toLocaleDateString("id-ID", { month: "short", year: "numeric" });
      return start.toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
    },
    perfLabel(section) {
      const cfg = this.PERF_CONFIG[section];
      const { start } = this.perfBounds(cfg.unit, this.perf[section].anchor, 0);
      if (cfg.unit === "year") return String(start.getFullYear());
      if (cfg.unit === "month") return start.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
      return start.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
    },
    // ---- Picker langsung (ganti tombol geser) ----
    perfYearValue(section) {
      return new Date(this.perf[section].anchor + "T00:00:00").getFullYear();
    },
    perfMonthValue(section) {
      return this.perf[section].anchor.slice(0, 7); // 'YYYY-MM'
    },
    setPerfYear(section, val) {
      const y = parseInt(val, 10);
      if (!y || y < 1900) return;
      const d = new Date(this.perf[section].anchor + "T00:00:00");
      d.setFullYear(y);
      this.perf[section].anchor = localDateStr(d);
      this.fetchPerfSection(section);
    },
    setPerfMonth(section, val) {
      if (!val) return; // val = 'YYYY-MM'
      this.perf[section].anchor = val + "-01";
      this.fetchPerfSection(section);
    },
    setPerfDate(section, val) {
      if (!val) return; // val = 'YYYY-MM-DD'
      this.perf[section].anchor = val;
      this.fetchPerfSection(section);
    },
    // ---- Ambil agregat lewat fungsi database (bukan tarik baris mentah ke
    // browser) — supaya tidak kepotong batas baris utk periode/mesin besar. ----
    async fetchPerfSection(section) {
      const cfg = this.PERF_CONFIG[section];
      const st = this.perf[section];
      st.loading = true;

      const stasiunList = (this.stationConfig.mode === "variant" && this.tandemVariant)
        ? this.stationConfig.variants[this.tandemVariant]
        : null;

      const periods = this.buildPerfPeriods(section, st.anchor);
      const currentBounds = this.perfBounds(cfg.unit, st.anchor, 0);

      const [aggResults, top5Result, catResult] = await Promise.all([
        Promise.all(periods.map((p) =>
          p.separator
            ? Promise.resolve({ data: null })
            : supabaseClient.rpc("performance_aggregate", {
                p_mesin: machineKey, p_stasiun_list: stasiunList,
                p_start: p.start.toISOString(), p_end: p.end.toISOString(),
              })
        )),
        supabaseClient.rpc("downtime_top_problems", {
          p_mesin: machineKey, p_stasiun_list: stasiunList,
          p_start: currentBounds.start.toISOString(), p_end: currentBounds.end.toISOString(), p_limit: 5,
        }),
        supabaseClient.rpc("downtime_by_category", {
          p_mesin: machineKey, p_stasiun_list: stasiunList,
          p_start: currentBounds.start.toISOString(), p_end: currentBounds.end.toISOString(),
        }),
      ]);
      st.loading = false;

      const anyError = aggResults.find((r) => r.error);
      if (anyError) { this.flash("Gagal memuat data performance: " + anyError.error.message, true); return; }

      const targetMode = this.mesinSettings.gsph_target_mode;
      const targetFixed = Number(this.mesinSettings.gsph_target_fixed) || 0;

      const trend = periods.map((p, idx) => {
        if (p.separator) {
          return { label: "", separator: true, gsph: null, targetGsph: null };
        }
        const row = (aggResults[idx].data && aggResults[idx].data[0]) || {};
        const whJam = (Number(row.wh_menit) || 0) / 60;
        const stroke = Number(row.stroke) || 0;
        const ng = Number(row.ng) || 0;
        const ngValue = Number(row.ng_value) || 0;
        const downtimeMenit = Math.round(Number(row.downtime_menit) || 0);
        const targetStdMenit = Number(row.target_std_menit) || 0;
        let targetGsph = targetFixed;
        if (targetMode === "per_part" && targetStdMenit > 0) {
          targetGsph = stroke / (targetStdMenit / 60);
        }
        const gsph = whJam > 0 ? stroke / whJam : 0;
        const availability = whJam > 0 ? Math.max(0, (whJam * 60 - downtimeMenit) / (whJam * 60)) * 100 : 0;
        const performanceFactor = targetGsph > 0 ? Math.min(gsph / targetGsph, 1) * 100 : 0;
        const quality = stroke > 0 ? Math.max(0, (stroke - ng) / stroke) * 100 : 100;
        const oee = (availability / 100) * (performanceFactor / 100) * (quality / 100) * 100;
        return {
          label: p.label, kindYear: p.kind === "year", stroke, ng, ngValue,
          dandoriMenit: Math.round(Number(row.dandori_menit) || 0),
          downtimeMenit,
          breakMenit: Math.round(Number(row.break_menit) || 0),
          whJam, gsph,
          jumlahBaris: Number(row.jumlah_baris) || 0,
          repairQty: Math.round(Number(row.repair_qty) || 0),
          targetGsph, availability, performanceFactor, quality, oee,
        };
      });
      st.trend = trend;
      // Kartu angka selalu menampilkan PERIODE TERPILIH:
      //  - tahunan -> tahun terpilih (index ke-2, sebelum pembatas)
      //  - bulanan/harian -> agregat periode itu sendiri
      if (section === "tahunan") {
        st.data = trend[2] || null;
      } else if (section === "bulanan") {
        // jumlahkan seluruh hari dlm bulan terpilih
        const valid = trend.filter((t) => !t.separator);
        const sum = valid.reduce((a, t) => ({
          stroke: a.stroke + (t.stroke || 0), ng: a.ng + (t.ng || 0),
          ngValue: a.ngValue + (t.ngValue || 0),
          dandoriMenit: a.dandoriMenit + (t.dandoriMenit || 0),
          downtimeMenit: a.downtimeMenit + (t.downtimeMenit || 0),
          breakMenit: a.breakMenit + (t.breakMenit || 0),
          whJam: a.whJam + (t.whJam || 0),
          repairQty: a.repairQty + (t.repairQty || 0),
        }), { stroke: 0, ng: 0, ngValue: 0, dandoriMenit: 0, downtimeMenit: 0, breakMenit: 0, whJam: 0, repairQty: 0 });
        const gsph = sum.whJam > 0 ? sum.stroke / sum.whJam : 0;
        const tg = (valid.find((t) => t.targetGsph > 0) || {}).targetGsph || 0;
        const availability = sum.whJam > 0 ? Math.max(0, (sum.whJam * 60 - sum.downtimeMenit) / (sum.whJam * 60)) * 100 : 0;
        const performanceFactor = tg > 0 ? Math.min(gsph / tg, 1) * 100 : 0;
        const quality = sum.stroke > 0 ? Math.max(0, (sum.stroke - sum.ng) / sum.stroke) * 100 : 100;
        st.data = {
          ...sum, gsph, targetGsph: tg, availability, performanceFactor, quality,
          oee: (availability / 100) * (performanceFactor / 100) * (quality / 100) * 100,
          label: this.perfPeriodLabel("month", this.perfBounds("month", st.anchor, 0).start),
        };
      } else {
        st.data = trend[trend.length - 1];
      }
      st.top5 = (top5Result.data || []).map((r) => ({ kategori: r.kategori, problem: r.problem, menit: Math.round(Number(r.total_menit) || 0) }));
      st.byCategory = (catResult.data || []).map((r) => ({ kategori: r.kategori, menit: Math.round(Number(r.total_menit) || 0) }));
      st.loaded = true;
      if (section === "harian") this.fetchPerfDayRows();
      this.$nextTick(() => { this.renderPerfChart(section); this.renderPerfPie(section); });
    },
    fetchAllPerf() {
      Object.keys(this.PERF_CONFIG).forEach((s) => this.fetchPerfSection(s));
    },
    // Refresh HANYA seksi Performance yang sudah pernah dibuka/dimuat user,
    // dipanggil setelah simpan/hapus data (Produksi, Downtime, NG Inline, dst).
    // Sengaja BUKAN fetchAllPerf() -- itu akan memuat ulang Tahunan + Bulanan +
    // Harian sekaligus (puluhan request RPC) walau user belum pernah buka
    // tab Performance sama sekali, bikin tiap simpan data jadi berat.
    refreshLoadedPerf() {
      Object.keys(this.perf).forEach((s) => { if (this.perf[s].loaded) this.fetchPerfSection(s); });
    },
    openPerformanceTab() {
      this.tab = "performance";
      if (!this.perf[this.activePerfSection].loaded && !this.perf[this.activePerfSection].loading) {
        this.fetchPerfSection(this.activePerfSection);
      }
      this.$nextTick(() => { this.renderPerfChart(this.activePerfSection); this.renderPerfPie(this.activePerfSection); });
    },
    perfOeeStatusClass(data) {
      if (!data || !data.stroke) return "status-none";
      const n = Number(data.oee) || 0;
      if (n >= 75) return "status-good";
      if (n >= 50) return "status-warn";
      return "status-bad";
    },
    perfBarWidth(v) {
      const n = Number(v) || 0;
      return Math.max(0, Math.min(100, n));
    },
    renderPerfChart(section) {
      const st = this.perf[section];
      if (!st.trend || st.trend.length === 0) return;
      const canvasId = "perfChart_" + machineKey + "_" + section + (section === "harian" ? "_daily" : "");
      const canvas = document.getElementById(canvasId);
      if (!canvas || typeof Chart === "undefined") return;
      if (st.chart) st.chart.destroy();
      // Mode harian -> tampilkan 2 batang berdampingan (Target vs Aktual)
      if (section === "harian") {
        const d = st.data || {};
        st.chart = new Chart(canvas, {
          type: "bar",
          data: {
            labels: ["GSPH"],
            datasets: [
              { label: "Target", data: [Number((d.targetGsph || 0).toFixed(1))],
                backgroundColor: cssVar("--sky"), borderRadius: 6, borderSkipped: false, barPercentage: 0.5, categoryPercentage: 0.6 },
              { label: "Aktual", data: [Number((d.gsph || 0).toFixed(1))],
                backgroundColor: cssVar("--teal"), borderRadius: 6, borderSkipped: false, barPercentage: 0.5, categoryPercentage: 0.6 },
            ],
          },
          options: {
            responsive: true, maintainAspectRatio: false, indexAxis: "y",
            plugins: {
              legend: { display: true, position: "top", align: "end",
                labels: { color: cssVar("--muted"), boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: "circle", font: { size: 10 }, padding: 12 } },
              tooltip: { backgroundColor: cssVar("--panel"), titleColor: cssVar("--text"), bodyColor: cssVar("--text"),
                borderColor: cssVar("--border"), borderWidth: 1, padding: 10 },
            },
            scales: {
              x: { ticks: { color: cssVar("--chart-tick"), font: { size: 10 } },
                   grid: { color: cssVar("--chart-grid"), drawTicks: false }, border: { display: false }, beginAtZero: true },
              y: { ticks: { color: cssVar("--chart-tick"), font: { size: 10 } }, grid: { display: false }, border: { display: false } },
            },
          },
        });
        return;
      }

      // Warnai batang tahun berbeda dari batang bulan (mode tahunan)
      const barColors = st.trend.map((t) =>
        section === "tahunan" && t.kindYear ? cssVar("--navy") : cssVar("--teal")
      );

      st.chart = new Chart(canvas, {
        data: {
          labels: st.trend.map((t) => t.label),
          datasets: [
            {
              type: "bar", label: "GSPH (Aktual)",
              data: st.trend.map((t) => (t.separator ? null : Number((t.gsph || 0).toFixed(1)))),
              backgroundColor: barColors, borderRadius: 4, borderSkipped: false, barPercentage: 0.7, categoryPercentage: 0.8, order: 2,
            },
            {
              type: "line", label: "GSPH (Target)",
              data: st.trend.map((t) => (t.separator ? null : Number((t.targetGsph || 0).toFixed(1)))),
              borderColor: cssVar("--red"), borderWidth: 2, pointRadius: 0, tension: 0, spanGaps: true, order: 1,
            },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: true, position: "top", align: "end",
              labels: { color: cssVar("--muted"), boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: "circle", font: { size: 10 }, padding: 12 } },
            tooltip: { backgroundColor: cssVar("--panel"), titleColor: cssVar("--text"), bodyColor: cssVar("--text"),
              borderColor: cssVar("--border"), borderWidth: 1, padding: 10 },
          },
          scales: {
            x: { ticks: { color: cssVar("--chart-tick"), font: { size: 10 } }, grid: { display: false }, border: { display: false } },
            y: { ticks: { color: cssVar("--chart-tick"), font: { size: 10 }, maxTicksLimit: 5 },
                 grid: { color: cssVar("--chart-grid"), drawTicks: false }, border: { display: false }, beginAtZero: true },
          },
        },
      });
    },
    renderPerfPie(section) {
      const st = this.perf[section];
      const canvasId = "perfPie_" + machineKey + "_" + section;
      const canvas = document.getElementById(canvasId);
      if (!canvas || typeof Chart === "undefined") return;
      if (st.pieChart) st.pieChart.destroy();
      const data = st.byCategory || [];
      if (data.length === 0) return;
      const colors = { MESIN: cssVar("--blue"), DIES: cssVar("--red"), FINGER: cssVar("--green"), OTHER: cssVar("--amber") };
      st.pieChart = new Chart(canvas, {
        type: "doughnut",
        data: {
          labels: data.map((d) => d.kategori),
          datasets: [{
            data: data.map((d) => d.menit),
            backgroundColor: data.map((d) => colors[d.kategori] || cssVar("--muted")),
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          cutout: "62%",
          plugins: { legend: { position: "right",
            labels: { color: cssVar("--muted"), boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: "circle", font: { size: 10 }, padding: 10 } },
            tooltip: { backgroundColor: cssVar("--panel"), titleColor: cssVar("--text"), bodyColor: cssVar("--text"),
              borderColor: cssVar("--border"), borderWidth: 1, padding: 10 } },
        },
      });
    },
    async fetchDowntime() {
      const { data, error } = await supabaseClient.from("downtime_log").select("*").eq("mesin", machineKey).order("waktu_awal", { ascending: false }).limit(300);
      if (error) { this.flash("Gagal memuat data downtime: " + error.message, true); return; }
      this.downtimeRows = data;
    },
    async fetchNonProduksi() {
      const { data, error } = await supabaseClient.from("dandori_log").select("*").eq("mesin", machineKey).order("waktu_awal", { ascending: false }).limit(500);
      if (error) { this.flash("Gagal memuat data non-produksi: " + error.message, true); return; }
      this.nonProduksiRows = data;
    },
    async fetchPlanning() {
      const { data, error } = await supabaseClient.from("production_planning").select("*").eq("mesin", machineKey).order("jam_rencana_mulai", { ascending: true }).limit(200);
      if (!error && data) this.planningRows = data;
    },
    async fetchNonProduksiTypes() {
      const { data, error } = await supabaseClient.from("nonproduksi_types").select("id, nama").eq("mesin", machineKey).order("nama");
      if (!error && data) this.nonProduksiTypeList = data;
    },

    // ================= RIWAYAT gabungan + FILTER =================
    stationSortKey(stasiun) {
      if (!stasiun) return 0;
      const m = String(stasiun).match(/(\d+)$/);
      return m ? parseInt(m[1], 10) : 0;
    },
    // Gabung produksi + non-produksi, urut: HARI dulu (terbaru duluan),
    // di dalam hari yang sama urut STASIUN (PA/PC kecil ke besar), lalu
    // di dalam stasiun yang sama urut WAKTU (kronologis) — persis alur
    // baca laporan Nippo per hari.
    combinedAll() {
      const prod = this.productionRows.map((r) => ({ ...r, _tipe: "produksi" }));
      const nonProd = this.nonProduksiRows.map((r) => ({ ...r, _tipe: "nonproduksi" }));
      let combined = [...prod, ...nonProd];

      if (this.stationConfig.mode === "variant" && this.tandemVariant) {
        const active = new Set(this.stationConfig.variants[this.tandemVariant]);
        combined = combined.filter((r) => active.has(r.stasiun));
      }

      combined.sort((a, b) => {
        const dayA = a.waktu_awal.slice(0, 10), dayB = b.waktu_awal.slice(0, 10);
        if (dayA !== dayB) return dayB.localeCompare(dayA); // hari terbaru duluan
        if (this.stationConfig.mode !== "none") {
          const sa = this.stationSortKey(a.stasiun), sb = this.stationSortKey(b.stasiun);
          if (sa !== sb) return sa - sb; // stasiun kecil ke besar
        }
        return new Date(a.waktu_awal) - new Date(b.waktu_awal); // kronologis dalam hari+stasiun yang sama
      });
      return combined;
    },
    riwayatGabungan() {
      let combined = this.combinedAll();
      const f = this.riwayatFilter;
      if (f.dari) combined = combined.filter((r) => r.waktu_awal >= f.dari);
      if (f.sampai) combined = combined.filter((r) => r.waktu_awal <= f.sampai + "T23:59:59");
      if (f.part_number) {
        const q = f.part_number.toLowerCase();
        combined = combined.filter((r) => (r._tipe === "produksi" ? r.part_number : r.part_ke || r.part_dari || "").toLowerCase().includes(q));
      }
      return combined;
    },
    // Cuma buat tab Input Produksi — riwayat hari ini saja, tanpa filter.
    riwayatHariIni() {
      const today = localDateStr(new Date());
      return this.combinedAll().filter((r) => localDateStr(new Date(r.waktu_awal)) === today);
    },
    resetRiwayatFilter() { this.riwayatFilter = { dari: "", sampai: "", part_number: "" }; },

    detailRiwayat(row) {
      if (row._tipe === "produksi") return row.part_number || "-";
      return row.part_ke || row.part_dari || "-";
    },
    fmt(iso) {

      if (!iso) return "-";
      return new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    },
    fmtClock,
    fmtNum,
    // Kesimpulan singkat di bawah donut downtime (biar tidak kosong melompong)
    downtimeKesimpulan(section) {
      const list = (this.perf[section] && this.perf[section].byCategory) || [];
      if (list.length === 0) return "";
      const total = list.reduce((a, b) => a + (b.menit || 0), 0);
      if (total === 0) return "";
      const top = list.reduce((a, b) => (b.menit > a.menit ? b : a), list[0]);
      const pct = ((top.menit / total) * 100).toFixed(0);
      const kategoriLain = list.length - 1;
      let s = `Total ${fmtNum(total)} menit. Penyumbang terbesar: ${top.kategori} ${fmtNum(top.menit)} mnt (${pct}%)`;
      if (kategoriLain > 0) s += `, dari ${list.length} kategori.`;
      else s += ".";
      return s;
    },
    fmtJam(iso) {
      if (!iso) return "-";
      const d = new Date(iso);
      return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    },
    // ---- Earned / Operation / Availability per baris (gaya "Daily Status") ----
    stdCtFor(partNumber) {
      const p = this.partNumberList.find((x) => x.value === partNumber);
      return p && p.std_ct ? Number(p.std_ct) : null;
    },
    stdMpFor(partNumber) {
      const p = this.partNumberList.find((x) => x.value === partNumber);
      return p && p.std_mp ? Number(p.std_mp) : null;
    },
    // Disamakan dengan rumus Earned di tab Input Produksi (baru): Qty x Std CT x Std MP / 60
    earnedMenit(row) {
      if (row._tipe !== "produksi" || !row.qty) return null;
      const ct = this.stdCtFor(row.part_number);
      const mp = this.stdMpFor(row.part_number);
      if (!ct || !mp) return null;
      return (row.qty * ct * mp) / 60;
    },
    // Disamakan dengan rumus Operation Min di tab Input Produksi (baru) untuk
    // baris produksi: ((Waktu Akhir - Waktu Awal) - Break) x Std MP.
    // Baris non-produksi tetap durasi mentah (konsep Break/MP tidak berlaku di situ).
    operationMenit(row) {
      const ms = new Date(row.waktu_akhir) - new Date(row.waktu_awal);
      if (Number.isNaN(ms) || ms < 0) return null;
      const diffMenit = ms / 60000;
      if (row._tipe !== "produksi") return diffMenit;
      const mp = this.stdMpFor(row.part_number);
      if (!mp) return null;
      const breakMenit = Number(row.break_menit) || 0;
      return (diffMenit - breakMenit) * mp;
    },
    rowAvailability(row) {
      const earned = this.earnedMenit(row);
      const operation = this.operationMenit(row);
      if (!earned || !operation || operation === 0) return null;
      return (earned / operation) * 100;
    },
    durasiMenit(a, b) {
      if (!a || !b) return "-";
      const d = (new Date(b) - new Date(a)) / 60000;
      return d >= 0 ? d.toFixed(1) + " mnt" : "-";
    },

    // ================= EDIT / HAPUS (riwayat, koreksi manual) =================
    editRiwayat(row) {
      if (row._tipe === "produksi") this.editProduction(row); else this.editNonProduksiRow(row);
    },
    deleteRiwayat(row) {
      if (row._tipe === "produksi") this.deleteProduction(row.id); else this.deleteNonProduksiRow(row.id);
    },
    editProduction(row) {
      const stationId = row.stasiun || "_single";
      if (this.stationConfig.mode === "variant" && row.stasiun) {
        if (this.stationConfig.variants.lama.includes(row.stasiun)) this.setTandemVariant("lama");
        else if (this.stationConfig.variants.baru.includes(row.stasiun)) this.setTandemVariant("baru");
      }
      if (!this.lines[stationId]) this.lines[stationId] = this.freshLine();
      const line = this.lines[stationId];
      line.editingId = row.id;
      line.state = "edit";
      line.entryStart = row.waktu_awal; line.entryEnd = row.waktu_akhir;
      line.editForm = {
        waktu_awal: toLocalInput(row.waktu_awal), waktu_akhir: toLocalInput(row.waktu_akhir),
        part_number: row.part_number || "", qty: row.qty ?? "", manpower: row.manpower ?? "",
        ng: row.ng ?? "", repair: row.repair ?? "",
        dandori_menit: row.dandori_menit ?? "", break_menit: row.break_menit ?? "",
      };
      this.extraFields.forEach((f) => (line.editForm[f.key] = row.extra?.[f.key] ?? ""));
      line.routingType = row.extra?.routing_type || null;
      line.routingNumbers = row.extra?.routing_numbers || [];
      if (!row.break_menit) this.recalcEditBreak(stationId);
      this.tab = "produksi";
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    async saveEditProduction(stationId) {
      const line = this.lines[stationId];
      const f = line.editForm;
      const extra = {};
      this.extraFields.forEach((field) => { extra[field.key] = f[field.key] === "" ? null : f[field.key]; });
      if (this.routingMax > 0) { extra.routing_type = line.routingType; extra.routing_numbers = line.routingNumbers; }
      const payload = {
        waktu_awal: new Date(f.waktu_awal).toISOString(), waktu_akhir: new Date(f.waktu_akhir).toISOString(),
        part_number: f.part_number || null, qty: f.qty === "" ? null : Number(f.qty),
        manpower: f.manpower === "" ? null : Number(f.manpower),
        ng: f.ng === "" ? null : Number(f.ng),
        repair: f.repair === "" ? null : Number(f.repair),
        dandori_menit: f.dandori_menit === "" ? null : Number(f.dandori_menit),
        break_menit: f.break_menit === "" ? null : Number(f.break_menit),
        extra: extra,
      };
      const { error } = await supabaseClient.from("production_log").update(payload).eq("id", line.editingId);
      if (error) { this.flash("Gagal simpan (butuh koneksi): " + error.message, true); return; }
      this.flash("Data produksi diperbarui.");
      this.lines[stationId] = this.freshLine();
      await this.fetchProduction();
      this.refreshLoadedPerf();
    },
    async deleteProduction(id) {
      if (String(id).startsWith("pending_")) { this.flash("Masih menunggu sinkron.", true); return; }
      if (!confirm("Hapus baris produksi ini?")) return;
      const { error } = await supabaseClient.from("production_log").delete().eq("id", id);
      if (error) { this.flash("Gagal menghapus: " + error.message, true); return; }
      this.flash("Data produksi dihapus.");
      await this.fetchProduction();
      this.refreshLoadedPerf();
    },
    editNonProduksiRow(row) {
      this.editingNonProduksiId = row.id;
      this.nonProduksiEditForm = {
        waktu_awal: toLocalInput(row.waktu_awal), waktu_akhir: toLocalInput(row.waktu_akhir),
        nama: row.part_ke || row.keterangan || "",
      };
    },
    cancelEditNonProduksi() { this.editingNonProduksiId = null; this.nonProduksiEditForm = {}; },
    async saveNonProduksiEdit() {
      const f = this.nonProduksiEditForm;
      const payload = {
        waktu_awal: new Date(f.waktu_awal).toISOString(), waktu_akhir: new Date(f.waktu_akhir).toISOString(),
        part_ke: f.nama, keterangan: f.nama,
      };
      const { error } = await supabaseClient.from("dandori_log").update(payload).eq("id", this.editingNonProduksiId);
      if (error) { this.flash("Gagal simpan: " + error.message, true); return; }
      this.flash("Data non-produksi diperbarui.");
      this.cancelEditNonProduksi();
      await this.fetchNonProduksi();
    },
    async deleteNonProduksiRow(id) {
      if (String(id).startsWith("pending_")) { this.flash("Masih menunggu sinkron.", true); return; }
      if (!confirm("Hapus catatan non-produksi ini?")) return;
      const { error } = await supabaseClient.from("dandori_log").delete().eq("id", id);
      if (error) { this.flash("Gagal menghapus: " + error.message, true); return; }
      this.flash("Data non-produksi dihapus.");
      await this.fetchNonProduksi();
    },

    // ================= DOWNTIME (Start/Stop + validasi tabrakan part) =================
    dtState: "idle", dtStart: null, dtEnd: null,
    startDowntime() { this.dtState = "running"; this.dtStart = new Date().toISOString(); },
    cancelDowntime() { this.dtState = "idle"; this.dtStart = null; this.editingDowntimeId = null; this.dtForm = {}; },
    stopDowntime() {
      this.dtState = "stopped"; this.dtEnd = new Date().toISOString();
      this.dtForm = {
        kategori: "", problem: "", penyebab: "", countermeasure: "", stasiun: "",
        pic: "", waktu_tunggu: "", ket: "", area: "", status: "",
      };
    },
    async submitDowntime() {
      const f = this.dtForm;
      const required = [
        ["kategori", "Kategori"], ["pic", "PIC"], ["problem", "Problem Kategori"],
        ["penyebab", "Problem Detail"], ["area", "Area"],
        ["countermeasure", "Countermeasure"], ["status", "Status"],
      ];
      const missing = required.filter(([key]) => !f[key] || String(f[key]).trim() === "");
      if (missing.length > 0) {
        this.flash("Wajib diisi: " + missing.map(([, label]) => label).join(", "), true);
        return;
      }
      // Pencocokan & link ke Input Produksi (baru atau lama) sepenuhnya
      // ditangani trigger database (link_and_validate_downtime) -- biar
      // satu sumber kebenaran, JS tidak perlu ngecek dobel.
      const payload = {
        mesin: machineKey, waktu_awal: this.dtStart, waktu_akhir: this.dtEnd,
        stasiun: f.stasiun || null, kategori: f.kategori || null, problem: f.problem || null,
        penyebab: f.penyebab || null, countermeasure: f.countermeasure || null,
        pic: f.pic || null, waktu_tunggu: f.waktu_tunggu === "" ? null : Number(f.waktu_tunggu),
        ket: f.ket || null, area: f.area || null, status: f.status || null,
      };
      if (f.problem) {
        const selProblem = this.problemList.find((p) => p.value === f.problem);
        this.learnProblem(f.problem, f.pic);
        if (f.penyebab) this.learnCause(f.penyebab, selProblem ? selProblem.id : null);
      } else if (f.penyebab) {
        this.learnCause(f.penyebab, null);
      }
      if (f.area) this.learnArea(f.area);
      if (this.editingDowntimeId) {
        const { error } = await supabaseClient.from("downtime_log").update(payload).eq("id", this.editingDowntimeId);
        if (error) { this.flash("Gagal simpan: " + error.message, true); return; }
        this.flash("Data downtime diperbarui, ter-link ke produksi otomatis. Cek lagi Qty di Input Produksi terkait, siapa tahu perlu disesuaikan.");
      } else {
        payload.created_by = this.session.user.id;
        const { error } = await supabaseClient.from("downtime_log").insert(payload);
        if (error) {
          this.flash("Gagal menyimpan downtime: " + error.message, true);
          return;
        }
        this.flash("Data downtime tersimpan, ter-link ke produksi otomatis. Cek lagi Qty di Input Produksi terkait, siapa tahu perlu disesuaikan.");
      }
      this.cancelDowntime();
      await Promise.all([this.fetchDowntime(), this.fetchProduction(), this.fetchProduksiNew()]);
      this.refreshLoadedPerf();
    },
    editDowntime(row) {
      this.editingDowntimeId = row.id;
      this.dtState = "stopped";
      this.dtStart = row.waktu_awal; this.dtEnd = row.waktu_akhir;
      this.dtForm = {
        kategori: row.kategori || "", problem: row.problem || "", penyebab: row.penyebab || "",
        countermeasure: row.countermeasure || "", stasiun: row.stasiun || "",
        pic: row.pic || "", waktu_tunggu: row.waktu_tunggu ?? "", ket: row.ket || "",
        area: row.area || "", status: row.status || "",
      };
      this.tab = "downtime";
    },
    // Ubah cuma jam (HH:MM) dari input type=time, tanggalnya tetap ikut
    // dtStart/dtEnd yang sudah ada (dari data aslinya) -- dipakai pas Edit.
    updateDtTime(which, value) {
      if (!value) return;
      const base = which === "start" ? this.dtStart : this.dtEnd;
      const d = base ? new Date(base) : new Date();
      const [hh, mm] = value.split(":").map(Number);
      d.setHours(hh, mm, 0, 0);
      if (which === "start") this.dtStart = d.toISOString();
      else this.dtEnd = d.toISOString();
    },
    async deleteDowntime(id) {
      if (!confirm("Hapus data downtime ini?")) return;
      const { error } = await supabaseClient.from("downtime_log").delete().eq("id", id);
      if (error) { this.flash("Gagal menghapus: " + error.message, true); return; }
      this.flash("Data downtime dihapus.");
      await Promise.all([this.fetchDowntime(), this.fetchProduction()]);
      this.refreshLoadedPerf();
    },

    // ================= PLANNING PRODUKSI =================
    newPlanning: { part_number: "", qty_rencana: "", jam_mulai: "", jam_selesai: "", stasiun: "" },
    async addPlanning() {
      const f = this.newPlanning;
      if (!f.part_number || !f.jam_mulai || !f.jam_selesai) { this.flash("Part Number, jam mulai & selesai wajib diisi.", true); return; }
      const payload = {
        mesin: machineKey, stasiun: f.stasiun || null, part_number: f.part_number,
        qty_rencana: f.qty_rencana === "" ? null : Number(f.qty_rencana),
        jam_rencana_mulai: new Date(f.jam_mulai).toISOString(), jam_rencana_selesai: new Date(f.jam_selesai).toISOString(),
        created_by: this.session.user.id,
      };
      const { error } = await supabaseClient.from("production_planning").insert(payload);
      if (error) { this.flash("Gagal tambah planning: " + error.message, true); return; }
      this.flash("Planning ditambahkan.");
      this.newPlanning = { part_number: "", qty_rencana: "", jam_mulai: "", jam_selesai: "", stasiun: "" };
      await this.fetchPlanning();
    },
    async deletePlanning(id) {
      if (!confirm("Hapus rencana ini?")) return;
      const { error } = await supabaseClient.from("production_planning").delete().eq("id", id);
      if (error) { this.flash("Gagal hapus: " + error.message, true); return; }
      await this.fetchPlanning();
    },
    planningForStation(stationId) {
      const want = this.dbStasiun(stationId);
      return this.planningRows.filter((r) => (r.stasiun || null) === want);
    },

    // ================= MASTER DATA =================
    async fetchPartNumbers() {
      const { data, error } = await supabaseClient.from("part_numbers").select("id, value, next_processes, std_mp, std_ct, harga_pcs, alias_values, target_peff").eq("mesin", machineKey).order("value");
      if (error) { this.flash("Gagal memuat Part Number: " + error.message, true); return; }
      this.partNumberList = data.map((r) => ({
        ...r, editing: false, draft: r.value,
        draftStdMp: r.std_mp ?? "", draftStdCt: r.std_ct ?? "", draftHargaPcs: r.harga_pcs ?? "",
        draftTargetPeff: r.target_peff ?? "",
        draftAliasText: (r.alias_values || []).join(", "),
        draftNextProcesses: (r.next_processes || []).map((p) => ({ ...p, _key: Math.random().toString(36).slice(2) })),
      }));
    },
    async fetchProblems() {
      // Shared untuk semua line (E-02..E-07) -- TIDAK difilter per mesin lagi.
      const { data, error } = await supabaseClient.from("downtime_problems").select("id, pic, value").order("pic").order("value");
      if (error) { this.flash("Gagal memuat Problem: " + error.message, true); return; }
      this.problemList = data.map((r) => ({ ...r, editing: false, draft: r.value }));
    },
    async fetchCauses() {
      // Shared untuk semua line -- TIDAK difilter per mesin lagi.
      const { data, error } = await supabaseClient.from("downtime_causes").select("id, problem_id, value").order("value");
      if (error) { this.flash("Gagal memuat Problem Detail: " + error.message, true); return; }
      this.causeList = data.map((r) => ({ ...r, editing: false, draft: r.value }));
    },
    async fetchAreas() {
      // Shared untuk semua line -- TIDAK difilter per mesin lagi.
      const { data, error } = await supabaseClient.from("downtime_areas").select("id, value").order("value");
      if (error) { this.flash("Gagal memuat Area: " + error.message, true); return; }
      this.areaList = data.map((r) => ({ ...r, editing: false, draft: r.value }));
    },
    // ---- Cascading PIC -> Problem Kategori -> Problem Detail ----
    problemsForPic(pic) {
      if (!pic) return this.problemList;
      return this.problemList.filter((p) => p.pic === pic);
    },
    causesForProblemValue(problemValue) {
      const sel = this.problemList.find((p) => p.value === problemValue);
      if (!sel) return [];
      return this.causeList.filter((c) => c.problem_id === sel.id);
    },
    problemPicLabel(item) { return item.pic ? "[" + item.pic + "] " : ""; },
    causeKategoriLabel(item) {
      const p = this.problemList.find((x) => x.id === item.problem_id);
      return p ? "[" + p.value + "] " : "[belum ada kategori] ";
    },
    async learnPartNumber(value) {
      if (!value || this.partNumberList.some((r) => r.value.toLowerCase() === value.toLowerCase())) return;
      const { data, error } = await supabaseClient.from("part_numbers").insert({ mesin: machineKey, value }).select().single();
      if (!error && data) this.partNumberList.push({ ...data, editing: false, draft: data.value, draftStdMp: "", draftStdCt: "", draftNextProcesses: [] });
    },
    async learnProblem(value, pic) {
      if (!value || this.problemList.some((r) => r.value.toLowerCase() === value.toLowerCase())) return;
      const { data, error } = await supabaseClient.from("downtime_problems").insert({ pic: pic || null, value }).select().single();
      if (!error && data) this.problemList.push({ ...data, editing: false, draft: data.value });
    },
    async learnCause(value, problemId) {
      if (!value || this.causeList.some((r) => r.value.toLowerCase() === value.toLowerCase())) return;
      const { data, error } = await supabaseClient.from("downtime_causes").insert({ problem_id: problemId || null, value }).select().single();
      if (!error && data) this.causeList.push({ ...data, editing: false, draft: data.value });
    },
    async learnArea(value) {
      if (!value || this.areaList.some((r) => r.value.toLowerCase() === value.toLowerCase())) return;
      const { data, error } = await supabaseClient.from("downtime_areas").insert({ value }).select().single();
      if (!error && data) this.areaList.push({ ...data, editing: false, draft: data.value });
    },
    async addMasterPartNumber() {
      const v = (this.newPartNumberValue || "").trim(); if (!v) return;
      const { data, error } = await supabaseClient.from("part_numbers").insert({ mesin: machineKey, value: v }).select().single();
      if (error) { this.flash("Gagal tambah: " + error.message, true); return; }
      this.partNumberList.push({ ...data, editing: false, draft: data.value, draftStdMp: "", draftStdCt: "", draftNextProcesses: [] });
      this.partNumberList.sort((a, b) => a.value.localeCompare(b.value));
      this.newPartNumberValue = ""; this.flash("Part number ditambahkan.");
    },
    startEditPartNumber(item) {
      item.draft = item.value;
      item.draftStdMp = item.std_mp ?? "";
      item.draftStdCt = item.std_ct ?? "";
      item.draftHargaPcs = item.harga_pcs ?? "";
      item.draftTargetPeff = item.target_peff ?? "";
      item.draftAliasText = (item.alias_values || []).join(", ");
      item.draftNextProcesses = (item.next_processes || []).map((p) => ({ ...p, _key: Math.random().toString(36).slice(2) }));
      item.draftNextProcesses.forEach((p) => { if (p.line) this.ensurePartNumbersForLine(p.line); });
      item.editing = true;
    },
    cancelEditPartNumber(item) { item.draft = item.value; item.editing = false; },
    addNextProcessRow(item) { item.draftNextProcesses.push({ line: "", part_number: "", _key: Math.random().toString(36).slice(2) }); },
    removeNextProcessRow(item, key) { item.draftNextProcesses = item.draftNextProcesses.filter((p) => p._key !== key); },
    spmFromCt(ct) {
      const n = Number(ct);
      if (!n || n <= 0) return "-";
      return (1 / n).toFixed(2);
    },
    async saveMasterPartNumber(item) {
      const v = (item.draft || "").trim(); if (!v) { this.flash("Tidak boleh kosong.", true); return; }
      const clean = item.draftNextProcesses.filter((p) => p.line && p.part_number).map((p) => ({ line: p.line, part_number: p.part_number }));
      const aliasClean = (item.draftAliasText || "").split(",").map((s) => s.trim()).filter((s) => s && s.toLowerCase() !== v.toLowerCase());
      const payload = {
        value: v, next_processes: clean,
        std_mp: item.draftStdMp === "" ? null : Number(item.draftStdMp),
        std_ct: item.draftStdCt === "" ? null : Number(item.draftStdCt),
        harga_pcs: item.draftHargaPcs === "" ? null : Number(item.draftHargaPcs),
        target_peff: item.draftTargetPeff === "" ? null : Number(item.draftTargetPeff),
        alias_values: aliasClean,
      };
      const { data, error } = await supabaseClient.from("part_numbers").update(payload).eq("id", item.id).select();
      if (error) { this.flash("Gagal simpan: " + error.message, true); return; }
      if (!data || data.length === 0) { this.flash("Gagal simpan — cek izin akses.", true); return; }
      item.value = v; item.next_processes = clean;
      item.std_mp = payload.std_mp; item.std_ct = payload.std_ct; item.harga_pcs = payload.harga_pcs;
      item.target_peff = payload.target_peff;
      item.alias_values = aliasClean;
      item.editing = false;
      this.flash("Part number diperbarui.");
    },
    async deleteMasterPartNumber(id) {
      if (!confirm("Hapus part number ini?")) return;
      const { error } = await supabaseClient.from("part_numbers").delete().eq("id", id);
      if (error) { this.flash("Gagal hapus: " + error.message, true); return; }
      this.partNumberList = this.partNumberList.filter((r) => r.id !== id);
    },
    async ensurePartNumbersForLine(lineKey) {
      if (!lineKey || this.partNumbersByLine[lineKey]) return;
      const { data, error } = await supabaseClient.from("part_numbers").select("value").eq("mesin", lineKey).order("value");
      if (!error && data) this.partNumbersByLine[lineKey] = data.map((r) => r.value);
    },
    machineLabel(key) { return this.machineOptions.find((m) => m.key === key)?.label || key; },

    async addMasterProblem() {
      const v = (this.newProblemValue || "").trim(); if (!v) return;
      if (!this.newProblemPic) { this.flash("Pilih PIC dulu untuk kategori baru ini.", true); return; }
      const { data, error } = await supabaseClient.from("downtime_problems").insert({ pic: this.newProblemPic, value: v }).select().single();
      if (error) { this.flash("Gagal tambah: " + error.message, true); return; }
      this.problemList.push({ ...data, editing: false, draft: data.value });
      this.problemList.sort((a, b) => (a.pic || "").localeCompare(b.pic || "") || a.value.localeCompare(b.value));
      this.newProblemValue = ""; this.flash("Problem ditambahkan.");
    },
    startEditProblem(item) { item.draft = item.value; item.editing = true; },
    cancelEditProblem(item) { item.draft = item.value; item.editing = false; },
    async saveMasterProblem(item) {
      const v = (item.draft || "").trim(); if (!v) { this.flash("Tidak boleh kosong.", true); return; }
      const { data, error } = await supabaseClient.from("downtime_problems").update({ value: v }).eq("id", item.id).select();
      if (error) { this.flash("Gagal simpan: " + error.message, true); return; }
      if (!data || data.length === 0) { this.flash("Gagal simpan — cek izin akses.", true); return; }
      item.value = v; item.editing = false;
    },
    async deleteMasterProblem(id) {
      if (!confirm("Hapus problem ini?")) return;
      const { error } = await supabaseClient.from("downtime_problems").delete().eq("id", id);
      if (error) { this.flash("Gagal hapus: " + error.message, true); return; }
      this.problemList = this.problemList.filter((r) => r.id !== id);
    },

    async addMasterCause() {
      const v = (this.newCauseValue || "").trim(); if (!v) return;
      if (!this.newCauseProblemId) { this.flash("Pilih Problem Kategori dulu untuk detail baru ini.", true); return; }
      const { data, error } = await supabaseClient.from("downtime_causes").insert({ problem_id: this.newCauseProblemId, value: v }).select().single();
      if (error) { this.flash("Gagal tambah: " + error.message, true); return; }
      this.causeList.push({ ...data, editing: false, draft: data.value });
      this.causeList.sort((a, b) => a.value.localeCompare(b.value));
      this.newCauseValue = ""; this.flash("Problem Detail ditambahkan.");
    },
    startEditCause(item) { item.draft = item.value; item.editing = true; },
    cancelEditCause(item) { item.draft = item.value; item.editing = false; },
    async saveMasterCause(item) {
      const v = (item.draft || "").trim(); if (!v) { this.flash("Tidak boleh kosong.", true); return; }
      const { data, error } = await supabaseClient.from("downtime_causes").update({ value: v }).eq("id", item.id).select();
      if (error) { this.flash("Gagal simpan: " + error.message, true); return; }
      if (!data || data.length === 0) { this.flash("Gagal simpan — cek izin akses.", true); return; }
      item.value = v; item.editing = false;
    },
    async deleteMasterCause(id) {
      if (!confirm("Hapus problem detail ini?")) return;
      const { error } = await supabaseClient.from("downtime_causes").delete().eq("id", id);
      if (error) { this.flash("Gagal hapus: " + error.message, true); return; }
      this.causeList = this.causeList.filter((r) => r.id !== id);
    },

    async addMasterArea() {
      const v = (this.newAreaValue || "").trim(); if (!v) return;
      const { data, error } = await supabaseClient.from("downtime_areas").insert({ value: v }).select().single();
      if (error) { this.flash("Gagal tambah: " + error.message, true); return; }
      this.areaList.push({ ...data, editing: false, draft: data.value });
      this.areaList.sort((a, b) => a.value.localeCompare(b.value));
      this.newAreaValue = ""; this.flash("Area ditambahkan.");
    },
    startEditArea(item) { item.draft = item.value; item.editing = true; },
    cancelEditArea(item) { item.draft = item.value; item.editing = false; },
    async saveMasterArea(item) {
      const v = (item.draft || "").trim(); if (!v) { this.flash("Tidak boleh kosong.", true); return; }
      const { data, error } = await supabaseClient.from("downtime_areas").update({ value: v }).eq("id", item.id).select();
      if (error) { this.flash("Gagal simpan: " + error.message, true); return; }
      if (!data || data.length === 0) { this.flash("Gagal simpan — cek izin akses.", true); return; }
      item.value = v; item.editing = false;
    },
    async deleteMasterArea(id) {
      if (!confirm("Hapus area ini?")) return;
      const { error } = await supabaseClient.from("downtime_areas").delete().eq("id", id);
      if (error) { this.flash("Gagal hapus: " + error.message, true); return; }
      this.areaList = this.areaList.filter((r) => r.id !== id);
    },

    async addMasterNonProduksiType() {
      const v = (this.newNonProduksiTypeValue || "").trim(); if (!v) return;
      const { data, error } = await supabaseClient.from("nonproduksi_types").insert({ mesin: machineKey, nama: v }).select().single();
      if (error) { this.flash("Gagal tambah: " + error.message, true); return; }
      this.nonProduksiTypeList.push(data);
      this.nonProduksiTypeList.sort((a, b) => a.nama.localeCompare(b.nama));
      this.newNonProduksiTypeValue = ""; this.flash("Jenis non-produksi ditambahkan.");
    },
    async deleteMasterNonProduksiType(id) {
      if (!confirm("Hapus jenis ini?")) return;
      const { error } = await supabaseClient.from("nonproduksi_types").delete().eq("id", id);
      if (error) { this.flash("Gagal hapus: " + error.message, true); return; }
      this.nonProduksiTypeList = this.nonProduksiTypeList.filter((r) => r.id !== id);
    },

    // ================= persist state (localStorage) supaya tahan pindah halaman =================
    restoreLocalState() {
      try {
        const raw = localStorage.getItem("linestate_v3_" + machineKey);
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (saved.tandemVariant) { this.tandemVariant = saved.tandemVariant; this.ensureLines(); }
        Object.entries(saved.lines || {}).forEach(([id, l]) => {
          if (!l || l.state === "idle") return;
          if (!this.lines[id]) this.lines[id] = this.freshLine();
          Object.assign(this.lines[id], l);
        });
      } catch {}
    },
    watchAndAutosave() {
      const persist = () => {
        const state = { tandemVariant: this.tandemVariant, lines: {} };
        Object.entries(this.lines).forEach(([id, l]) => { if (l.state !== "edit") state.lines[id] = l; });
        try { localStorage.setItem("linestate_v3_" + machineKey, JSON.stringify(state)); } catch {}
      };
      this.$watch("lines", persist);
      this.$watch("tandemVariant", persist);
    },

    // ================= NG INLINE (cascading) =================
    async fetchNgModelsForLine() {
      const { data, error } = await supabaseClient.from("ng_line_models").select("id, model").eq("mesin", machineKey).order("model");
      if (error) { this.flash("Gagal memuat Model NG Inline: " + error.message, true); return; }
      this.ngModelList = data;
    },
    async fetchNgInline() {
      const { data, error } = await supabaseClient
        .from("ng_inline_log").select("*")
        .eq("mesin", machineKey).order("tanggal", { ascending: false }).order("created_at", { ascending: false });
      if (error) { this.flash("Gagal memuat NG Inline: " + error.message, true); return; }
      this.ngInlineRows = data;
    },
    // =========================================================
    // INPUT PRODUKSI BARU — form ringkas (waktu awal/akhir + qty +
    // break/dandori/problem/repair), sisanya dihitung otomatis.
    // Tabel terpisah (production_log_new) dari tab "Input Produksi OLD".
    // =========================================================
    freshProduksiNewForm() {
      return {
        waktu_awal: "", waktu_akhir: "", part_number: "", qty: "",
        break_menit: "", dandori_menit: "", waktu_problem_menit: "", total_repair_menit: "",
      };
    },
    async fetchProduksiNew() {
      const { data, error } = await supabaseClient.from("production_log_new").select("*")
        .eq("mesin", machineKey).order("waktu_awal", { ascending: false }).limit(500);
      if (error) { this.flash("Gagal memuat Input Produksi: " + error.message, true); return; }
      this.produksiNewRows = data;
    },
    // Part Number di form Input Produksi baru diambil dari sumber yang SAMA
    // dengan NG Inline (ng_line_models -> ng_model_parts), karena itu yang
    // datanya sudah terisi per line -- bukan dari tabel part_numbers (Master
    // Data lama) yang ternyata masih kosong di semua line.
    produksiNewPartOptions: [],
    async fetchProduksiPartNumberOptions() {
      const modelNames = (this.ngModelList || []).map((m) => m.model).filter(Boolean);
      if (!modelNames.length) { this.produksiNewPartOptions = []; return; }
      const { data, error } = await supabaseClient.from("ng_model_parts").select("part_no").in("model", modelNames);
      if (error) { this.flash("Gagal memuat Part Number (NG Inline): " + error.message, true); return; }
      const uniq = [...new Set((data || []).map((r) => r.part_no).filter(Boolean))].sort();
      this.produksiNewPartOptions = uniq;

      // Auto-sync ke tabel part_numbers (Master Data) supaya Std CT & Target
      // P.Eff bisa diisi admin di sana, dan dipakai buat kalkulasi Earned/P.Eff.
      const existingValues = new Set(this.partNumberList.map((p) => p.value));
      const missing = uniq.filter((v) => !existingValues.has(v));
      if (missing.length) {
        const rows = missing.map((v) => ({ mesin: machineKey, value: v }));
        const { error: syncErr } = await supabaseClient.from("part_numbers")
          .upsert(rows, { onConflict: "mesin,value", ignoreDuplicates: true });
        if (!syncErr) await this.fetchPartNumbers();
      }
    },
    stdCtForPartNew(partNumber) {
      const p = this.partNumberList.find((x) => x.value === partNumber);
      return p && p.std_ct ? Number(p.std_ct) : 0;
    },
    stdMpForPartNew(partNumber) {
      const p = this.partNumberList.find((x) => x.value === partNumber);
      return p && p.std_mp ? Number(p.std_mp) : 0;
    },
    isNonProduksiSelected(partNumberValue) {
      if (!partNumberValue) return false;
      return this.nonProduksiTypeList.some((n) => n.nama === partNumberValue);
    },

    // ---- Kalkulasi otomatis (dipakai utk form yang lagi diisi & baris tersimpan) ----
    // 1. Earned = Qty x Std CT x Std MP / 60
    produksiNewEarned(row) {
      const qty = Number(row.qty) || 0;
      const ct = this.stdCtForPartNew(row.part_number);
      const mp = this.stdMpForPartNew(row.part_number);
      if (!qty || !ct || !mp) return null;
      return (qty * ct * mp) / 60;
    },
    // 2. Operation Min = ((Waktu Akhir - Waktu Awal) - Break) x Std MP
    produksiNewOperationMin(row) {
      if (!row.waktu_awal || !row.waktu_akhir) return null;
      const ms = new Date(row.waktu_akhir) - new Date(row.waktu_awal);
      if (Number.isNaN(ms) || ms <= 0) return null;
      const mp = this.stdMpForPartNew(row.part_number);
      if (!mp) return null;
      const diffMenit = ms / 60000;
      const breakMenit = Number(row.break_menit) || 0;
      return (diffMenit - breakMenit) * mp;
    },
    // 3. Workmin = Operation Min - Waktu Problem - Dandori
    produksiNewWorkmin(row) {
      const op = this.produksiNewOperationMin(row);
      if (op === null) return null;
      const waktuProblem = Number(row.waktu_problem_menit) || 0;
      const dandori = Number(row.dandori_menit) || 0;
      return op - waktuProblem - dandori;
    },
    // 4. P.Eff = Earned / Operation Min (desimal, tanpa dikali 100)
    produksiNewPeff(row) {
      const earned = this.produksiNewEarned(row);
      const op = this.produksiNewOperationMin(row);
      if (earned === null || op === null || op === 0) return null;
      return earned / op;
    },
    // Waktu Dibutuhkan = Earned + Waktu Problem + Dandori (dipakai P.Eff Seharusnya)
    produksiNewWaktuDibutuhkan(row) {
      const earned = this.produksiNewEarned(row);
      if (earned === null) return null;
      const waktuProblem = Number(row.waktu_problem_menit) || 0;
      const dandori = Number(row.dandori_menit) || 0;
      return earned + waktuProblem + dandori;
    },
    // 5. P.Eff Seharusnya = Earned / Waktu Dibutuhkan (desimal)
    produksiNewPeffSeharusnya(row) {
      const earned = this.produksiNewEarned(row);
      const waktuDibutuhkan = this.produksiNewWaktuDibutuhkan(row);
      if (earned === null || waktuDibutuhkan === null || waktuDibutuhkan === 0) return null;
      return earned / waktuDibutuhkan;
    },
    // 6. Straightpass = 1 - (Total Repair / Qty) (tampil sebagai %)
    produksiNewStraightpass(row) {
      const qty = Number(row.qty) || 0;
      if (!qty) return null;
      const totalRepair = Number(row.total_repair_menit) || 0;
      return (1 - (totalRepair / qty)) * 100;
    },
    // 7. Cek kewajaran Qty vs waktu bersih yang ada (Workmin), khusus kalau
    //    ada Waktu Problem (downtime) yang ke-link. Ini nangkep kasus: Qty
    //    ditulis di awal / sebelum tau ada problem mesin, terus problem itu
    //    di-link belakangan dari tab Downtime -- Qty-nya sendiri TIDAK
    //    otomatis berkurang (cuma Waktu Problem yang ke-update), jadi bisa
    //    keliatan "kepenuhan" dibanding waktu kerja bersih yang tersisa.
    //    Tidak memblokir simpan -- cuma pengingat visual buat operator/leader
    //    supaya dicek ulang manual.
    produksiNewQtyIssue(row) {
      const waktuProblem = Number(row.waktu_problem_menit) || 0;
      if (waktuProblem <= 0) return null; // gak ada downtime ke-link -> gak perlu cek
      const earned = this.produksiNewEarned(row);
      const workmin = this.produksiNewWorkmin(row);
      if (earned === null || workmin === null) return null;
      if (workmin < 0) {
        return "Total Waktu Problem + Dandori melebihi waktu yang tersedia di sesi ini. Cek lagi Waktu Awal/Akhir atau downtime yang ke-link.";
      }
      if (earned > workmin) {
        return "Qty ini butuh waktu kerja lebih besar dari waktu bersih yang tersisa setelah dikurangi Waktu Problem & Dandori. Kemungkinan Qty belum disesuaikan dengan problem yang terjadi -- cek & update kalau perlu.";
      }
      return null;
    },

    // ---- CRUD ----
    editProduksiNew(row) {
      this.produksiNewEditingId = row.id;
      this.produksiNewForm = {
        waktu_awal: toLocalInput(row.waktu_awal), waktu_akhir: toLocalInput(row.waktu_akhir),
        part_number: row.part_number || "", qty: row.qty ?? "",
        break_menit: row.break_menit ?? "", dandori_menit: row.dandori_menit ?? "",
        waktu_problem_menit: row.waktu_problem_menit ?? 0, total_repair_menit: row.total_repair_menit ?? "",
      };
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    cancelEditProduksiNew() {
      this.produksiNewEditingId = null;
      this.produksiNewForm = this.freshProduksiNewForm();
    },
    async saveProduksiNew() {
      const f = this.produksiNewForm;
      if (!f.waktu_awal || !f.waktu_akhir) { this.flash("Waktu Awal dan Waktu Akhir wajib diisi.", true); return; }
      if (new Date(f.waktu_akhir) <= new Date(f.waktu_awal)) { this.flash("Waktu Akhir harus setelah Waktu Awal.", true); return; }
      if (!f.part_number) { this.flash("Part Number wajib dipilih.", true); return; }
      const isNonProduksi = this.isNonProduksiSelected(f.part_number);
      if (!isNonProduksi && (f.qty === "" || Number(f.qty) <= 0)) { this.flash("Qty wajib diisi.", true); return; }

      // waktu_problem_menit SENGAJA tidak dikirim di sini -- itu dipegang penuh
      // oleh trigger database, disinkron otomatis dari Downtime yang di-link
      // (lihat migration_downtime_link_produksi_new.sql). Insert baru default 0.
      const payload = {
        mesin: machineKey,
        waktu_awal: new Date(f.waktu_awal).toISOString(),
        waktu_akhir: new Date(f.waktu_akhir).toISOString(),
        part_number: f.part_number,
        qty: f.qty === "" ? null : Number(f.qty),
        break_menit: f.break_menit === "" ? 0 : Number(f.break_menit),
        dandori_menit: f.dandori_menit === "" ? 0 : Number(f.dandori_menit),
        total_repair_menit: f.total_repair_menit === "" ? 0 : Number(f.total_repair_menit),
      };

      this.produksiNewSaving = true;
      try {
        if (this.produksiNewEditingId) {
          payload.updated_by = this.session.user.id;
          const { error } = await supabaseClient.from("production_log_new").update(payload).eq("id", this.produksiNewEditingId);
          if (error) throw error;
          this.flash("Data Input Produksi diperbarui.");
        } else {
          payload.created_by = this.session.user.id;
          const { error } = await supabaseClient.from("production_log_new").insert(payload);
          if (error) throw error;
          this.flash("Data Input Produksi tersimpan.");
        }
        this.cancelEditProduksiNew();
        await this.fetchProduksiNew();
      } catch (err) {
        this.flash("Gagal menyimpan: " + (err.message || err), true);
      } finally {
        this.produksiNewSaving = false;
      }
    },
    async deleteProduksiNew(id) {
      if (!confirm("Hapus data ini?")) return;
      const { error } = await supabaseClient.from("production_log_new").delete().eq("id", id);
      if (error) { this.flash("Gagal hapus: " + error.message, true); return; }
      if (this.produksiNewEditingId === id) this.cancelEditProduksiNew();
      await this.fetchProduksiNew();
    },

    async onModelChangeNg() {
      // reset field turunan tiap kali Model diganti
      this.ngForm.part_number = ""; this.ngForm.area_id = ""; this.ngForm.area = ""; this.ngForm.ng_proses = ""; this.ngForm.harga = 0;
      this.ngPartNoList = []; this.ngAreaOptions = [];
      if (!this.ngForm.model) return;

      const [partRes, areaRes] = await Promise.all([
        supabaseClient.from("ng_model_parts").select("id, part_no").eq("model", this.ngForm.model).order("part_no"),
        supabaseClient.from("ng_model_areas").select("id, area, ng_proses, harga").eq("mesin", machineKey).eq("model", this.ngForm.model).order("area"),
      ]);
      if (partRes.error) { this.flash("Gagal memuat Part No: " + partRes.error.message, true); return; }
      if (areaRes.error) { this.flash("Gagal memuat Area: " + areaRes.error.message, true); return; }

      this.ngPartNoList = partRes.data;
      // Kalau ada Area dengan nama sama tapi NG Proses beda, tampilkan
      // label "Area (NG Proses)" biar bisa dibedakan di dropdown.
      const nameCount = {};
      areaRes.data.forEach((a) => { nameCount[a.area] = (nameCount[a.area] || 0) + 1; });
      this.ngAreaOptions = areaRes.data.map((a) => ({
        ...a,
        label: nameCount[a.area] > 1 ? `${a.area} (${a.ng_proses})` : a.area,
      }));
    },
    onAreaChangeNg() {
      const sel = this.ngAreaOptions.find((a) => a.id === this.ngForm.area_id);
      this.ngForm.area = sel ? sel.area : "";
      this.ngForm.ng_proses = sel ? sel.ng_proses : "";
      this.ngForm.harga = sel ? Number(sel.harga || 0) : 0;
    },
    // Value = Qty x Harga (harga otomatis dari Area yang dipilih).
    ngValue(f) {
      const qty = Number(f.qty) || 0;
      const harga = Number(f.harga) || 0;
      return qty * harga;
    },
    async onNgFotoSelected(evt) {
      const rawFile = evt.target.files && evt.target.files[0];
      if (!rawFile) { this.ngFotoFile = null; this.ngFotoPreviewUrl = ""; return; }
      if (this.ngFotoPreviewUrl) URL.revokeObjectURL(this.ngFotoPreviewUrl);
      this.ngFotoCompressing = true;
      try {
        this.ngFotoFile = await compressImageFile(rawFile);
      } catch (e) {
        console.error("Gagal kompres foto NG Inline, pakai file asli:", e);
        this.ngFotoFile = rawFile; // jangan sampai gagal kompres bikin tidak bisa upload sama sekali
      } finally {
        this.ngFotoCompressing = false;
      }
      this.ngFotoPreviewUrl = URL.createObjectURL(this.ngFotoFile);
    },
    resetNgForm() {
      this.ngForm = { tanggal: localDateStr(new Date()), jam: localTimeStr(new Date()), type_ng: "", pic: "", model: "", part_number: "", area_id: "", area: "", ng_proses: "", qty: "", harga: 0, ng_kategori: "", reason: "" };
      this.ngPartNoList = []; this.ngAreaOptions = [];
      this.ngPartLocked = false; this.ngPartHint = "";
      if (this.ngFotoPreviewUrl) URL.revokeObjectURL(this.ngFotoPreviewUrl);
      this.ngFotoFile = null; this.ngFotoPreviewUrl = ""; this.ngExistingFotoUrl = "";
      this.editingNgId = null;
      if (this.$refs.ngFotoInput) this.$refs.ngFotoInput.value = "";
      this.syncNgPartFromProduction();
    },
    // ================= Auto-isi Part No NG Inline dari Input Produksi =================
    // Supaya Part No NG Inline tidak pernah beda sendiri dari yang lagi
    // diproduksi jam segitu (lihat trigger link_ng_inline_to_produksi di
    // migration_ng_repair_link_produksi.sql -- ini versi frontend-nya,
    // dipanggil tiap Tanggal/Jam berubah).
    ngPartLocked: false,
    ngPartHint: "",
    async syncNgPartFromProduction() {
      const iso = tanggalJamToIso(this.ngForm.tanggal, this.ngForm.jam);
      if (!iso) { this.ngPartLocked = false; this.ngPartHint = ""; return; }

      const { data: prod, error } = await supabaseClient
        .from("production_log")
        .select("part_number")
        .eq("mesin", machineKey)
        .lte("waktu_awal", iso)
        .gte("waktu_akhir", iso)
        .order("waktu_awal", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !prod || !prod.part_number) {
        this.ngForm.model = ""; this.ngForm.part_number = "";
        this.ngPartLocked = false;
        this.ngPartHint = "Tidak ada Input Produksi pada jam ini -- data tidak bisa disimpan. Cek kembali Tanggal & Jam.";
        return;
      }

      const { data: mp } = await supabaseClient
        .from("ng_model_parts")
        .select("model, part_no")
        .eq("part_no", prod.part_number)
        .limit(1)
        .maybeSingle();

      if (!mp) {
        this.ngForm.model = ""; this.ngForm.part_number = "";
        this.ngPartLocked = false;
        this.ngPartHint = `Input Produksi jam ini pakai Part No "${prod.part_number}", tapi belum terdaftar di Master NG -- data tidak bisa disimpan. Hubungi admin untuk daftarkan Part No ini dulu.`;
        return;
      }

      if (this.ngForm.model !== mp.model) {
        this.ngForm.model = mp.model;
        await this.onModelChangeNg();
      }
      this.ngForm.part_number = mp.part_no;
      this.ngPartLocked = true;
      this.ngPartHint = `Otomatis dari Input Produksi jam ${this.ngForm.jam} (${mp.part_no}).`;
    },
    async editNgInline(row) {
      this.editingNgId = row.id;
      this.ngPartLocked = false; this.ngPartHint = "";
      this.ngForm = {
        tanggal: row.tanggal, jam: row.jam || localTimeStr(new Date()), type_ng: row.type_ng, pic: row.pic, model: row.model,
        part_number: row.part_number, area_id: "", area: row.area, ng_proses: row.ng_proses,
        qty: row.qty, harga: Number(row.value || 0) / (Number(row.qty) || 1), ng_kategori: row.ng_kategori, reason: row.reason,
      };
      if (this.ngFotoPreviewUrl) URL.revokeObjectURL(this.ngFotoPreviewUrl);
      this.ngFotoFile = null; this.ngFotoPreviewUrl = "";
      this.ngExistingFotoUrl = row.foto_url;
      if (this.$refs.ngFotoInput) this.$refs.ngFotoInput.value = "";

      // muat ulang daftar Part No & Area buat model ini, lalu cocokkan
      // area_id yang sesuai (biar dropdown Area kepilih otomatis).
      const [partRes, areaRes] = await Promise.all([
        supabaseClient.from("ng_model_parts").select("id, part_no").eq("model", row.model).order("part_no"),
        supabaseClient.from("ng_model_areas").select("id, area, ng_proses, harga").eq("mesin", machineKey).eq("model", row.model).order("area"),
      ]);
      if (partRes.error) { this.flash("Gagal memuat Part No: " + partRes.error.message, true); return; }
      if (areaRes.error) { this.flash("Gagal memuat Area: " + areaRes.error.message, true); return; }
      this.ngPartNoList = partRes.data;
      const nameCount = {};
      areaRes.data.forEach((a) => { nameCount[a.area] = (nameCount[a.area] || 0) + 1; });
      this.ngAreaOptions = areaRes.data.map((a) => ({
        ...a,
        label: nameCount[a.area] > 1 ? `${a.area} (${a.ng_proses})` : a.area,
      }));
      const matchArea = this.ngAreaOptions.find((a) => a.area === row.area && a.ng_proses === row.ng_proses);
      this.ngForm.area_id = matchArea ? matchArea.id : "";
      // Harga dari master (bukan dari hasil bagi row.value/qty) supaya akurat
      // kalau harga master sudah sempat diubah setelah data lama disimpan.
      if (matchArea) this.ngForm.harga = Number(matchArea.harga || 0);

      // scroll ke form biar kelihatan lagi ngedit apa
      this.$nextTick(() => { document.querySelector('[x-show="tab === \'ng_inline\'"]')?.scrollIntoView({ behavior: "smooth", block: "start" }); });
    },
    cancelEditNgInline() {
      this.resetNgForm();
    },
    async saveNgInline() {
      const f = this.ngForm;
      const isEditing = !!this.editingNgId;
      const hasFoto = this.ngFotoFile || (isEditing && this.ngExistingFotoUrl);
      if (!f.part_number) {
        this.flash(this.ngPartHint || "Part No belum terisi -- pastikan Tanggal & Jam berada dalam jam Input Produksi.", true); return;
      }
      if (!f.tanggal || !f.jam || !f.type_ng || !f.pic || !f.model || !f.area_id || !f.ng_proses || !f.qty || !f.ng_kategori || !(f.reason || "").trim() || !hasFoto) {
        this.flash("Semua kolom wajib diisi, termasuk foto.", true); return;
      }
      if (!navigator.onLine) {
        this.flash("NG Inline butuh koneksi internet — coba lagi saat online.", true); return;
      }
      this.ngSaving = true;
      try {
        let fotoUrl = isEditing ? this.ngExistingFotoUrl : "";
        if (this.ngFotoFile) {
          const ext = (this.ngFotoFile.name.split(".").pop() || "jpg").toLowerCase();
          const path = `${machineKey}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
          const { error: upErr } = await supabaseClient.storage.from("ng-inline-photos").upload(path, this.ngFotoFile);
          if (upErr) throw upErr;
          const { data: pub } = supabaseClient.storage.from("ng-inline-photos").getPublicUrl(path);
          fotoUrl = pub.publicUrl;
        }

        const payload = {
          mesin: machineKey, tanggal: f.tanggal, jam: f.jam, waktu_kejadian: tanggalJamToIso(f.tanggal, f.jam),
          type_ng: f.type_ng, model: f.model, pic: f.pic,
          part_number: f.part_number, area: f.area, ng_proses: f.ng_proses,
          qty: Number(f.qty), value: this.ngValue(f), ng_kategori: f.ng_kategori, reason: f.reason.trim(),
          foto_url: fotoUrl,
        };

        if (isEditing) {
          const { data, error } = await supabaseClient.from("ng_inline_log").update(payload).eq("id", this.editingNgId).select().single();
          if (error) throw error;
          const idx = this.ngInlineRows.findIndex((r) => r.id === this.editingNgId);
          if (idx !== -1) this.ngInlineRows[idx] = data;
          this.flash("NG Inline berhasil diupdate.");
        } else {
          payload.created_by = this.session.user.id;
          const { data, error } = await supabaseClient.from("ng_inline_log").insert(payload).select().single();
          if (error) throw error;
          this.ngInlineRows.unshift(data);
          this.flash("NG Inline berhasil disimpan.");
        }
        this.resetNgForm();
      } catch (err) {
        this.flash("Gagal simpan NG Inline: " + (err.message || err), true);
      } finally {
        this.ngSaving = false;
      }
      this.refreshLoadedPerf();
    },
    async deleteNgInline(id) {
      if (!confirm("Hapus data NG Inline ini?")) return;
      const { error } = await supabaseClient.from("ng_inline_log").delete().eq("id", id);
      if (error) { this.flash("Gagal hapus: " + error.message, true); return; }
      this.ngInlineRows = this.ngInlineRows.filter((r) => r.id !== id);
      if (this.editingNgId === id) this.resetNgForm();
      this.refreshLoadedPerf();
    },

    // ================= REPAIR (klik titik di gambar -> popup) =================
    async fetchRepairViews() {
      const { data, error } = await supabaseClient.from("repair_views").select("*").eq("mesin", machineKey).order("sort_order");
      if (error) { this.flash("Gagal memuat gambar Repair: " + error.message, true); return; }
      this.repairViews = data || [];
      if (this.repairViews.length > 0 && !this.repairActiveViewId) {
        this.repairActiveViewId = this.repairViews[0].id;
      }
      if (this.repairActiveViewId) await this.fetchRepairPoints(this.repairActiveViewId);
    },
    async fetchRepairPoints(viewId) {
      const { data, error } = await supabaseClient.from("repair_points").select("*").eq("view_id", viewId).order("created_at");
      if (error) { this.flash("Gagal memuat Point Repair: " + error.message, true); return; }
      this.repairPoints = data || [];
    },
    async selectRepairView(viewId) {
      this.repairActiveViewId = viewId;
      await this.fetchRepairPoints(viewId);
      await this.initRepair3DViewerIfNeeded();
    },
    activeRepairView() {
      return this.repairViews.find((v) => v.id === this.repairActiveViewId) || null;
    },
    isThreeMFView(view) {
      return !!(view && view.model_url && /\.3mf(\?|$)/i.test(view.model_url));
    },
    async fetchRepairKategori() {
      const { data, error } = await supabaseClient.from("repair_kategori").select("*").order("value");
      if (error) { this.flash("Gagal memuat Kategori Repair: " + error.message, true); return; }
      this.repairKategoriOptions = data || [];
    },
    async fetchRepairPartNoOptions() {
      // Part No di popup Repair diambil dari master NG Inline (Line -> Model -> Part No).
      const { data: models, error: modelErr } = await supabaseClient.from("ng_line_models").select("model").eq("mesin", machineKey);
      if (modelErr) { this.flash("Gagal memuat Model NG Inline: " + modelErr.message, true); return; }
      const modelNames = (models || []).map((m) => m.model);
      if (modelNames.length === 0) { this.repairPartNoByModel = {}; this.repairPartNoModelMap = {}; return; }
      const { data: parts, error: partErr } = await supabaseClient.from("ng_model_parts").select("part_no, model").in("model", modelNames);
      if (partErr) { this.flash("Gagal memuat Part No NG Inline: " + partErr.message, true); return; }
      // Dikelompokkan PER MODEL -- dipakai buat filter dropdown Part No di
      // popup Repair, biar cuma nampilin Part No punya model 3D yang lagi
      // dibuka (mis. buka part "K15C" -> Part No yang muncul cuma punya K15C).
      const byModel = {};
      (parts || []).forEach((p) => {
        if (!byModel[p.model]) byModel[p.model] = new Set();
        byModel[p.model].add(p.part_no);
      });
      Object.keys(byModel).forEach((m) => { byModel[m] = [...byModel[m]].sort((a, b) => a.localeCompare(b)); });
      this.repairPartNoByModel = byModel;
      // Lookup Part No -> Model, dipakai buat kolom "Model" di tabel Riwayat
      // Repair (otomatis, bukan isian manual). Kalau 1 part_no kepakai di
      // lebih dari 1 model, diambil yang pertama ketemu.
      const map = {};
      (parts || []).forEach((p) => { if (!map[p.part_no]) map[p.part_no] = p.model; });
      this.repairPartNoModelMap = map;
    },
    // Part No yang muncul di popup Repair -- ke-filter otomatis sesuai
    // model 3D yang lagi aktif/dibuka (label part 3D-nya harus sama
    // persis dengan nama Model di Master Data NG Inline).
    repairPartNoOptionsForActiveView() {
      const label = this.activeRepairView()?.label;
      return (label && this.repairPartNoByModel[label]) || [];
    },
    async fetchRepairLog() {
      const { data, error } = await supabaseClient.from("repair_log").select("*").eq("mesin", machineKey).order("tanggal", { ascending: false }).order("created_at", { ascending: false }).limit(200);
      if (error) { this.flash("Gagal memuat Riwayat Repair: " + error.message, true); return; }
      this.repairLogRows = data || [];
    },

    openRepairPoint(point) {
      if (this.repairEditMode) return; // di mode edit, klik ditangani handleRepair3DClick (lihat viewer 3D)
      this.editingRepairId = null;
      this.repairModalPoint = point;
      this.repairForm = { tanggal: localDateStr(new Date()), jam: localTimeStr(new Date()), part_number: "", qty: "", kategori_repair: "" };
      this.repairModalOpen = true;
    },
    editRepairLog(row) {
      const point = this.repairPoints.find((p) => p.id === row.point_id) || { id: row.point_id, label: row.point_label };
      this.editingRepairId = row.id;
      this.repairModalPoint = point;
      this.repairForm = { tanggal: row.tanggal, jam: row.jam || localTimeStr(new Date()), part_number: row.part_number || "", qty: row.qty, kategori_repair: row.kategori_repair };
      this.repairModalOpen = true;
    },
    closeRepairModal() {
      this.repairModalOpen = false; this.repairModalPoint = null; this.editingRepairId = null;
    },
    async submitRepairPoint() {
      const f = this.repairForm;
      if (!f.tanggal || !f.jam || !f.part_number || !f.qty || Number(f.qty) <= 0 || !f.kategori_repair) {
        this.flash("Tanggal, Jam, Part No, Qty, dan Kategori Repair wajib diisi.", true); return;
      }
      this.repairSaving = true;
      const payload = {
        mesin: machineKey, tanggal: f.tanggal, jam: f.jam, waktu_kejadian: tanggalJamToIso(f.tanggal, f.jam),
        view_id: this.repairActiveViewId, point_id: this.repairModalPoint?.id || null,
        point_label: this.repairModalPoint?.label || null,
        part_number: f.part_number, qty: Number(f.qty), kategori_repair: f.kategori_repair,
      };
      try {
        if (this.editingRepairId) {
          const { data, error } = await supabaseClient.from("repair_log").update(payload).eq("id", this.editingRepairId).select().single();
          if (error) throw error;
          this.repairLogRows = this.repairLogRows.map((r) => (r.id === data.id ? data : r));
          this.flash("Data Repair berhasil diupdate.");
        } else {
          payload.created_by = this.session.user.id;
          const { data, error } = await supabaseClient.from("repair_log").insert(payload).select().single();
          if (error) throw error;
          this.repairLogRows.unshift(data);
          this.flash("Data Repair tersimpan.");
        }
        this.closeRepairModal();
      } catch (err) {
        this.flash("Gagal simpan Repair: " + (err.message || err), true);
      } finally {
        this.repairSaving = false;
      }
    },
    async deleteRepairLog(id) {
      if (!confirm("Hapus data Repair ini?")) return;
      const { error } = await supabaseClient.from("repair_log").delete().eq("id", id);
      if (error) { this.flash("Gagal hapus: " + error.message, true); return; }
      this.repairLogRows = this.repairLogRows.filter((r) => r.id !== id);
    },

    // ---- Master Data: Kategori Repair ----
    async addMasterRepairKategori() {
      const v = (this.newRepairKategoriValue || "").trim(); if (!v) return;
      const { data, error } = await supabaseClient.from("repair_kategori").insert({ value: v }).select().single();
      if (error) { this.flash("Gagal tambah: " + error.message, true); return; }
      this.repairKategoriOptions.push(data);
      this.repairKategoriOptions.sort((a, b) => a.value.localeCompare(b.value));
      this.newRepairKategoriValue = ""; this.flash("Kategori Repair ditambahkan.");
    },
    async deleteMasterRepairKategori(id) {
      if (!confirm("Hapus kategori repair ini?")) return;
      const { error } = await supabaseClient.from("repair_kategori").delete().eq("id", id);
      if (error) { this.flash("Gagal hapus: " + error.message, true); return; }
      this.repairKategoriOptions = this.repairKategoriOptions.filter((r) => r.id !== id);
    },

    // ---- Master Data: Point & Model 3D (admin) ----
    toggleRepairEditMode() {
      this.repairEditMode = !this.repairEditMode;
      // Keluar dari Mode Edit -> batalkan pilihan Point & sub-mode Geser/
      // Edit Titik yang mungkin masih aktif, biar gak "nyangkut".
      if (!this.repairEditMode) { this.repairSelectedPointId = null; this.repairPointActionMode = null; }
      // Garis las tampil beda tergantung mode -- selalu keliatan pas lagi
      // Mode Edit (biar admin bisa lihat & kelola semua Point), tapi
      // sengaja DIBUAT INVISIBLE di Mode Lihat biasa sampai di-hover
      // (lihat buildWeldLineMarker) -- jadi perlu gambar ulang tiap kali
      // mode-nya ganti.
      this.rebuildRepairMarkers();
    },
    async deleteRepairPoint(id) {
      if (!confirm("Hapus Point ini?")) return;
      const { error } = await supabaseClient.from("repair_points").delete().eq("id", id);
      if (error) { this.flash("Gagal hapus Point: " + error.message, true); return; }
      this.repairPoints = this.repairPoints.filter((p) => p.id !== id);
      if (this.repairSelectedPointId === id) { this.repairSelectedPointId = null; this.repairPointActionMode = null; }
      this.rebuildRepairMarkers();
    },
    onRepairNewViewFileChange(ev) {
      this.repairNewViewFile = ev.target.files[0] || null;
    },
    async addRepairView() {
      const label = (this.repairNewViewLabel || "").trim();
      if (!label || !this.repairNewViewFile) { this.flash("Nama Part dan file model wajib diisi.", true); return; }
      const ext = (this.repairNewViewFile.name.split(".").pop() || "").toLowerCase();
      if (ext !== "stl" && ext !== "3mf") { this.flash("File model harus format .stl atau .3mf", true); return; }
      this.repairViewUploading = true;
      try {
        const file = this.repairNewViewFile;
        const path = `models/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: upErr } = await supabaseClient.storage.from("repair-models").upload(path, file);
        if (upErr) throw upErr;
        const { data: pub } = supabaseClient.storage.from("repair-models").getPublicUrl(path);
        const nextOrder = this.repairViews.length > 0 ? Math.max(...this.repairViews.map((v) => v.sort_order || 0)) + 1 : 1;
        const { data, error } = await supabaseClient.from("repair_views")
          .insert({ label, model_url: pub.publicUrl, kind: "3d", sort_order: nextOrder, mesin: machineKey, color: this.repairNewViewColor || "#9aa4ad" }).select().single();
        if (error) throw error;
        this.repairViews.push(data);
        this.repairActiveViewId = data.id;
        this.repairPoints = [];
        this.repairNewViewLabel = ""; this.repairNewViewFile = null; this.repairNewViewColor = "#9aa4ad";
        this.flash("Model 3D part baru ditambahkan.");
        await this.initRepair3DViewerIfNeeded();
      } catch (err) {
        this.flash("Gagal upload model 3D: " + (err.message || err), true);
      } finally {
        this.repairViewUploading = false;
      }
    },
    async updateRepairViewColor(view, color) {
      const { error } = await supabaseClient.from("repair_views").update({ color }).eq("id", view.id);
      if (error) { this.flash("Gagal ganti warna: " + error.message, true); return; }
      view.color = color;
      // .3mf sudah bawa warna asli dari file-nya sendiri (per-bagian bisa
      // beda-beda) -- picker warna manual cuma berlaku buat .stl (yang
      // memang gak punya info warna sama sekali), jadi di-skip kalau
      // mesh-nya ternyata Group hasil load .3mf.
      if (repairThreeState && repairThreeState.currentViewId === view.id && repairThreeState.mesh && repairThreeState.mesh.material) {
        repairThreeState.mesh.material.vertexColors = false;
        repairThreeState.mesh.material.color.set(color);
        repairThreeState.mesh.material.needsUpdate = true;
      }
    },
    async deleteRepairView(id) {
      if (!confirm("Hapus model 3D ini beserta semua point-nya?")) return;
      const { error } = await supabaseClient.from("repair_views").delete().eq("id", id);
      if (error) { this.flash("Gagal hapus: " + error.message, true); return; }
      const cached = repairGeometryCache.get(id);
      if (cached) {
        cached.object.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => m.dispose());
        });
        repairGeometryCache.delete(id);
      }
      this.repairViews = this.repairViews.filter((v) => v.id !== id);
      if (this.repairActiveViewId === id) {
        this.repairActiveViewId = this.repairViews[0]?.id || null;
        this.repairPoints = [];
        this.teardownRepair3D();
        if (this.repairActiveViewId) {
          await this.fetchRepairPoints(this.repairActiveViewId);
          await this.initRepair3DViewerIfNeeded();
        }
      }
    },

    // ================= REPAIR 3D VIEWER (Three.js) =================
    // Library Three.js dimuat lewat dynamic import (lazy, baru dipanggil
    // pas tab Repair pertama kali dibuka) supaya halaman tetap ringan
    // kalau user tidak pernah buka tab Repair.
    async ensureThreeLib() {
      if (!window.__threeLib) {
        const [THREE, loaderMod, mfMod, controlsMod] = await Promise.all([
          import("https://esm.sh/three@0.160.0"),
          import("https://esm.sh/three@0.160.0/examples/jsm/loaders/STLLoader.js"),
          import("https://esm.sh/three@0.160.0/examples/jsm/loaders/3MFLoader.js"),
          // TrackballControls dipakai (bukan OrbitControls) SUPAYA rotasi
          // bener-bener bebas tanpa sumbu atas-bawah tetap -- OrbitControls
          // punya "kutub" (atas/bawah) yang bikin putaran vertikal mentok
          // dan harus balik arah. TrackballControls tidak punya batasan itu:
          // muter dari titik A, keliling terus ke segala arah, balik lagi
          // ke A tanpa pernah kejeduk.
          import("https://esm.sh/three@0.160.0/examples/jsm/controls/TrackballControls.js"),
        ]);
        window.__threeLib = { THREE, STLLoader: loaderMod.STLLoader, ThreeMFLoader: mfMod.ThreeMFLoader, TrackballControls: controlsMod.TrackballControls };
      }
      return window.__threeLib;
    },
    // Dipanggil lewat x-effect tiap kali tab / view aktif berubah.
    async initRepair3DViewerIfNeeded() {
      if (this.tab !== "repair") { this.pauseRepair3D(); return; }
      const view = this.activeRepairView();
      if (!view || view.kind !== "3d" || !view.model_url) { this.pauseRepair3D(); return; }
      await this.$nextTick();
      const container = this.$refs.repair3dCanvas;
      if (!container) return;
      if (repairThreeState && repairThreeState.currentViewId === view.id) {
        this.resumeRepair3D();
        return;
      }
      await this.loadRepairModel(container, view);
    },
    async loadRepairModel(container, view) {
      const cached = repairGeometryCache.get(view.id);
      this.repairModelLoading = !cached; // sudah pernah dibuka -> gak usah tampil "Memuat..." lagi
      try {
        const { THREE, STLLoader, ThreeMFLoader, TrackballControls } = await this.ensureThreeLib();
        this.teardownRepair3D();
        container.innerHTML = "";

        const width = container.clientWidth || 320;
        const height = container.clientHeight || 360;
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 5000);
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(width, height);
        container.appendChild(renderer.domElement);

        scene.add(new THREE.AmbientLight(0xffffff, 0.75));
        const dir1 = new THREE.DirectionalLight(0xffffff, 0.55); dir1.position.set(1, 1.4, 1); scene.add(dir1);
        const dir2 = new THREE.DirectionalLight(0xffffff, 0.3); dir2.position.set(-1, -0.6, -1); scene.add(dir2);

        // Part yang sudah pernah dibuka sebelumnya (di line/sesi yang sama)
        // dipakai lagi dari cache -- gak perlu download & parse ulang
        // file-nya, makanya ganti-ganti tombol part jadi instan.
        let mesh, bbox;
        if (cached) {
          mesh = cached.object; bbox = cached.box;
        } else {
          const isThreeMF = /\.3mf(\?|$)/i.test(view.model_url);
          if (isThreeMF) {
            // .3mf SUDAH bawa warna asli dari file CAD-nya (beda sama .stl
            // yang polos tanpa warna) -- jadi material-nya TIDAK disentuh
            // sama sekali di sini, dipakai apa adanya dari file.
            const loader = new ThreeMFLoader();
            mesh = await loader.loadAsync(view.model_url);
            bbox = new THREE.Box3().setFromObject(mesh);
          } else {
            const loader = new STLLoader();
            const geometry = await loader.loadAsync(view.model_url);
            geometry.computeVertexNormals();
            geometry.computeBoundingBox();
            const hasVertexColors = !!(geometry.attributes && geometry.attributes.color);
            const material = new THREE.MeshStandardMaterial(
              hasVertexColors
                ? { vertexColors: true, metalness: 0.2, roughness: 0.6 }
                : { color: view.color || "#9aa4ad", metalness: 0.2, roughness: 0.6 }
            );
            mesh = new THREE.Mesh(geometry, material);
            bbox = geometry.boundingBox.clone();
          }
          repairGeometryCache.set(view.id, { object: mesh, box: bbox });
        }
        const center = new THREE.Vector3(); bbox.getCenter(center);
        const size = new THREE.Vector3(); bbox.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        // Geser mesh biar center-nya di titik (0,0,0) -- titik Repair TETAP
        // disimpan dalam koordinat asli STL (anak dari mesh ini), jadi ikut
        // pindah otomatis kalau transform mesh berubah.
        mesh.position.set(-center.x, -center.y, -center.z);
        scene.add(mesh);

        // --- TrackballControls: rotasi BENER-BENER BEBAS, tanpa "kutub" ---
        // Beda sama OrbitControls yang punya sumbu atas-bawah tetap (jadi
        // putaran vertikal mentok di kutub & harus balik arah),
        // TrackballControls muter berdasarkan rotasi bola bebas (arcball) --
        // bisa digulir terus-menerus ke segala arah, dari titik A keliling
        // penuh balik lagi ke A, tanpa pernah kejeduk/mentok.
        const controls = new TrackballControls(camera, renderer.domElement);
        controls.rotateSpeed = 3.2;
        controls.zoomSpeed = 1.1;
        controls.staticMoving = false;        // ada inertia halus pas dilepas
        controls.dynamicDampingFactor = 0.12; // makin kecil = makin "licin"/lama redanya

        // --- ZOOM BEBAS, TANPA BATAS ---
        controls.minDistance = 0;
        controls.maxDistance = Infinity;

        // --- POSISI PART SELALU DI TENGAH (TIDAK BOLEH GESER) ---
        // Pan (geser) dimatikan total -- baik drag klik-kanan di desktop
        // maupun drag 2 jari di HP -- supaya target kamera permanen di
        // titik (0,0,0), pas di tengah part. User cuma bisa PUTAR & ZOOM,
        // part tidak akan pernah "kabur" dari tengah kolom.
        controls.noPan = true;

        // Arah lihat default -- dikembalikan ke sudut diagonal semula
        // (sesuai referensi gambar: besar, di tengah, kelihatan semua sisi
        // part sekaligus). camera.up TIDAK diubah (default 0,1,0).
        const viewDir = new THREE.Vector3(1, 0.65, 1).normalize();

        // Jarak kamera dihitung PAS berdasarkan proyeksi kotak part ke layar
        // (bukan cuma perkiraan bola), jadi part tampil sebesar mungkin
        // memenuhi kolom tanpa kepotong -- basis "right/up" di sini CUMA
        // dipakai buat hitung ukuran, TIDAK memengaruhi camera.up beneran.
        const half = new THREE.Vector3(size.x / 2, size.y / 2, size.z / 2);
        const upHint = Math.abs(viewDir.dot(new THREE.Vector3(0, 1, 0))) > 0.95
          ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3().crossVectors(upHint, viewDir).normalize();
        const projUp = new THREE.Vector3().crossVectors(viewDir, right).normalize();

        let maxRight = 0, maxUp = 0;
        for (let i = 0; i < 8; i++) {
          const corner = new THREE.Vector3(
            (i & 1 ? half.x : -half.x),
            (i & 2 ? half.y : -half.y),
            (i & 4 ? half.z : -half.z)
          );
          maxRight = Math.max(maxRight, Math.abs(corner.dot(right)));
          maxUp = Math.max(maxUp, Math.abs(corner.dot(projUp)));
        }

        const aspect = width / height;
        const vFovRad = camera.fov * (Math.PI / 180);
        const hFovRad = 2 * Math.atan(Math.tan(vFovRad / 2) * aspect);
        const paddingFactor = 1.02; // ruang napas tipis di tepi -- part tampil lebih besar
        const distV = maxUp / Math.tan(vFovRad / 2);
        const distH = maxRight / Math.tan(hFovRad / 2);
        const fitDistance = Math.max(distV, distH) * paddingFactor;

        camera.position.copy(viewDir.clone().multiplyScalar(fitDistance));
        camera.up.set(0, 1, 0);
        controls.target.set(0, 0, 0);
        controls.update();

        repairThreeState = {
          THREE, scene, camera, renderer, controls, mesh,
          raycaster: new THREE.Raycaster(), pointer: new THREE.Vector2(),
          markers: [], container, currentViewId: view.id, animId: null, paused: false,
          // --- state buat gambar garis las (drag-trace) & hover highlight ---
          weldLineMeshes: new Map(), // pointId -> { visible: Mesh, hit: Mesh }
          hoveredPointId: null,
          drawing: false, drawMode: null, drawPath: [], drawNormals: [], previewMesh: null,
          drawCenter: null, drawCenterNormal: null, drawCurrent: null, // buat mode Lingkaran/Kotak
          centerLocal: null, // titik tengah bbox part (lokal) -- di-update tiap rebuildRepairMarkers()
          lastClientX: 0, lastClientY: 0,
          // --- state buat Geser (move) & Edit Titik (reshape per-vertex) Point yang lagi dipilih ---
          vertexHandles: [], // bola biru (Edit Titik) ATAU kotak oranye (Ukuran) -- cuma salah satu yang aktif sekaligus
          moveDragging: false, moveStartLocal: null, moveOrigPoints: null, moveClosed: false, moveNormalRef: null,
          vertexDragging: false, vertexDragPointId: null, vertexDragIndex: null, vertexHandleCount: 0,
          vertexDragBasePoints: null, vertexDragNormalRef: null, vertexDragPlaneCenter: null,
          // --- state buat kotak seleksi Ukuran gaya Excel/PowerPoint (lihat buildBBoxHandles) ---
          bboxInfo: null, // snapshot bbox (centroid/basis u,v/rentang a,b) dari render TERAKHIR -- buat nge-klik handle
          resizeDragging: false, resizeHandleName: null, resizeOrigPoints: null, resizeClosed: false, resizeBBox: null,
          // Preview LIVE selagi geser/edit titik lagi berlangsung (belum tersimpan ke server) --
          // dipakai rebuildRepairMarkers/buildWeldLineMarker buat gambar posisi sementara.
          dragPreviewPointId: null, dragPreviewPoints: null, dragPreviewClosed: false,
          maxDim: 1, // di-update tiap rebuildRepairMarkers() -- dipakai buat ukuran preview garis pas drawing
          // Disimpan supaya bisa dipakai reset kamera tiap kali tab Repair
          // dibuka lagi -- lihat resetRepairCameraView() & resumeRepair3D().
          // PENTING: TrackballControls (beda dari OrbitControls) ikut
          // MEMUTAR camera.up tiap kali user muter model bebas -- jadi
          // "up" juga WAJIB disimpan & dikembalikan, bukan cuma posisi &
          // target, kalau enggak tampilan bakal kelihatan "miring" walau
          // posisi kamera sudah balik ke tempat semula.
          initialCameraPos: camera.position.clone(),
          initialCameraUp: camera.up.clone(),
          initialTarget: new THREE.Vector3(0, 0, 0),
        };

        this.attachRepair3DEvents(container);
        this.rebuildRepairMarkers();
        this.startRepair3DLoop();
        this.observeRepair3DResize(container);
      } catch (err) {
        this.flash("Gagal memuat model 3D: " + (err.message || err), true);
      } finally {
        this.repairModelLoading = false;
      }
    },
    startRepair3DLoop() {
      const r = repairThreeState;
      const tick = () => {
        if (!repairThreeState || repairThreeState !== r) return; // sudah di-teardown
        if (!r.paused) {
          // Jaring pengaman ekstra: paksa target selalu di titik (0,0,0)
          // tiap frame, jadi part dijamin 100% tetap di tengah walau ada
          // kejadian tak terduga yang menggeser target (mis. lib pihak
          // ketiga lain ikut memodifikasi controls).
          r.controls.target.set(0, 0, 0);
          r.controls.update();
          r.renderer.render(r.scene, r.camera);
        }
        r.animId = requestAnimationFrame(tick);
      };
      tick();
    },
    pauseRepair3D() {
      if (repairThreeState) repairThreeState.paused = true;
    },
    resumeRepair3D() {
      if (!repairThreeState) return;
      repairThreeState.paused = false;
      this.resetRepairCameraView();
      this.resizeRepair3D();
    },
    // Balikin kamera ke posisi & sudut AWAL (diagonal, besar, di tengah)
    // setiap kali tab Repair dibuka lagi -- baik pertama kali maupun
    // setelah pindah ke tab lain lalu balik lagi. Tanpa ini, kamera cuma
    // "resume" dari posisi terakhir user puter-puter manual sebelumnya,
    // jadi kelihatan seperti "belum reset" padahal cuma nyisa rotasi lama.
    resetRepairCameraView() {
      const r = repairThreeState; if (!r) return;
      r.camera.position.copy(r.initialCameraPos);
      r.camera.up.copy(r.initialCameraUp);
      r.controls.target.copy(r.initialTarget);
      r.controls.update();
    },
    resizeRepair3D() {
      const r = repairThreeState; if (!r) return;
      const w = r.container.clientWidth || 320, h = r.container.clientHeight || 360;
      r.camera.aspect = w / h; r.camera.updateProjectionMatrix();
      r.renderer.setSize(w, h);
      // TrackballControls nyimpen ukuran & posisi kolom secara internal --
      // wajib dikasih tau tiap kali kolomnya resize, kalau enggak nanti
      // hitungan drag-nya jadi ngaco (beda dari OrbitControls yg gak perlu ini).
      if (r.controls && r.controls.handleResize) r.controls.handleResize();
    },
    observeRepair3DResize(container) {
      const r = repairThreeState; if (!r) return;
      const ro = new ResizeObserver(() => this.resizeRepair3D());
      ro.observe(container);
      r.resizeObserver = ro;
    },
    teardownRepair3D() {
      const r = repairThreeState; if (!r) return;
      if (r.animId) cancelAnimationFrame(r.animId);
      if (r.resizeObserver) r.resizeObserver.disconnect();
      if (r.controls) r.controls.dispose();
      this.clearRepairDrawPreview();
      (r.markers || []).forEach((m) => this.disposeRepairObject(m));
      if (r.weldLineMeshes) r.weldLineMeshes.forEach((wl) => this.disposeRepairObject(wl.visible));
      (r.vertexHandles || []).forEach((m) => this.disposeRepairObject(m));
      // Mesh/Group (termasuk material-nya) SENGAJA tidak di-dispose di sini
      // -- disimpan utuh di repairGeometryCache biar bisa dipakai lagi
      // instan pas user balik ke part ini (lihat loadRepairModel). Cuma
      // dibuang beneran kalau part-nya dihapus (lihat deleteRepairView).
      if (r.renderer) { r.renderer.dispose(); r.renderer.domElement.remove(); }
      repairThreeState = null;
    },
    // Helper buang geometry+material 1 objek repair (sprite bola LAMA
    // ataupun Mesh tube garis las BARU) -- dipakai di teardown & rebuild.
    disposeRepairObject(obj) {
      if (!obj) return;
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (obj.material.map) obj.material.map.dispose();
        obj.material.dispose();
      }
    },
    makeRepairMarkerSprite(THREE, label) {
      // Bola kecil bergradasi (bukan garis+lingkaran) -- sengaja dibikin
      // simetris ke segala arah, jadi mau part-nya diputar ke sudut manapun
      // bentuknya selalu keliatan sama persis, gak akan pernah "tiduran"/miring.
      const W = 100, H = 100;
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d");
      const cx = W / 2, cy = H / 2, r = 38;

      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.4)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = "#7f1d1d"; ctx.fill();
      ctx.restore();

      const grad = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r * 1.1);
      grad.addColorStop(0, "#f87171");
      grad.addColorStop(0.55, "#dc2626");
      grad.addColorStop(1, "#8f1f1f");
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = grad; ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = "#ffffff"; ctx.stroke();

      ctx.beginPath();
      ctx.ellipse(cx - r * 0.35, cy - r * 0.45, r * 0.45, r * 0.28, -0.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.fill();

      if (label) {
        ctx.fillStyle = "#ffffff"; ctx.font = "bold 30px sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = 3;
        ctx.fillText(label.slice(0, 2), cx, cy + 1);
        ctx.shadowColor = "transparent";
      }

      const texture = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: texture, depthTest: true, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      // Simetris, jadi anchor di tengah (default) sudah pas -- gak perlu
      // digeser ke titik tertentu kayak desain garis/pin sebelumnya.
      sprite.center.set(0.5, 0.5);
      sprite.userData.aspect = 1;
      sprite.userData.isRepairAux = true;
      sprite.renderOrder = 999;
      return sprite;
    },
    // Bikin garis las (tube 3D tipis) buat Point yang punya "path" (jalur
    // hasil drag-trace) -- 1 mesh TIPIS buat tampilan (warna merah), + 1
    // mesh LEBIH GEMUK yang di-invisible-kan (cuma buat target klik/hover,
    // biar gampang kena walau jarinya agak meleset dari garis persis).
    // Terima 1 path RAW (bisa array bare [{x,y,z},...] = format LAMA/garis
    // terbuka, ATAU object {points:[...], closed:true} = format BARU buat
    // garis TERTUTUP/loop -- lingkaran, kotak, atau garis bebas yang balik
    // nyambung ke titik awal). Selalu dikembalikan bentuk seragam supaya
    // kode lain (render, dsb) gak perlu mikirin dua format sekaligus.
    normalizeRepairPath(path) {
      if (!path) return null;
      if (Array.isArray(path)) return path.length ? { points: path, closed: false } : null;
      if (path && Array.isArray(path.points)) return { points: path.points, closed: !!path.closed };
      return null;
    },
    buildWeldLineMarker(THREE, r, pt, maxDim, centerLocal, norm) {
      let normal = null;
      if (pt.nx != null && pt.ny != null && pt.nz != null) {
        normal = new THREE.Vector3(pt.nx, pt.ny, pt.nz);
        if (normal.lengthSq() < 1e-8) normal = null; else normal.normalize();
      }
      // Kalau Point ini lagi di-Geser/di-Edit Titik (belum di-save), pakai
      // jalur PREVIEW sementara (lihat startMoveDrag/extendMoveDrag dkk),
      // bukan jalur asli dari server -- biar keliatan bergerak live.
      const isDragPreview = r.dragPreviewPointId === pt.id && r.dragPreviewPoints;
      const points = isDragPreview ? r.dragPreviewPoints : norm.points;
      const offsetDist = maxDim * 0.006;
      // dorong tiap titik jalur keluar dikit dari permukaan (searah normal)
      // biar gak z-fighting/kedip nempel persis di kulit model.
      const pushed = points.map((p) => {
        let n = normal;
        if (!n) {
          n = new THREE.Vector3(p.x - centerLocal.x, p.y - centerLocal.y, p.z - centerLocal.z);
          if (n.lengthSq() < 1e-8) n.set(0, 0, 1); else n.normalize();
        }
        return new THREE.Vector3(p.x + n.x * offsetDist, p.y + n.y * offsetDist, p.z + n.z * offsetDist);
      });
      const closed = isDragPreview ? r.dragPreviewClosed : norm.closed;
      const curve = new THREE.CatmullRomCurve3(pushed, closed, "centripetal", 0.5);
      const tubularSegments = Math.max(16, Math.min(160, pushed.length * 6));

      // Point yang lagi DIPILIH (buat toolbar Geser/Ukuran/Edit Titik) selalu
      // tampil hijau & jelas, apapun Mode Lihat/Edit-nya. Selain itu: garis
      // INVISIBLE total di Mode Lihat (opacity 0 -- cuma nongol pas di-hover),
      // tapi tetap keliatan tipis di Mode Edit Point biar admin bisa lihat &
      // kelola semua Point yang ada (lihat toggleRepairEditMode).
      const isSelected = this.repairSelectedPointId === pt.id;
      const baseOpacity = isSelected ? WELD_LINE_OPACITY_SELECTED : (this.repairEditMode ? WELD_LINE_OPACITY_EDIT : WELD_LINE_OPACITY_VIEW);
      const lineColor = isSelected ? WELD_LINE_SELECTED_COLOR : WELD_LINE_COLOR;
      const visibleGeo = new THREE.TubeGeometry(curve, tubularSegments, Math.max(maxDim * 0.0022, 0.03), 6, closed);
      const visibleMat = new THREE.MeshBasicMaterial({
        color: lineColor, toneMapped: false,
        transparent: true, opacity: baseOpacity, depthWrite: false,
      });
      const visibleMesh = new THREE.Mesh(visibleGeo, visibleMat);
      visibleMesh.renderOrder = 998;
      visibleMesh.userData.isRepairAux = true;

      // Tube "hit zone" -- LEBIH GEMUK dari yang keliatan, invisible (tidak
      // dirender) tapi TETAP kena raycast (raycaster three.js tidak
      // memfilter berdasar .visible) -- ini yang bikin area klik/hover
      // nyaman dipencet walau garis visualnya sendiri tipis.
      const hitGeo = new THREE.TubeGeometry(curve, tubularSegments, Math.max(maxDim * 0.022, 0.15), 6, closed);
      const hitMesh = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ visible: false }));
      hitMesh.userData.pointId = pt.id;
      hitMesh.userData.isRepairAux = true;

      r.mesh.add(visibleMesh);
      r.mesh.add(hitMesh);
      r.markers.push(hitMesh);
      // baseOpacity disimpan biar setRepairHover tau harus "balik" ke
      // opacity berapa pas kursor lepas dari garis ini (beda-beda tergantung
      // Mode Lihat/Edit yang aktif waktu garis ini terakhir di-render).
      r.weldLineMeshes.set(pt.id, { visible: visibleMesh, hit: hitMesh, baseOpacity });
    },
    rebuildRepairMarkers() {
      const r = repairThreeState; if (!r) return;
      const THREE = r.THREE;
      (r.markers || []).forEach((m) => { r.mesh.remove(m); this.disposeRepairObject(m); });
      if (r.weldLineMeshes) {
        r.weldLineMeshes.forEach((wl) => { r.mesh.remove(wl.visible); this.disposeRepairObject(wl.visible); });
      }
      (r.vertexHandles || []).forEach((m) => { r.mesh.remove(m); this.disposeRepairObject(m); });
      r.markers = [];
      r.weldLineMeshes = new Map();
      r.vertexHandles = [];
      r.hoveredPointId = null;
      const bbox = new THREE.Box3().setFromObject(r.mesh);
      const size = new THREE.Vector3(); bbox.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      r.maxDim = maxDim; // dipakai lagi pas gambar garis baru (live preview)
      const spriteScale = maxDim * 0.05; // dikecilin dikit lagi dari 0.066
      // dorong marker sedikit keluar dari permukaan (searah normal) biar
      // tidak "z-fighting" (kedip) pas persis nempel permukaan, tapi tetap
      // ketutup badan model kalau posisinya lagi di sisi yang membelakangi kamera.
      const offsetDist = maxDim * 0.018;
      // titik tengah bbox dalam koordinat LOKAL (sama ruang dgn titik point) --
      // dipakai sebagai cadangan arah normal buat Point lama yang belum
      // punya nx/ny/nz tersimpan, DAN buat nentuin arah "keluar" awal pas
      // mulai gambar Lingkaran/Kotak (lihat approxRepairNormal).
      const centerWorld = new THREE.Vector3(); bbox.getCenter(centerWorld);
      const centerLocal = r.mesh.worldToLocal(centerWorld.clone());
      r.centerLocal = centerLocal;

      this.repairPoints.forEach((pt) => {
        const norm = this.normalizeRepairPath(pt.path);
        const minPts = norm && norm.closed ? 3 : 2;
        if (norm && norm.points.length >= minPts) {
          // --- Point BARU: garis las (jalur bebas, lingkaran, atau kotak) ---
          this.buildWeldLineMarker(THREE, r, pt, maxDim, centerLocal, norm);
          return;
        }
        // --- Point LAMA: bola merah tunggal (sebelum fitur garis las) ---
        const sprite = this.makeRepairMarkerSprite(THREE, pt.label);
        sprite.scale.set(spriteScale, spriteScale * sprite.userData.aspect, 1);
        let normal;
        if (pt.nx != null && pt.ny != null && pt.nz != null) {
          normal = new THREE.Vector3(pt.nx, pt.ny, pt.nz);
          if (normal.lengthSq() < 1e-8) normal = null; else normal.normalize();
        }
        if (!normal) {
          normal = new THREE.Vector3(pt.x - centerLocal.x, pt.y - centerLocal.y, pt.z - centerLocal.z);
          if (normal.lengthSq() < 1e-8) normal.set(0, 0, 1); else normal.normalize();
        }
        sprite.position.set(
          (pt.x || 0) + normal.x * offsetDist,
          (pt.y || 0) + normal.y * offsetDist,
          (pt.z || 0) + normal.z * offsetDist
        );
        sprite.userData.pointId = pt.id;
        r.mesh.add(sprite); // anak dari mesh -> otomatis ikut transform centering
        r.markers.push(sprite);
      });

      // ---- Handle "Edit Titik" (bola kecil biru) -- cuma muncul buat Point
      // yang lagi DIPILIH & sub-mode "reshape" aktif (lihat setRepairActionMode).
      // Jumlahnya SENGAJA DIBATASI (maks ~10) biar gak numpuk & gampang
      // dipencet -- geser satu bola, titik-titik SEKITARNYA di jalur asli
      // ikut ketarik halus (lihat extendVertexDrag), jadi garis tetap mulus
      // walau handle-nya dikit.
      if (this.repairPointActionMode === "reshape" && this.repairSelectedPointId) {
        const selPt = this.repairPoints.find((p) => p.id === this.repairSelectedPointId);
        const selNorm = selPt ? this.normalizeRepairPath(selPt.path) : null;
        if (selPt && selNorm) {
          const isPreview = r.dragPreviewPointId === selPt.id && r.dragPreviewPoints;
          const vpts = isPreview ? r.dragPreviewPoints : selNorm.points;
          const n = vpts.length;
          const targetHandles = Math.min(n, 10);
          const handleIndices = [];
          for (let i = 0; i < targetHandles; i++) {
            const idx = targetHandles > 1 ? Math.round((i * (n - 1)) / (targetHandles - 1)) : 0;
            if (!handleIndices.includes(idx)) handleIndices.push(idx);
          }
          r.vertexHandleCount = handleIndices.length;
          const handleRadius = Math.max(maxDim * 0.016, 0.16);
          handleIndices.forEach((idx) => {
            const p = vpts[idx];
            let hn;
            if (selPt.nx != null && selPt.ny != null && selPt.nz != null) {
              hn = new THREE.Vector3(selPt.nx, selPt.ny, selPt.nz);
              if (hn.lengthSq() < 1e-8) hn = null; else hn.normalize();
            }
            if (!hn) {
              hn = new THREE.Vector3(p.x - centerLocal.x, p.y - centerLocal.y, p.z - centerLocal.z);
              if (hn.lengthSq() < 1e-8) hn.set(0, 0, 1); else hn.normalize();
            }
            const geo = new THREE.SphereGeometry(handleRadius, 14, 12);
            const mat = new THREE.MeshBasicMaterial({ color: VERTEX_HANDLE_COLOR, toneMapped: false, depthTest: false });
            const handle = new THREE.Mesh(geo, mat);
            handle.position.set(p.x + hn.x * offsetDist * 2.6, p.y + hn.y * offsetDist * 2.6, p.z + hn.z * offsetDist * 2.6);
            handle.userData.isRepairAux = true;
            handle.userData.isVertexHandle = true;
            handle.userData.pointId = selPt.id;
            handle.userData.vertexIndex = idx;
            handle.renderOrder = 1000;
            r.mesh.add(handle);
            r.vertexHandles.push(handle);
          });
        }
      }

      // ---- Kotak seleksi ala Excel/PowerPoint (8 handle: 4 sudut + 4 tengah
      // sisi) -- muncul OTOMATIS begitu Point (bentuk jalur) dipilih, selama
      // BUKAN lagi sub-mode "Edit Titik". Seret sudut/sisi = Ukuran, seret
      // badan garisnya sendiri = Geser (lihat buildBBoxHandles di bawah &
      // startResizeDrag/startMoveDrag).
      if (this.repairPointActionMode !== "reshape" && this.repairSelectedPointId) {
        const selPt = this.repairPoints.find((p) => p.id === this.repairSelectedPointId);
        const selNorm = selPt ? this.normalizeRepairPath(selPt.path) : null;
        if (selPt && selNorm) this.buildBBoxHandles(THREE, r, selPt, selNorm, maxDim, centerLocal, offsetDist);
      }
    },
    // Kotak seleksi gaya Excel/PowerPoint: hitung bbox 2D (a,b) di bidang
    // singgung (tangent plane) shape-nya, lalu taruh 8 handle di sudut &
    // tengah sisi kotak itu. Basis (u,v,normal) & rentang a/b disimpan di
    // r.bboxInfo supaya bisa dipakai lagi pas mulai drag (startResizeDrag).
    buildBBoxHandles(THREE, r, pt, norm, maxDim, centerLocal, offsetDist) {
      const isPreview = r.dragPreviewPointId === pt.id && r.dragPreviewPoints;
      const pts = isPreview ? r.dragPreviewPoints : norm.points;
      let normal;
      if (pt.nx != null && pt.ny != null && pt.nz != null) {
        normal = new THREE.Vector3(pt.nx, pt.ny, pt.nz);
        if (normal.lengthSq() < 1e-8) normal = null; else normal.normalize();
      }
      const centroid = pts.reduce((acc, p) => acc.add(new THREE.Vector3(p.x, p.y, p.z)), new THREE.Vector3()).divideScalar(pts.length);
      if (!normal) {
        normal = centroid.clone().sub(centerLocal);
        if (normal.lengthSq() < 1e-8) normal.set(0, 0, 1); else normal.normalize();
      }
      const { u, v } = this.repairTangentBasis(THREE, normal);
      let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
      pts.forEach((p) => {
        const rel = new THREE.Vector3(p.x, p.y, p.z).sub(centroid);
        const a = rel.dot(u), b = rel.dot(v);
        if (a < aMin) aMin = a; if (a > aMax) aMax = a;
        if (b < bMin) bMin = b; if (b > bMax) bMax = b;
      });
      // Kasih sedikit "napas" biar handle gak nempel persis di garisnya.
      const pad = Math.max((aMax - aMin) * 0.08, (bMax - bMin) * 0.08, maxDim * 0.01);
      aMin -= pad; aMax += pad; bMin -= pad; bMax += pad;
      const aMid = (aMin + aMax) / 2, bMid = (bMin + bMax) / 2;
      r.bboxInfo = { centroid, u, v, normal, aMin, aMax, bMin, bMax, aMid, bMid };
      const defs = [
        { name: "nw", a: aMin, b: bMax, corner: true },
        { name: "ne", a: aMax, b: bMax, corner: true },
        { name: "se", a: aMax, b: bMin, corner: true },
        { name: "sw", a: aMin, b: bMin, corner: true },
        { name: "n", a: aMid, b: bMax, corner: false },
        { name: "s", a: aMid, b: bMin, corner: false },
        { name: "e", a: aMax, b: bMid, corner: false },
        { name: "w", a: aMin, b: bMid, corner: false },
      ];
      const handleSize = Math.max(maxDim * 0.022, 0.22);
      defs.forEach((d) => {
        const pos3D = centroid.clone().add(u.clone().multiplyScalar(d.a)).add(v.clone().multiplyScalar(d.b));
        const posOut = pos3D.clone().add(normal.clone().multiplyScalar(offsetDist * 3.2));
        const geo = d.corner
          ? new THREE.BoxGeometry(handleSize, handleSize, Math.max(handleSize * 0.35, 0.03))
          : new THREE.BoxGeometry(handleSize * 0.75, handleSize * 0.75, Math.max(handleSize * 0.3, 0.03));
        // depthTest: false -- handle SELALU tampil di atas body model, gak
        // akan "ketelen"/ketutupan permukaan part walau posisinya pas-pasan
        // deket kulit model (ini yang bikin kotaknya sempat keliatan hilang).
        const mat = new THREE.MeshBasicMaterial({ color: BBOX_HANDLE_COLOR, toneMapped: false, depthTest: false });
        const handle = new THREE.Mesh(geo, mat);
        handle.position.copy(posOut);
        handle.lookAt(posOut.clone().add(normal));
        handle.userData.isRepairAux = true;
        handle.userData.isBBoxHandle = true;
        handle.userData.pointId = pt.id;
        handle.userData.handleName = d.name;
        handle.renderOrder = 1000;
        r.mesh.add(handle);
        r.vertexHandles.push(handle);
      });
    },
    // Raycast KHUSUS permukaan model polos (mesh asli-nya doang) --
    // sengaja MEMBUANG semua objek tambahan (sprite bola lama, tube garis
    // las, hit-zone, preview) lewat flag userData.isRepairAux, supaya pas
    // lagi gambar garis baru kursor gak "kesangkut" nabrak garis lain yang
    // sudah ada duluan.
    raycastRepairSurface(ev, container) {
      const r = repairThreeState; if (!r) return null;
      const rect = container.getBoundingClientRect();
      r.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      r.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      r.raycaster.setFromCamera(r.pointer, r.camera);
      const hits = r.raycaster.intersectObject(r.mesh, true)
        .filter((h) => !h.object.isSprite && !(h.object.userData && h.object.userData.isRepairAux));
      if (!hits.length) return null;
      const closest = hits[0];
      return {
        local: r.mesh.worldToLocal(closest.point.clone()),
        normal: closest.face ? closest.face.normal.clone() : null,
      };
    },
    // Raycast KHUSUS Point yang sudah ada (garis las + bola lama) -- dipakai
    // buat deteksi hover & buat cek "pointerdown ini kena Point yang sudah
    // ada apa kena permukaan kosong" (lihat attachRepair3DEvents).
    raycastRepairMarkers(ev, container) {
      const r = repairThreeState; if (!r) return null;
      const rect = container.getBoundingClientRect();
      r.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      r.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      r.raycaster.setFromCamera(r.pointer, r.camera);
      const hits = r.raycaster.intersectObjects(r.markers, false);
      return hits.length ? hits[0] : null;
    },
    // Raycast KHUSUS handle tambahan di atas Point yang lagi dipilih --
    // bisa kena bola biru (Edit Titik, userData.isVertexHandle) ATAU kotak
    // oranye (Ukuran ala Excel/PowerPoint, userData.isBBoxHandle), tergantung
    // sub-mode mana yang lagi aktif waktu di-render (lihat rebuildRepairMarkers).
    raycastRepairVertexHandles(ev, container) {
      const r = repairThreeState; if (!r || !r.vertexHandles || !r.vertexHandles.length) return null;
      const rect = container.getBoundingClientRect();
      r.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      r.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      r.raycaster.setFromCamera(r.pointer, r.camera);
      const hits = r.raycaster.intersectObjects(r.vertexHandles, false);
      return hits.length ? hits[0] : null;
    },
    attachRepair3DEvents(container) {
      let downX = 0, downY = 0, downTime = 0;
      const onDown = (ev) => {
        downX = ev.clientX; downY = ev.clientY; downTime = Date.now();
        if (!this.repairEditMode) return;
        const r = repairThreeState;
        // Sub-mode "Edit Titik" aktif & kena bola handle -> mulai geser
        // TITIK ITU SAJA (lihat startVertexDrag), jangan mulai apa-apa lagi.
        if (this.repairPointActionMode === "reshape" && this.repairSelectedPointId) {
          const vHit = this.raycastRepairVertexHandles(ev, container);
          if (vHit && vHit.object.userData.isVertexHandle) { this.startVertexDrag(vHit); return; }
        }
        // Ada Point terpilih & BUKAN sub-mode Edit Titik -> kotak seleksi
        // ala Excel/PowerPoint aktif: kena handle sudut/sisi = Ukuran,
        // kena badan garis Point itu sendiri = Geser.
        if (this.repairPointActionMode !== "reshape" && this.repairSelectedPointId) {
          const bHit = this.raycastRepairVertexHandles(ev, container);
          if (bHit && bHit.object.userData.isBBoxHandle) { this.startResizeDrag(bHit); return; }
          const markerHit = this.raycastRepairMarkers(ev, container);
          if (markerHit && markerHit.object.userData.pointId === this.repairSelectedPointId) {
            this.startMoveDrag(ev, container);
            return;
          }
        }
        // Kena Point yang SUDAH ADA (garis/bola) -> jangan mulai gambar,
        // biar onUp yang proses (pilih Point / buka popup, lihat handleRepair3DClick).
        if (this.raycastRepairMarkers(ev, container)) return;
        // Kena permukaan model KOSONG -> mulai gambar Point baru, bentuknya
        // ngikut tombol "Bentuk Point" yang lagi aktif (Bebas/Lingkaran/Kotak).
        const surfaceHit = this.raycastRepairSurface(ev, container);
        if (!surfaceHit) return;
        this.startRepairDraw(this.repairDrawShape, surfaceHit, ev);
      };
      const onMove = (ev) => {
        this.handleRepair3DHover(ev, container);
        const r = repairThreeState;
        if (r && r.drawing) { this.extendRepairDraw(ev, container); return; }
        if (r && r.moveDragging) { this.extendMoveDrag(ev, container); return; }
        if (r && r.vertexDragging) { this.extendVertexDrag(ev, container); return; }
        if (r && r.resizeDragging) { this.extendResizeDrag(ev, container); return; }
      };
      const onUp = (ev) => {
        const r = repairThreeState;
        if (r && r.drawing) {
          if (r.drawMode === "freehand") this.finishRepairDraw();
          else this.finishRepairShapeDraw();
          return;
        }
        if (r && r.moveDragging) { this.finishMoveDrag(); return; }
        if (r && r.vertexDragging) { this.finishVertexDrag(); return; }
        if (r && r.resizeDragging) { this.finishResizeDrag(); return; }
        const dx = ev.clientX - downX, dy = ev.clientY - downY;
        const moved = Math.sqrt(dx * dx + dy * dy);
        // Gerakan kecil & cepat = klik beneran. Gerakan besar/lama = drag putar model, abaikan.
        if (moved > 6 || Date.now() - downTime > 600) return;
        this.handleRepair3DClick(ev, container);
      };
      container.addEventListener("pointerdown", onDown);
      container.addEventListener("pointermove", onMove);
      container.addEventListener("pointerup", onUp);
      container.addEventListener("pointerleave", onUp); // jaga2 kursor kabur keluar kolom pas lagi drag
    },
    // ---- Hover: garis las nyala tipis pas kursor deket/nempel (Mode Edit ATAU Mode Lihat) ----
    handleRepair3DHover(ev, container) {
      const r = repairThreeState; if (!r || r.drawing) return;
      const hit = this.raycastRepairMarkers(ev, container);
      const hoverId = hit && hit.object.userData && hit.object.userData.pointId ? hit.object.userData.pointId : null;
      if (hoverId !== r.hoveredPointId) this.setRepairHover(hoverId);
    },
    setRepairHover(pointId) {
      const r = repairThreeState; if (!r) return;
      // Point yang lagi DIPILIH (toolbar Geser/Ukuran/Edit Titik) selalu
      // tampil hijau tetap -- hover TIDAK menimpa warnanya, biar jelas
      // Point mana yang lagi diedit walau kursor lewat di atasnya.
      if (r.hoveredPointId && r.hoveredPointId !== pointId && r.hoveredPointId !== this.repairSelectedPointId && r.weldLineMeshes.has(r.hoveredPointId)) {
        const wl = r.weldLineMeshes.get(r.hoveredPointId);
        wl.visible.material.color.set(WELD_LINE_COLOR);
        wl.visible.material.opacity = wl.baseOpacity;
      }
      r.hoveredPointId = pointId;
      if (r.container) r.container.style.cursor = pointId ? "pointer" : "";
      if (pointId && pointId !== this.repairSelectedPointId && r.weldLineMeshes.has(pointId)) {
        const wl = r.weldLineMeshes.get(pointId);
        wl.visible.material.color.set(WELD_LINE_HOVER_COLOR);
        wl.visible.material.opacity = WELD_LINE_HOVER_OPACITY;
      }
    },
    // Cadangan arah "keluar" (normal) kalau raycast pas mulai gambar
    // kebetulan gak dapet face normal -- pakai arah dari titik tengah part
    // ke titik yang diklik (sama seperti fallback normal buat bola lama).
    approxRepairNormal(r, localPoint) {
      const THREE = r.THREE;
      const n = new THREE.Vector3(localPoint.x - r.centerLocal.x, localPoint.y - r.centerLocal.y, localPoint.z - r.centerLocal.z);
      return n.lengthSq() < 1e-8 ? new THREE.Vector3(0, 0, 1) : n.normalize();
    },
    // Basis 2 arah (u,v) yang saling tegak lurus & tegak lurus normal --
    // "bidang datar" tempat Lingkaran/Kotak digambar sebelum di-tempel ke
    // kontur permukaan model (lihat snapRepairToSurface).
    repairTangentBasis(THREE, normal) {
      const n = normal.clone().normalize();
      const arbitrary = Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const u = new THREE.Vector3().crossVectors(arbitrary, n).normalize();
      const v = new THREE.Vector3().crossVectors(n, u).normalize();
      return { u, v };
    },
    // Tembakin 1 titik "melayang" (hasil hitungan Lingkaran/Kotak di bidang
    // datar) lurus ke arah permukaan model, biar nempel ngikut kontur asli
    // part (bukan cuma bidang datar doang) -- kalau meleset (di luar tepi
    // part), titik mentahnya dipakai apa adanya.
    snapRepairToSurface(r, localPoint, normal) {
      const THREE = r.THREE;
      const away = Math.max((r.maxDim || 1) * 0.6, 1);
      const originLocal = localPoint.clone().add(normal.clone().multiplyScalar(away));
      const originWorld = r.mesh.localToWorld(originLocal);
      const dirWorld = normal.clone().negate().transformDirection(r.mesh.matrixWorld).normalize();
      r.raycaster.set(originWorld, dirWorld);
      const hits = r.raycaster.intersectObject(r.mesh, true)
        .filter((h) => !h.object.isSprite && !(h.object.userData && h.object.userData.isRepairAux));
      if (!hits.length) return localPoint.clone();
      return r.mesh.worldToLocal(hits[0].point.clone());
    },
    // Proyeksi kursor ke "bidang datar" tangent (dipakai pas drag Lingkaran/
    // Kotak sempat keluar dari tepi part -- biar radius/ukurannya tetap
    // ngikutin gerakan tangan walau sesaat gak kena permukaan model).
    projectRepairToTangentPlane(r, center, normal, ev, container) {
      const THREE = r.THREE;
      const rect = container.getBoundingClientRect();
      r.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      r.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      r.raycaster.setFromCamera(r.pointer, r.camera);
      const centerWorld = r.mesh.localToWorld(center.clone());
      const normalWorld = normal.clone().transformDirection(r.mesh.matrixWorld).normalize();
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normalWorld, centerWorld);
      const hitWorld = new THREE.Vector3();
      const ok = r.raycaster.ray.intersectPlane(plane, hitWorld);
      return ok ? r.mesh.worldToLocal(hitWorld) : center.clone();
    },
    // Bikin titik-titik Lingkaran (di bidang tangent titik tengah), tiap
    // titik ditempel ke permukaan model (lihat snapRepairToSurface).
    generateRepairCirclePoints(r, center, normal, radius, segments) {
      const THREE = r.THREE;
      const { u, v } = this.repairTangentBasis(THREE, normal);
      const pts = [];
      for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const flat = center.clone()
          .add(u.clone().multiplyScalar(radius * Math.cos(angle)))
          .add(v.clone().multiplyScalar(radius * Math.sin(angle)));
        pts.push(this.snapRepairToSurface(r, flat, normal));
      }
      return pts;
    },
    // Bikin titik-titik Kotak (4 sisi, tiap sisi dibagi beberapa segmen biar
    // ngikut lengkung permukaan) -- "center" = sudut tempat mulai nahan,
    // "current" = sudut seberang tempat dilepas.
    generateRepairSquarePoints(r, center, normal, current, segmentsPerEdge) {
      const THREE = r.THREE;
      const { u, v } = this.repairTangentBasis(THREE, normal);
      const rel = current.clone().sub(center);
      const du = rel.dot(u), dv = rel.dot(v);
      const corners2D = [[0, 0], [du, 0], [du, dv], [0, dv]];
      const pts = [];
      for (let c = 0; c < 4; c++) {
        const [x0, y0] = corners2D[c];
        const [x1, y1] = corners2D[(c + 1) % 4];
        for (let s = 0; s < segmentsPerEdge; s++) {
          const t = s / segmentsPerEdge;
          const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
          const flat = center.clone().add(u.clone().multiplyScalar(x)).add(v.clone().multiplyScalar(y));
          pts.push(this.snapRepairToSurface(r, flat, normal));
        }
      }
      return pts;
    },
    // ---- Mulai gambar Point baru (tahan/pointerdown di permukaan kosong) ----
    // shape: "freehand" (garis bebas, lihat extendFreehandDraw) atau
    // "circle"/"square" (lihat extendRepairShapeDraw).
    startRepairDraw(shape, surfaceHit, ev) {
      const r = repairThreeState; if (!r) return;
      r.controls.enabled = false; // matiin putar-model sementara, drag = gambar Point
      r.drawing = true;
      r.drawMode = shape;
      if (shape === "freehand") {
        r.drawPath = [surfaceHit.local.clone()];
        r.drawNormals = [surfaceHit.normal ? surfaceHit.normal.clone() : null];
      } else {
        r.drawCenter = surfaceHit.local.clone();
        r.drawCenterNormal = surfaceHit.normal ? surfaceHit.normal.clone() : this.approxRepairNormal(r, surfaceHit.local);
        r.drawCurrent = surfaceHit.local.clone();
      }
      r.lastClientX = ev.clientX; r.lastClientY = ev.clientY;
    },
    // Router: selama masih diseret, arahkan ke handler yang sesuai bentuknya.
    extendRepairDraw(ev, container) {
      const r = repairThreeState; if (!r || !r.drawing) return;
      if (r.drawMode === "freehand") this.extendFreehandDraw(ev, container);
      else this.extendRepairShapeDraw(ev, container);
    },
    extendFreehandDraw(ev, container) {
      const r = repairThreeState; if (!r || !r.drawing) return;
      const dx = ev.clientX - r.lastClientX, dy = ev.clientY - r.lastClientY;
      // Throttle sampel berdasar jarak di layar (bukan tiap event) biar
      // jalurnya gak numpuk ribuan titik cuma dari getar tangan kecil.
      // Digedein dari 4 -> 10px: makin jarang sampel mentah = makin gak
      // gampang keiket getar tangan, dasar buat garis yang lebih mulus.
      if (Math.sqrt(dx * dx + dy * dy) < 10) return;
      const hit = this.raycastRepairSurface(ev, container);
      if (!hit) return; // sempat meleset dari permukaan model -> lewati sampel ini, terusin nunggu gerakan berikutnya
      r.drawPath.push(hit.local.clone());
      r.drawNormals.push(hit.normal ? hit.normal.clone() : null);
      r.lastClientX = ev.clientX; r.lastClientY = ev.clientY;
      this.updateRepairDrawPreview();
    },
    extendRepairShapeDraw(ev, container) {
      const r = repairThreeState; if (!r || !r.drawing) return;
      const dx = ev.clientX - r.lastClientX, dy = ev.clientY - r.lastClientY;
      if (Math.sqrt(dx * dx + dy * dy) < 4) return; // update lebih rapat drpd freehand, biar ukurannya kerasa responsif
      const hit = this.raycastRepairSurface(ev, container);
      // Kalau kursor sesaat keluar dari tepi part, tetep update pakai
      // proyeksi ke bidang datar -- biar ukurannya tetap ngikutin tangan.
      r.drawCurrent = hit ? hit.local.clone() : this.projectRepairToTangentPlane(r, r.drawCenter, r.drawCenterNormal, ev, container);
      r.lastClientX = ev.clientX; r.lastClientY = ev.clientY;
      this.updateRepairShapePreview();
    },
    async finishRepairDraw() {
      const r = repairThreeState; if (!r) return;
      r.controls.enabled = true;
      r.drawing = false; r.drawMode = null;
      const rawPath = r.drawPath || [];
      const rawNormals = r.drawNormals || [];
      this.clearRepairDrawPreview();
      r.drawPath = []; r.drawNormals = [];
      // Cuma nge-tap doang (gak beneran diseret) -> diabaikan, bukan Point baru.
      if (rawPath.length < 2) return;
      // Deteksi "loop 360 derajat": kalau titik akhir balik deket ke titik
      // awal (nutup sendiri), otomatis disambung jadi 1 GARIS TERTUTUP,
      // bukan garis dengan ujung nganggur.
      const closeThreshold = Math.max((r.maxDim || 1) * 0.035, 0.4);
      let workingPath = rawPath;
      const isClosed = rawPath.length > 5 && rawPath[0].distanceTo(rawPath[rawPath.length - 1]) < closeThreshold;
      if (isClosed) {
        // buang buntut titik yang numpuk deket titik awal (bekas nutup loop)
        // biar gak ada gerombolan titik ganda pas nyambung.
        while (workingPath.length > 5 && workingPath[workingPath.length - 1].distanceTo(workingPath[0]) < closeThreshold) {
          workingPath = workingPath.slice(0, -1);
        }
      }
      const smoothed = this.smoothRepairPath(workingPath, isClosed);
      const avgNormal = this.averageRepairNormal(rawNormals);
      await this.addRepairPointPath(smoothed, avgNormal, isClosed);
    },
    async finishRepairShapeDraw() {
      const r = repairThreeState; if (!r) return;
      r.controls.enabled = true;
      r.drawing = false;
      const mode = r.drawMode;
      const center = r.drawCenter, normal = r.drawCenterNormal, current = r.drawCurrent;
      r.drawMode = null; r.drawCenter = null; r.drawCurrent = null; r.drawCenterNormal = null;
      this.clearRepairDrawPreview();
      if (!center || !current) return;
      const minSize = (r.maxDim || 1) * 0.01;
      let pts = null;
      if (mode === "circle") {
        const radius = center.distanceTo(current);
        if (radius < minSize) return; // cuma nge-tap doang, radiusnya kegantung -> diabaikan
        pts = this.generateRepairCirclePoints(r, center, normal, radius, 40);
      } else if (mode === "square") {
        if (center.distanceTo(current) < minSize) return;
        pts = this.generateRepairSquarePoints(r, center, normal, current, 8);
      }
      if (!pts || pts.length < 3) return;
      const points = pts.map((p) => ({ x: p.x, y: p.y, z: p.z }));
      await this.addRepairPointPath(points, normal, true);
    },
    // Rata-rata bertetangga (moving average) -- "membaurkan" tiap titik
    // dengan titik-titik di sekitarnya, jadi getar/patahan kecil dari
    // tangan hilang, TANPA mengubah bentuk/arah umum garis. Beda dari
    // Catmull-Rom (yang WAJIB lewat persis tiap titik mentah, jadi tetap
    // ikut kasar kalau titiknya sendiri kasar) -- ini pass duluan SEBELUM
    // dibikin kurva, baik buat preview (live) maupun hasil akhir.
    // windowRadius lebih besar = lebih halus tapi garis makin "dipotong sudutnya".
    smoothRawDrawPoints(rawPath, windowRadius) {
      const THREE = repairThreeState.THREE;
      const n = rawPath.length;
      if (n <= 2) return rawPath.map((p) => p.clone());
      const out = [];
      for (let i = 0; i < n; i++) {
        const lo = Math.max(0, i - windowRadius);
        const hi = Math.min(n - 1, i + windowRadius);
        const sum = new THREE.Vector3();
        for (let j = lo; j <= hi; j++) sum.add(rawPath[j]);
        sum.divideScalar(hi - lo + 1);
        out.push(sum);
      }
      // Ujung awal & akhir dijaga TETAP PERSIS di titik user mulai/lepas
      // jari -- biar garis gak "kepotong pendek" dari titik yang dimaksud.
      out[0] = rawPath[0].clone();
      out[n - 1] = rawPath[n - 1].clone();
      return out;
    },
    // Preview LIVE selagi Bebas lagi diseret (warna kuning) -- biar user
    // lihat langsung jalur yang lagi digambar (SUDAH dihaluskan) sebelum dilepas.
    updateRepairDrawPreview() {
      const r = repairThreeState; if (!r || !r.drawPath || r.drawPath.length < 2) return;
      const THREE = r.THREE;
      this.clearRepairDrawPreview();
      const smoothed = this.smoothRawDrawPoints(r.drawPath, 2);
      const curve = new THREE.CatmullRomCurve3(smoothed, false, "centripetal", 0.5);
      const segs = Math.max(8, Math.min(100, r.drawPath.length * 4));
      const radius = Math.max((r.maxDim || 1) * 0.0055, 0.05);
      const geo = new THREE.TubeGeometry(curve, segs, radius, 6, false);
      const mat = new THREE.MeshBasicMaterial({ color: WELD_LINE_DRAW_COLOR, toneMapped: false, transparent: true, opacity: 0.92 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.isRepairAux = true;
      mesh.renderOrder = 1000;
      r.mesh.add(mesh);
      r.previewMesh = mesh;
    },
    // Preview LIVE selagi Lingkaran/Kotak lagi diseret (warna kuning, SELALU
    // tertutup/loop) -- update tiap gerakan biar ukurannya kerasa langsung.
    updateRepairShapePreview() {
      const r = repairThreeState; if (!r || !r.drawCenter || !r.drawCurrent) return;
      const THREE = r.THREE;
      this.clearRepairDrawPreview();
      let pts = null;
      if (r.drawMode === "circle") {
        const radius = r.drawCenter.distanceTo(r.drawCurrent);
        if (radius < 1e-4) return;
        pts = this.generateRepairCirclePoints(r, r.drawCenter, r.drawCenterNormal, radius, 28);
      } else if (r.drawMode === "square") {
        pts = this.generateRepairSquarePoints(r, r.drawCenter, r.drawCenterNormal, r.drawCurrent, 6);
      }
      if (!pts || pts.length < 3) return;
      const curve = new THREE.CatmullRomCurve3(pts, true, "centripetal", 0.5);
      const segs = Math.max(24, pts.length * 3);
      const radius = Math.max((r.maxDim || 1) * 0.0055, 0.05);
      const geo = new THREE.TubeGeometry(curve, segs, radius, 6, true);
      const mat = new THREE.MeshBasicMaterial({ color: WELD_LINE_DRAW_COLOR, toneMapped: false, transparent: true, opacity: 0.92 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.isRepairAux = true;
      mesh.renderOrder = 1000;
      r.mesh.add(mesh);
      r.previewMesh = mesh;
    },
    clearRepairDrawPreview() {
      const r = repairThreeState; if (!r || !r.previewMesh) return;
      r.mesh.remove(r.previewMesh);
      this.disposeRepairObject(r.previewMesh);
      r.previewMesh = null;
    },
    // Haluskan jalur mentah hasil drag Bebas (kadang zigzag kasar ngikutin
    // getar tangan) buat hasil AKHIR yang disimpan -- 2 tahap: (1) rata-
    // ratakan tetangga (buang getar kasar), (2) alurkan lewat kurva &
    // resample ke jumlah titik yang rapi. "closed" true kalau ini loop
    // hasil deteksi 360 derajat (lihat finishRepairDraw).
    smoothRepairPath(rawPath, closed) {
      const THREE = repairThreeState.THREE;
      if (rawPath.length < 3) return rawPath.map((p) => ({ x: p.x, y: p.y, z: p.z }));
      const eased = this.smoothRawDrawPoints(rawPath, 3);
      const curve = new THREE.CatmullRomCurve3(eased, !!closed, "centripetal", 0.5);
      const n = Math.max(closed ? 14 : 6, Math.min(48, rawPath.length));
      return curve.getSpacedPoints(n).map((p) => ({ x: p.x, y: p.y, z: p.z }));
    },
    averageRepairNormal(normals) {
      const THREE = repairThreeState.THREE;
      const valid = normals.filter(Boolean);
      if (!valid.length) return null;
      const sum = valid.reduce((acc, n) => acc.add(n), new THREE.Vector3());
      return sum.lengthSq() > 1e-8 ? sum.normalize() : null;
    },
    handleRepair3DClick(ev, container) {
      // Klik biasa (bukan drag-gambar) cuma berlaku buat Point yang SUDAH
      // ADA -- buka popup (Mode Lihat) atau PILIH Point itu buat toolbar
      // Geser/Ukuran/Edit Titik/Hapus (Mode Edit, lihat selectRepairPoint).
      // Nambah Point baru sekarang HARUS lewat drag-menyusuri (lihat
      // startRepairDraw dkk), bukan lagi dari klik tunggal di permukaan kosong.
      const hit = this.raycastRepairMarkers(ev, container);
      if (!hit || !hit.object.userData || !hit.object.userData.pointId) return;
      const point = this.repairPoints.find((p) => p.id === hit.object.userData.pointId);
      if (!point) return;
      if (this.repairEditMode) this.selectRepairPoint(point.id);
      else this.openRepairPoint(point);
    },
    // ---- Pilih/batal-pilih Point buat toolbar Ukuran(otomatis)/Edit Titik/Hapus ----
    selectRepairPoint(id) {
      this.repairSelectedPointId = id;
      this.repairPointActionMode = null; // selalu mulai dari sub-mode netral (kotak seleksi) tiap pilih Point baru
      this.rebuildRepairMarkers();
    },
    deselectRepairPoint() {
      this.repairSelectedPointId = null;
      this.repairPointActionMode = null;
      this.rebuildRepairMarkers();
    },
    // Point object yang lagi dipilih (dipakai toolbar HTML) -- null kalau gak ada.
    selectedRepairPointObj() {
      return this.repairPoints.find((p) => p.id === this.repairSelectedPointId) || null;
    },
    // Kotak seleksi (Geser+Ukuran) & Edit Titik cuma masuk akal buat Point
    // BENTUK JALUR (garis las/lingkaran/kotak). Point LAMA (bola tunggal,
    // belum punya path) cuma bisa Digeser (drag langsung) & Dihapus.
    selectedRepairPointHasPath() {
      const p = this.selectedRepairPointObj();
      return !!(p && this.normalizeRepairPath(p.path));
    },
    // Klik tombol "Edit Titik" di toolbar -- klik lagi buat matiin (balik ke
    // kotak seleksi Geser/Ukuran biasa).
    setRepairActionMode(mode) {
      if (!this.selectedRepairPointHasPath()) return;
      this.repairPointActionMode = this.repairPointActionMode === mode ? null : mode;
      this.rebuildRepairMarkers();
    },
    // ---- Geser: seret BADAN garis/bentuknya sendiri (gaya Excel/PowerPoint --
    // klik & tahan di atas shape yang lagi dipilih, lalu seret). Bentuknya
    // digeser sebagai lapisan DATAR yang "mengambang" di atas part -- GAK
    // perlu nembak/ikut kontur permukaan model tiap gerakan, biar gesernya
    // selalu pasti ngikutin tangan walau kursor sempat keluar dari model. ----
    startMoveDrag(ev, container) {
      const r = repairThreeState; if (!r) return;
      const pt = this.selectedRepairPointObj(); if (!pt) return;
      const THREE = r.THREE;
      const norm = this.normalizeRepairPath(pt.path);
      let startLocal;
      if (norm) {
        startLocal = norm.points.reduce((acc, p) => acc.add(new THREE.Vector3(p.x, p.y, p.z)), new THREE.Vector3()).divideScalar(norm.points.length);
      } else {
        startLocal = new THREE.Vector3(pt.x || 0, pt.y || 0, pt.z || 0);
      }
      r.controls.enabled = false;
      r.moveDragging = true;
      r.moveStartLocal = startLocal;
      r.moveNormalRef = pt.nx != null ? new THREE.Vector3(pt.nx, pt.ny, pt.nz).normalize() : this.approxRepairNormal(r, startLocal);
      if (norm) {
        r.moveOrigPoints = norm.points.map((p) => ({ x: p.x, y: p.y, z: p.z }));
        r.moveClosed = norm.closed;
      } else {
        r.moveOrigPoints = [{ x: pt.x || 0, y: pt.y || 0, z: pt.z || 0 }];
        r.moveClosed = false;
      }
      r.dragPreviewPointId = pt.id;
      r.dragPreviewPoints = r.moveOrigPoints;
      r.dragPreviewClosed = r.moveClosed;
    },
    extendMoveDrag(ev, container) {
      const r = repairThreeState; if (!r || !r.moveDragging) return;
      // Selalu proyeksi ke bidang datar (tangent plane) di posisi & arah
      // normal AWAL Point ini -- TIDAK nembak ke permukaan model, jadi
      // gerakannya konsisten & gak keteteran walau kursor lewat di luar
      // siluet part.
      const newLocal = this.projectRepairToTangentPlane(r, r.moveStartLocal, r.moveNormalRef, ev, container);
      const delta = newLocal.clone().sub(r.moveStartLocal);
      const moved = r.moveOrigPoints.map((p) => ({ x: p.x + delta.x, y: p.y + delta.y, z: p.z + delta.z }));
      r.dragPreviewPoints = moved;
      this.rebuildRepairMarkers();
    },
    async finishMoveDrag() {
      const r = repairThreeState; if (!r || !r.moveDragging) return;
      r.controls.enabled = true;
      r.moveDragging = false;
      const points = r.dragPreviewPoints;
      const closed = r.dragPreviewClosed;
      r.dragPreviewPointId = null; r.dragPreviewPoints = null;
      const pointId = this.repairSelectedPointId;
      r.moveStartLocal = null; r.moveOrigPoints = null; r.moveNormalRef = null;
      if (!points || !pointId) { this.rebuildRepairMarkers(); return; }
      await this.saveRepairPointGeometry(pointId, points, closed);
      this.flash("Point berhasil digeser.");
    },
    // ---- Ukuran: seret salah satu dari 8 handle kotak seleksi (gaya Excel/
    // PowerPoint) -- sudut = 2 arah sekaligus, tengah sisi = 1 arah saja,
    // sisi/sudut SEBERANGNYA jadi jangkar yang diam. ----
    startResizeDrag(bHit) {
      const r = repairThreeState; if (!r || !r.bboxInfo) return;
      const pt = this.selectedRepairPointObj(); if (!pt) return;
      const norm = this.normalizeRepairPath(pt.path); if (!norm) return;
      r.controls.enabled = false;
      r.resizeDragging = true;
      r.resizeHandleName = bHit.object.userData.handleName;
      r.resizeOrigPoints = norm.points.map((p) => ({ x: p.x, y: p.y, z: p.z }));
      r.resizeClosed = norm.closed;
      r.resizeBBox = { ...r.bboxInfo }; // snapshot bbox SAAT MULAI drag, jangan berubah lagi selama diseret
      r.dragPreviewPointId = pt.id;
      r.dragPreviewPoints = r.resizeOrigPoints;
      r.dragPreviewClosed = r.resizeClosed;
    },
    extendResizeDrag(ev, container) {
      const r = repairThreeState; if (!r || !r.resizeDragging) return;
      const box = r.resizeBBox; if (!box) return;
      const THREE = r.THREE;
      // Sama seperti Geser -- selalu di bidang datar (tangent plane) bbox-nya
      // sendiri, TIDAK nembak permukaan model, biar Ukuran selalu ngikutin
      // tangan dengan pasti, apapun posisi kursor relatif ke part-nya.
      const localHit = this.projectRepairToTangentPlane(r, box.centroid, box.normal, ev, container);
      const rel = localHit.clone().sub(box.centroid);
      const a2 = rel.dot(box.u), b2 = rel.dot(box.v);
      // Definisi tiap handle: titik ASLI-nya sendiri (origA/origB) & titik
      // JANGKAR di seberangnya yang harus diam (anchorA/anchorB). Handle
      // sisi (n/s/e/w) cuma bebas gerak di 1 sumbu (freeA atau freeB saja).
      const table = {
        nw: { origA: box.aMin, origB: box.bMax, anchorA: box.aMax, anchorB: box.bMin, freeA: true, freeB: true },
        ne: { origA: box.aMax, origB: box.bMax, anchorA: box.aMin, anchorB: box.bMin, freeA: true, freeB: true },
        se: { origA: box.aMax, origB: box.bMin, anchorA: box.aMin, anchorB: box.bMax, freeA: true, freeB: true },
        sw: { origA: box.aMin, origB: box.bMin, anchorA: box.aMax, anchorB: box.bMax, freeA: true, freeB: true },
        n: { origA: box.aMid, origB: box.bMax, anchorA: null, anchorB: box.bMin, freeA: false, freeB: true },
        s: { origA: box.aMid, origB: box.bMin, anchorA: null, anchorB: box.bMax, freeA: false, freeB: true },
        e: { origA: box.aMax, origB: box.bMid, anchorA: box.aMin, anchorB: null, freeA: true, freeB: false },
        w: { origA: box.aMin, origB: box.bMid, anchorA: box.aMax, anchorB: null, freeA: true, freeB: false },
      };
      const cfg = table[r.resizeHandleName]; if (!cfg) return;
      const MIN_SCALE = 0.05; // cegah shape "kebalik"/nyaris hilang kalau diseret kelewatan
      let scaleA = 1, scaleB = 1;
      if (cfg.freeA) {
        const span = cfg.origA - cfg.anchorA;
        scaleA = Math.abs(span) > 1e-6 ? (a2 - cfg.anchorA) / span : 1;
        if (Math.abs(scaleA) < MIN_SCALE) scaleA = scaleA < 0 ? -MIN_SCALE : MIN_SCALE;
      }
      if (cfg.freeB) {
        const span = cfg.origB - cfg.anchorB;
        scaleB = Math.abs(span) > 1e-6 ? (b2 - cfg.anchorB) / span : 1;
        if (Math.abs(scaleB) < MIN_SCALE) scaleB = scaleB < 0 ? -MIN_SCALE : MIN_SCALE;
      }
      // Titik hasil resize dihitung LANGSUNG di bidang datar bbox (gak
      // ditembak ulang ke permukaan model) -- bentuknya jadi lapisan datar
      // yang membesar/mengecil apa adanya, gak perlu ngikut kontur part.
      const result = r.resizeOrigPoints.map((p) => {
        const relP = new THREE.Vector3(p.x, p.y, p.z).sub(box.centroid);
        const a = relP.dot(box.u), b = relP.dot(box.v);
        const newA = cfg.freeA ? cfg.anchorA + (a - cfg.anchorA) * scaleA : a;
        const newB = cfg.freeB ? cfg.anchorB + (b - cfg.anchorB) * scaleB : b;
        const pos = box.centroid.clone().add(box.u.clone().multiplyScalar(newA)).add(box.v.clone().multiplyScalar(newB));
        return { x: pos.x, y: pos.y, z: pos.z };
      });
      r.dragPreviewPoints = result;
      this.rebuildRepairMarkers();
    },
    async finishResizeDrag() {
      const r = repairThreeState; if (!r || !r.resizeDragging) return;
      r.controls.enabled = true;
      r.resizeDragging = false;
      const points = r.dragPreviewPoints;
      const closed = r.dragPreviewClosed;
      const pointId = this.repairSelectedPointId;
      r.dragPreviewPointId = null; r.dragPreviewPoints = null;
      r.resizeHandleName = null; r.resizeOrigPoints = null; r.resizeBBox = null;
      if (!points || !pointId) { this.rebuildRepairMarkers(); return; }
      await this.saveRepairPointGeometry(pointId, points, closed);
      this.flash("Ukuran Point berhasil diubah.");
    },
    // ---- Edit Titik: geser 1 titik jalur (bola biru) -- titik-titik lain
    // di SEKITARNYA ikut ketarik halus (falloff), biar garis gak patah tajam. ----
    startVertexDrag(vHit) {
      const r = repairThreeState; if (!r) return;
      const pt = this.selectedRepairPointObj(); if (!pt) return;
      const norm = this.normalizeRepairPath(pt.path); if (!norm) return;
      const THREE = r.THREE;
      r.controls.enabled = false;
      r.vertexDragging = true;
      r.vertexDragPointId = pt.id;
      r.vertexDragIndex = vHit.object.userData.vertexIndex;
      r.vertexDragBasePoints = norm.points.map((p) => ({ x: p.x, y: p.y, z: p.z }));
      // Bidang datar acuan buat drag titik ini -- lewat titik yang diseret,
      // searah normal keseluruhan Point-nya (bukan nembak permukaan model).
      r.vertexDragNormalRef = pt.nx != null ? new THREE.Vector3(pt.nx, pt.ny, pt.nz).normalize() : this.approxRepairNormal(r, new THREE.Vector3(r.vertexDragBasePoints[r.vertexDragIndex].x, r.vertexDragBasePoints[r.vertexDragIndex].y, r.vertexDragBasePoints[r.vertexDragIndex].z));
      r.vertexDragPlaneCenter = new THREE.Vector3(r.vertexDragBasePoints[r.vertexDragIndex].x, r.vertexDragBasePoints[r.vertexDragIndex].y, r.vertexDragBasePoints[r.vertexDragIndex].z);
      r.dragPreviewPointId = pt.id;
      r.dragPreviewPoints = r.vertexDragBasePoints;
      r.dragPreviewClosed = norm.closed;
    },
    extendVertexDrag(ev, container) {
      const r = repairThreeState; if (!r || !r.vertexDragging) return;
      // Sama seperti Geser/Ukuran -- proyeksi ke bidang datar, GAK nembak
      // permukaan model, biar gesernya selalu pasti ngikutin tangan.
      const target = this.projectRepairToTangentPlane(r, r.vertexDragPlaneCenter, r.vertexDragNormalRef, ev, container);
      const THREE = r.THREE;
      const idx = r.vertexDragIndex;
      const base = r.vertexDragBasePoints;
      const n = base.length;
      const closed = r.dragPreviewClosed;
      const delta = { x: target.x - base[idx].x, y: target.y - base[idx].y, z: target.z - base[idx].z };
      // Radius pengaruh ("falloff") sepanjang jalur -- makin jauh index-nya
      // dari titik yang diseret, makin kecil pengaruhnya, sampai akhirnya 0.
      // Dihitung dari jarak rata-rata antar-handle biar konsisten walau
      // jumlah handle beda-beda (lihat r.vertexHandleCount).
      const falloffRadius = Math.max(2, Math.round(n / Math.max(1, r.vertexHandleCount)) * 1.4);
      const result = base.map((p, j) => {
        let d = Math.abs(j - idx);
        if (closed) d = Math.min(d, n - d);
        if (d > falloffRadius) return { x: p.x, y: p.y, z: p.z };
        const t = d / falloffRadius;
        const w = Math.cos((t * Math.PI) / 2); // 1 pas di titik yg diseret, 0 di ujung radius, mulus di antaranya
        return { x: p.x + delta.x * w, y: p.y + delta.y * w, z: p.z + delta.z * w };
      });
      r.dragPreviewPoints = result;
      this.rebuildRepairMarkers();
    },
    async finishVertexDrag() {
      const r = repairThreeState; if (!r || !r.vertexDragging) return;
      r.controls.enabled = true;
      r.vertexDragging = false;
      const points = r.dragPreviewPoints;
      const closed = r.dragPreviewClosed;
      const pointId = r.vertexDragPointId;
      r.dragPreviewPointId = null; r.dragPreviewPoints = null;
      r.vertexDragPointId = null; r.vertexDragIndex = null; r.vertexDragBasePoints = null;
      r.vertexDragNormalRef = null; r.vertexDragPlaneCenter = null;
      if (!points || !pointId) { this.rebuildRepairMarkers(); return; }
      await this.saveRepairPointGeometry(pointId, points, closed);
      this.flash("Bentuk garis Point berhasil diubah.");
    },
    // ---- Simpan geometri baru (dipakai bareng oleh Geser, Ukuran, & Edit Titik) ----
    async saveRepairPointGeometry(pointId, points, closed) {
      const r = repairThreeState; if (!r) return;
      const THREE = r.THREE;
      const mid = points[Math.floor(points.length / 2)];
      const normals = points.map((p) => this.approxRepairNormal(r, new THREE.Vector3(p.x, p.y, p.z)));
      const avgNormal = this.averageRepairNormal(normals);
      const payload = { x: mid.x, y: mid.y, z: mid.z };
      // Point lama (bola tunggal, cuma 1 titik) sengaja TIDAK dikasih kolom
      // path -- biar tetap "bola merah" seperti semula, cuma posisinya yang
      // pindah (lihat cabang render di rebuildRepairMarkers).
      if (points.length > 1) payload.path = closed ? { points, closed: true } : points;
      if (avgNormal) { payload.nx = avgNormal.x; payload.ny = avgNormal.y; payload.nz = avgNormal.z; }
      const { data, error } = await supabaseClient.from("repair_points").update(payload).eq("id", pointId).select().single();
      if (error) { this.flash("Gagal update Point: " + error.message, true); this.rebuildRepairMarkers(); return; }
      this.repairPoints = this.repairPoints.map((p) => (p.id === data.id ? data : p));
      this.rebuildRepairMarkers();
    },
    // pathPoints: array {x,y,z} sederhana menyusuri jalur/bentuknya.
    // isClosed: true buat loop tertutup (lingkaran, kotak, atau garis bebas
    // yang balik nyambung ke titik awal) -- disimpan format {points, closed}
    // di kolom "path" (jsonb), beda dari format lama (array bare) yang
    // artinya garis TERBUKA (lihat normalizeRepairPath).
    async addRepairPointPath(pathPoints, avgNormal, isClosed) {
      if (!this.repairActiveViewId) return;
      if (!pathPoints || pathPoints.length < 2) return;
      const label = prompt("Label Point ini (boleh kosong):", "") || null;
      const mid = pathPoints[Math.floor(pathPoints.length / 2)];
      const payload = {
        view_id: this.repairActiveViewId,
        x: mid.x, y: mid.y, z: mid.z,
        label,
        path: isClosed ? { points: pathPoints, closed: true } : pathPoints,
      };
      if (avgNormal) { payload.nx = avgNormal.x; payload.ny = avgNormal.y; payload.nz = avgNormal.z; }
      const { data, error } = await supabaseClient.from("repair_points")
        .insert(payload)
        .select().single();
      if (error) { this.flash("Gagal tambah Point: " + error.message, true); return; }
      this.repairPoints.push(data);
      this.rebuildRepairMarkers();
      this.flash(isClosed ? "Point (garis tertutup) ditambahkan." : "Point (garis las) ditambahkan.");
    },

    logout,
  };
}

// =========================================================
// Indikator scroll horizontal custom untuk .table-wrap.
// Browser di HP (Chrome/Safari mobile) nyembunyiin scrollbar bawaan
// kecuali lagi disentuh, jadi orang nggak sadar tabel itu bisa digeser
// ke samping. Bar biru ini digambar manual & selalu keliatan kalau
// tabelnya memang lebih lebar dari layar.
// =========================================================
(function initTableScrollIndicators() {
  function ensureIndicator(wrap) {
    let ind = wrap._scrollIndicatorEl;
    if (ind) return ind;
    ind = document.createElement("div");
    ind.className = "table-scroll-indicator";
    const thumb = document.createElement("div");
    thumb.className = "table-scroll-indicator-thumb";
    ind.appendChild(thumb);
    wrap.insertAdjacentElement("afterend", ind);
    wrap._scrollIndicatorEl = ind;
    wrap.addEventListener("scroll", () => updateIndicator(wrap), { passive: true });

    // ---- Bar indikator bisa DITEKAN & DIGESER langsung (kayak scrollbar asli) ----
    let dragging = false, startX = 0, startScrollLeft = 0;
    const onDown = (e) => {
      dragging = true;
      startX = e.clientX;
      startScrollLeft = wrap.scrollLeft;
      ind.setPointerCapture && ind.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!dragging) return;
      const { scrollWidth, clientWidth } = wrap;
      const maxScroll = scrollWidth - clientWidth;
      const trackWidth = ind.clientWidth || 1;
      const deltaScroll = ((e.clientX - startX) / trackWidth) * scrollWidth;
      wrap.scrollLeft = Math.max(0, Math.min(maxScroll, startScrollLeft + deltaScroll));
    };
    const onUp = () => { dragging = false; };
    ind.addEventListener("pointerdown", onDown);
    ind.addEventListener("pointermove", onMove);
    ind.addEventListener("pointerup", onUp);
    ind.addEventListener("pointercancel", onUp);
    thumb.style.touchAction = "none";
    ind.style.touchAction = "none";
    ind.style.cursor = "grab";

    // ---- Tabel-nya sendiri juga bisa "tekan-tahan-geser" pakai mouse
    // (touch/jari di HP sudah otomatis bisa geser bawaan browser, ini
    // khusus buat mouse/trackpad di desktop / device emulator). ----
    let dragWrap = false, wrapStartX = 0, wrapStartScroll = 0;
    wrap.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse") return; // biarkan touch pakai swipe bawaan
      dragWrap = true;
      wrapStartX = e.clientX;
      wrapStartScroll = wrap.scrollLeft;
      wrap.style.cursor = "grabbing";
    });
    wrap.addEventListener("pointermove", (e) => {
      if (!dragWrap) return;
      wrap.scrollLeft = wrapStartScroll - (e.clientX - wrapStartX);
    });
    const stopWrapDrag = () => { dragWrap = false; wrap.style.cursor = ""; };
    wrap.addEventListener("pointerup", stopWrapDrag);
    wrap.addEventListener("pointerleave", stopWrapDrag);
    wrap.style.cursor = "grab";

    return ind;
  }
  function updateIndicator(wrap) {
    const ind = ensureIndicator(wrap);
    const thumb = ind.firstElementChild;
    const { scrollWidth, clientWidth, scrollLeft } = wrap;
    if (clientWidth === 0 || scrollWidth <= clientWidth + 2) {
      ind.style.display = "none";
      return;
    }
    ind.style.display = "block";
    const thumbPct = Math.max((clientWidth / scrollWidth) * 100, 8);
    const maxScroll = scrollWidth - clientWidth;
    const scrollPct = maxScroll > 0 ? scrollLeft / maxScroll : 0;
    thumb.style.width = thumbPct + "%";
    thumb.style.marginLeft = scrollPct * (100 - thumbPct) + "%";
  }
  function scanAll() {
    document.querySelectorAll(".table-wrap").forEach(updateIndicator);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scanAll);
  } else {
    scanAll();
  }
  // Tabel yang sedang tersembunyi (tab lain / data belum dimuat) punya
  // clientWidth 0 saat pertama dicek, jadi kita cek ulang berkala biar
  // begitu kelihatan / datanya berubah, indikatornya otomatis muncul.
  setInterval(scanAll, 500);
  window.addEventListener("resize", scanAll);
})();
