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
  { kode: "MESIN",   label: "Mesin / Maintenance", warna: "#2563eb",
    ikon: '<path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/>' },
  { kode: "DIES",    label: "Dies / Jig",          warna: "#dc2626",
    ikon: '<path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm13 0h2v3h3v2h-3v3h-2v-3h-3v-2h3v-3z"/>' },
  { kode: "PE",      label: "PE",                  warna: "#7c3aed",
    ikon: '<path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.47.47 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.47.47 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.48.48 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/>' },
  { kode: "QC",      label: "QC",                  warna: "#059669",
    ikon: '<path d="M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/>' },
  { kode: "PC-SUPP", label: "PC / Supply Part",    warna: "#0891b2",
    ikon: '<path d="M20 7h-3V4H3v13h2a3 3 0 0 0 6 0h4a3 3 0 0 0 6 0h2v-5l-3-5zM8 18.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm10 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM17 12V9h2.5l1.8 3H17z"/>' },
  { kode: "PRESS",   label: "Press",               warna: "#be185d",
    ikon: '<path d="M4 2h16v4H4V2zm7 6h2v5h3l-4 5-4-5h3V8zM2 20h20v2H2v-2z"/>' },
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
// Nada bisa dipilih admin (tabel andon_setting). Tiap nada = 1 "siklus"
// yang diulang terus selama durasi yang disetel (seperti HP berdering).
const ANDON_NADA = [
  { kode: "telepon", label: "Telepon berdering", ket: "Kring-kring seperti telepon masuk" },
  { kode: "sirene",  label: "Sirene",            ket: "Naik-turun, paling terdengar di area bising" },
  { kode: "alarm",   label: "Alarm cepat",       ket: "Bip-bip-bip beruntun" },
  { kode: "bel",     label: "Bel",               ket: "Ding-dong klasik" },
  { kode: "marimba", label: "Marimba",           ket: "Halus · nada kayu yang lembut" },
  { kode: "lonceng", label: "Lonceng angin",     ket: "Halus · denting lonceng yang bergaung" },
  { kode: "kristal", label: "Kristal",           ket: "Halus · \"ting\" jernih bernada tinggi" },
  { kode: "piano",   label: "Piano lembut",      ket: "Halus · arpeggio piano naik perlahan" },
];
const ANDON_SETTING_DEFAULT = { nada: "telepon", durasi: 30, ulang: 60, volume: 80, layar_panggilan: true, getar: true, push_ulang: 60, push_ulang_max: 15, eskalasi_menit: 5 };

