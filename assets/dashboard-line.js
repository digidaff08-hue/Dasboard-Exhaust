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
//   Productivity / Perjam / Trend Volume -> kerangka kosong dulu.
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
      get tahunOptions() { const y = new Date().getFullYear(); return [y - 2, y - 1, y, y + 1]; },
      get jumlahHari() { return new Date(this.tahun, this.bulan, 0).getDate(); },
      get labelHari() { return Array.from({ length: this.jumlahHari }, (_, i) => String(i + 1)); },
      get dekiUrl() { return "dekidaka-line.html?line=" + this.activeTab + "&solo=1&dekidaka=1&inline=1"; },
      dekiSiap: false,
      dekiZoom: "",
      dekiAksi(a) { const fr = document.querySelector(".dl-deki iframe"); if (fr && fr.contentWindow) fr.contentWindow.postMessage({ dekidakaAksi: a }, "*"); },

      async setTab(tab) { this.dekiSiap = false; this.activeTab = tab; await this.muat(); },

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

        // Perjam & Trend Volume: kerangka kosong
        aman(() => {
          const c = this.kanvas("dlPerjam"); if (!c) return;
          this.charts.dlPerjam = new Chart(c, { type: "bar", data: { labels: L, datasets: [{ label: "Perjam", data: kosong, backgroundColor: COL.perjam, barPercentage: 0.65, categoryPercentage: 0.75 }] },
            options: { responsive: true, maintainAspectRatio: false, animation: noAnim, layout: { padding: { top: 20 } }, plugins: { legend: legenda(true) }, scales: { x: skalaX(), y: skalaY() } } });
        }, "perjam");
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
