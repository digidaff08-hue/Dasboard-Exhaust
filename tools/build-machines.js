#!/usr/bin/env node
// =========================================================
// Generator halaman line: machines/e-02.html ... e-07.html
//
// Semua halaman line ISINYA SAMA, cuma beda kode line. Jadi yang
// diedit cukup SATU file:   tools/machine-template.html
// lalu jalankan:            node tools/build-machines.js
//
// Placeholder di template:
//   {{LINE}}  -> kode line huruf besar  (mis. E-03)
//   {{line}}  -> kode line huruf kecil  (mis. e-03)
//
// Opsi:
//   --check   tidak menulis apa-apa; cuma cek apakah machines/*.html
//             sudah sesuai template (exit code 1 kalau ada yang beda)
//
// Tambah line baru: tambahkan kodenya di LINES di bawah, jalankan
// script, lalu daftarkan juga di service-worker.js (SHELL_FILES) dan
// MACHINES di assets/dashboard-exhaust.js.
// =========================================================
const fs = require("fs");
const path = require("path");

const LINES = ["E-02", "E-03", "E-04", "E-05", "E-06", "E-07"];

const root = path.join(__dirname, "..");
const template = fs.readFileSync(path.join(__dirname, "machine-template.html"), "utf8");
const checkOnly = process.argv.includes("--check");
let beda = 0;

for (const line of LINES) {
  const out = template.replace(/\{\{LINE\}\}/g, line).replace(/\{\{line\}\}/g, line.toLowerCase());
  const file = path.join(root, "machines", line.toLowerCase() + ".html");
  const lama = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (lama === out) { console.log("  sama   machines/" + path.basename(file)); continue; }
  beda++;
  if (checkOnly) { console.log("  BEDA   machines/" + path.basename(file)); continue; }
  fs.writeFileSync(file, out);
  console.log("  ditulis machines/" + path.basename(file));
}
if (checkOnly && beda) { console.log("\n" + beda + " file tidak sesuai template. Jalankan: node tools/build-machines.js"); process.exit(1); }
