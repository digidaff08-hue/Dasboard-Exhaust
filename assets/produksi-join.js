// =========================================================
// SATU SUMBER ATURAN untuk 2 hal yang dulu jawabannya beda-beda
// di tiap halaman:
//
//   1. NG Inline nempel ke baris produksi yang mana?
//   2. Downtime sebuah baris produksi berapa menit?
//
// File ini dimuat SEBELUM assets/machine-page.js (halaman tiap line)
// dan juga oleh data-mentah.html, supaya halaman Performance, Riwayat
// Produksi, Data Mentah (Produksi & Nippo), dan file Excel hasil export
// SELALU memberi angka yang sama. Dulu tiap tempat punya caranya
// sendiri-sendiri, jadi satu perbaikan tidak pernah ikut ke tempat lain.
//
// Pasangan SQL-nya: migration_ng_hari_produksi.sql
// (fungsi public.ng_waktu_kejadian & public.ng_hari_produksi).
// =========================================================

// Penanda versi. Dipakai halaman untuk menampilkan "build" yang sedang
// jalan, supaya kalau ada angka yang terasa aneh kita bisa langsung tahu
// file-nya sudah ter-update atau belum -- tanpa perlu buka DevTools.
const PRODUKSI_JOIN_VERSI = "v79";
if (typeof window !== "undefined") window.PRODUKSI_JOIN_VERSI = PRODUKSI_JOIN_VERSI;

