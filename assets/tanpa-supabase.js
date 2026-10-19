// =========================================================
// TANPA SUPABASE -- pengganti Supabase yang jalan sepenuhnya di browser.
//
// Dipakai untuk melihat / memperbaiki TAMPILAN saat Supabase belum bisa
// dipakai. Tidak ada request jaringan ke Supabase, dan TIDAK ADA DATA:
// semua tabel kosong, semua RPC mengembalikan daftar kosong. Satu-satunya
// isi adalah sebuah akun masuk ("Admin Contoh") supaya pemeriksaan login
// tidak menghalangi halaman.
//
// Kapan aktif & cara kembali ke Supabase: lihat bagian atas
// assets/supabaseClient.js (MODE_TANPA_SUPABASE).
//
// Perlu diketahui:
//  - Bagian yang butuh data (tabel, grafik, KPI) tampil kosong / 0.
//  - Yang kamu isi di form hanya hidup di memori dan hilang saat reload.
//  - Antrean offline & status "Mulai Produksi" disimpan di browser dengan
//    nama berawalan "contoh_", jadi tidak pernah bercampur dengan yang asli.
//  - approval-cuti.html memakai koneksi sendiri -> tidak ikut.
//
// File ini hanya diunduh saat mode tanpa Supabase aktif.
// =========================================================
(function () {
  "use strict";

  // ---------- pisahkan penyimpanan browser dari yang ASLI ----------
  // Kunci ini biasanya berisi antrean kirim-ulang dan status produksi yang
  // sedang berjalan. Di mode ini diberi awalan supaya tidak pernah terkirim
  // ke Supabase asli nanti, dan antrean asli tidak "terkirim" ke tiruan.
  try {
    if (typeof Storage !== "undefined" && !Storage.prototype.__tanpaSupabase) {
      const AWALAN = "contoh_", KUNCI = /^(offline_queue|linestate_)/;
      const g = Storage.prototype.getItem, s = Storage.prototype.setItem, r = Storage.prototype.removeItem;
      const k2 = (k) => (KUNCI.test(String(k)) ? AWALAN + k : k);
      Storage.prototype.getItem = function (k) { return g.call(this, k2(k)); };
      Storage.prototype.setItem = function (k, v) { return s.call(this, k2(k), v); };
      Storage.prototype.removeItem = function (k) { return r.call(this, k2(k)); };
      Storage.prototype.__tanpaSupabase = true;
    }
  } catch (e) { /* abaikan */ }

  // ---------- util dasar ----------
  const pad = (n) => String(n).padStart(2, "0");
  const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
  let _idn = 0;
  const uuid = () => {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    _idn++;
    return "contoh-" + Date.now().toString(36) + "-" + _idn.toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  };
  const nowIso = () => new Date().toISOString();

  // ---------- sesi / akun masuk ----------
  const USER_CONTOH = {
    id: "user-contoh-0001",
    email: "admin@contoh.local",
    user_metadata: { full_name: "Admin Contoh" },
    app_metadata: {},
    aud: "authenticated",
  };
  const SESI_CONTOH = { access_token: "token-contoh", refresh_token: "refresh-contoh", token_type: "bearer", expires_in: 86400, user: USER_CONTOH };
  const loggedOut = () => { try { return sessionStorage.getItem("contoh_keluar") === "1"; } catch (e) { return false; } };

  // ---------- penyimpanan data: KOSONG ----------
  const DB = {};
  const table = (name) => (DB[name] || (DB[name] = []));
  // satu-satunya isi: profil akun masuk (dibutuhkan pemeriksaan login)
  table("profiles").push({
    id: USER_CONTOH.id, full_name: "Admin Contoh", role: "admin", jabatan: "admin",
    nik: "CONTOH001", email: USER_CONTOH.email, no_wa: "", created_at: nowIso(),
  });

  // ---------- perbandingan & filter ----------
  const ISO_DT = /^\d{4}-\d{2}-\d{2}T/;
  function cmp(a, b) {
    if (a === null || a === undefined || b === null || b === undefined) return a == b ? 0 : (a == null ? -1 : 1);
    if (typeof a === "number" || typeof b === "number") return Number(a) - Number(b);
    if (typeof a === "boolean" || typeof b === "boolean") return Number(a) - Number(b);
    if (typeof a === "string" && typeof b === "string" && (ISO_DT.test(a) || ISO_DT.test(b))) {
      const x = Date.parse(a), y = Date.parse(b);
      if (!isNaN(x) && !isNaN(y)) return x - y;
    }
    a = String(a); b = String(b);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  const likeToRe = (pat, flags) => new RegExp("^" + String(pat).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".") + "$", flags);
  const parseVal = (v) => (v === "null" ? null : v === "true" ? true : v === "false" ? false : v);

  function makePredicate(col, op, val) {
    switch (op) {
      case "eq": return (r) => r[col] !== undefined && r[col] !== null && cmp(r[col], val) === 0;
      case "neq": return (r) => !(r[col] !== undefined && r[col] !== null && cmp(r[col], val) === 0) && !(r[col] == null && val == null);
      case "gt": return (r) => r[col] != null && cmp(r[col], val) > 0;
      case "gte": return (r) => r[col] != null && cmp(r[col], val) >= 0;
      case "lt": return (r) => r[col] != null && cmp(r[col], val) < 0;
      case "lte": return (r) => r[col] != null && cmp(r[col], val) <= 0;
      case "in": {
        const list = Array.isArray(val) ? val : String(val).replace(/^\(|\)$/g, "").split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
        return (r) => r[col] != null && list.some((x) => cmp(r[col], x) === 0);
      }
      case "is": return (r) => (val === null || val === "null" ? r[col] == null : r[col] === parseVal(String(val)));
      case "like": { const re = likeToRe(val); return (r) => r[col] != null && re.test(String(r[col])); }
      case "ilike": { const re = likeToRe(val, "i"); return (r) => r[col] != null && re.test(String(r[col])); }
      case "contains": return (r) => Array.isArray(r[col]) && (Array.isArray(val) ? val : [val]).every((x) => r[col].includes(x));
      default: return () => true;
    }
  }
  function splitTop(s) {
    const out = []; let depth = 0, cur = "";
    for (const ch of s) {
      if (ch === "(") depth++; if (ch === ")") depth--;
      if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  }
  function parseOr(str) {
    const preds = splitTop(str).map((part) => {
      const m = part.match(/^([^.]+)\.(not\.)?([a-z]+)\.(.*)$/);
      if (!m) return () => true;
      let val = m[4]; if (m[3] !== "in") val = m[3] === "is" ? val : parseVal(val);
      const p = makePredicate(m[1], m[3], val);
      return m[2] ? (r) => !p(r) : p;
    });
    return (r) => preds.some((p) => p(r));
  }

  // ---------- query builder ----------
  class Query {
    constructor(name) {
      this.t = name; this.op = "select"; this.filters = []; this.orders = []; this.lim = null; this.rng = null;
      this.mode = null; this.payload = null; this.returning = false; this.countMode = null; this.head = false; this.onConflict = null;
    }
    select(_cols, opts) {
      if (this.op === "select") this.op = "select"; else this.returning = true;
      if (opts && opts.count) this.countMode = opts.count;
      if (opts && opts.head) this.head = true;
      return this;
    }
    insert(p) { this.op = "insert"; this.payload = p; return this; }
    update(p) { this.op = "update"; this.payload = p; return this; }
    upsert(p, o) { this.op = "upsert"; this.payload = p; this.onConflict = (o && o.onConflict) || null; return this; }
    delete() { this.op = "delete"; return this; }
    eq(c, v) { this.filters.push(makePredicate(c, "eq", v)); return this; }
    neq(c, v) { this.filters.push(makePredicate(c, "neq", v)); return this; }
    gt(c, v) { this.filters.push(makePredicate(c, "gt", v)); return this; }
    gte(c, v) { this.filters.push(makePredicate(c, "gte", v)); return this; }
    lt(c, v) { this.filters.push(makePredicate(c, "lt", v)); return this; }
    lte(c, v) { this.filters.push(makePredicate(c, "lte", v)); return this; }
    in(c, v) { this.filters.push(makePredicate(c, "in", v)); return this; }
    is(c, v) { this.filters.push(makePredicate(c, "is", v)); return this; }
    like(c, v) { this.filters.push(makePredicate(c, "like", v)); return this; }
    ilike(c, v) { this.filters.push(makePredicate(c, "ilike", v)); return this; }
    contains(c, v) { this.filters.push(makePredicate(c, "contains", v)); return this; }
    not(c, op, v) { const p = makePredicate(c, op, op === "is" ? v : v); this.filters.push((r) => !p(r)); return this; }
    or(str) { this.filters.push(parseOr(str)); return this; }
    match(obj) { Object.keys(obj || {}).forEach((k) => this.eq(k, obj[k])); return this; }
    filter(c, op, v) { this.filters.push(makePredicate(c, op, v)); return this; }
    order(c, o) { this.orders.push({ c, asc: !(o && o.ascending === false) }); return this; }
    limit(n) { this.lim = n; return this; }
    range(a, b) { this.rng = [a, b]; return this; }
    single() { this.mode = "single"; return this; }
    maybeSingle() { this.mode = "maybe"; return this; }
    abortSignal() { return this; }
    then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }
    catch(rej) { return this.then(undefined, rej); }

    run() {
      const rows = table(this.t);
      const match = (r) => this.filters.every((f) => f(r));
      let out;
      if (this.op === "insert" || this.op === "upsert") {
        const items = (Array.isArray(this.payload) ? this.payload : [this.payload]).map(clone);
        out = [];
        items.forEach((it) => {
          let existing = null;
          if (this.op === "upsert") {
            const keys = this.onConflict ? this.onConflict.split(",").map((s) => s.trim()) : ["id"];
            existing = rows.find((r) => keys.every((k) => it[k] !== undefined && cmp(r[k], it[k]) === 0));
          }
          if (existing) { Object.assign(existing, it, { updated_at: nowIso() }); out.push(existing); return; }
          const row = Object.assign({ id: uuid(), created_at: nowIso(), updated_at: nowIso() }, it);
          if (this.t === "mesin_settings" || this.t === "profiles") { if (!it.id) delete row.id; }
          rows.push(row); out.push(row);
        });
      } else if (this.op === "update") {
        out = rows.filter(match);
        out.forEach((r) => Object.assign(r, clone(this.payload), { updated_at: nowIso() }));
      } else if (this.op === "delete") {
        out = rows.filter(match);
        const ids = new Set(out.map((r) => r.id));
        DB[this.t] = rows.filter((r) => !ids.has(r.id));
        if (this.t === "production_log") DB.downtime_log = table("downtime_log").filter((d) => !ids.has(d.production_log_id));
      } else {
        out = rows.filter(match);
        this.orders.slice().reverse().forEach((o) => out.sort((a, b) => (o.asc ? 1 : -1) * cmp(a[o.c], b[o.c])));
      }
      const isRead = this.op === "select";
      const wantsRows = isRead || this.returning;
      let count = null;
      if (this.countMode) count = out.length;
      if (this.rng) out = out.slice(this.rng[0], this.rng[1] + 1);
      if (this.lim !== null) out = out.slice(0, this.lim);
      if (this.head) return { data: null, error: null, count };
      if (!wantsRows) return { data: null, error: null, count };
      out = clone(out);
      if (this.mode === "single") {
        if (out.length !== 1) return { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" }, count };
        return { data: out[0], error: null, count };
      }
      if (this.mode === "maybe") {
        if (out.length > 1) return { data: null, error: { code: "PGRST116", message: "multiple rows returned" }, count };
        return { data: out[0] || null, error: null, count };
      }
      return { data: out, error: null, count };
    }
  }

  // ---------- RPC: semua kosong, kecuali yang perlu supaya form/login tidak macet ----------
  const RPC = {
    generate_kode_produksi: (p) => `${String((p && (p.p_mesin || p.mesin)) || "E-02").replace("-", "")}-${dstr(new Date()).replace(/-/g, "").slice(2)}-${pad(table("production_log").length % 100)}`,
    generate_kode_produksi_new: (p) => RPC.generate_kode_produksi(p),
    login_nik: () => USER_CONTOH.email,
    login_khusus: () => USER_CONTOH.email,
    email_for_nik: () => USER_CONTOH.email,
    cek_email_nik: () => USER_CONTOH.email,
    nik_terdaftar: () => true,
  };

  class RpcQuery {
    constructor(name, params) { this.name = name; this.params = params || {}; this.rng = null; this.mode = null; }
    range(a, b) { this.rng = [a, b]; return this; }
    limit() { return this; }
    order() { return this; }
    single() { this.mode = "single"; return this; }
    maybeSingle() { this.mode = "maybe"; return this; }
    then(res, rej) {
      return Promise.resolve().then(() => {
        const fn = RPC[this.name];
        let data = fn ? fn(this.params) : [];
        if (Array.isArray(data) && this.rng) data = data.slice(this.rng[0], this.rng[1] + 1);
        if (this.mode === "single") data = Array.isArray(data) ? data[0] || null : data;
        if (this.mode === "maybe") data = Array.isArray(data) ? data[0] || null : data;
        return { data: clone(data), error: null };
      }).then(res, rej);
    }
    catch(rej) { return this.then(undefined, rej); }
  }

  // ---------- storage palsu (upload di-memori, URL = blob) ----------
  const FILES = {};
  const PLACEHOLDER = "data:image/svg+xml;utf8," + encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='320' height='200'><rect width='100%' height='100%' fill='#e5e7eb'/><text x='50%' y='50%' text-anchor='middle' dy='.3em' font-family='sans-serif' font-size='18' fill='#6b7280'>FOTO CONTOH</text></svg>");
  const storage = {
    from(bucket) {
      return {
        upload: async (path, file) => {
          try { FILES[bucket + "/" + path] = URL.createObjectURL(file); } catch (e) {}
          return { data: { path }, error: null };
        },
        getPublicUrl: (path) => ({ data: { publicUrl: FILES[bucket + "/" + path] || PLACEHOLDER } }),
        createSignedUrl: async (path) => ({ data: { signedUrl: FILES[bucket + "/" + path] || PLACEHOLDER }, error: null }),
        remove: async () => ({ data: [], error: null }),
        list: async () => ({ data: [], error: null }),
        download: async () => ({ data: null, error: { message: "contoh" } }),
      };
    },
  };

  // ---------- klien ----------
  function createClient() {
    return {
      from: (name) => new Query(name),
      rpc: (name, params) => new RpcQuery(name, params),
      auth: {
        getSession: async () => ({ data: { session: loggedOut() ? null : SESI_CONTOH }, error: null }),
        getUser: async () => ({ data: { user: loggedOut() ? null : USER_CONTOH }, error: null }),
        onAuthStateChange: (cb) => {
          setTimeout(() => { try { cb(loggedOut() ? "SIGNED_OUT" : "SIGNED_IN", loggedOut() ? null : SESI_CONTOH); } catch (e) {} }, 0);
          return { data: { subscription: { unsubscribe() {} } } };
        },
        signInWithPassword: async () => { try { sessionStorage.removeItem("contoh_keluar"); } catch (e) {} return { data: { session: SESI_CONTOH, user: USER_CONTOH }, error: null }; },
        signUp: async () => ({ data: { user: USER_CONTOH, session: SESI_CONTOH }, error: null }),
        signOut: async () => { try { sessionStorage.setItem("contoh_keluar", "1"); } catch (e) {} return { error: null }; },
        resetPasswordForEmail: async () => ({ data: {}, error: null }),
        updateUser: async () => ({ data: { user: USER_CONTOH }, error: null }),
      },
      channel: () => {
        const ch = { on: () => ch, subscribe: (cb) => { if (typeof cb === "function") setTimeout(() => cb("SUBSCRIBED"), 0); return ch; }, unsubscribe: () => Promise.resolve("ok") };
        return ch;
      },
      removeChannel: () => Promise.resolve("ok"),
      removeAllChannels: () => Promise.resolve([]),
      storage,
      functions: { invoke: async () => ({ data: null, error: null }) },
    };
  }

  window.__tanpaSupabase = createClient();
  window.__dataKosong = DB;      // untuk mengintip lewat Console: __dataKosong
  console.info("[TANPA SUPABASE] Tidak terhubung ke Supabase. Semua data kosong.");
})();
