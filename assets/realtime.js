// =========================================================
// REALTIME -- SATU PINTU untuk Supabase Realtime ATAU Pusher
//
// Semua halaman (halaman line, Dashboard Exhaust, Andon) memanggil:
//
//   const h = RealtimeHub.subscribe("nama_channel", [
//     { table: "downtime_log", filter: "mesin=eq.E-03", onChange: (payload) => {...} },
//     { table: "repair_points", onChange: (payload) => {...} },
//   ]);
//   ...
//   RealtimeHub.close(h);     // berhenti mendengar
//
// Isi onChange SAMA PERSIS di kedua mode, jadi kode halaman tidak perlu
// tahu sedang memakai yang mana.
//
// ---------------------------------------------------------
// CARA BERALIH (lihat PUSHER.md untuk langkah lengkap)
//   1. Isi PUSHER_KEY & PUSHER_CLUSTER di bawah (dari dashboard Pusher).
//   2. Uji di SATU perangkat dulu tanpa mengubah file:
//        buka halaman apa pun dengan  ?rt=pusher
//      (disimpan di browser itu). Kembali: ?rt=supabase  atau  ?rt=reset
//   3. Kalau sudah yakin, ubah REALTIME_PROVIDER di bawah ke "pusher"
//      lalu upload. Mau balik ke Supabase: ubah lagi ke "supabase".
//
// Kalau mode "pusher" tapi PUSHER_KEY kosong, atau pustaka Pusher gagal
// dimuat, otomatis kembali memakai Supabase (aplikasi tidak mati).
// =========================================================

const REALTIME_PROVIDER = "pusher";            // "supabase" | "pusher"
const PUSHER_KEY = "fce0ec5ae3eb100a007e";     // App Key (bukan Secret!) dari dashboard Pusher
const PUSHER_CLUSTER = "ap1";                  // ap1 = Singapura
const PUSHER_JS_URL = "https://cdn.jsdelivr.net/npm/pusher-js@8.4.0/dist/web/pusher.min.js";

// Channel yang TETAP memakai Supabase walau mode "pusher". Absensi/cuti
// jarang berubah (hanya karena aksi orang, bukan sinkronisasi sheet) dan
// dipakai banyak karyawan sekaligus, sementara paket gratis Pusher dibatasi
// 100 koneksi bersamaan. Hapus nama dari daftar ini kalau mau ikut Pusher
// (tabelnya juga harus dipasangi trigger di migration_pusher_realtime.sql).
const REALTIME_TETAP_SUPABASE = ["rt_attendance", "rt_master_cuti"];

