// =========================================================
// Dashboard Line -- data & grafik per line (E-02 .. E-07).
// Dipakai dashboard-line.html lewat dashboardLineData() (digabung ke
// objek Alpine halaman itu).
//
// Sumber data SAMA dengan Dashboard Exhaust:
//   Availability, Downtime Harian -> RPC dashboard_harian_produksi (p_mesin)
//   NG Inline harian              -> RPC dashboard_qc_ng_detail_range (disaring per line)
//   Straightpass harian           -> bar Qty Repair: dashboard_qc_repair_detail_range
//                                    (disaring per line); garis %: RPC
//                                    dashboard_qc_produksi_daily_line (BARU,
//                                    kosong sampai SQL-nya dijalankan)
//   Productivity / Trend Volume -> kerangka kosong dulu.
//   Perjam -> RPC dashboard_dekidaka_production_rows (data Dekidaka), 1 tanggal + 1 shift.
// =========================================================
(function () {
  const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  const COL = { productivity: "#0EA5E9", availability: "#10B981", downtime: "#F97316", ngInline: "#F43F5E", money: "#1D4ED8", straight: "#14B8A6", perjam: "#6366F1", trend: "#2563EB" };

  // Naikkan setiap kali file Dekidaka (machine-page.js, style.css, dekidaka-line.html) berubah.
  const DEKI_VER = "20261029x";

  const mgCache = {};   // hasil Trend Volume per line|tahun|bulan -> tidak hitung ulang saat pindah line (berlaku 10 menit)
  const pad2 = (n) => String(n).padStart(2, "0");
  const tglStr = (y, m, d) => y + "-" + pad2(m) + "-" + pad2(d);
  const fmtNum = (n) => Number(n).toLocaleString("id-ID", { maximumFractionDigits: 1 });

  // Ambil SEMUA baris RPC (Supabase membatasi 1000 baris per request).
  async function ambilSemua(rpcName, params, pageSize = 1000) {
    let semua = [], dari = 0, err = null;
    while (true) {
      const { data, error } = await supabaseClient.rpc(rpcName, params).range(dari, dari + pageSize - 1);
      if (error) { err = error; break; }
      const rows = data || [];
      semua = semua.concat(rows);
      if (rows.length < pageSize) break;
      dari += pageSize;
    }
    return { data: semua, error: err };
  }

  // Label angka di atas batang (diputar tegak kalau tidak muat).
  const labelBatang = (formatter, datasetIndex = 0, pos = "above") => ({
    id: "dlBarLabels" + datasetIndex,
    afterDatasetsDraw(chart) {
      const { ctx, chartArea } = chart;
      const meta = chart.getDatasetMeta(datasetIndex);
      const ds = chart.data.datasets[datasetIndex];
      if (!meta || !ds || meta.type !== "bar" || !meta.data || !chartArea) return;
      const slot = chartArea.width / (meta.data.length || 1);
      const fs = slot < 18 ? 6.5 : slot < 26 ? 7.5 : slot < 40 ? 8.5 : 9.5;
      ctx.save();
      ctx.font = "700 " + fs + "px Inter, sans-serif";
      ctx.fillStyle = "#000"; ctx.textAlign = "center";
      let terlebar = 0;
      meta.data.forEach((b, i) => {
        const v = Number(ds.data[i]);
        if (ds.data[i] == null || Number.isNaN(v) || v === 0) return;
        terlebar = Math.max(terlebar, ctx.measureText(formatter(v)).width);
      });
      const putar = terlebar > slot - 2;
      meta.data.forEach((b, i) => {
        const v = Number(ds.data[i]);
        if (ds.data[i] == null || Number.isNaN(v) || v === 0) return;
        const { x, y } = b.getProps(["x", "y"], true);
        const yy = pos === "base" ? chartArea.bottom - 4 : y - 4;
        if (putar) {
          ctx.save(); ctx.translate(x, yy); ctx.rotate(-Math.PI / 2);
          ctx.textAlign = "left"; ctx.textBaseline = "middle";
          ctx.fillText(formatter(v), 0, 0); ctx.restore();
        } else {
          ctx.textBaseline = "bottom"; ctx.fillText(formatter(v), x, yy);
        }
      });
      ctx.restore();
    },
  });

  // Label angka di atas titik garis.
  const labelGaris = (formatter, datasetIndex) => ({
    id: "dlLineLabels" + datasetIndex,
    afterDatasetsDraw(chart) {
      const { ctx, chartArea } = chart;
      const meta = chart.getDatasetMeta(datasetIndex);
      const ds = chart.data.datasets[datasetIndex];
      if (!meta || !ds || !meta.data || !chartArea) return;
      const slot = chartArea.width / (meta.data.length || 1);
      const fs = slot < 18 ? 6.5 : slot < 26 ? 7.5 : slot < 40 ? 8.5 : 9.5;
      ctx.save();
      ctx.font = "700 " + fs + "px Inter, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.fillStyle = "#000";
      meta.data.forEach((p, i) => {
        const v = Number(ds.data[i]);
        if (ds.data[i] == null || Number.isNaN(v) || v === 0) return;
        const { x, y } = p.getProps(["x", "y"], true);
        const yy = Math.max(y - 6, chartArea.top + fs);
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.lineJoin = "round";
        ctx.strokeText(formatter(v), x, yy); ctx.fillText(formatter(v), x, yy);
      });
      ctx.restore();
    },
  });

  const tick = { color: "#000", font: { size: 9 } };
  const skalaX = () => ({ ticks: { color: "#000", font: { size: 8.5 }, autoSkip: false, maxRotation: 0, minRotation: 0 }, grid: { display: false } });
  const skalaY = (extra = {}) => ({ ticks: { ...tick, maxTicksLimit: 5 }, grid: { color: "#e2e8f0", drawTicks: false }, beginAtZero: true, ...extra });
  const legenda = (tampil = true) => ({ display: tampil, position: "bottom", labels: { color: "#000", boxWidth: 5, boxHeight: 5, usePointStyle: true, pointStyle: "circle", font: { size: 8 }, padding: 4 } });


  // Blok jam Dekidaka (sama dengan DKD_TIME_TABLE di machine-page.js) dan
  // label sumbu X sesuai format Excel Perjam.
  const BLOK = [
    { s1: ["07:15", "08:00"], j1: ["07:15", "08:00"], s2: ["19:45", "20:30"] },
    { s1: ["08:00", "09:00"], j1: ["08:00", "09:00"], s2: ["20:30", "21:30"] },
    { s1: ["09:00", "09:30"], j1: ["09:00", "09:30"], s2: ["21:30", "21:40"] },
    { s1: ["09:40", "11:00"], j1: ["09:40", "11:00"], s2: ["22:40", "23:40"] },
    { s1: ["11:00", "11:50"], j1: ["11:00", "11:30"], s2: ["00:20", "01:20"] },
    { s1: ["12:30", "13:30"], j1: ["12:40", "13:30"], s2: ["01:20", "02:20"] },
    { s1: ["13:30", "14:30"], j1: ["13:30", "14:30"], s2: ["02:30", "03:30"] },
    { s1: ["14:40", "15:50"], j1: ["14:40", "16:15"], s2: ["03:30", "04:20"] },
    { s1: ["16:15", "17:15"], j1: ["16:45", "17:15"], s2: ["05:00", "06:00"] },
    { s1: ["17:15", "18:15"], j1: ["17:15", "18:15"], s2: ["06:00", "07:00"] },
    { s1: ["18:15", "19:30"], j1: ["18:15", "19:30"], s2: null },
  ];
  const LABEL_SHIFT = {
    "1": ["8,00", "9,00", "9,40", "11,00", "12,30", "13,30", "14,40", "15,45", "17,15", "18,15", "19,30"],
    "2": ["20,30", "21,40", "22,40", "23,40", "1,20", "2,20", "3,30", "4,15", "6,00", "7,00", "–"],
  };
  // Isi 2 grafik Perjam per line: judul + kode part yang dihitung (dicocokkan
  // dengan "mengandung" pada part_number, mis. 14110-73R10 mengandung 73R10).
  const PERJAM_CFG = {
    "E-02": [{ judul: "73R10/R20/74U00", kode: ["73R10", "73R20", "74U00"] }, { judul: "52P00", kode: ["52P00"] }],
    "E-03": [{ judul: "BZ060", kode: ["BZ060"] }, { judul: "BZ260", kode: ["BZ260"] }],
    "E-04": [{ judul: "BZ140", kode: ["BZ140"] }, { judul: "BZ150", kode: ["BZ150"] }],
    "E-05": [{ judul: "0Y050/60", kode: ["0Y050", "0Y060"] }, { judul: "BZ140/50", kode: ["BZ140", "BZ150"] }],
    "E-06": [{ judul: "BZ110/010", kode: ["BZ110", "BZ010"] }, { judul: "BZ140/50", kode: ["BZ140", "BZ150"] }],
    "E-07": [{ judul: "74U50", kode: ["74U50"] }, { judul: "BZ140/50", kode: ["BZ140", "BZ150"] }],
  };
  const KPJ_DEFAULT = { "E-02": 25, "E-03": 32, "E-04": 32, "E-05": 32, "E-06": 32, "E-07": 35 };
  const menit = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const dalam = (x, a, b) => (a === b ? false : b > a ? x >= a && x < b : x >= a || x < b);
  const tglHariIni = () => { const d = new Date(); return tglStr(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
  const shiftSekarang = () => { const d = new Date(); const t = d.getHours() * 60 + d.getMinutes(); return t >= 420 && t < 1170 ? "1" : "2"; };

  window.dashboardLineData = function () {
    return {
      BULAN_LABELS: BULAN,
      bulan: new Date().getMonth() + 1,
      tahun: new Date().getFullYear(),
      memuat: false,
      pesan: "",
      charts: {},
      // Papan Dekidaka (iframe ke halaman line, lihat machines/e-0X.html?dekidaka=1)
      dekiBuka: false,
      // ---- Grafik Perjam (1 tanggal, 1 shift, 1 panel per part number) ----
      perjamTgl: tglHariIni(),
      perjamShift: shiftSekarang(),
      perjamManual: false,     // true kalau user memilih sendiri tanggal/shift -> jangan di-otomatis
      perjamPanels: [],
      perjamMemuat: false,
      perjamPesan: "",
      perjamAuto() {
        // Ikut jam sekarang (shift 1 07:00-19:30, selebihnya shift 2) selama user belum memilih sendiri.
        if (this._pjTimer) return;
        this._pjTimer = setInterval(() => {
          if (this.perjamManual) return;
          const sh = shiftSekarang(), tg = tglHariIni();
          if (sh !== this.perjamShift || tg !== this.perjamTgl) { this.perjamShift = sh; this.perjamTgl = tg; }
          this.muatPerjam();
        }, 60000);
      },
      // Manual = user memilih tanggal/shift lain dari yang sedang berjalan. Kalau pilihannya
      // kembali ke hari ini + shift saat ini, otomatis ikut jam lagi.
      tandaiManual() { this.perjamManual = !(this.perjamTgl === tglHariIni() && this.perjamShift === shiftSekarang()); },
      // Grafik Perjam = Rasio Dekidaka per blok (Hasil Aktual / Target x 100), diambil dari papan Dekidaka
      // (iframe mengirim data per blok lewat pesan "dekidakaData"), dikelompokkan per part (PERJAM_CFG).
      async muatPerjam() {
        if (!this.bolehLihat() || typeof Chart === "undefined") return;
        this.dekiSinkron();           // minta papan Dekidaka ikut tanggal & shift ini -> papan mengirim data baru
        this.bangunPerjam();
      },
      async bangunPerjam() {
        if (!this.bolehLihat() || typeof Chart === "undefined") return;
        const token = (this._pjTok = (this._pjTok || 0) + 1);
        const line = this.activeTab, sh = this.perjamShift;
        const dd = this.dekiData;
        const cocok = dd && dd.line === line && dd.tanggal === this.perjamTgl && String(dd.shift) === String(sh);
        const baris = cocok ? (dd.baris || []) : [];
        const cfg = PERJAM_CFG[line] || [{ judul: "", kode: [] }, { judul: "", kode: [] }];
        const panels = cfg.map((g) => {
          const pct = Array(11).fill(null), qty = Array(11).fill(0);
          for (let i = 0; i < 11; i++) {
            const rs = baris.filter((r) => r.blok === i + 1 && r.part && g.kode.some((k) => String(r.part).toUpperCase().includes(k)));
            if (!rs.length) continue;
            const q = rs.reduce((t, r) => t + (Number(r.qty) || 0), 0);
            const kols = [...new Set(rs.map((r) => r.kol))];
            const tg = kols.reduce((t, c) => t + (Number(((dd.target || [])[i] || [])[c]) || 0), 0);
            qty[i] = q;
            if (q > 0 && tg > 0) pct[i] = Math.round((q / tg) * 1000) / 10;
          }
          return { part: g.judul, qty, pct };
        });
        while (panels.length < 2) panels.push({ part: "", pct: Array(11).fill(null), qty: Array(11).fill(0) });
        this.hapusPerjam();
        this.perjamPanels = panels; this.perjamMemuat = false;
        await this.$nextTick();
        if (token !== this._pjTok) return;
        panels.forEach((pn, i) => this.gambarPerjam(pn, i, sh));
      },
      dekiData: null,
      // Tampilan utama: dashboard (grid) atau Performance Tahunan/Bulanan/Harian (halaman mesin di iframe).
      tampil: "dashboard",
      get perfUrl() {
        if (this.tampil === "dashboard") return "about:blank";
        return "machines/" + this.activeTab.toLowerCase() + ".html?tab=performance&bagian=" + this.tampil + "&v=" + DEKI_VER;
      },
      setTampil(t) {
        this.tampil = t;
        // Kembali ke grid: grafik & papan Dekidaka perlu menghitung ulang ukuran setelah tampil lagi.
        if (t === "dashboard") this.$nextTick(() => { window.dispatchEvent(new Event("resize")); setTimeout(() => window.dispatchEvent(new Event("resize")), 150); });
      },
      hapusPerjam() { Object.keys(this.charts).filter((k) => /^dlPerjam\d+$/.test(k)).forEach((k) => { try { this.charts[k].destroy(); } catch (e) {} delete this.charts[k]; }); },
      gambarPerjam(pn, i, sh) {
        const c = document.getElementById("dlPerjam" + i); if (!c) return;
        const L = LABEL_SHIFT[sh];
        const nilai = pn.pct.filter((v) => v != null);
        const ymin = Math.min(50, nilai.length ? Math.floor(Math.min(...nilai) / 10) * 10 : 50);
        const ymax = Math.max(100, nilai.length ? Math.ceil(Math.max(...nilai) / 10) * 10 : 100);
        const kotak = { id: "pjKotak", afterDraw(ch) { const a = ch.chartArea, x = ch.ctx; x.save(); x.strokeStyle = "#000"; x.lineWidth = 1.6; x.strokeRect(a.left, a.top, a.width, a.height); x.restore(); } };
        const titik = (id) => ({ id, afterDatasetsDraw(ch) {
          const m = ch.getDatasetMeta(1), ds = ch.data.datasets[1], x = ch.ctx;
          x.save(); x.font = "700 8px Arial"; x.fillStyle = "#000"; x.textAlign = "center"; x.textBaseline = "bottom";
          m.data.forEach((p, k) => { if (ds.data[k] == null) return; x.strokeStyle = "#fff"; x.lineWidth = 3; x.strokeText(ds.data[k] + "%", p.x, p.y - 4); x.fillText(ds.data[k] + "%", p.x, p.y - 4); });
          x.restore(); } });
        this.charts["dlPerjam" + i] = new Chart(c, {
          type: "line",
          data: { labels: L, datasets: [
            { clip: false, label: "Target", data: L.map((l, k) => (l === "–" ? null : 100)), borderColor: "#dc2626", backgroundColor: "#dc2626", borderWidth: 1.4, pointRadius: 2.5, tension: 0 },
            { clip: false, label: "Aktual", data: pn.pct, borderColor: "#1d4ed8", backgroundColor: "#1d4ed8", borderWidth: 1.6, pointRadius: 3, tension: 0, spanGaps: true },
          ] },
          options: { responsive: true, maintainAspectRatio: false, animation: false, layout: { padding: { top: 12, right: 6 } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (it) => it.dataset.label + ": " + it.parsed.y + "%" + (it.datasetIndex === 1 ? " (" + pn.qty[it.dataIndex] + " pcs)" : "") } } },
            scales: {
              x: { ticks: { color: "#000", font: { size: 7, weight: "700" }, autoSkip: false, maxRotation: 0, padding: 2 }, border: { dash: [1, 3] }, grid: { color: "#000", drawTicks: false } },
              y: { min: ymin, max: ymax, ticks: { color: "#000", font: { size: 8.5 }, stepSize: 10 }, border: { dash: [1, 3] }, grid: { color: "#000", drawTicks: false } } } },
          plugins: [kotak, titik("pjTitik" + i)],
        });
      },

      get tahunOptions() { const y = new Date().getFullYear(); return [y - 2, y - 1, y, y + 1]; },
      get jumlahHari() { return new Date(this.tahun, this.bulan, 0).getDate(); },
      get labelHari() { return Array.from({ length: this.jumlahHari }, (_, i) => String(i + 1)); },
      get dekiUrl() { return "dekidaka-line.html?line=" + this.activeTab + "&solo=1&dekidaka=1&inline=1&v=" + DEKI_VER; },
      dekiSiap: false,
      dekiZoom: "",
      // Tanggal & shift di bar atas juga dipakai papan Dekidaka (dan nanti Problem Followup).
      dekiSinkron(tujuan) {
        if (!this.perjamTgl) return;
        const frames = tujuan ? [tujuan] : Array.from(document.querySelectorAll(".dl-deki iframe, .dl-besar iframe"));
        let kecil = false;
        frames.forEach((fr) => { if (fr && fr.contentWindow) { fr.contentWindow.postMessage({ dekidakaSet: { tanggal: this.perjamTgl, shift: this.perjamShift } }, "*"); if (fr.closest(".dl-deki")) kecil = true; } });
        if (kecil) { this._dekiAck = false; setTimeout(() => { if (this.dekiSiap && !this._dekiAck) this.pesan = "Papan Dekidaka belum ikut tanggal/shift - tekan Ctrl+F5 sekali."; }, 6000); }
      },
      dekiAksi(a, besar) { const fr = document.querySelector(besar ? ".dl-besar iframe" : ".dl-deki iframe"); if (fr && fr.contentWindow) fr.contentWindow.postMessage({ dekidakaAksi: a }, "*"); },
      dekiBesarSiap: false,
      dekiZoomBesar: "",

      async setTab(tab) { this.dekiSiap = false; this.activeTab = tab; this.muatPerjam(); this.muatFoto(); await this.muat(); },

      async muat() {
        if (!this.bolehLihat() || typeof Chart === "undefined") return;
        const token = (this._tok = (this._tok || 0) + 1);
        this.memuat = true; this.pesan = "";
        const line = this.activeTab;
        this.mintaMingguan();
        const y = this.tahun, m = this.bulan, n = this.jumlahHari;
        const awal = new Date(y, m - 1, 1), akhir = new Date(y, m, 1);
        const sAwal = tglStr(y, m, 1);
        const sAkhir = tglStr(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1);
        const hariIni = new Date(); hariIni.setHours(0, 0, 0, 0);
        const lewat = (d) => new Date(y, m - 1, d) > hariIni;   // hari yang belum tiba

        const hasil = { avail: Array(n).fill(null), downtime: Array(n).fill(0), ngQty: Array(n).fill(0), ngVal: Array(n).fill(0), repQty: Array(n).fill(0), spPct: Array(n).fill(null), target: 100 };
        try {
          const [prodRes, ngRes, repRes, spRes, tgRes] = await Promise.all([
            supabaseClient.rpc("dashboard_harian_produksi", { p_start: awal.toISOString(), p_end: akhir.toISOString(), p_mesin: line }),
            ambilSemua("dashboard_qc_ng_detail_range", { p_type_ng: "NG PRODUKSI", p_start: sAwal, p_end: sAkhir }),
            ambilSemua("dashboard_qc_repair_detail_range", { p_start: sAwal, p_end: sAkhir }),
            supabaseClient.rpc("dashboard_qc_produksi_daily_line", { p_start: awal.toISOString(), p_end: akhir.toISOString(), p_mesin: line }),
            supabaseClient.from("productivity_target").select("tahun,bulan,target").eq("tahun", y).eq("bulan", m),
          ]);
          if (token !== this._tok) return;   // sudah ganti line/bulan lagi -> abaikan hasil lama

          // Availability & Downtime harian
          const rows = prodRes.data || [];
          for (let d = 1; d <= n; d++) {
            const r = rows.find((x) => x.tanggal === tglStr(y, m, d));
            if (r && r.wh_menit) hasil.avail[d - 1] = Number((((r.wh_menit - r.downtime_menit) / r.wh_menit) * 100).toFixed(1));
            hasil.downtime[d - 1] = r ? Math.round(Number(r.downtime_menit) || 0) : 0;
          }
          // NG Inline & Repair per hari, disaring line ini
          const hariDari = (tgl) => parseInt((tgl || "").slice(8, 10), 10);
          (ngRes.data || []).forEach((r) => {
            if (r.mesin !== line) return;
            const d = hariDari(r.tanggal);
            if (d >= 1 && d <= n) { hasil.ngQty[d - 1] += Number(r.qty) || 0; hasil.ngVal[d - 1] += Number(r.value) || 0; }
          });
          (repRes.data || []).forEach((r) => {
            if (r.mesin !== line) return;
            const d = hariDari(r.tanggal);
            if (d >= 1 && d <= n) hasil.repQty[d - 1] += Number(r.qty) || 0;
          });
          // % Straightpass harian = (stroke - repair) / stroke
          if (spRes.error) {
            console.info("dashboard_qc_produksi_daily_line belum ada di Supabase -> garis % Straightpass dikosongkan.", spRes.error.message);
          } else {
            for (let d = 1; d <= n; d++) {
              if (lewat(d)) continue;
              const r = (spRes.data || []).find((x) => x.tanggal === tglStr(y, m, d));
              if (r && Number(r.stroke)) hasil.spPct[d - 1] = Number((((Number(r.stroke) - hasil.repQty[d - 1]) / Number(r.stroke)) * 100).toFixed(1));
            }
          }
          const t = (tgRes.data || [])[0];
          if (t && Number.isFinite(Number(t.target))) hasil.target = Number(t.target);
          for (let d = 1; d <= n; d++) if (lewat(d)) { hasil.avail[d - 1] = null; }
        } catch (e) {
          console.error("Gagal memuat Dashboard Line:", e);
          this.pesan = "Gagal memuat data: " + (e.message || e);
        }
        if (token !== this._tok) return;
        this.data = hasil;
        this.memuat = false;
        this.$nextTick(() => this.gambar());
      },

      data: null,
      get totalDowntime() { return this.data ? this.data.downtime.reduce((a, b) => a + b, 0) : 0; },
      get rataAvail() {
        if (!this.data) return 0;
        const v = this.data.avail.filter((x) => x !== null);
        return v.length ? Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(1)) : 0;
      },
      fmtNum,

      hancur(id) { if (this.charts[id]) { this.charts[id].destroy(); delete this.charts[id]; } },
      kanvas(id) { this.hancur(id); return document.getElementById(id); },

      gambar() {
        if (typeof Chart === "undefined") return;
        const L = this.labelHari;
        const D = this.data || { avail: [], downtime: [], ngQty: [], ngVal: [], repQty: [], spPct: [], target: 100 };
        const aman = (fn, nama) => { try { fn(); } catch (e) { console.error("Gagal gambar", nama, e); } };
        const kosong = L.map(() => null);
        const noAnim = { duration: 0 };

        // Batang persen + garis target (Productivity kosong; Availability tanpa target)
        const batangPersen = (id, data, hex, target) => {
          const c = this.kanvas(id); if (!c) return;
          this.charts[id] = new Chart(c, {
            data: { labels: L, datasets: [
              { order: 2, type: "bar", label: "Actual", data, backgroundColor: hex, borderRadius: 0, barPercentage: 0.65, categoryPercentage: 0.75, borderSkipped: false },
              ...(target == null ? [] : [{ order: 1, type: "line", label: "Target", data: L.map(() => target), borderColor: "#EF4444", borderDash: [4, 3], borderWidth: 1.2, pointRadius: 0, tension: 0 }]),
            ] },
            options: { responsive: true, maintainAspectRatio: false, animation: noAnim, layout: { padding: { top: 34 } },
              plugins: { legend: legenda(true) }, scales: { x: skalaX(), y: skalaY({ suggestedMax: 100, ticks: { ...tick, maxTicksLimit: 5, callback: (v) => v + "%" } }) } },
            plugins: [labelBatang((v) => v + "%")],
          });
        };
        aman(() => batangPersen("dlProductivity", kosong, COL.productivity, D.target), "productivity");
        aman(() => batangPersen("dlAvailability", D.avail, COL.availability, null), "availability");

        // Downtime harian (area)
        aman(() => {
          const c = this.kanvas("dlDowntime"); if (!c) return;
          this.charts.dlDowntime = new Chart(c, {
            type: "line",
            data: { labels: L, datasets: [{ label: "Downtime (menit)", data: D.downtime, fill: true, backgroundColor: COL.downtime + "33", borderColor: COL.downtime, borderWidth: 1.2, tension: 0.35, cubicInterpolationMode: "monotone", pointRadius: 2, pointBackgroundColor: COL.downtime }] },
            options: { responsive: true, maintainAspectRatio: false, animation: noAnim, layout: { padding: { top: 22 } }, plugins: { legend: legenda(true) }, scales: { x: skalaX(), y: skalaY() } },
            plugins: [labelGaris((v) => fmtNum(v), 0)],
          });
        }, "downtime");

        // Dua sumbu: batang (Qty) + garis (Value Rp ribuan / % Straightpass)
        const ganda = (id, hexBar, hexLine, lblBar, lblLine, persen, dBar, dLine, posBar) => {
          const c = this.kanvas(id); if (!c) return;
          this.charts[id] = new Chart(c, {
            data: { labels: L, datasets: [
              { order: 2, type: "bar", label: lblBar, data: dBar, backgroundColor: hexBar, yAxisID: "y", borderRadius: 0, barPercentage: 0.6, categoryPercentage: 0.75 },
              { order: 1, type: "line", label: lblLine, data: dLine, borderColor: hexLine, backgroundColor: persen ? hexLine : "rgba(29,78,216,0.1)", fill: !persen, borderWidth: 1.2, yAxisID: "y1", pointRadius: 1, tension: 0.3, spanGaps: true },
            ] },
            options: { responsive: true, maintainAspectRatio: false, animation: noAnim, layout: { padding: { top: 30 } }, plugins: { legend: legenda(true) },
              scales: { x: skalaX(), y: skalaY({ position: "left", grace: "12%" }),
                y1: { position: "right", ticks: { ...tick, callback: (v) => (persen ? v + "%" : fmtNum(Math.round(v / 1000))) }, grid: { display: false }, beginAtZero: true, grace: persen ? "8%" : "12%", ...(persen ? { suggestedMax: 100 } : {}) } } },
            plugins: [labelBatang((v) => fmtNum(v), 0, posBar), labelGaris((v) => (persen ? v + "%" : fmtNum(Math.round(v / 1000))), 1)],
          });
        };
        aman(() => ganda("dlNgInline", COL.ngInline, COL.money, "Qty", "Value (ribu Rp)", false, D.ngQty, D.ngVal, "above"), "ngInline");
        aman(() => ganda("dlStraightpass", COL.straight, "#000000", "Qty Repair", "% Straightpass", true, D.repQty, D.spPct, "base"), "straightpass");

        // Trend Volume: W1..Wn per bulan (lihat gambarTrend / mintaMingguan)
        aman(() => this.gambarTrend(), "trend");
      },

      // ---------- Trend Volume (per minggu) ----------
      // Nilai per minggu = Total Aktual / Total Target x 100, dihitung oleh papan Dekidaka (rumus Target yang sama).
      mingguHasil: null,
      mingguPesan: "",
      mintaMingguan() {
        const fr = document.querySelector(".dl-deki iframe");
        const line = this.activeTab, tahun = this.tahun, bulan = this.bulan;
        const kc = `${line}|${tahun}|${bulan}`, ada = mgCache[kc];
        if (ada && Date.now() - ada.t < 600000) { this.mingguHasil = ada.r; this.mingguPesan = ""; this.gambarTrend(); return; }
        this.mingguHasil = null; this.mingguPesan = "Menghitung…";
        this.gambarTrend();
        if (!fr || !fr.contentWindow) { this.mingguPesan = ""; return; }
        const kirim = () => { try { fr.contentWindow.postMessage({ dekidakaMingguan: { line, tahun, bulan } }, "*"); } catch (e) {} };
        kirim();
        // Papan bisa belum siap: ulangi sampai ada jawaban (maks. beberapa kali).
        let sisa = 6;
        const ulang = () => {
          if (this.mingguHasil || line !== this.activeTab || tahun !== this.tahun || bulan !== this.bulan) return;
          if (sisa-- <= 0) { this.mingguPesan = "Papan Dekidaka belum menjawab"; return; }
          kirim(); setTimeout(ulang, 2500);
        };
        setTimeout(ulang, 2500);
      },
      gambarTrend() {
        const c = this.kanvas("dlTrend"); if (!c || typeof Chart === "undefined") return;
        const h = this.mingguHasil;
        const offset = (new Date(this.tahun, this.bulan - 1, 1).getDay() + 6) % 7;
        const nMinggu = Math.floor((this.jumlahHari - 1 + offset) / 7) + 1;
        const labels = Array.from({ length: nMinggu }, (_, i) => "W" + (i + 1));
        const nilai = labels.map((_, i) => (h && h.minggu[i] ? h.minggu[i].pct : null));
        const ada = nilai.filter((v) => v != null);
        const ymin = Math.min(50, ada.length ? Math.floor(Math.min(...ada) / 10) * 10 : 50);
        const ymax = Math.max(100, ada.length ? Math.ceil(Math.max(...ada) / 10) * 10 : 100);
        this.charts.dlTrend = new Chart(c, { type: "line",
          data: { labels, datasets: [
            { label: "Target", data: labels.map(() => 100), borderColor: "#dc2626", backgroundColor: "#dc2626", borderWidth: 1.2, borderDash: [4, 3], pointRadius: 0, tension: 0 },
            { label: "Rata-rata Rasio", data: nilai, borderColor: COL.trend, backgroundColor: COL.trend, borderWidth: 2, pointRadius: 4, tension: 0, spanGaps: true, clip: false },
          ] },
          options: { responsive: true, maintainAspectRatio: false, animation: { duration: 0 }, layout: { padding: { top: 22, right: 14, left: 4 } }, plugins: { legend: legenda(true), tooltip: { callbacks: { label: (it) => it.dataset.label + ": " + it.formattedValue + "%" } } },
            scales: { x: { ...skalaX(), offset: true, ticks: { color: "#000", font: { size: 11, weight: "700" }, autoSkip: false, maxRotation: 0 } }, y: { ...skalaY(), min: ymin, max: ymax, ticks: { ...tick, stepSize: 10, callback: (v) => v + "%" } } } },
          plugins: [labelGaris((v) => v + "%", 1)] });
      },

      // ---------- Kotak foto (1 foto per line, disimpan di Supabase Storage bucket "line-foto") ----------
      fotoUrl: "",
      fotoBesar: false,
      fotoPesan: "",
      fotoBusy: false,
      async muatFoto() {
        const line = this.activeTab;
        this.fotoPesan = "";
        try {
          const st = supabaseClient.storage.from("line-foto");
          const { data, error } = await st.list("", { search: line });
          if (line !== this.activeTab) return;
          if (error) throw error;
          const f = (data || []).find((x) => x.name === line + ".jpg");
          this.fotoUrl = f ? st.getPublicUrl(f.name).data.publicUrl + "?v=" + encodeURIComponent(f.updated_at || f.created_at || "") : (this._fotoLokal && this._fotoLokal[line]) || "";
        } catch (e) {
          console.error("Gagal memuat foto line:", e);
          this.fotoUrl = (this._fotoLokal && this._fotoLokal[line]) || "";
        }
      },
      async unggahFoto(ev) {
        const file = ev.target.files && ev.target.files[0]; ev.target.value = "";
        if (!file || !this.isAdmin()) return;
        const line = this.activeTab;
        this.fotoBusy = true; this.fotoPesan = "";
        try {
          // Perkecil dulu (maks. 1600px) supaya ringan.
          const bmp = await createImageBitmap(file);
          const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
          const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
          cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
          const blob = await new Promise((res) => cv.toBlob(res, "image/jpeg", 0.85));
          const st = supabaseClient.storage.from("line-foto");
          const { error } = await st.upload(line + ".jpg", blob, { upsert: true, contentType: "image/jpeg" });
          if (error) throw error;
          this._fotoLokal = this._fotoLokal || {}; this._fotoLokal[line] = URL.createObjectURL(blob);
          await this.muatFoto();
        } catch (e) {
          console.error("Gagal unggah TSK:", e);
          this.fotoPesan = "Gagal unggah TSK: " + (e.message || e) + " (sudah menjalankan SQL 'Trend Volume + Foto'?)";
        }
        this.fotoBusy = false;
      },
      async hapusFoto() {
        if (!this.isAdmin() || !this.fotoUrl) return;
        if (!confirm("Hapus TSK " + this.activeTab + "?")) return;
        const line = this.activeTab;
        try {
          const { error } = await supabaseClient.storage.from("line-foto").remove([line + ".jpg"]);
          if (error) throw error;
          if (this._fotoLokal) delete this._fotoLokal[line];
          this.fotoUrl = "";
        } catch (e) { this.fotoPesan = "Gagal hapus TSK: " + (e.message || e); }
      },

      bukaDekidaka() { this.dekiBesarSiap = false; this.dekiZoomBesar = ""; this.dekiBuka = true; },
      tutupDekidaka() { this.dekiBuka = false; },
      pasangPesan() {
        window.addEventListener("message", (e) => {
          const d = e.data || {};
          const frBesar = document.querySelector(".dl-besar iframe");
          const dariBesar = !!(frBesar && frBesar.contentWindow === e.source);
          if (d.dekidakaSiap) { if (dariBesar) { this.dekiBesarSiap = true; this.dekiSinkron(frBesar); } else { this.dekiSiap = true; this.dekiSinkron(document.querySelector(".dl-deki iframe")); if (!this.mingguHasil) this.mintaMingguan(); } }
          if (d.dekidakaZoom) { if (dariBesar) this.dekiZoomBesar = d.dekidakaZoom; else this.dekiZoom = d.dekidakaZoom; }
          if (d.dekidakaBuild) {
            const b = d.dekidakaBuild, salah = [];
            if (b.js !== DEKI_VER) salah.push("assets/machine-page.js");
            if (b.css !== DEKI_VER) salah.push("assets/style.css");
            this.pesan = salah.length ? "File belum versi terbaru: " + salah.join(", ") + " - timpa dari zip lalu Ctrl+F5." : (/File belum versi terbaru/.test(this.pesan) ? "" : this.pesan);
          }
          if (d.dekidakaMingguanHasil && !dariBesar) {
            const r = d.dekidakaMingguanHasil;
            if (r.line === this.activeTab && r.tahun === this.tahun && r.bulan === this.bulan) { this.mingguHasil = r; this.mingguPesan = r.error || ""; if (!r.error) mgCache[`${r.line}|${r.tahun}|${r.bulan}`] = { r, t: Date.now() }; this.gambarTrend(); }
          }
          if (d.dekidakaData && !dariBesar) { this.dekiData = d.dekidakaData; this.bangunPerjam(); }
          if (d.dekidakaSetOk) { this._dekiAck = true; if (/Dekidaka belum ikut/.test(this.pesan)) this.pesan = ""; }
        });
        window.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (this.fotoBesar) this.fotoBesar = false; else if (this.dekiBuka) this.tutupDekidaka(); } });
        setTimeout(() => { this.dekiSiap = true; }, 8000);   // jaga-jaga kalau sinyal siap tidak datang
      },
      ubahPeriode() { this.muat(); },
    };
  };
})();
