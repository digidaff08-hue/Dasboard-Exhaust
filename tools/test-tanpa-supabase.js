// Uji otomatis pengganti Supabase (assets/tanpa-supabase.js). Jalankan: node tools/test-tanpa-supabase.js
const vm = require("vm"), fs = require("fs"), path = require("path");
const R = path.join(__dirname, "..", "assets") + "/";

function mkEnv(search, ls, protocol, hostname) {
  protocol = protocol || "file:"; hostname = hostname || "";
  // kelas Storage BARU tiap halaman (seperti browser: tiap muat halaman = prototype segar)
  class FakeStorage {                    // meniru Storage browser (dipakai utk uji pemisahan kunci)
    constructor() { this.m = {}; }
    getItem(k) { return k in this.m ? this.m[k] : null; }
    setItem(k, v) { this.m[k] = String(v); }
    removeItem(k) { delete this.m[k]; }
  }
  const local = new FakeStorage(); Object.assign(local.m, ls || {});
  const sess = new FakeStorage(); const written = [];
  const win = {};
  const ctx = vm.createContext({
    window: win, console, setTimeout, Promise, URLSearchParams, Proxy, JSON, Math, Date, Number, String, Array, Object, Error, RegExp, Set, URL,
    Storage: FakeStorage, localStorage: local, sessionStorage: sess, crypto: require("crypto"), navigator: {},
    location: { search, protocol, hostname, pathname: "/x/login.html" },
    document: { currentScript: { src: "http://x/assets/supabaseClient.js" }, readyState: "complete", body: null, write: (s) => written.push(s), getElementById: () => null, addEventListener() {} },
  });
  Object.assign(win, { top: win, self: win, window: win, location: { search, protocol, hostname }, crypto: require("crypto"), supabase: undefined });
  return { ctx, local, written };
}
const load = (name, ctx) => vm.runInContext(fs.readFileSync(R + name, "utf8"), ctx);

