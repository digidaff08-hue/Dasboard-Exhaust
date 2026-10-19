// =========================================================
// Helper bersama (dipakai dashboard-exhaust.html & machines/*.html)
// Dimuat SEBELUM assets/machine-page.js / assets/dashboard-exhaust.js.
//
// Catatan: fmtNum TIDAK digabung ke sini karena versi dashboard dan
// versi halaman mesin beda perilaku untuk nilai string kosong ("").
// =========================================================

// Ambil nilai CSS variable (mis. "--accent") dari <html>
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Tanggal lokal (BUKAN UTC) format YYYY-MM-DD
function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
