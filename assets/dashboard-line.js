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
      pilihShift(sh) { this.perjamManual = true; this.perjamShift = sh; this.muatPerjam(); },
      async muatPerjam() {
        if (!this.isAdmin() || typeof Chart === "undefined") return;
        const token = (this._pjTok = (this._pjTok || 0) + 1);
        const line = this.activeTab, sh = this.perjamShift;
        this.perjamMemuat = true; this.perjamPesan = "";
        const [yy, mm, dd] = String(this.perjamTgl || tglHariIni()).split("-").map(Number);
        const awal = new Date(yy, mm - 1, dd), akhir = new Date(yy, mm - 1, dd + 1);
        let rows = [], kph = KPJ_DEFAULT[line] || 0;
        try {
          const [pr, cap] = await Promise.all([
            supabaseClient.rpc("dashboard_dekidaka_production_rows", { p_mesin: line, p_start: awal.toISOString(), p_end: akhir.toISOString(), p_shift: sh }),
            supabaseClient.from("production_capa_line").select("mesin,kapasitas_per_jam").eq("mesin", line),
          ]);
          if (token !== this._pjTok) return;
          if (pr.error) throw pr.error;
          rows = pr.data || [];
          const c = (cap.data || [])[0];
          if (c && Number(c.kapasitas_per_jam) > 0) kph = Number(c.kapasitas_per_jam);
        } catch (e) {
          console.error("Gagal memuat grafik Perjam:", e);
          this.perjamPesan = "Gagal memuat data Perjam"; this.perjamPanels = []; this.perjamMemuat = false; this.hapusPerjam(); return;
        }
        // Kelompokkan per part -> qty per blok jam
        const jumat = awal.getDay() === 5;
        const waktuBlok = BLOK.map((b) => (sh === "2" ? b.s2 : jumat ? b.j1 : b.s1));
        const per = {};
        rows.forEach((r) => {
          if (!r.part_number || !r.jam) return;
          const t = menit(r.jam);
          const idx = waktuBlok.findIndex((w) => w && dalam(t, menit(w[0]), menit(w[1])));
          if (idx < 0) return;
          const p = per[r.part_number] || (per[r.part_number] = { part: r.part_number, qty: Array(11).fill(0), total: 0 });
          p.qty[idx] += Number(r.qty) || 0; p.total += Number(r.qty) || 0;
        });
        const panels = Object.values(per).filter((p) => p.total > 0).sort((a, b) => b.total - a.total).map((p) => ({
          part: p.part,
          // % = qty blok / (kapasitas per jam x durasi blok); blok tanpa produksi -> tidak digambar
          pct: p.qty.map((q, i) => {
            const w = waktuBlok[i]; if (!w || !kph || q <= 0) return null;
            let mnt = menit(w[1]) - menit(w[0]); if (mnt < 0) mnt += 1440;
            return Math.round((q / (kph * mnt / 60)) * 1000) / 10;
          }),
          qty: p.qty,
        }));
        // Selalu tampil minimal 2 bagan (kosong bila tidak ada produksi), seperti format Excel.
        while (panels.length < 2) panels.push({ part: "", pct: Array(11).fill(null), qty: Array(11).fill(0) });
        this.hapusPerjam();
        this.perjamPanels = panels; this.perjamMemuat = false;
        await this.$nextTick();
        if (token !== this._pjTok) return;
        panels.forEach((pn, i) => this.gambarPerjam(pn, i, sh));
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
      get dekiUrl() { return "dekidaka-line.html?line=" + this.activeTab + "&solo=1&dekidaka=1&inline=1"; },
      dekiSiap: false,
      dekiZoom: "",
      dekiAksi(a) { const fr = document.querySelector(".dl-deki iframe"); if (fr && fr.contentWindow) fr.contentWindow.postMessage({ dekidakaAksi: a }, "*"); },

      async setTab(tab) { this.dekiSiap = false; this.activeTab = tab; this.muatPerjam(); await this.muat(); },

      async muat() {
        if (!this.isAdmin() || typeof Chart === "undefined") return;
        const token = (this._tok = (this._tok || 0) + 1);
        this.memuat = true; this.pesan = "";
        const line = this.activeTab;
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

        // Trend Volume: kerangka kosong (Perjam: lihat muatPerjam)
        aman(() => {
          const c = this.kanvas("dlTrend"); if (!c) return;
          this.charts.dlTrend = new Chart(c, { type: "line", data: { labels: L, datasets: [{ label: "Volume", data: kosong, borderColor: COL.trend, backgroundColor: COL.trend + "33", fill: true, borderWidth: 1.2, tension: 0.35, pointRadius: 2 }] },
            options: { responsive: true, maintainAspectRatio: false, animation: noAnim, layout: { padding: { top: 20 } }, plugins: { legend: legenda(true) }, scales: { x: skalaX(), y: skalaY() } } });
        }, "trend");
      },

      bukaDekidaka() { this.dekiBuka = true; },
      tutupDekidaka() { this.dekiBuka = false; },
      pasangPesan() {
        window.addEventListener("message", (e) => { if (e.data && e.data.dekidakaSiap) this.dekiSiap = true; if (e.data && e.data.dekidakaZoom) this.dekiZoom = e.data.dekidakaZoom; });
        setTimeout(() => { this.dekiSiap = true; }, 8000);   // jaga-jaga kalau sinyal siap tidak datang
      },
      ubahPeriode() { this.muat(); },
    };
  };
})();