// ---------- dasar ----------
function pjLocalDateStr(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Hari produksi mulai jam 07:00 WIB. Jadi "hari produksi" sebuah titik
// waktu = tanggal dari (waktu - 7 jam). Dipakai untuk NG maupun baris
// produksi, supaya shift 2 yang lewat tengah malam tetap dianggap satu
// hari dengan shift yang melahirkannya.
function pjHariProduksiDariWaktu(waktu) {
  const d = waktu instanceof Date ? waktu : new Date(waktu);
  if (!d || Number.isNaN(d.getTime())) return null;
  return pjLocalDateStr(new Date(d.getTime() - 7 * 60 * 60 * 1000));
}

// ---------- NG Inline ----------

// Titik waktu kejadian sebuah baris NG Inline:
//   waktu_kejadian -> kalau kosong: tanggal + jam -> kalau jam juga
//   kosong (data lama): tanggal jam 12:00, supaya hari produksinya sama
//   persis dengan perilaku lama yang cuma memakai kolom tanggal
//   (data lama TIDAK ikut bergeser hari).
// Kembar dengan fungsi SQL public.ng_waktu_kejadian().
function ngWaktuKejadian(n) {
  if (!n) return null;
  if (n.waktu_kejadian) {
    const d = new Date(n.waktu_kejadian);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (!n.tanggal) return null;
  const jam = String(n.jam || "12:00").slice(0, 5); // kolom `time` bisa balik 'HH:MM:SS'
  const d = new Date(`${n.tanggal}T${jam}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Hari produksi sebuah baris NG Inline ('YYYY-MM-DD').
// Kembar dengan fungsi SQL public.ng_hari_produksi().
function ngHariProduksi(n) {
  const w = ngWaktuKejadian(n);
  if (!w) return n && n.tanggal ? String(n.tanggal) : null;
  return pjHariProduksiDariWaktu(w);
}

// Tempelkan baris-baris NG Inline ke baris produksi, bertingkat:
//   1) production_log_id -- dipakai HANYA kalau menunjuk ke baris yang
//      memang ada di daftar `rows` (link bisa menunjuk ke hari lain).
//   2) jam kejadian jatuh di dalam jendela waktu salah satu baris.
//   3) part number yang sama, DAN baris itu berada di hari produksi yang
//      sama dengan NG-nya. Syarat "hari produksi sama" ini penting:
//      daftar `rows` bisa berisi ratusan baris lintas banyak hari (tab
//      Riwayat Produksi, Data Mentah), jadi tanpa itu NG bisa nyasar ke
//      hari lain yang kebetulan memakai part number sama.
//      Kalau dalam 1 hari part itu dipakai beberapa baris, NG ditempel
//      ke baris dengan Qty terbesar (run utamanya).
// Balikan: { byRow: {idBarisProduksi: qty}, takTerpasang: qty }
function cocokkanNgKeBarisProduksi(ngRows, rows) {
  const byRow = {};
  let takTerpasang = 0;
  const daftar = rows || [];
  const idSet = new Set(daftar.map((r) => r.id));
  const normPart = (v) => String(v || "").trim().toUpperCase();

  (ngRows || []).forEach((n) => {
    const qty = Number(n.qty) || 0;
    if (!qty) return;

    if (n.production_log_id && idSet.has(n.production_log_id)) {
      byRow[n.production_log_id] = (byRow[n.production_log_id] || 0) + qty;
      return;
    }

    const w = ngWaktuKejadian(n);
    if (w) {
      const t = w.getTime();
      const row = daftar.find((r) => {
        if (n.mesin && r.mesin && n.mesin !== r.mesin) return false;
        const mulai = new Date(r.waktu_awal).getTime();
        const selesai = new Date(r.waktu_akhir).getTime();
        return t >= mulai && t < selesai;
      });
      if (row) { byRow[row.id] = (byRow[row.id] || 0) + qty; return; }
    }

    const part = normPart(n.part_number);
    const hariNg = ngHariProduksi(n);
    if (part && hariNg) {
      const kandidat = daftar.filter((r) => {
        if (n.mesin && r.mesin && n.mesin !== r.mesin) return false;
        if (normPart(r.part_number) !== part) return false;
        return pjHariProduksiDariWaktu(r.waktu_awal) === hariNg;
      });
      if (kandidat.length) {
        const row = kandidat.reduce((a, b) => ((Number(b.qty) || 0) > (Number(a.qty) || 0) ? b : a));
        byRow[row.id] = (byRow[row.id] || 0) + qty;
        return;
      }
    }

    takTerpasang += qty;
  });

  return { byRow, takTerpasang };
}

// Ambil baris NG Inline untuk rentang HARI PRODUKSI tertentu.
//
// Catatan penting soal cara ambilnya: query-nya menyaring pakai kolom
// `tanggal` saja -- kolom yang PASTI ada sejak schema_ng_inline.sql.
// Kolom jam/waktu_kejadian/production_log_id TIDAK boleh disebut di
// filter maupun di daftar select, karena kalau salah satunya belum ada
// di database, PostgREST menolak SELURUH query dan datanya balik kosong
// TANPA pesan error -- itu yang dulu bikin kolom "NG Inline" selalu 0 di
// banyak halaman sekaligus.
// Makanya: select("*") + rentang tanggal dilebarkan 1 hari di kedua
// ujung (NG jam 01:30 milik hari produksi kemarin, tanggalnya hari ini),
// lalu penyaringan hari produksinya dikerjakan di sini.
//
// `mesin` boleh 1 nama line (string) atau daftar line (array).
async function ambilNgInlineHariProduksi(client, mesin, dariStr, sampaiStr) {
  if (!dariStr || !sampaiStr) return [];
  const geser = (s, hari) => {
    const d = new Date(`${s}T00:00:00`);
    d.setDate(d.getDate() + hari);
    return pjLocalDateStr(d);
  };
  let q = client.from("ng_inline_log").select("*")
    .gte("tanggal", geser(dariStr, -1))
    .lte("tanggal", geser(sampaiStr, 1));
  if (Array.isArray(mesin)) q = q.in("mesin", mesin);
  else if (mesin) q = q.eq("mesin", mesin);
  const res = await q;
  if (res.error) {
    console.error("Gagal memuat NG Inline:", res.error);
    return [];
  }
  return (res.data || []).filter((n) => {
    const h = ngHariProduksi(n);
    return h && h >= dariStr && h <= sampaiStr;
  });
}

// ---------- Downtime ----------

// Downtime per baris produksi DIHITUNG dari tabel downtime_log, BUKAN
// dari kolom production_log.downtime_menit.
//
// Kolom lama itu praktis selalu 0: dia hanya terisi lewat trigger
// sync_production_downtime_menit (schema_welding.sql) yang butuh
// downtime_log.production_log_id. Sejak patch_fix_downtime_validation_trigger.sql,
// downtime di-link ke Input Produksi BARU dulu (production_log_new_id),
// jadi kolom di tabel lama tidak pernah ikut terisi. Akibatnya semua
// laporan yang membacanya menampilkan 0 / "-" walau Rekap Downtime jelas
// ada isinya.
//
// Aturan penempelan: sebuah downtime milik baris produksi yang jendela
// waktunya MEMUAT JAM MULAI downtime itu. Dipakai sama persis di semua
// tempat, termasuk di SQL performance_aggregate, supaya tidak ada
// downtime yang terhitung dua kali di dua baris yang bersebelahan.
// Balikan: { idBarisProduksi: [barisDowntime, ...] }
function cocokkanDowntimeKeBaris(rows, dtRows) {
  const byRow = {};
  (rows || []).forEach((r) => { byRow[r.id] = []; });
  (dtRows || []).forEach((d) => {
    const t = new Date(d.waktu_awal).getTime();
    if (Number.isNaN(t)) return;
    const row = (rows || []).find((r) => {
      if (r.mesin && d.mesin && r.mesin !== d.mesin) return false;
      if (r.stasiun && d.stasiun && r.stasiun !== d.stasiun) return false;
      const mulai = new Date(r.waktu_awal).getTime();
      const selesai = new Date(r.waktu_akhir).getTime();
      return t >= mulai && t < selesai;
    });
    if (row) byRow[row.id].push(d);
  });
  return byRow;
}

// Total menit dari sekumpulan baris downtime_log.
function totalMenitDowntime(list) {
  return (list || []).reduce((sum, d) => {
    const menit = (new Date(d.waktu_akhir).getTime() - new Date(d.waktu_awal).getTime()) / 60000;
    return sum + (menit > 0 ? menit : 0);
  }, 0);
}

// Ambil baris downtime_log yang jam mulainya berada di rentang waktu
// baris-baris produksi yang diberikan. `mesin` boleh string atau array.
async function ambilDowntimeUntukBaris(client, mesin, rows, kolomTambahan) {
  const daftar = (rows || []).filter((r) => r.waktu_awal && r.waktu_akhir);
  if (!daftar.length) return [];
  const mulai = Math.min(...daftar.map((r) => new Date(r.waktu_awal).getTime()));
  const selesai = Math.max(...daftar.map((r) => new Date(r.waktu_akhir).getTime()));
  if (!Number.isFinite(mulai) || !Number.isFinite(selesai)) return [];
  const kolom = "mesin, stasiun, waktu_awal, waktu_akhir" + (kolomTambahan ? ", " + kolomTambahan : "");
  let q = client.from("downtime_log").select(kolom)
    .gte("waktu_awal", new Date(mulai).toISOString())
    .lt("waktu_awal", new Date(selesai).toISOString());
  if (Array.isArray(mesin)) q = q.in("mesin", mesin);
  else if (mesin) q = q.eq("mesin", mesin);
  const res = await q;
  if (res.error) {
    console.error("Gagal memuat downtime:", res.error);
    return [];
  }
  return res.data || [];
}