const AndonSuara = {
  ctx: null, master: null, volume: 0.8,
  _loop: null, _stopAt: 0, sedangBunyi: false,
  aktifkan() {
    try {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
      this.setVolume(this.volume);
      return true;
    } catch (e) { return false; }
  },
  get siap() { return !!this.ctx && this.ctx.state === "running"; },
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume;
  },
  // nada pendek: satu siklus (dipakai "Tes bunyi" & pengingat)
  bunyi(nada) { this._siklus(nada || "telepon"); },

  // Mainkan 1 siklus nada, balikan panjang siklus (detik)
  _siklus(nada) {
    if (!this.siap) return 1;
    const c = this.ctx, t0 = c.currentTime + 0.02, out = this.master;
    const nada1 = (freq, mulai, lama, tipe, vol) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = tipe || "sine"; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0 + mulai);
      g.gain.exponentialRampToValueAtTime(vol || 0.3, t0 + mulai + 0.02);
      g.gain.setValueAtTime(vol || 0.3, t0 + mulai + lama - 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + mulai + lama);
      o.connect(g); g.connect(out); o.start(t0 + mulai); o.stop(t0 + mulai + lama + 0.02);
      return { o, g };
    };
    if (nada === "sirene") {
      const o = c.createOscillator(), g = c.createGain();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(650, t0);
      o.frequency.linearRampToValueAtTime(1350, t0 + 0.9);
      o.frequency.linearRampToValueAtTime(650, t0 + 1.8);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.05);
      g.gain.setValueAtTime(0.16, t0 + 1.75); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.8);
      o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + 1.82);
      return 1.8;
    }
    if (nada === "alarm") {
      [0, 0.25, 0.5, 0.75].forEach((dt) => nada1(1050, dt, 0.16, "square", 0.18));
      return 1.4;
    }
    // ---- nada halus: gelombang sinus/segitiga, serangan lembut, gaung panjang ----
    const lembut = (freq, mulai, lama, vol, tipe) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = tipe || "sine"; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0 + mulai);
      g.gain.exponentialRampToValueAtTime(vol, t0 + mulai + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + mulai + lama);
      o.connect(g); g.connect(out); o.start(t0 + mulai); o.stop(t0 + mulai + lama + 0.05);
    };
    if (nada === "marimba") {
      [[1046.5, 0], [1318.5, 0.18], [1568, 0.36], [1318.5, 0.54], [1568, 0.9], [2093, 1.08]].forEach(([f, dt]) => {
        lembut(f, dt, 0.55, 0.22, "sine"); lembut(f * 4, dt, 0.12, 0.03, "sine");   // nada kayu: dasar + dentingan pendek
      });
      return 2.6;
    }
    if (nada === "lonceng") {
      [[1318.5, 0], [987.8, 0.35], [830.6, 0.7], [659.3, 1.05]].forEach(([f, dt]) => {
        lembut(f, dt, 1.6, 0.16); lembut(f * 2.76, dt, 0.8, 0.035); lembut(f * 5.4, dt, 0.35, 0.015);  // parsial lonceng
      });
      return 3.4;
    }
    if (nada === "kristal") {
      [[1760, 0], [2349.3, 0.28], [1760, 1.0], [2349.3, 1.28]].forEach(([f, dt]) => {
        lembut(f, dt, 0.9, 0.18); lembut(f * 2, dt, 0.4, 0.035);
      });
      return 2.9;
    }
    if (nada === "piano") {
      [[523.3, 0], [659.3, 0.2], [784, 0.4], [1046.5, 0.6]].forEach(([f, dt]) => {
        lembut(f, dt, 1.4, 0.2, "triangle"); lembut(f * 2, dt, 0.6, 0.04);
      });
      return 3.0;
    }
    if (nada === "bel") {
      nada1(880, 0, 0.9, "sine", 0.4); nada1(1760, 0, 0.5, "sine", 0.08);
      nada1(660, 0.6, 1.1, "sine", 0.4); nada1(1320, 0.6, 0.6, "sine", 0.08);
      return 2.4;
    }
    // "telepon": 2 dering "trrrrt" (dua nada + getaran 20 Hz), lalu jeda
    [0, 1.3].forEach((dt) => {
      [440, 480].forEach((f) => {
        const { g } = nada1(f, dt, 1.0, "sine", 0.22);
        const lfo = c.createOscillator(), lg = c.createGain();
        lfo.frequency.value = 20; lg.gain.value = 0.18;
        lfo.connect(lg); lg.connect(g.gain);
        lfo.start(t0 + dt); lfo.stop(t0 + dt + 1.0);
      });
    });
    return 3.6;
  },

  // Berdering terus sampai berhenti() atau durasiDetik habis (0 = tanpa batas)
  mulai(nada, durasiDetik, getar) {
    this.berhenti();
    if (!this.siap) return;
    this.sedangBunyi = true;
    this._stopAt = durasiDetik > 0 ? Date.now() + durasiDetik * 1000 : Infinity;
    const putar = () => {
      if (!this.sedangBunyi) return;
      if (Date.now() >= this._stopAt) { this.berhenti(); return; }
      const lama = this._siklus(nada);
      if (getar && navigator.vibrate) { try { navigator.vibrate([700, 300, 700]); } catch (e) {} }
      this._loop = setTimeout(putar, lama * 1000 + 250);
    };
    putar();
  },
  berhenti() {
    this.sedangBunyi = false;
    clearTimeout(this._loop); this._loop = null;
    if (navigator.vibrate) { try { navigator.vibrate(0); } catch (e) {} }
  },
};

// Terjemahkan error Supabase jadi kalimat yang bisa dipahami operator
function andonPesanError(error, tim) {
  const m = String(error?.message || error || "");
  if (m.includes("andon_call_aktif_uq")) return "Tim " + tim + " sudah dipanggil dan belum selesai.";
  if (/andon_call/.test(m) && /(does not exist|schema cache|not find)/i.test(m))
    return "Fitur Andon belum aktif di database. Admin perlu menjalankan migration_andon.sql di Supabase.";
  if (/row-level security|permission denied/i.test(m)) return "Akun ini tidak diizinkan memanggil supporting.";
  if (/Failed to fetch|NetworkError|network/i.test(m)) return "Tidak ada koneksi internet. Coba lagi.";
  return "Gagal memanggil: " + m;
}

// Notifikasi sistem. Lewat service worker kalau ada (bisa bergetar &
// tetap tampil di bilah notifikasi), selain itu pakai Notification biasa.
async function andonNotifikasi(c, getar) {
  const judul = "📞 " + c.mesin + " memanggil " + c.tim;
  const opsi = {
    body: (c.keterangan ? c.keterangan + "\n" : "") + "oleh " + (c.dipanggil_nama || "-") + " · " + andonJam(c.dipanggil_at),
    tag: "andon-" + c.id, renotify: true, requireInteraction: true,
    icon: "/assets/icons/icon-192.png", badge: "/assets/icons/icon-192.png",
    vibrate: getar ? [800, 400, 800, 400, 800, 400, 800] : undefined,
    data: { url: "/andon.html" },
  };
  try {
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (reg && reg.showNotification) { await reg.showNotification(judul, opsi); return; }
  } catch (e) {}
  try { const n = new Notification(judul, opsi); n.onclick = () => { window.focus(); n.close(); }; } catch (e) {}
}