const RealtimeHub = (() => {
  const LS_KEY = "realtime_provider_v1";

  // ---- pilih provider: ?rt= di alamat > pengaturan di atas ----
  function resolveProvider() {
    try {
      const q = new URLSearchParams(window.location.search).get("rt");
      if (q === "pusher" || q === "supabase") localStorage.setItem(LS_KEY, q);
      else if (q === "reset") localStorage.removeItem(LS_KEY);
      const manual = localStorage.getItem(LS_KEY);
      if (manual === "pusher" || manual === "supabase") return manual;
    } catch (e) { /* storage diblokir -> pakai pengaturan di file */ }
    return REALTIME_PROVIDER;
  }

  function providerFor(name) {
    if (REALTIME_TETAP_SUPABASE.indexOf(name) >= 0) return "supabase";
    return resolveProvider();
  }

  // ======================= SUPABASE =======================
  // Persis seperti kode lama: channel + postgres_changes + subscribe.
  function viaSupabase(name, specs) {
    let channel = supabaseClient.channel(name);
    specs.forEach((s) => {
      const cfg = { event: "*", schema: "public", table: s.table };
      if (s.filter) cfg.filter = s.filter;
      channel = channel.on("postgres_changes", cfg, s.onChange);
    });
    const raw = channel.subscribe();
    return {
      provider: "supabase",
      close() { try { supabaseClient.removeChannel(raw); } catch (e) { /* sudah tertutup */ } },
    };
  }

  // ======================= PUSHER =========================
  // Server (api/pusher-notify.js) mengirim SINYAL KECIL, bukan isi baris:
  //   { t: "downtime_log", op: "UPDATE", m: ["E-03"], v: ["<view_id>"] }
  // ke channel "t-<tabel>" (semua line) dan "m-<mesin>" (satu line).
  // Halaman cukup tahu "tabel X berubah" lalu mengambil ulang datanya
  // lewat API seperti biasa.
  let pusherPromise = null;
  let pusherInst = null;
  let sengajaPutus = false;       // true = kita sendiri yang memutus (tidak ada pendengar)
  const chanRefs = {};            // nama channel -> jumlah pendengar
  const activeHandles = new Set(); // untuk sinkron ulang setelah koneksi pulih

  function getPusher() {
    if (pusherPromise) return pusherPromise;
    pusherPromise = new Promise((resolve, reject) => {
      const init = () => {
        try {
          pusherInst = new window.Pusher(PUSHER_KEY, { cluster: PUSHER_CLUSTER, forceTLS: true });
          let pernahTerputus = false;
          pusherInst.connection.bind("state_change", (st) => {
            if (st.current === "connected") sengajaPutus = false;
            if (st.current === "connected" && pernahTerputus) {
              // Event yang lewat saat koneksi putus tidak akan dikirim ulang,
              // jadi minta semua halaman mengambil data sekali lagi.
              pernahTerputus = false;
              activeHandles.forEach((h) => h.resync());
            } else if (st.current !== "connected" && st.previous === "connected" && !sengajaPutus) {
              pernahTerputus = true;
            }
          });
          resolve(pusherInst);
        } catch (e) { reject(e); }
      };
      if (window.Pusher) return init();
      const sc = document.createElement("script");
      sc.src = PUSHER_JS_URL;
      sc.async = true;
      sc.onload = init;
      sc.onerror = () => reject(new Error("pustaka Pusher gagal dimuat"));
      document.head.appendChild(sc);
    });
    return pusherPromise;
  }

  // channel tempat sebuah langganan "tinggal": filter mesin=eq.E-03 -> m-E-03,
  // selain itu -> t-<tabel>.
  function channelFor(spec) {
    const m = /^mesin=eq\.(.+)$/.exec(spec.filter || "");
    return m ? "m-" + m[1] : "t-" + spec.table;
  }

  // Bentuk payload mirip Supabase supaya handler lama (mis. repair_points
  // yang membaca payload.new.view_id) tidak perlu diubah.
  function emit(spec, sig) {
    if (spec.table !== sig.t) return;
    try {
      if (Array.isArray(sig.v) && sig.v.length) {
        sig.v.forEach((v) => spec.onChange({ eventType: sig.op, table: sig.t, new: { view_id: v }, old: { view_id: v } }));
      } else {
        spec.onChange({ eventType: sig.op, table: sig.t, new: {}, old: {} });
      }
    } catch (e) { console.error("Realtime handler error:", e); }
  }

  function bindPusher(p, name, specs) {
    if (p.connection.state === "disconnected") p.connect();
    const bound = [];
    const byChannel = {};
    specs.forEach((s) => { (byChannel[channelFor(s)] = byChannel[channelFor(s)] || []).push(s); });
    Object.keys(byChannel).forEach((chName) => {
      const list = byChannel[chName];
      const ch = p.subscribe(chName);
      const fn = (sig) => { if (sig) list.forEach((s) => emit(s, sig)); };
      ch.bind("change", fn);
      chanRefs[chName] = (chanRefs[chName] || 0) + 1;
      bound.push({ chName, ch, fn });
    });
    return {
      resync() {
        specs.forEach((s) => { try { s.onChange({ eventType: "RESYNC", table: s.table, new: {}, old: {} }); } catch (e) { /* abaikan */ } });
      },
      close() {
        bound.forEach((b) => {
          try { b.ch.unbind("change", b.fn); } catch (e) { /* abaikan */ }
          chanRefs[b.chName] = (chanRefs[b.chName] || 1) - 1;
          if (chanRefs[b.chName] <= 0) { try { p.unsubscribe(b.chName); } catch (e) { /* abaikan */ } delete chanRefs[b.chName]; }
        });
        // Tidak ada yang mendengarkan lagi (mis. tab Dashboard disembunyikan)
        // -> putus koneksi supaya tidak memakan jatah koneksi Pusher.
        if (Object.keys(chanRefs).length === 0) { sengajaPutus = true; try { p.disconnect(); } catch (e) { /* abaikan */ } }
      },
    };
  }

  function viaPusher(name, specs) {
    const handle = { provider: "pusher", closed: false, inner: null };
    getPusher().then((p) => {
      if (handle.closed) return;
      const inner = bindPusher(p, name, specs);
      handle.inner = inner;
      activeHandles.add(inner);
    }).catch((err) => {
      console.warn("[Realtime] Pusher gagal (" + (err && err.message) + "), memakai Supabase.");
      if (handle.closed) return;
      handle.provider = "supabase";
      handle.inner = viaSupabase(name, specs);
    });
    handle.close = function () {
      handle.closed = true;
      if (handle.inner) { activeHandles.delete(handle.inner); handle.inner.close(); handle.inner = null; }
    };
    return handle;
  }

  // ======================= API PUBLIK =====================
  function subscribe(name, specs) {
    let prov = providerFor(name);
    if (prov === "pusher" && !PUSHER_KEY) {
      console.warn("[Realtime] PUSHER_KEY kosong di assets/realtime.js, memakai Supabase.");
      prov = "supabase";
    }
    return prov === "pusher" ? viaPusher(name, specs) : viaSupabase(name, specs);
  }

  function close(handle) {
    if (handle && typeof handle.close === "function") handle.close();
  }

  return { subscribe, close, providerFor, _channelFor: channelFor };
})();
