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

// =========================================================
// Komponen utama
// =========================================================
function machinePage(machineKey, machineLabel, extraFields, routingMax, kategoriOptions, stationConfig) {
  // State viewer 3D (Three.js) disimpan di variabel closure biasa (BUKAN
  // properti reactive Alpine) karena objek internal Three.js (matrix,
  // buffer, dsb) punya property non-configurable yang bentrok kalau
  // dibungkus Proxy reaktif Alpine -> error "read-only ... proxy".
  let repairThreeState = null;
  return {
    session: null, profile: null, tab: "produksi", loading: true,
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

    lines: {}, // per stasiun: state machine produksi
    productionRows: [], downtimeRows: [], nonProduksiRows: [], planningRows: [],
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
    ngForm: { tanggal: localDateStr(new Date()), type_ng: "", pic: "", model: "", part_number: "", area_id: "", area: "", ng_proses: "", qty: "", ng_kategori: "", reason: "" },
    ngFotoFile: null, ngFotoPreviewUrl: "", ngSaving: false,
    editingNgId: null, ngExistingFotoUrl: "",

    editingDowntimeId: null, dtForm: {},
    editingNonProduksiId: null, nonProduksiEditForm: {},
    riwayatFilter: { dari: "", sampai: "", part_number: "" },
    downtimeFilterProductionId: null, downtimeFilterLabel: "",

    // ---- Repair (klik titik di gambar part -> popup Qty + Kategori) ----
    repairViews: [], repairActiveViewId: null, repairPoints: [],
    repairKategoriOptions: [], newRepairKategoriValue: "",
    repairPartNoList: [],
    repairLogRows: [],
    repairForm: { tanggal: localDateStr(new Date()), part_number: "", qty: "", kategori_repair: "" },
    repairModalOpen: false, repairModalPoint: null, repairSaving: false,
    editingRepairId: null,
    // Mode admin buat naruh titik baru di Master Data
    repairEditMode: false, repairNewViewLabel: "", repairNewViewFile: null, repairViewUploading: false,
    repairNewViewColor: "#9aa4ad",
    // State viewer 3D (Three.js) -- diisi runtime, bukan reactive data biasa
    repairModelLoading: false,

    // ---- Performance dashboard (3 seksi independen) ----
    perf: {
      tahunan: { anchor: localDateStr(new Date()), loading: false, data: null, trend: [], chart: null, pieChart: null, top5: [], byCategory: [] },
      bulanan: { anchor: localDateStr(new Date()), loading: false, data: null, trend: [], chart: null, pieChart: null, top5: [], byCategory: [] },
      harian: { anchor: localDateStr(new Date()), loading: false, data: null, trend: [], chart: null, pieChart: null, top5: [], byCategory: [] },
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

      try {
        const { data: profile, error: pErr } = await supabaseClient.from("profiles").select("*").eq("id", this.session.user.id).maybeSingle();
        if (pErr) throw pErr;
        this.profile = profile;

        this.ensureLines();
        await Promise.all([
          this.fetchProduction(), this.fetchDowntime(), this.fetchNonProduksi(),
          this.fetchPlanning(), this.fetchPartNumbers(), this.fetchProblems(), this.fetchCauses(), this.fetchAreas(), this.fetchNonProduksiTypes(),
          this.fetchNgModelsForLine(), this.fetchNgInline(),
          this.fetchRepairViews(), this.fetchRepairKategori(), this.fetchRepairLog(), this.fetchRepairPartNoOptions(),
        ]);
        this.restoreLocalState();
        this.watchAndAutosave();
        this.refreshPendingCount();
        await this.fetchMesinSettings();
        this.fetchAllPerf();
        this.$watch("tandemVariant", () => this.fetchAllPerf());
        await this.syncNow();
      } catch (err) {
        this.flash("Gagal memuat halaman: " + (err.message || err), true);
      } finally {
        this.loading = false;
      }
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
        form: { part_number: "", qty: "", manpower: "" },
        gapInfo: null, // {gapStart, gapEnd}
        gapForm: { nonproduksi_nama: "" },
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
      line.state = "idle";
    },
    async confirmGapNonProduksi(stationId) {
      const line = this.lines[stationId];
      const nama = line.gapForm.nonproduksi_nama;
      if (!nama) { this.flash("Pilih jenis non-produksi dulu.", true); return; }
      const payload = {
        mesin: machineKey, stasiun: this.dbStasiun(stationId),
        waktu_awal: line.gapInfo.gapStart, waktu_akhir: line.gapInfo.gapEnd,
        kategori: "OTHER", part_dari: null, part_ke: nama, keterangan: nama,
      };
      await this.saveNonProduksiRow(payload);
      line.gapInfo = null; line.gapForm.nonproduksi_nama = "";
      this.openPartSelection(stationId, payload.waktu_akhir);
    },

    openPartSelection(stationId, startIso) {
      const line = this.lines[stationId];
      line.entryStart = startIso; line.entryEnd = null;
      line.form = { part_number: "", qty: "", manpower: "" };
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
      await this.commitProductionRow(stationId);
      const line = this.lines[stationId];
      line.afterFinishChoice = false;
      this.openPartSelection(stationId, line.entryEnd || new Date().toISOString());
    },
    async chooseNonProduksiNext(stationId) {
      await this.commitProductionRow(stationId);
      const line = this.lines[stationId];
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
        dandori_menit: dandoriMenit, downtime_menit: 0, break_menit: breakMenit,
        ng: null, kategori_ng: null, extra: JSON.stringify(extra),
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
      this.productionRows = data;
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
        .select("id, stasiun, waktu_awal, waktu_akhir, part_number, qty, dandori_menit, downtime_menit, break_menit")
        .eq("mesin", machineKey)
        .gte("waktu_awal", start.toISOString())
        .lt("waktu_awal", end.toISOString());
      if (stasiunList) q = q.in("stasiun", stasiunList);
      const { data, error } = await q.order("waktu_awal", { ascending: true });
      if (error) { this.perfDayRows = []; return; }
      this.perfDayRows = (data || []).sort((a, b) => {
        const s = String(a.stasiun || "").localeCompare(String(b.stasiun || ""));
        if (s !== 0) return s;
        return new Date(a.waktu_awal) - new Date(b.waktu_awal);
      });
    },
    setActivePerfSection(section) {
      this.activePerfSection = section;
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
      this.fetchAllPerf();
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
        }), { stroke: 0, ng: 0, ngValue: 0, dandoriMenit: 0, downtimeMenit: 0, breakMenit: 0, whJam: 0 });
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
      if (section === "harian") this.fetchPerfDayRows();
      this.$nextTick(() => { this.renderPerfChart(section); this.renderPerfPie(section); });
    },
    fetchAllPerf() {
      Object.keys(this.PERF_CONFIG).forEach((s) => this.fetchPerfSection(s));
    },
    openPerformanceTab() {
      this.tab = "performance";
      this.$nextTick(() => { this.renderPerfChart(this.activePerfSection); this.renderPerfPie(this.activePerfSection); });
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
    earnedMenit(row) {
      if (row._tipe !== "produksi" || !row.qty) return null;
      const ct = this.stdCtFor(row.part_number);
      return ct ? row.qty * ct : null;
    },
    operationMenit(row) {
      const d = (new Date(row.waktu_akhir) - new Date(row.waktu_awal)) / 60000;
      return d >= 0 ? d : null;
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
        ng: row.ng ?? "",
        dandori_menit: row.dandori_menit ?? "", break_menit: row.break_menit ?? "",
      };
      this.extraFields.forEach((f) => (line.editForm[f.key] = row.extra?.[f.key] ?? ""));
      line.routingType = row.extra?.routing_type || null;
      line.routingNumbers = row.extra?.routing_numbers || [];
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
        dandori_menit: f.dandori_menit === "" ? null : Number(f.dandori_menit),
        break_menit: f.break_menit === "" ? null : Number(f.break_menit),
        extra: JSON.stringify(extra),
      };
      const { error } = await supabaseClient.from("production_log").update(payload).eq("id", line.editingId);
      if (error) { this.flash("Gagal simpan (butuh koneksi): " + error.message, true); return; }
      this.flash("Data produksi diperbarui.");
      this.lines[stationId] = this.freshLine();
      await this.fetchProduction();
    },
    async deleteProduction(id) {
      if (String(id).startsWith("pending_")) { this.flash("Masih menunggu sinkron.", true); return; }
      if (!confirm("Hapus baris produksi ini?")) return;
      const { error } = await supabaseClient.from("production_log").delete().eq("id", id);
      if (error) { this.flash("Gagal menghapus: " + error.message, true); return; }
      this.flash("Data produksi dihapus.");
      await this.fetchProduction();
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
        this.flash("Data downtime diperbarui.");
      } else {
        payload.created_by = this.session.user.id;
        const { error } = await supabaseClient.from("downtime_log").insert(payload);
        if (error) {
          this.flash("Gagal menyimpan downtime: " + error.message, true);
          return;
        }
        this.flash("Data downtime tersimpan.");
      }
      this.cancelDowntime();
      await Promise.all([this.fetchDowntime(), this.fetchProduction()]);
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
    async deleteDowntime(id) {
      if (!confirm("Hapus data downtime ini?")) return;
      const { error } = await supabaseClient.from("downtime_log").delete().eq("id", id);
      if (error) { this.flash("Gagal menghapus: " + error.message, true); return; }
      this.flash("Data downtime dihapus.");
      await Promise.all([this.fetchDowntime(), this.fetchProduction()]);
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
      const { data, error } = await supabaseClient.from("part_numbers").select("id, value, next_processes, std_mp, std_ct, harga_pcs, alias_values").eq("mesin", machineKey).order("value");
      if (error) { this.flash("Gagal memuat Part Number: " + error.message, true); return; }
      this.partNumberList = data.map((r) => ({
        ...r, editing: false, draft: r.value,
        draftStdMp: r.std_mp ?? "", draftStdCt: r.std_ct ?? "", draftHargaPcs: r.harga_pcs ?? "",
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
        alias_values: aliasClean,
      };
      const { data, error } = await supabaseClient.from("part_numbers").update(payload).eq("id", item.id).select();
      if (error) { this.flash("Gagal simpan: " + error.message, true); return; }
      if (!data || data.length === 0) { this.flash("Gagal simpan — cek izin akses.", true); return; }
      item.value = v; item.next_processes = clean;
      item.std_mp = payload.std_mp; item.std_ct = payload.std_ct; item.harga_pcs = payload.harga_pcs;
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
    async onModelChangeNg() {
      // reset field turunan tiap kali Model diganti
      this.ngForm.part_number = ""; this.ngForm.area_id = ""; this.ngForm.area = ""; this.ngForm.ng_proses = "";
      this.ngPartNoList = []; this.ngAreaOptions = [];
      if (!this.ngForm.model) return;

      const [partRes, areaRes] = await Promise.all([
        supabaseClient.from("ng_model_parts").select("id, part_no").eq("model", this.ngForm.model).order("part_no"),
        supabaseClient.from("ng_model_areas").select("id, area, ng_proses").eq("mesin", machineKey).eq("model", this.ngForm.model).order("area"),
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
    },
    onNgFotoSelected(evt) {
      const file = evt.target.files && evt.target.files[0];
      if (!file) { this.ngFotoFile = null; this.ngFotoPreviewUrl = ""; return; }
      this.ngFotoFile = file;
      if (this.ngFotoPreviewUrl) URL.revokeObjectURL(this.ngFotoPreviewUrl);
      this.ngFotoPreviewUrl = URL.createObjectURL(file);
    },
    resetNgForm() {
      this.ngForm = { tanggal: localDateStr(new Date()), type_ng: "", pic: "", model: "", part_number: "", area_id: "", area: "", ng_proses: "", qty: "", ng_kategori: "", reason: "" };
      this.ngPartNoList = []; this.ngAreaOptions = [];
      if (this.ngFotoPreviewUrl) URL.revokeObjectURL(this.ngFotoPreviewUrl);
      this.ngFotoFile = null; this.ngFotoPreviewUrl = ""; this.ngExistingFotoUrl = "";
      this.editingNgId = null;
      if (this.$refs.ngFotoInput) this.$refs.ngFotoInput.value = "";
    },
    async editNgInline(row) {
      this.editingNgId = row.id;
      this.ngForm = {
        tanggal: row.tanggal, type_ng: row.type_ng, pic: row.pic, model: row.model,
        part_number: row.part_number, area_id: "", area: row.area, ng_proses: row.ng_proses,
        qty: row.qty, ng_kategori: row.ng_kategori, reason: row.reason,
      };
      if (this.ngFotoPreviewUrl) URL.revokeObjectURL(this.ngFotoPreviewUrl);
      this.ngFotoFile = null; this.ngFotoPreviewUrl = "";
      this.ngExistingFotoUrl = row.foto_url;
      if (this.$refs.ngFotoInput) this.$refs.ngFotoInput.value = "";

      // muat ulang daftar Part No & Area buat model ini, lalu cocokkan
      // area_id yang sesuai (biar dropdown Area kepilih otomatis).
      const [partRes, areaRes] = await Promise.all([
        supabaseClient.from("ng_model_parts").select("id, part_no").eq("model", row.model).order("part_no"),
        supabaseClient.from("ng_model_areas").select("id, area, ng_proses").eq("mesin", machineKey).eq("model", row.model).order("area"),
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
      if (!f.tanggal || !f.type_ng || !f.pic || !f.model || !f.part_number || !f.area_id || !f.ng_proses || !f.qty || !f.ng_kategori || !(f.reason || "").trim() || !hasFoto) {
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
          mesin: machineKey, tanggal: f.tanggal, type_ng: f.type_ng, model: f.model, pic: f.pic,
          part_number: f.part_number, area: f.area, ng_proses: f.ng_proses,
          qty: Number(f.qty), ng_kategori: f.ng_kategori, reason: f.reason.trim(),
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
    },
    async deleteNgInline(id) {
      if (!confirm("Hapus data NG Inline ini?")) return;
      const { error } = await supabaseClient.from("ng_inline_log").delete().eq("id", id);
      if (error) { this.flash("Gagal hapus: " + error.message, true); return; }
      this.ngInlineRows = this.ngInlineRows.filter((r) => r.id !== id);
      if (this.editingNgId === id) this.resetNgForm();
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
    async fetchRepairKategori() {
      const { data, error } = await supabaseClient.from("repair_kategori").select("*").order("value");
      if (error) { this.flash("Gagal memuat Kategori Repair: " + error.message, true); return; }
      this.repairKategoriOptions = data || [];
    },
    async fetchRepairPartNoOptions() {
      // Part No di popup Repair diambil dari master NG Inline (Line -> Model -> Part No),
      // digabung SEMUA part_no dari SEMUA model yang terdaftar di line ini (bukan per-model).
      const { data: models, error: modelErr } = await supabaseClient.from("ng_line_models").select("model").eq("mesin", machineKey);
      if (modelErr) { this.flash("Gagal memuat Model NG Inline: " + modelErr.message, true); return; }
      const modelNames = (models || []).map((m) => m.model);
      if (modelNames.length === 0) { this.repairPartNoList = []; return; }
      const { data: parts, error: partErr } = await supabaseClient.from("ng_model_parts").select("part_no").in("model", modelNames);
      if (partErr) { this.flash("Gagal memuat Part No NG Inline: " + partErr.message, true); return; }
      const uniquePartNo = [...new Set((parts || []).map((p) => p.part_no))].sort((a, b) => a.localeCompare(b));
      this.repairPartNoList = uniquePartNo;
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
      this.repairForm = { tanggal: localDateStr(new Date()), part_number: "", qty: "", kategori_repair: "" };
      this.repairModalOpen = true;
    },
    editRepairLog(row) {
      const point = this.repairPoints.find((p) => p.id === row.point_id) || { id: row.point_id, label: row.point_label };
      this.editingRepairId = row.id;
      this.repairModalPoint = point;
      this.repairForm = { tanggal: row.tanggal, part_number: row.part_number || "", qty: row.qty, kategori_repair: row.kategori_repair };
      this.repairModalOpen = true;
    },
    closeRepairModal() {
      this.repairModalOpen = false; this.repairModalPoint = null; this.editingRepairId = null;
    },
    async submitRepairPoint() {
      const f = this.repairForm;
      if (!f.tanggal || !f.part_number || !f.qty || Number(f.qty) <= 0 || !f.kategori_repair) {
        this.flash("Tanggal, Part No, Qty, dan Kategori Repair wajib diisi.", true); return;
      }
      this.repairSaving = true;
      const payload = {
        mesin: machineKey, tanggal: f.tanggal,
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
    },
    async deleteRepairPoint(id) {
      if (!confirm("Hapus Point ini?")) return;
      const { error } = await supabaseClient.from("repair_points").delete().eq("id", id);
      if (error) { this.flash("Gagal hapus Point: " + error.message, true); return; }
      this.repairPoints = this.repairPoints.filter((p) => p.id !== id);
      this.rebuildRepairMarkers();
    },
    onRepairNewViewFileChange(ev) {
      this.repairNewViewFile = ev.target.files[0] || null;
    },
    async addRepairView() {
      const label = (this.repairNewViewLabel || "").trim();
      if (!label || !this.repairNewViewFile) { this.flash("Nama Part dan file .stl wajib diisi.", true); return; }
      const ext = (this.repairNewViewFile.name.split(".").pop() || "").toLowerCase();
      if (ext !== "stl") { this.flash("File model harus format .stl", true); return; }
      this.repairViewUploading = true;
      try {
        const file = this.repairNewViewFile;
        const path = `models/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.stl`;
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
      if (repairThreeState && repairThreeState.currentViewId === view.id && repairThreeState.mesh) {
        repairThreeState.mesh.material.vertexColors = false;
        repairThreeState.mesh.material.color.set(color);
        repairThreeState.mesh.material.needsUpdate = true;
      }
    },
    async deleteRepairView(id) {
      if (!confirm("Hapus model 3D ini beserta semua point-nya?")) return;
      const { error } = await supabaseClient.from("repair_views").delete().eq("id", id);
      if (error) { this.flash("Gagal hapus: " + error.message, true); return; }
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
        const [THREE, loaderMod, controlsMod] = await Promise.all([
          import("https://esm.sh/three@0.160.0"),
          import("https://esm.sh/three@0.160.0/examples/jsm/loaders/STLLoader.js"),
          // TrackballControls dipakai (bukan OrbitControls) SUPAYA rotasi
          // bener-bener bebas tanpa sumbu atas-bawah tetap -- OrbitControls
          // punya "kutub" (atas/bawah) yang bikin putaran vertikal mentok
          // dan harus balik arah. TrackballControls tidak punya batasan itu:
          // muter dari titik A, keliling terus ke segala arah, balik lagi
          // ke A tanpa pernah kejeduk.
          import("https://esm.sh/three@0.160.0/examples/jsm/controls/TrackballControls.js"),
        ]);
        window.__threeLib = { THREE, STLLoader: loaderMod.STLLoader, TrackballControls: controlsMod.TrackballControls };
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
      this.repairModelLoading = true;
      try {
        const { THREE, STLLoader, TrackballControls } = await this.ensureThreeLib();
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

        const loader = new STLLoader();
        const geometry = await loader.loadAsync(view.model_url);
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        const bbox = geometry.boundingBox;
        const center = new THREE.Vector3(); bbox.getCenter(center);
        const size = new THREE.Vector3(); bbox.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z) || 1;

        const hasVertexColors = !!(geometry.attributes && geometry.attributes.color);
        const material = new THREE.MeshStandardMaterial(
          hasVertexColors
            ? { vertexColors: true, metalness: 0.2, roughness: 0.6 }
            : { color: view.color || "#9aa4ad", metalness: 0.2, roughness: 0.6 }
        );
        const mesh = new THREE.Mesh(geometry, material);
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
          this.updateRepairMarkersUpright();
          r.renderer.render(r.scene, r.camera);
        }
        r.animId = requestAnimationFrame(tick);
      };
      tick();
    },
    // TrackballControls ngebiarin kamera BEBAS puter termasuk "roll" (miring
    // kayak pesawat oleng) -- beda dari OrbitControls yang ngunci sumbu atas.
    // Sprite marker ikut miring sesuai roll kamera ini, jadi keliatan
    // "tiduran". Fungsi ini itung sudut roll kamera tiap frame & putar balik
    // texture marker-nya, biar garis+lingkaran-nya SELALU tegak di layar.
    updateRepairMarkersUpright() {
      const r = repairThreeState; if (!r || !r.markers || r.markers.length === 0) return;
      const THREE = r.THREE;
      const forward = new THREE.Vector3(), up = new THREE.Vector3(), right = new THREE.Vector3();
      r.camera.matrixWorld.extractBasis(right, up, forward);
      const worldUp = new THREE.Vector3(0, 1, 0);
      const projUp = worldUp.clone().sub(forward.clone().multiplyScalar(worldUp.dot(forward)));
      if (projUp.lengthSq() < 1e-6) projUp.copy(up); else projUp.normalize();
      const roll = Math.atan2(right.dot(projUp), up.dot(projUp));
      r.markers.forEach((m) => { m.material.rotation = roll; });
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
      (r.markers || []).forEach((m) => { m.material.map && m.material.map.dispose(); m.material.dispose(); });
      if (r.mesh) { r.mesh.geometry.dispose(); r.mesh.material.dispose(); }
      if (r.renderer) { r.renderer.dispose(); r.renderer.domElement.remove(); }
      repairThreeState = null;
    },
    makeRepairMarkerSprite(THREE, label) {
      // Gaya penandaan defect ala QC: titik merah kecil PERSIS di titik
      // Repair-nya, disambung garis tipis ke lingkaran label (dikasih
      // gradasi + bayangan biar kelihatan 3D/bulat, bukan flat), biar
      // nomor/huruf point-nya kebaca jelas tanpa nutupin permukaan model.
      const W = 150, H = 150;
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d");

      const dotX = W * 0.17, dotY = H * 0.75, dotR = 6;
      const circleX = W * 0.7, circleY = H * 0.24, circleR = 22;

      // garis penghubung
      ctx.strokeStyle = "#dc2626"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(dotX, dotY); ctx.lineTo(circleX, circleY); ctx.stroke();

      // titik kecil persis di lokasi
      ctx.beginPath(); ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
      ctx.fillStyle = "#dc2626"; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = "#ffffff"; ctx.stroke();

      // lingkaran label -- bayangan dulu biar kesan "ngambang" 3D
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.4)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
      ctx.beginPath(); ctx.arc(circleX, circleY, circleR, 0, Math.PI * 2);
      ctx.fillStyle = "#7f1d1d"; ctx.fill();
      ctx.restore();

      // gradasi radial (highlight di kiri-atas, gelap di tepi) biar
      // kelihatan kayak bola, bukan lingkaran flat
      const grad = ctx.createRadialGradient(
        circleX - circleR * 0.35, circleY - circleR * 0.4, circleR * 0.1,
        circleX, circleY, circleR * 1.1
      );
      grad.addColorStop(0, "#f87171");
      grad.addColorStop(0.55, "#dc2626");
      grad.addColorStop(1, "#8f1f1f");
      ctx.beginPath(); ctx.arc(circleX, circleY, circleR, 0, Math.PI * 2);
      ctx.fillStyle = grad; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = "#ffffff"; ctx.stroke();

      // kilau kecil putih transparan, nambah kesan glossy/3D
      ctx.beginPath();
      ctx.ellipse(circleX - circleR * 0.35, circleY - circleR * 0.45, circleR * 0.45, circleR * 0.28, -0.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.fill();

      if (label) {
        ctx.fillStyle = "#ffffff"; ctx.font = "bold 20px sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = 3;
        ctx.fillText(label.slice(0, 2), circleX, circleY + 1);
        ctx.shadowColor = "transparent";
      }

      const texture = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: texture, depthTest: true, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      // Anchor PERSIS di titik merah kecil (bukan di tengah sprite), biar
      // titik itu yang nempel ke posisi Point sebenarnya di model.
      sprite.center.set(dotX / W, 1 - dotY / H);
      sprite.userData.aspect = H / W;
      sprite.renderOrder = 999;
      return sprite;
    },
    rebuildRepairMarkers() {
      const r = repairThreeState; if (!r) return;
      const THREE = r.THREE;
      (r.markers || []).forEach((m) => { r.mesh.remove(m); m.material.map && m.material.map.dispose(); m.material.dispose(); });
      r.markers = [];
      const bbox = new THREE.Box3().setFromObject(r.mesh);
      const size = new THREE.Vector3(); bbox.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const spriteScale = maxDim * 0.11; // dibesarin lagi, sebelumnya kekecilan
      // dorong marker sedikit keluar dari permukaan (searah normal) biar
      // tidak "z-fighting" (kedip) pas persis nempel permukaan, tapi tetap
      // ketutup badan model kalau posisinya lagi di sisi yang membelakangi kamera.
      const offsetDist = maxDim * 0.01;
      // titik tengah bbox dalam koordinat LOKAL (sama ruang dgn titik point) --
      // dipakai sebagai cadangan arah normal buat Point lama yang belum
      // punya nx/ny/nz tersimpan.
      const centerWorld = new THREE.Vector3(); bbox.getCenter(centerWorld);
      const centerLocal = r.mesh.worldToLocal(centerWorld.clone());

      this.repairPoints.forEach((pt) => {
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
    },
    attachRepair3DEvents(container) {
      let downX = 0, downY = 0, downTime = 0;
      const onDown = (ev) => { downX = ev.clientX; downY = ev.clientY; downTime = Date.now(); };
      const onUp = (ev) => {
        const dx = ev.clientX - downX, dy = ev.clientY - downY;
        const moved = Math.sqrt(dx * dx + dy * dy);
        // Gerakan kecil & cepat = klik beneran. Gerakan besar/lama = drag putar model, abaikan.
        if (moved > 6 || Date.now() - downTime > 600) return;
        this.handleRepair3DClick(ev, container);
      };
      container.addEventListener("pointerdown", onDown);
      container.addEventListener("pointerup", onUp);
    },
    handleRepair3DClick(ev, container) {
      const r = repairThreeState; if (!r) return;
      const rect = container.getBoundingClientRect();
      r.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      r.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      r.raycaster.setFromCamera(r.pointer, r.camera);

      // Raycast gabungan (model + semua marker) lalu ambil yang PALING DEKAT
      // ke kamera -- ini otomatis bikin Point yang ketutup badan model (lagi
      // di sisi belakang) tidak ke-klik, sama seperti secara visual tertutup.
      const hits = r.raycaster.intersectObjects([r.mesh, ...r.markers], false);
      if (hits.length === 0) return;
      const closest = hits[0];

      if (closest.object.userData && closest.object.userData.pointId) {
        const point = this.repairPoints.find((p) => p.id === closest.object.userData.pointId);
        if (!point) return;
        if (this.repairEditMode) this.deleteRepairPoint(point.id);
        else this.openRepairPoint(point);
        return;
      }
      // Kena permukaan model -> tambah Point baru (cuma di Mode Edit)
      if (!this.repairEditMode) return;
      const localPoint = r.mesh.worldToLocal(closest.point.clone());
      const normal = closest.face ? closest.face.normal.clone() : null;
      this.addRepairPoint3D(localPoint, normal);
    },
    async addRepairPoint3D(localPoint, normal) {
      if (!this.repairActiveViewId) return;
      const label = prompt("Label Point ini (boleh kosong):", "") || null;
      const payload = { view_id: this.repairActiveViewId, x: localPoint.x, y: localPoint.y, z: localPoint.z, label };
      if (normal) { payload.nx = normal.x; payload.ny = normal.y; payload.nz = normal.z; }
      const { data, error } = await supabaseClient.from("repair_points")
        .insert(payload)
        .select().single();
      if (error) { this.flash("Gagal tambah Point: " + error.message, true); return; }
      this.repairPoints.push(data);
      this.rebuildRepairMarkers();
      this.flash("Point ditambahkan.");
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
