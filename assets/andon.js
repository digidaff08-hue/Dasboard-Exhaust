// =====================================================================
// ANDON -- panggil supporting (tahap 1)
// Dipakai oleh:
//   * halaman mesin (machines/e-xx.html) -> andonWidget("E-03")
//       tombol merah "Panggil Supporting" + status panggilan mesin itu
//   * andon.html -> andonBoard()
//       papan panggilan untuk HP supporting / TV di area produksi
// Butuh: supabaseClient (assets/supabaseClient.js) & tabel andon_call
// (migration_andon.sql).
// =====================================================================

// Tim yang bisa dipanggil -- sama dengan pilihan PIC di form Downtime.
const ANDON_TIM = [
  { kode: "MESIN",   label: "Mesin / Maintenance", warna: "#2563eb" },
  { kode: "DIES",    label: "Dies / Jig",          warna: "#dc2626" },
  { kode: "PE",      label: "PE",                  warna: "#7c3aed" },
  { kode: "QC",      label: "QC",                  warna: "#059669" },
  { kode: "PROD",    label: "Produksi (Leader)",   warna: "#ea580c" },
  { kode: "PC-SUPP", label: "PC / Supply Part",    warna: "#0891b2" },
  { kode: "PRESS",   label: "Press",               warna: "#be185d" },
];

function andonTimInfo(kode) {
  return ANDON_TIM.find((t) => t.kode === kode) || { kode, label: kode, warna: "#475569" };
}

// "3:07" / "1:02:15" dari selisih milidetik
function andonDurasi(ms) {
  if (ms == null || isNaN(ms)) return "-";
  if (ms < 0) ms = 0;   // jam HP sedikit beda dengan jam server
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), d = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? h + ":" + pad(m) + ":" + pad(d) : m + ":" + pad(d);
}
function andonMenit(ms) {
  if (ms == null || isNaN(ms) || ms < 0) return null;
  return Math.round(ms / 6000) / 10; // 1 angka di belakang koma
}
function andonJam(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}
// Awal hari ini (jam 00:00 waktu HP) dalam ISO -- untuk filter "hari ini"
function andonAwalHariIni() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// ---------- Bunyi (tanpa file audio, dibuat dengan Web Audio) ----------
// Browser baru mengizinkan bunyi setelah user menekan sesuatu di halaman,
// jadi AudioContext dibuat saat tombol "Aktifkan bunyi" ditekan.
const AndonSuara = {
  ctx: null,
  aktifkan() {
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === "suspended") this.ctx.resume();
      return true;
    } catch (e) { return false; }
  },
  get siap() { return !!this.ctx && this.ctx.state === "running"; },
  // pola "ti-tu ti-tu" 2x
  bunyi() {
    if (!this.siap) return;
    const c = this.ctx, t0 = c.currentTime;
    [0, 0.28, 0.7, 0.98].forEach((dt, i) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = "square";
      o.frequency.value = i % 2 === 0 ? 880 : 660;
      g.gain.setValueAtTime(0.0001, t0 + dt);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.24);
      o.connect(g); g.connect(c.destination);
      o.start(t0 + dt); o.stop(t0 + dt + 0.26);
    });
    if (navigator.vibrate) { try { navigator.vibrate([300, 150, 300]); } catch (e) {} }
  },
};

async function andonAksi(id, aksi, catatan) {
  const { data, error } = await supabaseClient.rpc("andon_aksi", {
    p_id: id, p_aksi: aksi, p_catatan: catatan || null,
  });
  if (error) return { ok: false, pesan: error.message };
  return data || { ok: false, pesan: "Tidak ada respon dari server." };
}

async function andonProfilSaya() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return { session: null, profile: null };
  const { data } = await supabaseClient.from("profiles")
    .select("id,full_name,role,jabatan").eq("id", session.user.id).maybeSingle();
  return { session, profile: data || null };
}