async function main() {
  let pass = 0, fail = 0;
  const ok = (c, m) => { if (c) pass++; else { fail++; console.log("GAGAL:", m); } };
  const asReal = (e) => { let called = false; e.ctx.window.supabase = { createClient: () => { called = true; return { real: true }; } }; return () => called; };
  const noReal = (e) => { e.ctx.window.supabase = { createClient: () => { throw new Error("TIDAK BOLEH memanggil Supabase asli"); } }; };

  // ===== aturan kapan aktif =====
  let e = mkEnv("", {}, "https:", "app-kita.vercel.app"); let called = asReal(e);
  load("supabaseClient.js", e.ctx);
  ok(called() && e.written.length === 0, "alamat ONLINE tanpa flag harus pakai Supabase asli");

  e = mkEnv("", {}, "file:", ""); noReal(e); load("supabaseClient.js", e.ctx);
  ok(e.written.length === 1 && e.written[0].includes("assets/tanpa-supabase.js"), "file: lokal otomatis tanpa Supabase");

  e = mkEnv("", {}, "http:", "localhost"); noReal(e); load("supabaseClient.js", e.ctx);
  ok(e.written.length === 1, "localhost otomatis tanpa Supabase");

  e = mkEnv("?supabase=on", {}, "file:", ""); called = asReal(e); load("supabaseClient.js", e.ctx);
  ok(called() && e.written.length === 0, "?supabase=on di lokal harus paksa Supabase asli");

  e = mkEnv("?supabase=off", {}, "https:", "app-kita.vercel.app"); noReal(e); load("supabaseClient.js", e.ctx);
  ok(e.written.length === 1 && e.local.m.tanpa_supabase_v1 === "off", "?supabase=off di online harus paksa tanpa Supabase");

  e = mkEnv("?supabase=reset", { tanpa_supabase_v1: "on" }, "https:", "x.vercel.app"); asReal(e); load("supabaseClient.js", e.ctx);
  ok(!("tanpa_supabase_v1" in e.local.m), "?supabase=reset menghapus override");

  // SAKLAR false di file -> pakai Supabase asli walau di lokal
  const srcFalse = fs.readFileSync(R + "supabaseClient.js", "utf8").replace("const MODE_TANPA_SUPABASE = true;", "const MODE_TANPA_SUPABASE = false;");
  ok(srcFalse.includes("const MODE_TANPA_SUPABASE = false;"), "saklar false harus bisa diubah");
  e = mkEnv("", {}, "file:", ""); called = asReal(e); vm.runInContext(srcFalse, e.ctx);
  ok(called() && e.written.length === 0, "MODE_TANPA_SUPABASE=false di lokal harus pakai Supabase asli");

  // ===== perilaku saat aktif: SEMUA KOSONG =====
  e = mkEnv("", {}, "file:", ""); noReal(e);
  load("supabaseClient.js", e.ctx); load("tanpa-supabase.js", e.ctx);
  const T = (code) => vm.runInContext("(async()=>{" + code + "})()", e.ctx);

  const sess = await T(`const {data:{session}}=await supabaseClient.auth.getSession(); return session&&session.user.id;`);
  ok(sess === "user-contoh-0001", "ada sesi masuk");
  const prof = await T(`const {data}=await supabaseClient.from("profiles").select("*").eq("id","user-contoh-0001").maybeSingle(); return data;`);
  ok(prof && prof.role === "admin", "profil admin ada (agar login tidak menghalangi)");

  const tabel = ["production_log", "downtime_log", "dandori_log", "part_numbers", "downtime_problems", "nonproduksi_types",
    "repair_views", "repair_kategori", "attendance_log", "mesin_settings", "production_plan_harian", "ng_inline_log"];
  for (const t of tabel) {
    const n = await T(`const {data,error}=await supabaseClient.from("${t}").select("*"); return error?-1:data.length;`);
    ok(n === 0, `tabel ${t} harus KOSONG (tidak ada data palsu), dapat: ${n}`);
  }
  const rp = await T(`const {data,error}=await supabaseClient.rpc("performance_aggregate",{}).range(0,999); return {data,error};`);
  ok(Array.isArray(rp.data) && rp.data.length === 0 && !rp.error, "RPC apa pun = daftar kosong");
  const rp2 = await T(`const {data}=await supabaseClient.rpc("plan_produksi_actual",{p_tanggal:"2026-10-13"}); return data;`);
  ok(Array.isArray(rp2) && rp2.length === 0, "plan_produksi_actual kosong");
  const kode = await T(`const {data}=await supabaseClient.rpc("generate_kode_produksi",{p_mesin:"E-04"}); return data;`);
  ok(typeof kode === "string" && kode.startsWith("E04-"), "generate_kode_produksi tetap jalan agar form tidak macet");

  // ===== mesin query dasar (pakai data yang dimasukkan sendiri di uji) =====
  const ins = await T(`const {data,error}=await supabaseClient.from("nonproduksi_types").insert({mesin:"E-02",nama:"Tes"}).select().single(); return {data,error};`);
  ok(!ins.error && ins.data.nama === "Tes" && ins.data.id, "insert+select+single");
  const got = await T(`const {data}=await supabaseClient.from("nonproduksi_types").select("*").eq("mesin","E-02"); return data.length;`);
  ok(got === 1, "data yang diinput terbaca lagi (selama halaman belum di-reload)");
  const upd = await T(`const {data}=await supabaseClient.from("nonproduksi_types").update({nama:"Tes2"}).eq("mesin","E-02").select(); return data;`);
  ok(upd.length === 1 && upd[0].nama === "Tes2", "update+select");
  await T(`await supabaseClient.from("mesin_settings").upsert({mesin:"E-02",gsph_target_fixed:50},{onConflict:"mesin"}); await supabaseClient.from("mesin_settings").upsert({mesin:"E-02",gsph_target_fixed:60},{onConflict:"mesin"});`);
  const up = await T(`const {data}=await supabaseClient.from("mesin_settings").select("*"); return data;`);
  ok(up.length === 1 && up[0].gsph_target_fixed === 60, "upsert onConflict tidak menggandakan baris");
  const cnt = await T(`return await supabaseClient.from("nonproduksi_types").select("*",{count:"exact",head:true});`);
  ok(cnt.count === 1 && cnt.data === null, "count exact + head");
  await T(`await supabaseClient.from("nonproduksi_types").delete().eq("mesin","E-02");`);
  const del = await T(`const {data}=await supabaseClient.from("nonproduksi_types").select("*"); return data.length;`);
  ok(del === 0, "delete");
  const none = await T(`return await supabaseClient.from("profiles").select("*").eq("id","zzz").single();`);
  ok(none.error && none.error.code === "PGRST116", "single tanpa baris = error PGRST116");

  ok(await T(`const c=supabaseClient.channel("x").on("postgres_changes",{},()=>{}).subscribe(); await supabaseClient.removeChannel(c); return true;`) === true, "channel/realtime stub");
  const st = await T(`const r=await supabaseClient.storage.from("b").upload("a.png",{}); const u=supabaseClient.storage.from("b").getPublicUrl("a.png"); return [r.error,u.data.publicUrl.slice(0,10)];`);
  ok(st[0] === null && st[1].startsWith("data:image"), "storage stub");
  await T(`await supabaseClient.auth.signOut();`);
  ok(await T(`const {data:{session}}=await supabaseClient.auth.getSession(); return session;`) === null, "setelah signOut sesi null");
  await T(`await supabaseClient.auth.signInWithPassword({email:"a",password:"b"});`);
  ok(await T(`const {data:{session}}=await supabaseClient.auth.getSession(); return !!session;`) === true, "setelah signIn sesi ada");

  // ===== PEMISAHAN penyimpanan browser (antrean offline & status produksi) =====
  const e3 = mkEnv("", { offline_queue_v2: "ASLI-MENUNGGU", linestate_v3_E_02: "ASLI-STATE", theme_v1: "dark" }, "file:", ""); noReal(e3);
  load("supabaseClient.js", e3.ctx); load("tanpa-supabase.js", e3.ctx);
  const ls = (code) => vm.runInContext(code, e3.ctx);
  ok(ls(`localStorage.getItem("offline_queue_v2")`) === null, "antrean ASLI tidak terbaca di mode tanpa Supabase (tidak 'terkirim' ke tiruan)");
  ok(ls(`localStorage.getItem("linestate_v3_E_02")`) === null, "status produksi ASLI tidak terbaca");
  ls(`localStorage.setItem("offline_queue_v2","PALSU"); localStorage.setItem("linestate_v3_E_02","PALSU-STATE")`);
  ok(e3.local.m.offline_queue_v2 === "ASLI-MENUNGGU" && e3.local.m.linestate_v3_E_02 === "ASLI-STATE", "isi ASLI tidak tertimpa");
  ok(e3.local.m.contoh_offline_queue_v2 === "PALSU" && e3.local.m.contoh_linestate_v3_E_02 === "PALSU-STATE", "yang ditulis di mode ini masuk ke kunci berawalan contoh_");
  ok(ls(`localStorage.getItem("theme_v1")`) === "dark", "pengaturan lain (tema) tidak ikut dipisah");
  // kembali ke Supabase asli: kunci asli utuh, kunci contoh_ tak pernah dibaca
  const e4 = mkEnv("?supabase=on", Object.assign({}, e3.local.m), "file:", ""); asReal(e4); load("supabaseClient.js", e4.ctx);
  ok(vm.runInContext(`localStorage.getItem("offline_queue_v2")`, e4.ctx) === "ASLI-MENUNGGU", "setelah kembali ke Supabase, antrean asli utuh & tanpa data palsu");

  console.log(`\nHASIL: ${pass} lulus, ${fail} gagal`);
  process.exit(fail ? 1 : 0);
}
main().catch((err) => { console.error("ERROR UJI:", err); process.exit(2); });
