// =========================================================
// Pengaturan tampilan (tema terang/gelap + jenis font).
// Dimuat di <head> SEMUA halaman (sebelum CSS selesai dipakai) supaya
// pilihan langsung terpasang dan layar tidak berkedip terang -> gelap.
// Disimpan di localStorage perangkat ini ("app_pref_v1"), jadi tiap
// perangkat/browser punya pilihannya sendiri.
// Halaman pengaturan.html memakai window.AppPref dari file ini.
// =========================================================
(function () {
  var KEY = "app_pref_v1";

  // Daftar font. "gf" = nama keluarga di Google Fonts (dimuat HANYA kalau
  // dipilih, jadi pilihan bawaan tidak menambah unduhan).
  var FONTS = {
    inter:    { label: "Inter",     note: "Bawaan",            stack: "'Inter', -apple-system, sans-serif" },
    sistem:   { label: "Sistem",    note: "Segoe UI / SF / Roboto bawaan perangkat", stack: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif" },
    roboto:   { label: "Roboto",    note: "Rapi & netral",     stack: "'Roboto', 'Inter', sans-serif",    gf: "Roboto:wght@400;500;700" },
    opensans: { label: "Open Sans", note: "Lebar & mudah dibaca", stack: "'Open Sans', 'Inter', sans-serif", gf: "Open+Sans:wght@400;600;700" },
    poppins:  { label: "Poppins",   note: "Bulat & modern",    stack: "'Poppins', 'Inter', sans-serif",   gf: "Poppins:wght@400;500;600;700" },
    manrope:  { label: "Manrope",   note: "Ramping & tegas",   stack: "'Manrope', 'Inter', sans-serif",   gf: "Manrope:wght@400;500;600;700;800" }
  };
  var UKURAN = { kecil: "Kecil", normal: "Normal", besar: "Besar" };
  var LINES = ["E-02", "E-03", "E-04", "E-05", "E-06", "E-07"];
  // halamanAwal: "auto" = otomatis sesuai peran (bawaan). Selain itu = nama file.
  var DEFAULT = { tema: "terang", font: "inter", ukuran: "normal", sidebar: "bawaan", line: "", halamanAwal: "auto" };

  function load() {
    var p = {};
    try { p = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { p = {}; }
    return {
      tema: p.tema || DEFAULT.tema,
      font: FONTS[p.font] ? p.font : DEFAULT.font,
      ukuran: UKURAN[p.ukuran] ? p.ukuran : DEFAULT.ukuran,
      sidebar: (p.sidebar === "terbuka" || p.sidebar === "menciut") ? p.sidebar : DEFAULT.sidebar,
      line: LINES.indexOf(p.line) >= 0 ? p.line : "",
      halamanAwal: typeof p.halamanAwal === "string" && p.halamanAwal ? p.halamanAwal : DEFAULT.halamanAwal
    };
  }
  function save(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {} }

  function systemDark() {
    try { return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches); }
    catch (e) { return false; }
  }
  function temaEfektif(tema) {
    if (tema === "gelap") return "dark";
    if (tema === "auto") return systemDark() ? "dark" : "light";
    return "light";
  }

  // Muat file font dari Google Fonts sekali saja (kalau belum ada di halaman).
  function muatFont(key) {
    var f = FONTS[key];
    if (!f || !f.gf) return;
    var id = "pref-font-" + key;
    if (document.getElementById(id)) return;
    var l = document.createElement("link");
    l.id = id; l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=" + f.gf + "&display=swap";
    (document.head || document.documentElement).appendChild(l);
    try { if (document.fonts && document.fonts.load) document.fonts.load("16px '" + f.label + "'"); } catch (e) {}
  }

  function apply(p) {
    p = p || load();
    var root = document.documentElement;
    // Desain halaman dibuat untuk tema terang. Mode gelap = tema terang yang
    // warnanya dibalik otomatis lewat CSS (html[data-tampilan="gelap"] di
    // style.css), jadi semua halaman ikut konsisten tanpa warna yang hilang.
    root.setAttribute("data-theme", "light");
    root.setAttribute("data-tampilan", temaEfektif(p.tema) === "dark" ? "gelap" : "terang");
    if (p.ukuran === "kecil" || p.ukuran === "besar") root.setAttribute("data-ukuran", p.ukuran);
    else root.removeAttribute("data-ukuran");
    var f = FONTS[p.font] || FONTS.inter;
    muatFont(p.font);
    if (p.font === "inter") {          // bawaan: kembalikan ke nilai di style.css
      root.style.removeProperty("--font-body");
      root.style.removeProperty("--font-display");
      root.style.removeProperty("--font-ui");
    } else {
      root.style.setProperty("--font-ui", f.stack);
      root.style.setProperty("--font-body", f.stack);
      root.style.setProperty("--font-display", f.stack);
    }
  }

  // "Ikuti perangkat": kalau pengaturan OS berubah saat halaman terbuka
  try {
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    var onChg = function () { if (load().tema === "auto") apply(); };
    if (mq.addEventListener) mq.addEventListener("change", onChg);
    else if (mq.addListener) mq.addListener(onChg);
  } catch (e) {}

  window.AppPref = {
    FONTS: FONTS,
    DEFAULT: DEFAULT,
    load: load,
    apply: apply,
    muatFont: muatFont,
    UKURAN: UKURAN,
    LINES: LINES,
    // Nilai awal sidebar: defaultCollapsed = bawaan halaman itu sendiri.
    sidebarAwal: function (defaultCollapsed) {
      var s = load().sidebar;
      if (s === "terbuka") return false;
      if (s === "menciut") return true;
      return defaultCollapsed;
    },
    // Line favorit ("" = semua line). Dipakai sebagai nilai awal filter.
    lineFavorit: function () { return load().line || ""; },
    set: function (patch) { var p = load(); for (var k in patch) p[k] = patch[k]; save(p); apply(p); return p; },
    reset: function () { save(DEFAULT); apply(DEFAULT); return load(); }
  };
  apply(load());
})();