// =====================================================================
// 1) WIDGET DI HALAMAN MESIN
// =====================================================================
function andonWidget(mesin) {
  return {
    mesin,
    TIM: ANDON_TIM,
    calls: [],            // panggilan aktif mesin ini (memanggil / ditangani)
    modalOpen: false,
    form: { tim: "", keterangan: "" },
    sending: false,
    pesan: "", pesanError: false,
    now: Date.now(),
    myId: null, myRole: "",
    channel: null,

    get bolehPanggil() { return !!this.myId && !["guest", "viewer"].includes(this.myRole); },
    get adaMemanggil() { return this.calls.some((c) => c.status === "memanggil"); },
    timSedangAktif(kode) { return this.calls.some((c) => c.tim === kode); },

    async init() {
      const { session, profile } = await andonProfilSaya();
      this.myId = session?.user?.id || null;
      this.myRole = (profile?.role || "").toLowerCase();
      await this.muat();
      this.channel = supabaseClient
        .channel("andon_" + this.mesin)
        .on("postgres_changes",
            { event: "*", schema: "public", table: "andon_call", filter: "mesin=eq." + this.mesin },
            () => this.muat())
        .subscribe();
      setInterval(() => { this.now = Date.now(); }, 1000);
      // cadangan kalau realtime putus
      setInterval(() => this.muat(), 30000);
    },

    async muat() {
      const { data, error } = await supabaseClient.from("andon_call")
        .select("*").eq("mesin", this.mesin)
        .in("status", ["memanggil", "ditangani"])
        .order("dipanggil_at", { ascending: true });
      if (!error) this.calls = data || [];
    },

    bukaModal() {
      this.form = { tim: "", keterangan: "" };
      this.pesan = "";
      this.modalOpen = true;
    },

    async panggil() {
      if (!this.form.tim) { this.flash("Pilih dulu tim yang dipanggil.", true); return; }
      if (this.timSedangAktif(this.form.tim)) { this.flash("Tim " + this.form.tim + " sudah dipanggil dan belum selesai.", true); return; }
      this.sending = true;
      const { error } = await supabaseClient.from("andon_call").insert({
        mesin: this.mesin, tim: this.form.tim, keterangan: this.form.keterangan || null,
      });
      this.sending = false;
      if (error) {
        const dobel = String(error.message || "").includes("andon_call_aktif_uq");
        this.flash(dobel ? "Tim " + this.form.tim + " sudah dipanggil dan belum selesai." : "Gagal memanggil: " + error.message, true);
        return;
      }
      this.modalOpen = false;
      this.flash("Panggilan ke " + this.form.tim + " terkirim. Tunggu sampai ada yang merespons.");
      await this.muat();
    },

    async aksi(c, jenis) {
      if (jenis === "batal" && !confirm("Batalkan panggilan ke " + c.tim + "?")) return;
      let catatan = null;
      if (jenis === "selesai") {
        catatan = prompt("Masalah sudah beres? Catatan singkat perbaikan (boleh kosong):", "");
        if (catatan === null) return;
      }
      const r = await andonAksi(c.id, jenis, catatan);
      if (!r.ok) this.flash(r.pesan || "Gagal.", true);
      await this.muat();
    },

    lama(c) { return andonDurasi(this.now - new Date(c.dipanggil_at).getTime()); },
    lamaDitangani(c) { return c.ditangani_at ? andonDurasi(this.now - new Date(c.ditangani_at).getTime()) : "-"; },
    info(kode) { return andonTimInfo(kode); },
    jam: andonJam,

    flash(t, err) {
      this.pesan = t; this.pesanError = !!err;
      clearTimeout(this._ft);
      this._ft = setTimeout(() => { this.pesan = ""; }, 5000);
    },
  };
}