// ---------- Notifikasi push (tahap 2) ----------
// Kunci PUBLIK VAPID (boleh ada di web). Pasangannya, kunci PRIVAT, hanya
// disimpan di Supabase > Edge Functions > Secrets (VAPID_PRIVATE_KEY).
const ANDON_VAPID_PUBLIC = "BLuFvPPGoevnzKaAllbX3LkmJ2AEx1Md-TPcYvHrat3WI_XpgD7g4oCCWc1M1ui_xn8GJ8fHUyOQEvbcO57p_yQ";

function andonB64ToUint8(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
const AndonPush = {
  get didukung() { return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; },
  get iosPerluInstall() {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    return ios && !standalone;
  },
  async reg() { return navigator.serviceWorker.ready; },
  async langgananSekarang() {
    if (!this.didukung) return null;
    try { return await (await this.reg()).pushManager.getSubscription(); } catch (e) { return null; }
  },
  async simpan(sub) {
    const j = sub.toJSON();
    const { data, error } = await supabaseClient.rpc("push_simpan", {
      p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: navigator.userAgent,
    });
    if (error) throw new Error(/push_simpan/.test(error.message) ? "Fitur notifikasi HP belum aktif di database. Jalankan migration_andon_push.sql." : error.message);
    if (!data || !data.ok) throw new Error((data && data.pesan) || "Gagal menyimpan langganan.");
  },
  async aktifkan() {
    const izin = await Notification.requestPermission();
    if (izin !== "granted") throw new Error(izin === "denied"
      ? "Notifikasi diblokir. Buka pengaturan situs di Chrome (ikon gembok di alamat) lalu izinkan Notifikasi."
      : "Izin notifikasi belum diberikan.");
    const reg = await this.reg();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: andonB64ToUint8(ANDON_VAPID_PUBLIC) });
    await this.simpan(sub);
    return sub;
  },
  async matikan() {
    const sub = await this.langgananSekarang();
    if (!sub) return;
    try { await supabaseClient.from("push_subscriptions").delete().eq("endpoint", sub.endpoint); } catch (e) {}
    await sub.unsubscribe();
  },
  async tes() {
    const { data, error } = await supabaseClient.functions.invoke("andon-push", { body: { test: true } });
    if (error) throw new Error("Fungsi andon-push belum terpasang / gagal: " + (error.message || error));
    return data;
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
    .select("id,full_name,role,jabatan,nik").eq("id", session.user.id).maybeSingle();
  return { session, profile: data || null };
}



// ---------- Dialog "Selesaikan perbaikan" (pengganti prompt() bawaan browser) ----------
// Dipakai widget mesin & papan Andon. Isi catatan = countermeasure.
function andonSelesaiMixin() {
  return {
    selesaiDlg: { open: false, c: null, catatan: "", saving: false, error: "" },
    bukaSelesai(c) {
      this.selesaiDlg = { open: true, c, catatan: "", saving: false, error: "" };
      this.$nextTick && this.$nextTick(() => { const t = document.querySelector(".asd-open textarea"); if (t) t.focus(); });
    },
    tutupSelesai() { if (!this.selesaiDlg.saving) this.selesaiDlg.open = false; },
    async simpanSelesai() {
      const d = this.selesaiDlg;
      if (!d.c || d.saving) return;
      d.saving = true; d.error = "";
      const r = await andonAksi(d.c.id, "selesai", d.catatan);
      d.saving = false;
      if (!r.ok) { d.error = r.pesan || "Gagal menyimpan."; return; }
      d.open = false;
      if (navigator.vibrate) { try { navigator.vibrate(80); } catch (e) {} }
      this.flash("Perbaikan " + d.c.mesin + " (" + d.c.tim + ") selesai. Terima kasih!");
      await this.muat();
    },
    // Panggilan yang sudah diterima hanya boleh diselesaikan oleh penerimanya
    // (atau admin). Aturan yang sama dijaga di database (andon_aksi).
    bolehSelesai(c) {
      if (!c || !["ditangani", "diperbaiki"].includes(c.status)) return true;
      const uid = this.myId || this.session?.user?.id;
      const role = (this.myRole || this.profile?.role || "").toLowerCase();
      return c.ditangani_oleh === uid || role === "admin";
    },
    // lama perbaikan berjalan (dari "ditangani", atau dari panggilan kalau belum diambil)
    lamaPerbaikan(c) {
      if (!c) return "-";
      const dari = new Date(c.mulai_at || c.ditangani_at || c.dipanggil_at).getTime();
      return andonDurasi(this.now - dari);
    },
  };
}

// =====================================================================
// 1) WIDGET DI HALAMAN MESIN
// =====================================================================
function andonWidget(mesin) {
  return {
    ...andonSelesaiMixin(),
    mesin,
    TIM: ANDON_TIM,
    calls: [],            // panggilan aktif mesin ini (memanggil / ditangani)
    modalOpen: false,
    modalError: "",
    terkirimTim: "",      // terisi = layar "Terkirim!" sedang tampil
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
        .in("status", ["memanggil", "ditangani", "diperbaiki"])
        .order("dipanggil_at", { ascending: true });
      if (!error) this.calls = data || [];
      // beri tahu halaman mesin (tab Downtime) supaya daftar "Andon selesai" ikut segar
      window.dispatchEvent(new CustomEvent("andon-berubah"));
    },

    bukaModal() {
      this.form = { tim: "", keterangan: "" };
      this.pesan = ""; this.modalError = ""; this.terkirimTim = "";
      this.modalOpen = true;
    },

    async panggil() {
      this.modalError = "";
      if (!this.form.tim) { this.modalError = "Pilih dulu tim yang dipanggil."; return; }
      if (this.timSedangAktif(this.form.tim)) { this.modalError = "Tim " + this.form.tim + " sudah dipanggil dan belum selesai."; return; }
      this.sending = true;
      let error;
      try {
        ({ error } = await supabaseClient.from("andon_call").insert({
          mesin: this.mesin, tim: this.form.tim, keterangan: this.form.keterangan || null,
        }));
      } catch (e) {
        error = { message: e?.message || String(e) };
      }
      this.sending = false;
      if (error) {
        // Pesan error ditampilkan DI DALAM popup (dulu muncul di belakang
        // popup sehingga tidak terlihat).
        this.modalError = andonPesanError(error, this.form.tim);
        return;
      }
      // Berhasil -> layar "Terkirim!" sebentar, lalu popup menutup sendiri
      this.terkirimTim = this.form.tim;
      if (navigator.vibrate) { try { navigator.vibrate(120); } catch (e) {} }
      await this.muat();
      clearTimeout(this._tutup);
      this._tutup = setTimeout(() => { this.modalOpen = false; this.terkirimTim = ""; }, 2200);
    },

    tutupModal() {
      clearTimeout(this._tutup);
      this.modalOpen = false; this.terkirimTim = ""; this.modalError = "";
    },

    async aksi(c, jenis) {
      if (jenis === "batal" && !confirm("Batalkan panggilan ke " + c.tim + "?")) return;
      if (jenis === "selesai") { this.bukaSelesai(c); return; }
      const r = await andonAksi(c.id, jenis, null);
      if (!r.ok) this.flash(r.pesan || "Gagal.", true);
      await this.muat();
    },

    lama(c) { return andonDurasi(this.now - new Date(c.dipanggil_at).getTime()); },
    lamaDitangani(c) { return c.ditangani_at ? andonDurasi(this.now - new Date(c.ditangani_at).getTime()) : "-"; },
    lamaMulai(c) { return c.mulai_at ? andonDurasi(this.now - new Date(c.mulai_at).getTime()) : "-"; },
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
    ...andonSelesaiMixin(),
    TIM: ANDON_TIM,
    session: null, profile: null,
    aktif: [],             // memanggil + ditangani (semua mesin)
    riwayat: [],           // selesai / batal hari ini
    filterTim: [],         // kosong = semua tim
    suaraAktif: false,
    NADA: ANDON_NADA,
    setting: { ...ANDON_SETTING_DEFAULT },
    settingAda: true,          // false = tabel andon_setting belum dibuat
    settingDlg: { open: false, form: null, saving: false, error: "" },
    panggilanMasuk: null,      // panggilan yang sedang tampil di layar "panggilan masuk"
    push: { status: "cek", sibuk: false, pesan: "", error: false },   // cek|tidak|mati|aktif|blokir
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
      // Anggota Tim Supporting (menu Pengaturan > Tim Supporting): filter
      // DIKUNCI ke timnya -- hanya melihat, mendengar & menerima notifikasi
      // panggilan timnya sendiri. Admin/leader & non-anggota melihat semua.
      if (profile?.nik) {
        try {
          const { data: ang } = await supabaseClient.from("andon_tim_anggota").select("tim").eq("nik", profile.nik).maybeSingle();
          if (ang && ang.tim && !["admin", "leader"].includes((profile.role || "").toLowerCase())) {
            this.timKunci = ang.tim;
            this.filterTim = [ang.tim];
          }
        } catch (e) {}
      }
      await this.muatSetting();
      this.cekPush();
      await this.muat();
      this.loading = false;
      supabaseClient.channel("andon_board")
        .on("postgres_changes", { event: "*", schema: "public", table: "andon_call" }, () => this.muat())
        .on("postgres_changes", { event: "*", schema: "public", table: "andon_setting" }, () => this.muatSetting())
        .subscribe();
      document.addEventListener("fullscreenchange", () => { this.fullscreen = !!document.fullscreenElement; });
      // Aturan browser: bunyi baru boleh menyala setelah layar disentuh.
      // Jadi sentuhan / klik PERTAMA di mana saja langsung mengaktifkan bunyi.
      const bukaSuara = () => {
        if (!this.suaraAktif) {
          this.suaraAktif = AndonSuara.aktifkan();
          AndonSuara.setVolume((Number(this.setting.volume) || 0) / 100);
        }
        if (this.suaraAktif) { window.removeEventListener("pointerdown", bukaSuara, true); window.removeEventListener("keydown", bukaSuara, true); }
      };
      window.addEventListener("pointerdown", bukaSuara, true);
      window.addEventListener("keydown", bukaSuara, true);
      setInterval(() => { this.now = Date.now(); }, 1000);
      setInterval(() => this.muat(), 30000);
      // Pengingat: selama masih ada panggilan yang belum direspons, bunyi
      // diulang tiap "ulang" detik (diatur admin; 0 = tidak diulang).
      this._terakhirIngat = Date.now();
      setInterval(() => {
        const ulang = Number(this.setting.ulang) || 0;
        if (!ulang || !this.suaraAktif || AndonSuara.sedangBunyi) return;
        if (!this.aktifTampil.some((c) => c.status === "memanggil")) return;
        if (Date.now() - this._terakhirIngat < ulang * 1000) return;
        this._terakhirIngat = Date.now();
        AndonSuara.mulai(this.setting.nada, 8, this.setting.getar);
      }, 1000);
    },

    async muat() {
      const [a, r] = await Promise.all([
        supabaseClient.from("andon_call").select("*")
          .in("status", ["memanggil", "ditangani", "diperbaiki"]).order("dipanggil_at", { ascending: true }),
        supabaseClient.from("andon_call").select("*")
          .gte("dipanggil_at", andonAwalHariIni())
          .in("status", ["selesai", "batal"]).order("dipanggil_at", { ascending: false }).limit(300),
      ]);
      if (a.error) { this.flash("Gagal memuat: " + a.error.message, true); return; }
      this.aktif = a.data || [];
      this.riwayat = r.data || [];
      this.cekPanggilanBaru();
      // Panggilan di layar "panggilan masuk" sudah diambil orang lain /
      // selesai / batal -> layar & bunyi berhenti sendiri.
      if (this.panggilanMasuk) {
        const masih = this.aktif.find((c) => c.id === this.panggilanMasuk.id && c.status === "memanggil");
        if (!masih) this.tutupPanggilanMasuk();
      }
    },

    // Panggilan baru (belum pernah dilihat di halaman ini) -> bunyi + notifikasi
    cekPanggilanBaru() {
      const baru = this.aktif.filter((c) => c.status === "memanggil" && !this._sudahDilihat.has(c.id));
      this.aktif.forEach((c) => this._sudahDilihat.add(c.id));
      if (this._pertamaMuat) { this._pertamaMuat = false; return; }
      const relevan = baru.filter((c) => this.cocokFilter(c));
      if (!relevan.length) return;
      const c0 = relevan[relevan.length - 1];
      // Layar "panggilan masuk" + dering panjang (seperti telepon masuk)
      if (this.setting.layar_panggilan) this.panggilanMasuk = c0;
      if (this.suaraAktif) {
        AndonSuara.mulai(this.setting.nada, Number(this.setting.durasi) || 0, this.setting.getar);
        this._terakhirIngat = Date.now();
      }
      if (this.notifIzin === "granted") relevan.forEach((c) => andonNotifikasi(c, this.setting.getar));
    },

    // ---- notifikasi push (HP terkunci) ----
    async cekPush() {
      if (!AndonPush.didukung) { this.push.status = AndonPush.iosPerluInstall ? "ios" : "tidak"; return; }
      if (Notification.permission === "denied") { this.push.status = "blokir"; return; }
      const sub = await AndonPush.langgananSekarang();
      if (sub && Notification.permission === "granted") {
        this.push.status = "aktif";
        try { await AndonPush.simpan(sub); } catch (e) {}   // pastikan tercatat utk akun yang sedang login
        return;
      }
      // Izin sudah pernah diberikan di HP ini -> aktifkan otomatis tanpa tombol
      if (Notification.permission === "granted" && this.bolehAksi) {
        try { await AndonPush.aktifkan(); this.push.status = "aktif"; return; } catch (e) {}
      }
      this.push.status = "mati";
      // Belum pernah ditanya -> tampilkan layar aktivasi sekali ketuk
      let ditunda = false;
      try { ditunda = sessionStorage.getItem("andonAktivasiNanti") === "1"; } catch (e) {}
      if (this.bolehAksi && Notification.permission === "default" && !ditunda) this.aktivasiOpen = true;
    },
    aktivasiOpen: false,
    async aktivasiSekarang() {
      await this.aktifkanPeringatan();            // bunyi (butuh ketukan ini)
      await this.aktifkanPush();                  // notifikasi HP
      this.aktivasiOpen = false;
    },
    aktivasiNanti() {
      this.aktivasiOpen = false;
      try { sessionStorage.setItem("andonAktivasiNanti", "1"); } catch (e) {}
    },
    pushInfo(t, err) {
      this.push.pesan = t; this.push.error = !!err;
      clearTimeout(this._pt); this._pt = setTimeout(() => { this.push.pesan = ""; }, 8000);
    },
    async aktifkanPush() {
      this.push.sibuk = true;
      try {
        await AndonPush.aktifkan();
        this.push.status = "aktif";
        this.notifIzin = "granted";
        this.pushInfo("Notifikasi HP aktif. Panggilan akan masuk walau layar terkunci. Tekan \"Tes\" untuk mencoba.");
      } catch (e) {
        this.push.status = Notification.permission === "denied" ? "blokir" : "mati";
        this.pushInfo(e.message || String(e), true);
      }
      this.push.sibuk = false;
    },
    async tesPush() {
      this.push.sibuk = true;
      try {
        const r = await AndonPush.tes();
        this.pushInfo(r && r.terkirim ? "Tes terkirim. Kunci layar HP sebentar untuk melihat notifikasinya." : "Tidak ada HP yang terdaftar untuk akun ini. Tekan Aktifkan lagi.", !(r && r.terkirim));
      } catch (e) { this.pushInfo(e.message || String(e), true); }
      this.push.sibuk = false;
    },
    async matikanPush() {
      if (!confirm("Matikan notifikasi Andon di HP ini?")) return;
      this.push.sibuk = true;
      try { await AndonPush.matikan(); this.push.status = "mati"; this.pushInfo("Notifikasi HP dimatikan."); }
      catch (e) { this.pushInfo(e.message || String(e), true); }
      this.push.sibuk = false;
    },

    // ---- layar panggilan masuk ----
    tutupPanggilanMasuk() {
      this.panggilanMasuk = null;
      AndonSuara.berhenti();
    },
    async bunyikanMasuk() {
      await this.aktifkanPeringatan();
      AndonSuara.berhenti();
      if (this.suaraAktif) AndonSuara.mulai(this.setting.nada, Number(this.setting.durasi) || 0, this.setting.getar);
    },
    async terimaPanggilan() {
      const c = this.panggilanMasuk;
      this.tutupPanggilanMasuk();
      if (c && this.bolehAksi) await this.aksi(c, "ambil");
    },

    // ---- pengaturan (tabel andon_setting, hanya admin yang bisa mengubah) ----
    async muatSetting() {
      const { data, error } = await supabaseClient.from("andon_setting").select("*").eq("id", 1).maybeSingle();
      if (error) { this.settingAda = false; return; }
      this.settingAda = true;
      this.setting = { ...ANDON_SETTING_DEFAULT, ...(data || {}) };
      AndonSuara.setVolume((Number(this.setting.volume) || 0) / 100);
    },
    bukaSetting() {
      if (!this.isAdmin()) return;
      this.settingDlg = { open: true, form: { ...this.setting }, saving: false, error: "" };
      this.settingTab = "suara"; this.timPesan = ""; this.timEdit = false;
    },
    tesNada(kode) {
      if (!AndonSuara.siap) { this.suaraAktif = AndonSuara.aktifkan(); }
      AndonSuara.setVolume((Number(this.settingDlg.form?.volume ?? this.setting.volume) || 0) / 100);
      AndonSuara.berhenti();
      AndonSuara.mulai(kode, 4, false);
    },
    tutupSetting() {
      AndonSuara.berhenti();
      AndonSuara.setVolume((Number(this.setting.volume) || 0) / 100);
      this.settingDlg.open = false;
    },
    async simpanSetting() {
      const d = this.settingDlg, f = d.form;
      d.saving = true; d.error = "";
      const row = {
        id: 1, nada: f.nada, durasi: Number(f.durasi) || 0, ulang: Number(f.ulang) || 0,
        volume: Math.max(0, Math.min(100, Number(f.volume) || 0)),
        layar_panggilan: !!f.layar_panggilan, getar: !!f.getar,
        push_ulang: Number(f.push_ulang) || 0, push_ulang_max: Number(f.push_ulang_max) || 15,
        eskalasi_menit: Number(f.eskalasi_menit) || 0,
      };
      const { error } = await supabaseClient.from("andon_setting").upsert(row).select("id");
      d.saving = false;
      if (error) {
        d.error = /andon_setting/.test(error.message) && /(exist|schema cache|not find)/i.test(error.message)
          ? "Tabel pengaturan belum dibuat. Jalankan migration_andon_setting.sql di Supabase."
          : /push_ulang|eskalasi_menit/.test(error.message) ? "Pengaturan ulang/eskalasi belum aktif. Jalankan migration_andon_ulang.sql di Supabase."
          : /row-level security|permission/i.test(error.message) ? "Hanya admin yang bisa mengubah pengaturan." : "Gagal menyimpan: " + error.message;
        return;
      }
      this.setting = { ...ANDON_SETTING_DEFAULT, ...row };
      this.tutupSetting();
      this.flash("Pengaturan Andon disimpan. Berlaku di semua HP/TV yang membuka halaman Andon.");
    },
    // ---- Tim Supporting (admin) ----
    settingTab: "suara",
    timAnggota: [], timLoading: false, timSaving: false, timEdit: false,
    timForm: { nik: "", nama: "", tim: "MESIN" },
    timPesan: "", timPesanError: false,
    async muatTim() {
      this.timLoading = true;
      const { data, error } = await supabaseClient.rpc("andon_tim_daftar");
      this.timLoading = false;
      if (error) {
        this.timAnggota = [];
        this.timInfo(/andon_tim_daftar/.test(error.message) ? "Fitur Tim Supporting belum aktif. Jalankan migration_andon_tim.sql di Supabase." : "Gagal memuat: " + error.message, true);
        return;
      }
      this.timAnggota = data || [];
    },
    timInfo(t, err) {
      this.timPesan = t; this.timPesanError = !!err;
      clearTimeout(this._tt); this._tt = setTimeout(() => { this.timPesan = ""; }, 6000);
    },
    editTim(a) { this.timForm = { nik: a.nik, nama: a.nama, tim: a.tim }; this.timEdit = true; },
    async simpanTim() {
      const f = this.timForm;
      if (!f.nik || !f.nama) { this.timInfo("NIK dan nama wajib diisi.", true); return; }
      this.timSaving = true;
      const { data, error } = await supabaseClient.rpc("andon_tim_simpan", { p_nik: f.nik, p_nama: f.nama, p_tim: f.tim });
      this.timSaving = false;
      if (error) { this.timInfo(/andon_tim_simpan/.test(error.message) ? "Fitur Tim Supporting belum aktif. Jalankan migration_andon_tim.sql di Supabase." : "Gagal: " + error.message, true); return; }
      if (!data || !data.ok) { this.timInfo((data && data.pesan) || "Gagal menyimpan.", true); return; }
      this.timInfo(data.nik_baru
        ? "NIK " + f.nik + " didaftarkan. Sekarang " + f.nama.toUpperCase() + " bisa membuat akun lewat \"Daftar di sini\" di halaman login."
        : "Anggota " + f.nama.toUpperCase() + " disimpan (" + f.tim + ").");
      this.timForm = { nik: "", nama: "", tim: f.tim };
      this.timEdit = false;
      await this.muatTim();
    },
    async hapusTim(a) {
      if (!confirm("Keluarkan " + a.nama + " dari tim " + a.tim + "?\nAkun login-nya tidak ikut terhapus.")) return;
      const { data, error } = await supabaseClient.rpc("andon_tim_hapus", { p_nik: a.nik });
      if (error || !data || !data.ok) { this.timInfo("Gagal menghapus" + (error ? ": " + error.message : "."), true); return; }
      this.timInfo(a.nama + " dikeluarkan dari tim.");
      await this.muatTim();
    },

    labelDurasi(d) { d = Number(d) || 0; return d === 0 ? "sampai ada yang merespons" : d + " detik"; },
    namaNada(k) { return (ANDON_NADA.find((n) => n.kode === k) || {}).label || k; },

    cocokFilter(c) { return !this.filterTim.length || this.filterTim.includes(c.tim); },
    get aktifTampil() { return this.aktif.filter((c) => this.cocokFilter(c)); },
    get riwayatTampil() { return this.riwayat.filter((c) => this.cocokFilter(c)); },
    get jumlahMemanggil() { return this.aktifTampil.filter((c) => c.status === "memanggil").length; },
    get jumlahDitangani() { return this.aktifTampil.filter((c) => c.status === "ditangani" || c.status === "diperbaiki").length; },

    timKunci: "",          // terisi = user anggota tim ini, filter tidak bisa diubah
    toggleTim(kode) {
      if (this.timKunci) return;
      const i = this.filterTim.indexOf(kode);
      if (i >= 0) this.filterTim.splice(i, 1); else this.filterTim.push(kode);
      try { localStorage.setItem("andonFilterTim", JSON.stringify(this.filterTim)); } catch (e) {}
    },
    semuaTim() {
      if (this.timKunci) return;
      this.filterTim = [];
      try { localStorage.setItem("andonFilterTim", "[]"); } catch (e) {}
    },

    // Mode TV: layar penuh (Fullscreen API). Sekalian mengaktifkan bunyi.
    fullscreen: false,
    async layarPenuh() {
      try {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen();
          if (!this.suaraAktif) this.aktifkanPeringatan();
        } else {
          await document.exitFullscreen();
        }
      } catch (e) { this.flash("Browser ini tidak mendukung layar penuh. Tekan F11.", true); }
    },

    async aktifkanPeringatan() {
      this.suaraAktif = AndonSuara.aktifkan();
      AndonSuara.setVolume((Number(this.setting.volume) || 0) / 100);
      if (this.suaraAktif && !AndonSuara.sedangBunyi && !this.panggilanMasuk) AndonSuara.bunyi(this.setting.nada);   // tes bunyi
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        try { this.notifIzin = await Notification.requestPermission(); } catch (e) {}
      } else if (typeof Notification !== "undefined") {
        this.notifIzin = Notification.permission;
      }
    },

    get bolehAksi() { return !!this.profile && !["guest", "viewer"].includes((this.profile.role || "").toLowerCase()); },

    async aksi(c, jenis) {
      if (jenis === "selesai") { this.bukaSelesai(c); return; }
      const catatan = null;
      if (jenis === "batal" && !confirm("Batalkan panggilan " + c.mesin + " ke " + c.tim + "?")) return;
      const r = await andonAksi(c.id, jenis, catatan);
      if (!r.ok) this.flash(r.pesan || "Gagal.", true);
      else this.flash(jenis === "ambil" ? "Diterima. Tekan \"Mulai perbaikan\" setelah sampai di " + c.mesin + "."
                    : jenis === "mulai" ? "Perbaikan " + c.mesin + " dimulai. Tekan Selesai kalau sudah beres." : "Tersimpan.");
      await this.muat();
    },

    // Edit riwayat: masalah & countermeasure (semua user kecuali guest/viewer)
    editDlg: { open: false, c: null, keterangan: "", catatan: "", saving: false, error: "" },
    bukaEdit(c) {
      this.editDlg = { open: true, c, keterangan: c.keterangan || "", catatan: c.catatan || "", saving: false, error: "" };
    },
    tutupEdit() { if (!this.editDlg.saving) this.editDlg.open = false; },
    async simpanEdit() {
      const d = this.editDlg;
      d.saving = true; d.error = "";
      const { data, error } = await supabaseClient.rpc("andon_edit", { p_id: d.c.id, p_keterangan: d.keterangan, p_catatan: d.catatan });
      d.saving = false;
      if (error) {
        d.error = /andon_edit/.test(error.message) ? "Fitur edit belum aktif. Jalankan migration_andon_setting.sql di Supabase." : "Gagal menyimpan: " + error.message;
        return;
      }
      if (!data || !data.ok) { d.error = (data && data.pesan) || "Gagal menyimpan."; return; }
      d.open = false;
      this.flash("Riwayat " + d.c.mesin + " diperbarui.");
      await this.muat();
    },

    // Hapus 1 riwayat (khusus admin -- dijaga juga oleh RLS andon_delete)
    async hapus(c) {
      if (!this.isAdmin()) return;
      if (!confirm("Hapus riwayat " + c.mesin + " (" + c.tim + ", " + andonJam(c.dipanggil_at) + ")?\nData yang dihapus tidak bisa dikembalikan.")) return;
      const { data, error } = await supabaseClient.from("andon_call").delete().eq("id", c.id).select("id");
      if (error) { this.flash("Gagal menghapus: " + error.message, true); return; }
      if (!data || !data.length) { this.flash("Tidak terhapus -- hanya admin yang bisa menghapus riwayat.", true); return; }
      this.riwayat = this.riwayat.filter((r) => r.id !== c.id);
      this.flash("Riwayat dihapus.");
    },

    // ---- angka ----
    responsMs(c) { return c.ditangani_at ? new Date(c.ditangani_at) - new Date(c.dipanggil_at) : null; },
    tibaMs(c) { return c.mulai_at ? new Date(c.mulai_at) - new Date(c.dipanggil_at) : null; },
    perbaikanMs(c) { const m = c.mulai_at || c.ditangani_at; return m && c.selesai_at ? new Date(c.selesai_at) - new Date(m) : null; },
    lama(c) { return andonDurasi(this.now - new Date(c.dipanggil_at).getTime()); },
    lamaDitangani(c) { return c.ditangani_at ? andonDurasi(this.now - new Date(c.ditangani_at).getTime()) : "-"; },
    lamaMulai(c) { return c.mulai_at ? andonDurasi(this.now - new Date(c.mulai_at).getTime()) : "-"; },
    menit(ms) { const m = andonMenit(ms); return m == null ? "-" : m.toLocaleString("id-ID") + " mnt"; },
    get ringkasan() {
      const selesai = this.riwayatTampil.filter((c) => c.status === "selesai");
      const rata = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
      return {
        total: this.riwayatTampil.length + this.aktifTampil.length,
        selesai: selesai.length,
        respons: rata(selesai.map((c) => this.responsMs(c)).filter((x) => x != null)),
        tiba: rata(selesai.map((c) => this.tibaMs(c)).filter((x) => x != null)),
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