// =====================================================================
// 2) PAPAN ANDON (andon.html) -- HP supporting / TV
// =====================================================================
function andonBoard() {
  return {
    TIM: ANDON_TIM,
    session: null, profile: null,
    aktif: [],             // memanggil + ditangani (semua mesin)
    riwayat: [],           // selesai / batal hari ini
    filterTim: [],         // kosong = semua tim
    suaraAktif: false,
    notifIzin: (typeof Notification !== "undefined") ? Notification.permission : "unsupported",
    now: Date.now(),
    loading: true,
    pesan: "", pesanError: false,
    sidebarCollapsed: true, mobileNavOpen: false,
    _sudahDilihat: new Set(),
    _pertamaMuat: true,

    async init() {
      const session = await requireAuth();
      if (!session) return;
      this.session = session;
      const { profile } = await andonProfilSaya();
      this.profile = profile;
      try {
        const f = JSON.parse(localStorage.getItem("andonFilterTim") || "[]");
        if (Array.isArray(f)) this.filterTim = f.filter((k) => ANDON_TIM.some((t) => t.kode === k));
      } catch (e) {}
      await this.muat();
      this.loading = false;
      supabaseClient.channel("andon_board")
        .on("postgres_changes", { event: "*", schema: "public", table: "andon_call" }, () => this.muat())
        .subscribe();
      setInterval(() => { this.now = Date.now(); }, 1000);
      setInterval(() => this.muat(), 30000);
      // Selama masih ada panggilan yang belum direspons, bunyi diulang tiap 15 detik
      setInterval(() => { if (this.suaraAktif && this.aktifTampil.some((c) => c.status === "memanggil")) AndonSuara.bunyi(); }, 15000);
    },

    async muat() {
      const [a, r] = await Promise.all([
        supabaseClient.from("andon_call").select("*")
          .in("status", ["memanggil", "ditangani"]).order("dipanggil_at", { ascending: true }),
        supabaseClient.from("andon_call").select("*")
          .gte("dipanggil_at", andonAwalHariIni())
          .in("status", ["selesai", "batal"]).order("dipanggil_at", { ascending: false }).limit(300),
      ]);
      if (a.error) { this.flash("Gagal memuat: " + a.error.message, true); return; }
      this.aktif = a.data || [];
      this.riwayat = r.data || [];
      this.cekPanggilanBaru();
    },

    // Panggilan baru (belum pernah dilihat di halaman ini) -> bunyi + notifikasi
    cekPanggilanBaru() {
      const baru = this.aktif.filter((c) => c.status === "memanggil" && !this._sudahDilihat.has(c.id));
      this.aktif.forEach((c) => this._sudahDilihat.add(c.id));
      if (this._pertamaMuat) { this._pertamaMuat = false; return; }
      const relevan = baru.filter((c) => this.cocokFilter(c));
      if (!relevan.length) return;
      if (this.suaraAktif) AndonSuara.bunyi();
      if (this.notifIzin === "granted") {
        relevan.forEach((c) => {
          try {
            const n = new Notification("🔴 " + c.mesin + " memanggil " + c.tim, {
              body: (c.keterangan ? c.keterangan + " · " : "") + "oleh " + (c.dipanggil_nama || "-") + " · " + andonJam(c.dipanggil_at),
              tag: "andon-" + c.id, requireInteraction: true,
            });
            n.onclick = () => { window.focus(); n.close(); };
          } catch (e) {}
        });
      }
    },

    cocokFilter(c) { return !this.filterTim.length || this.filterTim.includes(c.tim); },
    get aktifTampil() { return this.aktif.filter((c) => this.cocokFilter(c)); },
    get riwayatTampil() { return this.riwayat.filter((c) => this.cocokFilter(c)); },
    get jumlahMemanggil() { return this.aktifTampil.filter((c) => c.status === "memanggil").length; },

    toggleTim(kode) {
      const i = this.filterTim.indexOf(kode);
      if (i >= 0) this.filterTim.splice(i, 1); else this.filterTim.push(kode);
      try { localStorage.setItem("andonFilterTim", JSON.stringify(this.filterTim)); } catch (e) {}
    },
    semuaTim() {
      this.filterTim = [];
      try { localStorage.setItem("andonFilterTim", "[]"); } catch (e) {}
    },

    async aktifkanPeringatan() {
      this.suaraAktif = AndonSuara.aktifkan();
      if (this.suaraAktif) AndonSuara.bunyi();   // tes bunyi
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        try { this.notifIzin = await Notification.requestPermission(); } catch (e) {}
      } else if (typeof Notification !== "undefined") {
        this.notifIzin = Notification.permission;
      }
    },

    get bolehAksi() { return !!this.profile && !["guest", "viewer"].includes((this.profile.role || "").toLowerCase()); },

    async aksi(c, jenis) {
      let catatan = null;
      if (jenis === "selesai") {
        catatan = prompt("Perbaikan " + c.mesin + " (" + c.tim + ") selesai. Catatan singkat (boleh kosong):", "");
        if (catatan === null) return;
      }
      if (jenis === "batal" && !confirm("Batalkan panggilan " + c.mesin + " ke " + c.tim + "?")) return;
      const r = await andonAksi(c.id, jenis, catatan);
      if (!r.ok) this.flash(r.pesan || "Gagal.", true);
      else this.flash(jenis === "ambil" ? "Anda tercatat menangani " + c.mesin + "." : "Tersimpan.");
      await this.muat();
    },

    // ---- angka ----
    responsMs(c) { return c.ditangani_at ? new Date(c.ditangani_at) - new Date(c.dipanggil_at) : null; },
    perbaikanMs(c) { return c.ditangani_at && c.selesai_at ? new Date(c.selesai_at) - new Date(c.ditangani_at) : null; },
    lama(c) { return andonDurasi(this.now - new Date(c.dipanggil_at).getTime()); },
    lamaDitangani(c) { return c.ditangani_at ? andonDurasi(this.now - new Date(c.ditangani_at).getTime()) : "-"; },
    menit(ms) { const m = andonMenit(ms); return m == null ? "-" : m.toLocaleString("id-ID") + " mnt"; },
    get ringkasan() {
      const selesai = this.riwayatTampil.filter((c) => c.status === "selesai");
      const rata = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
      return {
        total: this.riwayatTampil.length + this.aktifTampil.length,
        selesai: selesai.length,
        respons: rata(selesai.map((c) => this.responsMs(c)).filter((x) => x != null)),
        perbaikan: rata(selesai.map((c) => this.perbaikanMs(c)).filter((x) => x != null)),
      };
    },
    telat(c) { return c.status === "memanggil" && (this.now - new Date(c.dipanggil_at)) > 5 * 60000; },
    info(kode) { return andonTimInfo(kode); },
    jam: andonJam,

    // ---- sidebar ----
    role() { return (this.profile?.role || "").toLowerCase(); },
    isAdmin() { return this.role() === "admin"; },
    isLeaderOrAdmin() { return ["admin", "leader"].includes(this.role()); },
    isViewer() { return this.role() === "viewer"; },
    async logout() { await supabaseClient.auth.signOut(); window.location.href = getBasePath() + "login.html"; },

    flash(t, err) {
      this.pesan = t; this.pesanError = !!err;
      clearTimeout(this._ft);
      this._ft = setTimeout(() => { this.pesan = ""; }, 5000);
    },
  };
}
