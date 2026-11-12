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
  const DEKI_VER = "20261112l";

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
    { s1: ["07:15", "08:00"], j1: ["07:15", "08:00"], s2: ["19:40", "20:30"] },
    { s1: ["08:00", "09:00"], j1: ["08:00", "09:00"], s2: ["20:30", "21:30"] },
    { s1: ["09:00", "09:30"], j1: ["09:00", "09:30"], s2: ["21:40", "22:40"] },
    { s1: ["09:40", "11:00"], j1: ["09:40", "11:00"], s2: ["22:40", "23:40"] },
    { s1: ["11:00", "11:50"], j1: ["11:00", "11:30"], s2: ["00:20", "01:30"] },
    { s1: ["12:30", "13:30"], j1: ["12:40", "13:30"], s2: ["01:30", "02:20"] },
    { s1: ["13:30", "14:30"], j1: ["13:30", "14:30"], s2: ["02:30", "03:30"] },
    { s1: ["14:40", "16:00"], j1: ["14:40", "16:30"], s2: ["03:30", "04:30"] },
    { s1: ["16:15", "17:15"], j1: ["16:45", "17:15"], s2: ["05:00", "06:00"] },
    { s1: ["17:15", "18:15"], j1: ["17:15", "18:15"], s2: ["06:00", "07:00"] },
    { s1: ["18:30", "19:30"], j1: ["18:30", "19:30"], s2: null },
  ];
  const LABEL_SHIFT = {
    "1": ["8,00", "9,00", "9,40", "11,00", "12,30", "13,30", "14,40", "15,45", "17,15", "18,15", "19,30"],
    "2": ["20,30", "21,30", "22,40", "23,40", "1,30", "2,30", "3,30", "4,15", "6,00", "7,00", "–"],
  };
  // Daftar part Perjam per line (kode = bagian belakang part no, mis. 25051-0Y050 -> 0Y050,
  // 17150-BZ140-T -> BZ140-T). Cocok persis, jadi BZ140 tidak ikut menghitung BZ140-T.
  // Grafik menampilkan 2 part: default = 2 part yang terakhir diproduksi, atau pilihan manual lewat chip.
  const PERJAM_PART = {
    "E-02": ["73R11", "73R21", "52P00", "74U00"],
    "E-03": ["BZ060", "BZ260", "BZ140", "BZ140-T"],
    "E-04": ["BZ140-T", "BZ150-T"],
    "E-05": ["0Y050", "0Y060", "BZ140", "BZ140-T", "BZ260"],
    "E-06": ["BZ110", "BZ010", "BZ180", "BZ140", "BZ140-T"],
    "E-07": ["74U50", "BZ140", "BZ150"],
  };
  const kodePerjam = (part, daftar) => {
    const s = String(part || "").trim().toUpperCase();
    return daftar.find((c) => s === c || s.endsWith("-" + c)) || "";
  };
  const KPJ_DEFAULT = { "E-02": 25, "E-03": 32, "E-04": 32, "E-05": 32, "E-06": 32, "E-07": 35 };
  const menit = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const dalam = (x, a, b) => (a === b ? false : b > a ? x >= a && x < b : x >= a || x < b);
  const tglHariIni = () => { const d = new Date(); return tglStr(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
  const shiftSekarang = () => { const d = new Date(); const t = d.getHours() * 60 + d.getMinutes(); return t >= 420 && t < 1170 ? "1" : "2"; };
  // Shift sebuah waktu (Date / string ISO). Sama persis dengan aturan di
  // seluruh aplikasi: 07:00-19:30 Shift 1, selebihnya Shift 2.
  const shiftDari = (w) => { const d = new Date(w); const t = d.getHours() * 60 + d.getMinutes(); return t >= 420 && t < 1170 ? "1" : "2"; };

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
      perjamChips: [],
      perjamBulan: null,    // hasil Grafik Perjam bulanan (tab Bulanan)
      // Minta papan Dekidaka menghitung Grafik Perjam sebulan. Shiftnya ikut
      // papan Dekidaka, bukan bar atas -- blok jam dua shift memang berbeda.
      mintaPerjamBulan() {
        const sh = (this.dekiData && this.dekiData.shift) || this.perjamShift;
        const kunci = this.activeTab + "|" + this.tahun + "|" + this.bulan + "|" + sh;
        if (this._pbKunci === kunci) return;
        this._pbKunci = kunci;
        this.perjamMemuat = true;
        document.querySelectorAll(".dl-deki iframe").forEach((fr) => {
          if (fr && fr.contentWindow) { try { fr.contentWindow.postMessage({ dekidakaPerjamBulan: { line: this.activeTab, tahun: this.tahun, bulan: this.bulan, shift: String(sh) } }, "*"); } catch (e) {} }
        });
      },
      repair3dTotal: null,     // {qty, titik} dikirim kotak 3D
      repairSinkron() {
        if (!this.perjamTgl && this.tampil !== "bulanan") return;
        const kirim = (sel, isi) => document.querySelectorAll(sel).forEach((fr) => {
          if (fr && fr.contentWindow) { try { fr.contentWindow.postMessage({ repairSet: isi }, "*"); } catch (e) {} }
        });
        // Control Board : 1 hari, 1 shift
        // Tab Harian     : 1 hari, dua shift
        // Tab Bulanan    : sebulan penuh ditumpuk
        let isi;
        if (this.tampil === "bulanan") {
          const p2 = (x) => String(x).padStart(2, "0");
          isi = { dari: this.tahun + "-" + p2(this.bulan) + "-01",
                  sampai: (this.bulan === 12 ? this.tahun + 1 : this.tahun) + "-" + p2(this.bulan === 12 ? 1 : this.bulan + 1) + "-01" };
        } else if (this.tampil === "harian") isi = { tanggal: this.perjamTgl };
        else isi = { tanggal: this.perjamTgl, shift: this.perjamShift };
        kirim(".dl-r3d, .dl-r3d-big", isi);
      },
      perjamPilih: [],         // pilihan manual (maks 2 kode part); kosong = otomatis
      pilihPerjam(kd) {
        const aktif = this.perjamChips.filter((c) => c.aktif).map((c) => c.kode);
        if (aktif.includes(kd)) return;
        this.perjamPilih = [aktif[aktif.length - 1], kd].filter(Boolean);   // ganti yang tampil lebih dulu
        this.bangunPerjam();
      },
      perjamOtomatis() { this.perjamPilih = []; this.bangunPerjam(); },
      perjamMemuat: false,
      perjamPesan: "",
      perjamAuto() {
        // Ikut jam sekarang (shift 1 07:00-19:30, selebihnya shift 2) selama user belum memilih sendiri.
        if (this._pjTimer) return;
        this._pjTimer = setInterval(() => {
          if (this.perjamManual) return;
          const sh = shiftSekarang(), tg = tglHariIni();
          const berganti = sh !== this.perjamShift || tg !== this.perjamTgl;
          if (berganti) { this.perjamShift = sh; this.perjamTgl = tg; }
          this.muatPerjam();
          // Panel bawah ikut Tanggal & Shift, jadi harus dimuat ulang -- tapi HANYA
          // saat benar-benar berganti, bukan tiap kali pengatur waktu jalan.
          if (berganti) this.muat(true);
        }, 60000);
      },
      // Manual = user memilih tanggal/shift lain dari yang sedang berjalan. Kalau pilihannya
      // kembali ke hari ini + shift saat ini, otomatis ikut jam lagi.
      tandaiManual() { this.perjamManual = !(this.perjamTgl === tglHariIni() && this.perjamShift === shiftSekarang()); },
      // Grafik Perjam = Rasio Dekidaka per blok (Hasil Aktual / Target x 100), diambil dari papan Dekidaka
      // (iframe mengirim data per blok lewat pesan "dekidakaData"), dikelompokkan per part (PERJAM_CFG).
      async muatPerjam() {
        if (!this.bolehLihat() || typeof Chart === "undefined") return;
        this.repairSinkron();
        this.dekiSinkron();           // minta papan Dekidaka ikut tanggal & shift ini -> papan mengirim data baru
        this.bangunPerjam();
        this.muatProblem();
      },
      // Rangkuman downtime 1 BULAN per Problem -> dipakai tab Bulanan.
      // Versi 1 harinya dihitung di muatProblem(), dari data hari yang sudah diambil
      // di sana -- jadi tidak ada query tambahan.
      topRows: [],
      topRowsAll: [],      // 1 hari, dua shift digabung -- tab Harian
      topRowsBulan: [],    // 1 bulan, dua shift digabung -- tab Bulanan
      susunTop: null,
      topDetail: null,   // {judul, sub, items:[{teks,kali,info}]} untuk jendela detail Penyebab / Penanganan
      bukaDetail(r, jenis) {
        const sebab = jenis === 'sebab', menit = jenis === 'menit';
        this.topDetail = { judul: (menit ? 'Menit (' + r.menit + ' mnt, ' + r.kali + ' kejadian)' : sebab ? 'Penyebab' : 'Penanganan') + ' — ' + r.problem, items: menit ? r.menitList : sebab ? r.sebabList : r.tindakList };
      },
      async muatTop() {
        if (!this.bolehLihat()) return;
        const tok = (this._topTok = (this._topTok || 0) + 1);
        const line = this.activeTab, y = this.tahun, m = this.bulan;
        const awal = new Date(y, m - 1, 1, 7, 0), akhir = new Date(y, m, 1, 7, 0);
        try {
          const { data, error } = await supabaseClient.from("downtime_log")
            .select("waktu_awal,waktu_akhir,problem,area,penyebab,countermeasure,pic")
            .eq("mesin", line).gte("waktu_awal", awal.toISOString()).lt("waktu_awal", akhir.toISOString()).order("waktu_awal");
          if (error) throw error;
          if (tok !== this._topTok) return;
          const susun = (baris) => {
          const g = new Map();
          (baris || []).forEach((r) => {
            const k = r.problem || r.area || "(tanpa keterangan)";
            const o = g.get(k) || { problem: k, kali: 0, menit: 0, sebab: new Map(), tindak: "", tindakMap: new Map(), kej: [] };
            o.kali += 1;
            const mn = Math.max(0, Math.round((new Date(r.waktu_akhir) - new Date(r.waktu_awal)) / 60000));
            o.menit += mn;
            const wa = new Date(r.waktu_awal);
            o.kej.push({ teks: pad2(wa.getDate()) + "/" + pad2(wa.getMonth() + 1) + "/" + wa.getFullYear() + " " + pad2(wa.getHours()) + ":" + pad2(wa.getMinutes()) + (r.penyebab ? " — " + r.penyebab : ""), mn });
            if (r.penyebab) o.sebab.set(r.penyebab, (o.sebab.get(r.penyebab) || 0) + 1);
            if (r.countermeasure) {
              o.tindak = r.countermeasure;   // data urut waktu -> yang terakhir = penanganan terbaru
              const t = o.tindakMap.get(r.countermeasure) || { kali: 0, terakhir: "" };
              t.kali += 1; t.terakhir = r.waktu_awal; o.tindakMap.set(r.countermeasure, t);
            }
            g.set(k, o);
          });
          return [...g.values()].sort((a, b) => b.kali - a.kali || b.menit - a.menit).slice(0, 10).map((o) => ({
            problem: o.problem, kali: o.kali, menit: o.menit, tindak: o.tindak,
            sebab: [...o.sebab.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0])[0] || "",
            sebabList: [...o.sebab.entries()].sort((a, b) => b[1] - a[1]).map((x) => ({ teks: x[0], kali: x[1], info: "" })),
            menitList: o.kej.slice().sort((a, b) => b.mn - a.mn).map((x) => ({ teks: x.teks, kali: 1, info: x.mn + " mnt" })),
            tindakList: [...o.tindakMap.entries()].sort((a, b) => String(b[1].terakhir).localeCompare(String(a[1].terakhir))).map((x) => {
              const d = new Date(x[1].terakhir);
              return { teks: x[0], kali: x[1].kali, info: "terakhir " + pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1) + "/" + d.getFullYear() };
            }),
          }));
          };
          this.susunTop = susun;                      // dipakai lagi oleh muatProblem()
          this.topRowsBulan = susun(data || []);      // Bulanan: sebulan penuh, 2 shift
          this.problemRowsBulan = (data || []).map((r) => this.buatProblem(r)).reverse();   // terbaru di atas
          if (this._pfData) this.hitungTopHarian();   // data harian sudah ada -> hitung sekarang
        } catch (e) { console.error("Gagal memuat Problem Terbanyak:", e); if (tok === this._topTok) { this.topRowsBulan = []; this.problemRowsBulan = []; } }
      },
      // Problem Followup Sheets: downtime hari produksi terpilih (07:00-07:00), hanya shift yang dipilih di bar atas.
      problemRows: [],
      problemRowsAll: [],     // 1 hari, dua shift digabung -- tab Harian
      problemRowsBulan: [],   // 1 bulan, dua shift digabung -- tab Bulanan
      _pfData: null,
      // Satu baris tabel Problem Followup. Tanggalnya diambil dari HARI PRODUKSI
      // (07:00-07:00), bukan tanggal kalender, supaya baris dini hari Shift 2
      // tetap tercatat di hari kerjanya.
      buatProblem(r) {
        const a = new Date(r.waktu_awal), mnt = a.getHours() * 60 + a.getMinutes();
        const hp = new Date(a); if (mnt < 420) hp.setDate(hp.getDate() - 1);
        const f = (t) => { const x = new Date(t); return pad2(x.getDate()) + "/" + pad2(x.getMonth() + 1) + "/" + x.getFullYear() + " " + pad2(x.getHours()) + ":" + pad2(x.getMinutes()); };
        return {
          problem: r.penyebab || r.problem || r.area || "(tanpa keterangan)",
          tanggal: pad2(hp.getDate()) + "/" + pad2(hp.getMonth() + 1) + "/" + hp.getFullYear(),
          shift: mnt >= 420 && mnt < 1170 ? "1" : "2",
          penanganan: r.countermeasure || "",
          waktu: Math.round((new Date(r.waktu_akhir) - a) / 60000),
          selesai: f(r.waktu_akhir),
          pic: r.pic || "",
        };
      },
      // Problem Terbanyak versi 1 hari: dihitung dari baris hari yang sudah
      // diambil muatProblem(), memakai penyusun milik muatTop().
      hitungTopHarian() {
        if (!this.susunTop || !this._pfData) return;
        this.topRows = this.susunTop(this._pfData.filter((r) => shiftDari(r.waktu_awal) === this.perjamShift));
        this.topRowsAll = this.susunTop(this._pfData);
      },
      async muatProblem() {
        if (!this.bolehLihat()) return;
        const tok = (this._pfTok = (this._pfTok || 0) + 1);
        const line = this.activeTab, tgl = this.perjamTgl;
        if (!tgl) return;
        const [y, m, d] = tgl.split("-").map(Number);
        const awal = new Date(y, m - 1, d, 7, 0), akhir = new Date(y, m - 1, d + 1, 7, 0);
        try {
          const { data, error } = await supabaseClient.from("downtime_log")
            .select("waktu_awal,waktu_akhir,problem,area,penyebab,countermeasure,pic")
            .eq("mesin", line).gte("waktu_awal", awal.toISOString()).lt("waktu_awal", akhir.toISOString()).order("waktu_awal");
          if (error) throw error;
          if (tok !== this._pfTok) return;
          this._pfData = data || [];
          this.problemRows = this._pfData.filter((r) => shiftDari(r.waktu_awal) === this.perjamShift).map((r) => this.buatProblem(r));
          this.problemRowsAll = this._pfData.map((r) => this.buatProblem(r));   // Harian: 2 shift digabung
          this.hitungTopHarian();
        } catch (e) { console.error("Gagal memuat Problem Followup:", e); if (tok === this._pfTok) { this.problemRows = []; this.problemRowsAll = []; } }
      },
      async bangunPerjam() {
        if (!this.bolehLihat() || typeof Chart === "undefined") return;
        const token = (this._pjTok = (this._pjTok || 0) + 1);
        const line = this.activeTab;
        const bulanan = this.tampil === "bulanan";
        // Tab Bulanan: sumbernya hasil hitungan sebulan dari papan Dekidaka.
        // Tab lain: kiriman papan Dekidaka untuk tanggal & shift yang tampil.
        const dd = bulanan ? this.perjamBulan : this.dekiData;
        const sh = bulanan ? ((dd && dd.shift) || this.perjamShift) : this.perjamShift;
        const cocok = bulanan
          ? (dd && dd.line === line && dd.tahun === this.tahun && dd.bulan === this.bulan)
          : (dd && dd.line === line && dd.tanggal === this.perjamTgl && String(dd.shift) === String(sh));
        const baris = cocok ? (dd.baris || []) : [];
        const daftar = PERJAM_PART[line] || [];
        const kunci = line + "|" + (bulanan ? "B" + this.tahun + "-" + this.bulan : this.perjamTgl) + "|" + sh;
        if (this._pjKunci !== kunci) { this._pjKunci = kunci; this.perjamPilih = []; }   // ganti line/tanggal/shift -> kembali otomatis
        const data = {};
        daftar.forEach((kd) => {
          const pct = Array(11).fill(null), qty = Array(11).fill(0);
          let akhir = -1;
          for (let i = 0; i < 11; i++) {
            const rs = baris.filter((r) => r.blok === i + 1 && kodePerjam(r.part, daftar) === kd);
            if (!rs.length) continue;
            const q = rs.reduce((t, r) => t + (Number(r.qty) || 0), 0);
            const kols = [...new Set(rs.map((r) => r.kol))];
            const tg = kols.reduce((t, c) => t + (Number(((dd.target || [])[i] || [])[c]) || 0), 0);
            qty[i] = q;
            if (q > 0) akhir = i;
            if (q > 0 && tg > 0) pct[i] = Math.round((q / tg) * 1000) / 10;
          }
          data[kd] = { part: kd, qty, pct, akhir };
        });
        // Otomatis: 2 part dengan blok produksi terakhir paling akhir; sisanya diisi urutan daftar.
        let pilih = (this.perjamPilih || []).filter((k) => daftar.includes(k));
        if (pilih.length < 2) {
          const urut = [...daftar].sort((x, y) => data[y].akhir - data[x].akhir || daftar.indexOf(x) - daftar.indexOf(y));
          pilih = urut.slice(0, 2);
        }
        pilih = daftar.filter((k) => pilih.includes(k));   // urutan tampil sama dengan urutan daftar
        this.perjamChips = daftar.map((k) => ({ kode: k, aktif: pilih.includes(k), ada: data[k].akhir >= 0 }));
        const panels = pilih.map((k) => data[k]);
        while (panels.length < 2) panels.push({ part: "", pct: Array(11).fill(null), qty: Array(11).fill(0) });
        this.hapusPerjam();
        this.perjamPanels = panels; this.perjamMemuat = bulanan && !cocok;
        await this.$nextTick();
        if (token !== this._pjTok) return;
        panels.forEach((pn, i) => this.gambarPerjam(pn, i, sh));
      },
      dekiData: null,
      // Tampilan utama: dashboard (grid) atau Performance Tahunan/Bulanan/Harian (halaman mesin di iframe).
      tampil: "dashboard",
      // Tiap tampilan Performance (Harian/Bulanan/Tahunan) punya iframe sendiri yang DIPERTAHANKAN: pindah tab bolak-balik
      // tidak memuat ulang. Baru dimuat saat pertama dibuka; ganti line -> dimuat ulang saat dibuka lagi.
      perfSrc: { tahunan: "" },
      perfUrlFor(m) { return "machines/" + this.activeTab.toLowerCase() + ".html?tab=performance&bagian=" + m + "&v=" + DEKI_VER; },
      perfSegarkan() {
        ["tahunan"].forEach((m) => {
          if (m === this.tampil) { if (this.perfSrc[m] !== this.perfUrlFor(m)) this.perfSrc[m] = this.perfUrlFor(m); }
          else if (this.perfSrc[m] && this.perfSrc[m] !== this.perfUrlFor(m)) this.perfSrc[m] = "";   // line lain: lepas, muat lagi nanti
        });
      },
      setTampil(t) {
        this.tampil = t;
        this.perfSegarkan();
        if (t !== "tahunan") {
          this.repairSinkron();
          if (t !== "bulanan") this.bangunPerjam();
          // Kanvas tadi lebar 0 waktu tab ini tersembunyi -> gambar ulang.
          this.$nextTick(() => { window.dispatchEvent(new Event("resize")); this.gambar(); });
        }
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
            { clip: false, label: "Target", data: L.map((l, k) => (l === "–" ? null : 100)), borderColor: "#dc2626", backgroundColor: "#dc2626", borderWidth: 1.4, pointRadius: 1, tension: 0 },
            { clip: false, label: "Aktual", data: pn.pct, borderColor: "#1d4ed8", backgroundColor: "#1d4ed8", borderWidth: 1.6, pointRadius: 1, tension: 0, spanGaps: true },
          ] },
          options: { responsive: true, maintainAspectRatio: false, animation: false, layout: { padding: { top: 14, right: 10, left: 2 } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (it) => it.dataset.label + ": " + it.parsed.y + "%" + (it.datasetIndex === 1 ? " (" + pn.qty[it.dataIndex] + " pcs)" : "") } } },
            scales: {
              x: { offset: true, ticks: { color: "#000", font: { size: 6, weight: "700" }, autoSkip: false, maxRotation: 0, padding: 2 }, border: { dash: [1, 3] }, grid: { color: "#000", drawTicks: false } },
              y: { min: ymin, max: ymax, ticks: { color: "#000", font: { size: 8.5 }, stepSize: 10 }, border: { dash: [1, 3] }, grid: { color: "#000", drawTicks: false } } } },
          plugins: [kotak, titik("pjTitik" + i)],
        });
      },

      get tahunOptions() { const y = new Date().getFullYear(); return [y - 2, y - 1, y, y + 1]; },
      get jumlahHari() { return new Date(this.tahun, this.bulan, 0).getDate(); },
      get labelHari() { return Array.from({ length: this.jumlahHari }, (_, i) => String(i + 1)); },
      get repair3dUrl() { return "machines/" + this.activeTab.toLowerCase() + ".html?tab=repair&solo3d=1&v=" + DEKI_VER; },
      get dekiUrl() { return "dekidaka-line.html?line=" + this.activeTab + "&solo=1&dekidaka=1&inline=1&v=" + DEKI_VER; },
      dekiSiap: false,
      dekiZoom: "",
      // Tanggal & shift di bar atas juga dipakai papan Dekidaka (dan nanti Problem Followup).
      dekiSinkron(tujuan) {
        if (!this.perjamTgl) return;
        const frames = tujuan ? [tujuan] : Array.from(document.querySelectorAll(".dl-deki iframe, .dl-besar iframe"));
        let kecil = false;
        // Di tab Harian shift SENGAJA tidak dikirim -- papan Dekidaka memakai
        // pemilih shift miliknya sendiri, karena panel lain di tab itu sehari penuh.
        const isi = this.tampil === "harian" ? { tanggal: this.perjamTgl } : { tanggal: this.perjamTgl, shift: this.perjamShift };
        frames.forEach((fr) => { if (fr && fr.contentWindow) { fr.contentWindow.postMessage({ dekidakaSet: isi }, "*"); if (fr.closest(".dl-deki")) kecil = true; } });
        if (kecil) { this._dekiAck = false; setTimeout(() => { if (this.dekiSiap && !this._dekiAck) this.pesan = "Papan Dekidaka belum ikut tanggal/shift - tekan Ctrl+F5 sekali."; }, 6000); }
      },
      dekiAksi(a, besar) { const fr = document.querySelector(besar ? ".dl-besar iframe" : ".dl-deki iframe"); if (fr && fr.contentWindow) fr.contentWindow.postMessage({ dekidakaAksi: a }, "*"); },
      dekiBesarSiap: false,
      dekiZoomBesar: "",

      async setTab(tab) { this.dekiSiap = false; this.activeTab = tab; this.perfSegarkan(); this.muatPerjam(); this.muatFoto(); this.mulaiRealtime(); await this.muat(); },

      async muat(senyap) {
        if (!this.bolehLihat() || typeof Chart === "undefined") return;
        const token = (this._tok = (this._tok || 0) + 1);
        if (!senyap) this.memuat = true;
        this.pesan = "";
        const line = this.activeTab;
        this.muatTop();
        const sh = Number(this.perjamShift) || 1;   // bottom Control Board ikut pemilih Shift di bar atas
        const y = this.tahun, m = this.bulan, n = this.jumlahHari;
        const awal = new Date(y, m - 1, 1), akhir = new Date(y, m, 1);
        const sAwal = tglStr(y, m, 1);
        const sAkhir = tglStr(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1);
        const hariIni = new Date(); hariIni.setHours(0, 0, 0, 0);
        const lewat = (d) => new Date(y, m - 1, d) > hariIni;   // hari yang belum tiba

        const kosong = () => ({ avail: Array(n).fill(null), downtime: Array(n).fill(0), ngQty: Array(n).fill(0), ngVal: Array(n).fill(0), trQty: Array(n).fill(0), trVal: Array(n).fill(0), repQty: Array(n).fill(0), spPct: Array(n).fill(null), target: 100 });
        // "hasil" = shift terpilih (Control Board). "semua" = dua shift digabung (tab Harian).
        // Dua-duanya dihitung dari SATU kali ambil data, jadi tidak ada query tambahan
        // dan angkanya mustahil berbeda antar tab.
        const hasil = kosong(), semua = kosong();
        semua.gsph = Array(n).fill(null); semua.gsphTarget = Array(n).fill(null); semua.qtyHari = Array(n).fill(0);
        const whHari = Array(n).fill(0), tgtHari = Array(n).fill(0);
        try {
          const [prodRes, ngRes, repRes, spRes, tgRes, trRes] = await Promise.all([
            supabaseClient.rpc("dashboard_harian_produksi_shift", { p_start: awal.toISOString(), p_end: akhir.toISOString(), p_mesin: line }),
            ambilSemua("dashboard_qc_ng_detail_range_shift", { p_type_ng: "NG PRODUKSI", p_start: sAwal, p_end: sAkhir }),
            // Straightpass: stroke (qty) & repair diambil LANGSUNG dari production_log -- sumber yang sama
            // dengan Dekidaka / tab Performance. Hari produksi = 07:00 s/d 07:00 berikutnya.
            supabaseClient.from("production_log").select("id,stasiun,waktu_awal,waktu_akhir,qty,repair,part_number,dandori_menit,break_menit").eq("mesin", line)
              .gte("waktu_awal", sAwal + "T07:00:00+07:00").lt("waktu_awal", sAkhir + "T07:00:00+07:00").limit(5000),
            // NG per part, pengaturan target GSPH, dan downtime sebulan.
            // Downtime per part SENGAJA diambil dari downtime_log, bukan dari kolom
            // production_log.downtime_menit -- kolom itu cuma salinan yang diisi
            // trigger, dan di data lama banyak yang masih kosong. downtime_log
            // adalah sumber yang sama dengan angka Downtime di Ringkasan Bulan,
            // jadi dua angka itu dijamin tidak akan berselisih.
            Promise.all([
              supabaseClient.from("ng_inline_log").select("tanggal,jam,qty,part_number,type_ng")
                .eq("mesin", line).in("type_ng", ["NG PRODUKSI", "NG TRIAL"]).gte("tanggal", sAwal).lt("tanggal", sAkhir).limit(20000),
              supabaseClient.from("mesin_settings").select("gsph_target_mode,gsph_target_fixed").eq("mesin", line).maybeSingle(),
              (async () => {
                // Kalau kolom "stasiun" tidak ada di downtime_log, permintaannya
                // gagal TOTAL dan kolom Downtime jadi kosong tanpa pesan apa pun.
                // Jadi diulang sekali tanpa kolom itu.
                const ambil = (kol) => supabaseClient.from("downtime_log").select(kol).eq("mesin", line)
                  .gte("waktu_awal", sAwal + "T07:00:00+07:00").lt("waktu_awal", sAkhir + "T07:00:00+07:00").limit(20000);
                const r = await ambil("stasiun,waktu_awal,waktu_akhir");
                return r.error ? await ambil("waktu_awal,waktu_akhir") : r;
              })(),
            ]),
            supabaseClient.from("productivity_target").select("tahun,bulan,target").eq("tahun", y).eq("bulan", m),
            ambilSemua("dashboard_qc_ng_detail_range_shift", { p_type_ng: "NG TRIAL", p_start: sAwal, p_end: sAkhir }),
          ]);
          if (token !== this._tok) return;   // sudah ganti line/bulan lagi -> abaikan hasil lama

          // Availability & Downtime harian
          if (prodRes.error) throw prodRes.error;
          const semuaRows = prodRes.data || [];
          const rows = semuaRows.filter((x) => Number(x.shift) === sh);
          for (let d = 1; d <= n; d++) {
            const tg = tglStr(y, m, d);
            const r = rows.find((x) => x.tanggal === tg);
            if (r && r.wh_menit) hasil.avail[d - 1] = Number((((r.wh_menit - r.downtime_menit) / r.wh_menit) * 100).toFixed(1));
            hasil.downtime[d - 1] = r ? Math.round(Number(r.downtime_menit) || 0) : 0;
            // Gabungan: jam kerja dan downtime dua shift dijumlahkan dulu, baru dibagi.
            const sm = semuaRows.filter((x) => x.tanggal === tg);
            const wh = sm.reduce((t, x) => t + (Number(x.wh_menit) || 0), 0);
            const dt = sm.reduce((t, x) => t + (Number(x.downtime_menit) || 0), 0);
            if (wh) semua.avail[d - 1] = Number((((wh - dt) / wh) * 100).toFixed(1));
            semua.downtime[d - 1] = Math.round(dt);
            whHari[d - 1] = wh;
            tgtHari[d - 1] = sm.reduce((t, x) => t + (Number(x.target_std_menit) || 0), 0);
          }
          // NG Inline & Repair per hari, disaring line ini
          const hariDari = (tgl) => parseInt((tgl || "").slice(8, 10), 10);
          (ngRes.data || []).forEach((r) => {
            if (r.mesin !== line) return;
            const d = hariDari(r.tanggal);
            if (d < 1 || d > n) return;
            semua.ngQty[d - 1] += Number(r.qty) || 0; semua.ngVal[d - 1] += Number(r.value) || 0;
            if (Number(r.shift) !== sh) return;
            hasil.ngQty[d - 1] += Number(r.qty) || 0; hasil.ngVal[d - 1] += Number(r.value) || 0;
          });
          (trRes.data || []).forEach((r) => {
            if (r.mesin !== line) return;
            const d = hariDari(r.tanggal);
            if (d < 1 || d > n) return;
            semua.trQty[d - 1] += Number(r.qty) || 0; semua.trVal[d - 1] += Number(r.value) || 0;
            if (Number(r.shift) !== sh) return;
            hasil.trQty[d - 1] += Number(r.qty) || 0; hasil.trVal[d - 1] += Number(r.value) || 0;
          });
          // Hari produksi baris = tanggal UTC dari waktu_awal (jam lokal WIB dikurangi 7 jam).
          if (repRes.error) {
            console.error("Gagal memuat production_log untuk Straightpass:", repRes.error);
          } else {
            const stroke = Array(n).fill(0), ada = Array(n).fill(false);
            const strokeA = Array(n).fill(0), adaA = Array(n).fill(false);
            const peta = new Map();   // part -> {qty, repair, ng, trial, dt}
            const barisProd = [];                  // untuk mencocokkan downtime ke part
            const jendela = new Map();             // (stasiun|awal|akhir) -> {dandori, break}
            (repRes.data || []).forEach((r) => {
              const pn = r.part_number || "(tanpa part)";
              const o = peta.get(pn) || { part: pn, qty: 0, repair: 0, ng: 0, trial: 0, dt: 0 };
              o.qty += Number(r.qty) || 0; o.repair += Number(r.repair) || 0; peta.set(pn, o);
              if (r.waktu_awal && r.waktu_akhir) {
                barisProd.push({ st: r.stasiun || null, a: Date.parse(r.waktu_awal), z: Date.parse(r.waktu_akhir), pn });
              }
              // Dandori & Break ditulis sama di SEMUA part yang berbagi satu
              // jendela waktu. Kalau dijumlah apa adanya, jendela berisi dua part
              // terhitung dua kali -- jadi diambil yang terbesar per jendela,
              // sama persis dengan cara performance_aggregate menghitungnya.
              const k = (r.stasiun || "") + "|" + r.waktu_awal + "|" + r.waktu_akhir;
              const j = jendela.get(k) || { dandori: 0, brk: 0 };
              j.dandori = Math.max(j.dandori, Number(r.dandori_menit) || 0);
              j.brk = Math.max(j.brk, Number(r.break_menit) || 0);
              jendela.set(k, j);
            });
            let dandoriB = 0, breakB = 0;
            jendela.forEach((j) => { dandoriB += j.dandori; breakB += j.brk; });
            const [ngPartRes, setRes, dtRes] = spRes || [];
            if (dtRes && dtRes.error) console.error("Gagal memuat downtime_log untuk Rekap per Part:", dtRes.error);
            // Downtime per part: tiap baris downtime dijatuhkan ke baris produksi
            // yang menampungnya, dicocokkan dari JAMNYA -- aturan yang sama dengan
            // trigger link_and_validate_downtime di database. Sengaja tidak
            // memakai kolom production_log_id supaya tidak bergantung pada kolom
            // yang mungkin belum terisi di baris-baris lama.
            barisProd.sort((x, y) => x.a - y.a);
            let dtLepas = 0;
            const dtHari = Array(n).fill(0);
            let adaDt = false;
            (dtRes && dtRes.data ? dtRes.data : []).forEach((r) => {
              const a = Date.parse(r.waktu_awal), z = Date.parse(r.waktu_akhir);
              // Dibulatkan ke menit utuh PER BARIS. Baris downtime lama dari
              // stopwatch menyimpan detik; kalau detiknya dibiarkan, jumlah yang
              // dibulatkan belakangan bisa meleset semenit dari jumlah per part.
              const menit = Math.round((z - a) / 60000);
              if (!(menit > 0)) return;
              adaDt = true;
              const d = hariDari(new Date(a).toISOString());
              if (d >= 1 && d <= n) dtHari[d - 1] += menit;
              const st = r.stasiun || null;
              const cocok = barisProd.find((b) => b.a <= a && b.z >= z && (b.st === st || b.st === null || st === null));
              if (!cocok) { dtLepas += menit; return; }
              const o = peta.get(cocok.pn); if (o) o.dt += menit;
            });
            this.rekapDtLepas = dtLepas;
            // Downtime harian versi gabungan diambil dari baris downtime_log yang
            // sama dengan Rekap per Part. Satu sumber, satu cara membulatkan ->
            // grafik, kartu Ringkasan, dan tabel Rekap mustahil berselisih.
            if (adaDt) for (let d = 1; d <= n; d++) semua.downtime[d - 1] = dtHari[d - 1];
            (ngPartRes && ngPartRes.data ? ngPartRes.data : []).forEach((r) => {
              const pn = r.part_number || "(tanpa part)";
              const o = peta.get(pn) || { part: pn, qty: 0, repair: 0, ng: 0, trial: 0, dt: 0 };
              if (r.type_ng === "NG TRIAL") o.trial += Number(r.qty) || 0;
              else o.ng += Number(r.qty) || 0;
              peta.set(pn, o);
            });
            // Baris Non-Produksi (A, C, K, G1 dan sejenisnya) dibuang -- tabel ini
            // khusus part number. Part asli selalu berbentuk 25051-BZ260: ada tanda
            // hubung, atau setidaknya berangka dan panjangnya 4 huruf ke atas.
            const partAsli = (pn) => /-/.test(pn) || (/\d/.test(pn) && pn.length >= 4);
            this.rekapPart = [...peta.values()].filter((o) => partAsli(o.part)).map((o) => ({
              ...o,
              rasio: o.qty > 0 ? Number(((o.ng / o.qty) * 100).toFixed(2)) : null,
              sp: o.qty > 0 ? Number((((o.qty - o.repair) / o.qty) * 100).toFixed(1)) : null,
            })).sort((a, b) => b.qty - a.qty || a.part.localeCompare(b.part));
            this.mesinSet = (setRes && setRes.data) || null;
            (repRes.data || []).forEach((r) => {
              const d = hariDari(new Date(r.waktu_awal).toISOString());
              if (d < 1 || d > n) return;
              semua.repQty[d - 1] += Number(r.repair) || 0;
              strokeA[d - 1] += Number(r.qty) || 0; adaA[d - 1] = true;
              if (Number(shiftDari(r.waktu_awal)) !== sh) return;
              hasil.repQty[d - 1] += Number(r.repair) || 0;
              stroke[d - 1] += Number(r.qty) || 0; ada[d - 1] = true;
            });
            // % Straightpass harian = (stroke - repair) / stroke
            for (let d = 1; d <= n; d++) {
              if (lewat(d)) continue;
              if (ada[d - 1] && stroke[d - 1]) hasil.spPct[d - 1] = Number((((stroke[d - 1] - hasil.repQty[d - 1]) / stroke[d - 1]) * 100).toFixed(1));
              if (adaA[d - 1] && strokeA[d - 1]) semua.spPct[d - 1] = Number((((strokeA[d - 1] - semua.repQty[d - 1]) / strokeA[d - 1]) * 100).toFixed(1));
            }
            // ---- Ringkasan sebulan ----
            // Dihitung dari TOTAL sebulan, bukan rata-rata angka harian. Hari yang
            // cuma jalan 2 jam tidak boleh punya bobot sama dengan hari penuh.
            const jml = (a) => a.reduce((t, x) => t + (Number(x) || 0), 0);
            const whB = jml(whHari), dtB = jml(semua.downtime), qtyB = jml(strokeA);
            const ngB = jml(semua.ngQty), repB = jml(semua.repQty), tgtB = jml(tgtHari);
            semua.ringkas = { whB, dtB, qtyB, ngB, repB, tgtB, dandoriB, breakB };

            // ---- Perjam harian (dua shift digabung) -- rumusnya disamakan dengan tab Performance ----
            //   Perjam Aktual = Qty Produksi / jam kerja
            //   Perjam Target = ikut pengaturan mesin (tetap, atau dihitung per part)
            const mode = this.mesinSet && this.mesinSet.gsph_target_mode;
            const tetap = Number(this.mesinSet && this.mesinSet.gsph_target_fixed) || 0;
            for (let d = 1; d <= n; d++) {
              if (lewat(d)) continue;
              const wh = whHari[d - 1], tgt = tgtHari[d - 1], st = strokeA[d - 1];
              semua.qtyHari[d - 1] = st;
              if (!wh || !st) continue;
              semua.gsph[d - 1] = Number((st / (wh / 60)).toFixed(1));
              const gt = mode === "per_part" && tgt > 0 ? st / (tgt / 60) : tetap;
              if (gt > 0) semua.gsphTarget[d - 1] = Number(gt.toFixed(1));
            }
          }
          const t = (tgRes.data || [])[0];
          if (t && Number.isFinite(Number(t.target))) { hasil.target = Number(t.target); semua.target = Number(t.target); }
          for (let d = 1; d <= n; d++) if (lewat(d)) { hasil.avail[d - 1] = null; semua.avail[d - 1] = null; }
        } catch (e) {
          console.error("Gagal memuat Dashboard Line:", e);
          this.pesan = "Gagal memuat data: " + (e.message || e);
        }
        if (token !== this._tok) return;
        this.data = hasil;
        this.dataAll = semua;
        this.memuat = false;
        this.$nextTick(() => this.gambar());
      },

      data: null,
      dataAll: null,   // dua shift digabung -- dipakai tab Harian & Bulanan
      rekapPart: [],   // rekap sebulan per part number -- tab Bulanan
      rekapDtLepas: 0, // menit downtime yang tidak terhubung ke baris produksi mana pun
      mesinSet: null,  // pengaturan GSPH target, untuk rumus OEE
      get rekapPartTotal() {
        const t = this.rekapPart.reduce((a, r) => ({ qty: a.qty + r.qty, dt: a.dt + Math.round(r.dt), ng: a.ng + r.ng, trial: a.trial + r.trial, repair: a.repair + r.repair }), { qty: 0, dt: 0, ng: 0, trial: 0, repair: 0 });
        return { ...t,
          rasio: t.qty > 0 ? Number(((t.ng / t.qty) * 100).toFixed(2)) : null,
          sp: t.qty > 0 ? Number((((t.qty - t.repair) / t.qty) * 100).toFixed(1)) : null };
      },
      get totalQtyBulan() {
        return ((this.dataAll && this.dataAll.qtyHari) || []).reduce((a, b) => a + b, 0);
      },
      // Kartu Ringkasan Bulan. Bentuknya disamakan dengan kartu Performance di
      // halaman mesin (kelas CSS-nya memang dipakai bersama), isinya total sebulan.
      get ringkas() {
        const r = (this.dataAll && this.dataAll.ringkas) || {};
        const whB = r.whB || 0, dtB = r.dtB || 0, qtyB = r.qtyB || 0, ngB = r.ngB || 0, repB = r.repB || 0, tgtB = r.tgtB || 0;
        const mode = this.mesinSet && this.mesinSet.gsph_target_mode;
        const tetap = Number(this.mesinSet && this.mesinSet.gsph_target_fixed) || 0;
        const jam = whB / 60;
        const gsph = jam > 0 ? qtyB / jam : 0;
        const gsphTarget = mode === "per_part" && tgtB > 0 ? qtyB / (tgtB / 60) : tetap;
        const A = whB > 0 ? Math.max(0, (whB - dtB) / whB) * 100 : 0;
        const P = gsphTarget > 0 ? Math.min(gsph / gsphTarget, 1) * 100 : 0;
        const Q = qtyB > 0 ? Math.max(0, (qtyB - ngB) / qtyB) * 100 : 100;
        return {
          oee: (A / 100) * (P / 100) * (Q / 100) * 100, availability: A, performanceFactor: P, quality: Q,
          gsph, stroke: qtyB, ng: ngB, repairQty: repB,
          ngRatio: qtyB > 0 ? (ngB / qtyB) * 100 : 0,
          straightPass: qtyB > 0 ? ((qtyB - repB) / qtyB) * 100 : 0,
          downtimeMenit: Math.round(dtB), dandoriMenit: Math.round(r.dandoriB || 0),
          breakMenit: Math.round(r.breakB || 0), whJam: Number(jam.toFixed(1)),
        };
      },
      ringkasKelas() {
        const d = this.ringkas;
        if (!d.stroke) return "status-none";
        const n = Number(d.oee) || 0;
        return n >= 75 ? "status-good" : (n >= 50 ? "status-warn" : "status-bad");
      },
      lebarBar(v) { return Math.max(0, Math.min(100, Number(v) || 0)); },
      get ringkasBulan() {
        const r = (this.dataAll && this.dataAll.ringkas) || { whB: 0, dtB: 0, qtyB: 0, ngB: 0, repB: 0, tgtB: 0 };
        const n = (v, d) => Number(v).toLocaleString("id-ID", { maximumFractionDigits: d === undefined ? 0 : d });
        const mode = this.mesinSet && this.mesinSet.gsph_target_mode;
        const tetap = Number(this.mesinSet && this.mesinSet.gsph_target_fixed) || 0;
        const jam = r.whB / 60;
        const gsph = jam > 0 ? r.qtyB / jam : 0;
        const gsphTarget = mode === "per_part" && r.tgtB > 0 ? (r.tgtB > 0 ? r.qtyB / (r.tgtB / 60) : 0) : tetap;
        const A = r.whB > 0 ? Math.max(0, (r.whB - r.dtB) / r.whB) : 0;
        const P = gsphTarget > 0 ? Math.min(gsph / gsphTarget, 1) : 0;
        const Q = r.qtyB > 0 ? Math.max(0, (r.qtyB - r.ngB) / r.qtyB) : 1;
        const sp = r.qtyB > 0 ? ((r.qtyB - r.repB) / r.qtyB) * 100 : null;
        return [
          { label: "Qty Produksi", nilai: n(r.qtyB), satuan: "pcs" },
          { label: "Jam Kerja", nilai: n(jam, 1), satuan: "jam" },
          { label: "Downtime", nilai: n(r.dtB), satuan: "mnt" },
          { label: "Perjam Aktual", nilai: n(gsph, 1), satuan: "" },
          { label: "Availability", nilai: n(A * 100, 1) + "%", satuan: "" },
          { label: "Performance", nilai: n(P * 100, 1) + "%", satuan: "" },
          { label: "Quality", nilai: n(Q * 100, 1) + "%", satuan: "" },
          { label: "OEE", nilai: n(A * P * Q * 100, 1) + "%", satuan: "" },
          { label: "Straightpass", nilai: sp === null ? "-" : n(sp, 1) + "%", satuan: "" },
          { label: "NG Inline", nilai: n(r.ngB), satuan: "pcs" },
          { label: "Repair", nilai: n(r.repB), satuan: "pcs" },
          { label: "Hari Produksi", nilai: n(((this.dataAll && this.dataAll.qtyHari) || []).filter((x) => x > 0).length), satuan: "hari" },
        ];
      },
      get totalDowntime() { return this.data ? this.data.downtime.reduce((a, b) => a + b, 0) : 0; },
      get totalDowntimeAll() { return this.dataAll ? this.dataAll.downtime.reduce((a, b) => a + b, 0) : 0; },
      rataDari(d) {
        if (!d) return 0;
        const v = d.avail.filter((x) => x !== null);
        return v.length ? Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(1)) : 0;
      },
      get rataAvail() { return this.rataDari(this.data); },
      get rataAvailAll() { return this.rataDari(this.dataAll); },
      // Susunan panel dipakai bersama Control Board & tab Harian. Yang membedakan
      // cuma SUMBER DATANYA: Control Board 1 shift, Harian sehari penuh (2 shift).
      get papanHarian() { return this.tampil === "harian"; },
      get papanBulanan() { return this.tampil === "bulanan"; },
      get papanGabung() { return this.papanHarian || this.papanBulanan; },
      get papanData() { return this.papanGabung ? this.dataAll : this.data; },
      get papanProblem() { return this.papanBulanan ? this.problemRowsBulan : (this.papanHarian ? this.problemRowsAll : this.problemRows); },
      get papanTop() { return this.papanBulanan ? this.topRowsBulan : (this.papanHarian ? this.topRowsAll : this.topRows); },
      // Di tab Harian tidak ditulis apa-apa: panelnya memang sehari penuh, jadi
      // keterangan shift cuma jadi hiasan. Control Board tetap ditulis, di sana
      // penting supaya tidak salah baca shift mana yang sedang tampil.
      get labelShift() { return this.papanGabung ? "" : "Shift " + this.perjamShift; },
      get labelShiftAwal() { return this.labelShift ? this.labelShift + " · " : ""; },
      get rataAvailPapan() { return this.rataDari(this.papanData); },
      get totalDowntimePapan() { return this.papanData ? this.papanData.downtime.reduce((a, b) => a + b, 0) : 0; },
      fmtNum,

      hancur(id) { if (this.charts[id]) { this.charts[id].destroy(); delete this.charts[id]; } },
      kanvas(id) { this.hancur(id); return document.getElementById(id); },

      // Kanvasnya satu set, dipakai bersama Control Board & tab Harian --
      // yang berganti cuma datanya. Digambar ulang tiap pindah tab.
      gambar() {
        if (typeof Chart === "undefined") return;
        if (this.tampil === "tahunan") return;
        this.gambarSet("dl", this.papanData);
        const aman = (fn, nama) => { try { fn(); } catch (e) { console.error("Gagal gambar", nama, e); } };
        aman(() => this.gambarTrend(), "trend");
      },
      gambarSet(pre, Dpakai) {
        const L = this.labelHari;
        const D = Dpakai || { avail: [], downtime: [], ngQty: [], ngVal: [], repQty: [], spPct: [], target: 100 };
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
        aman(() => batangPersen(pre + "Availability", D.avail, COL.availability, null), "availability");

        // Downtime harian (area)
        aman(() => {
          const c = this.kanvas(pre + "Downtime"); if (!c) return;
          this.charts[pre + "Downtime"] = new Chart(c, {
            type: "line",
            data: { labels: L, datasets: [{ label: "Downtime (menit)", data: D.downtime, fill: true, backgroundColor: COL.downtime + "33", borderColor: COL.downtime, borderWidth: 1.2, tension: 0.35, cubicInterpolationMode: "monotone", pointRadius: 1, pointBackgroundColor: COL.downtime }] },
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
        aman(() => ganda(pre + "NgInline", COL.ngInline, COL.money, "Qty", "Value (ribu Rp)", false, D.ngQty, D.ngVal, "above"), "ngInline");
        aman(() => ganda(pre + "NgTrial", COL.ngInline, COL.money, "Qty", "Value (ribu Rp)", false, D.trQty || [], D.trVal || [], "above"), "ngTrial");
        aman(() => ganda(pre + "Straightpass", COL.straight, "#000000", "Qty Repair", "% Straightpass", true, D.repQty, D.spPct, "base"), "straightpass");

        // Grafik Perjam Harian -- cuma ada di tab Bulanan, menggantikan Grafik
        // Perjam per blok. Bentuknya disamakan dengan grafik Performance Bulanan
        // di halaman mesin: batang hijau Aktual, garis merah Target, garis
        // putus-putus kuning Qty Produksi di sumbu kanan (skalanya beda jauh).
        if (this.tampil !== "bulanan") return;
        aman(() => {
          const c = this.kanvas("dlPerjamHari"); if (!c) return;
          // Angka di TENGAH batang (supaya tidak bertabrakan dengan garis yang
          // lewat di atasnya) dan di ATAS titik garis. Chart.js inti tidak punya
          // ini, dan pustaka datalabels sengaja tidak dipakai di aplikasi ini --
          // jadi plugin kecil sendiri, cuma dipasang di grafik ini.
          const angkaPlugin = {
            id: "dlAngkaPerjam",
            afterDatasetsDraw(chart) {
              const { ctx } = chart;
              chart.data.datasets.forEach((ds, i) => {
                const meta = chart.getDatasetMeta(i);
                if (meta.hidden) return;
                ctx.save();
                ctx.textAlign = "center";
                if (ds.type === "bar") {
                  ctx.fillStyle = "#000000"; ctx.font = "bold 9px sans-serif"; ctx.textBaseline = "middle";
                  meta.data.forEach((bar, k) => {
                    const v = ds.data[k];
                    if (v === null || v === undefined || Number(v) === 0) return;
                    if (Math.abs(bar.base - bar.y) < 14) return;   // batang terlalu pendek -> angkanya tidak muat
                    ctx.fillText(fmtNum(v), bar.x, (bar.y + bar.base) / 2);
                  });
                } else {
                  ctx.fillStyle = ds.borderColor; ctx.font = "bold 9px sans-serif"; ctx.textBaseline = "bottom";
                  meta.data.forEach((titik, k) => {
                    const v = ds.data[k];
                    if (v === null || v === undefined || Number(v) === 0) return;
                    ctx.fillText(fmtNum(v), titik.x, titik.y - 4);
                  });
                }
                ctx.restore();
              });
            },
          };
          this.charts.dlPerjamHari = new Chart(c, { type: "bar",
            plugins: [angkaPlugin],
            data: { labels: L, datasets: [
              { type: "bar", label: "Perjam (Aktual)", data: D.gsph || kosong,
                backgroundColor: COL.availability, borderRadius: 0, borderSkipped: false,
                barPercentage: 0.7, categoryPercentage: 0.8, order: 2 },
              { type: "line", label: "Perjam (Target)", data: D.gsphTarget || kosong,
                borderColor: "#DC2626", backgroundColor: "#DC2626", borderWidth: 2,
                pointRadius: 0, tension: 0, spanGaps: true, order: 1 },
              { type: "line", label: "Qty Produksi (Harian)", data: D.qtyHari || kosong,
                borderColor: "#D97706", backgroundColor: "transparent", borderWidth: 2,
                borderDash: [5, 3], pointRadius: 0, tension: 0.25, spanGaps: true,
                yAxisID: "y1", order: 0 },
            ] },
            options: { responsive: true, maintainAspectRatio: false, animation: noAnim,
              layout: { padding: { top: 18, right: 6, left: 4 } },
              plugins: { legend: legenda(true),
                tooltip: { callbacks: { label: (it) => it.dataset.label + ": " + it.formattedValue } } },
              scales: {
                x: skalaX(),
                y: { ...skalaY(), position: "left" },
                y1: { ...skalaY(), position: "right", grid: { drawOnChartArea: false }, ticks: { ...tick, color: "#D97706" } },
              } },
          });
        }, "perjamHari");
      },

      // ---------- Trend Volume (per minggu) ----------
      // Nilai per minggu = Total Aktual / Total Target x 100, dihitung oleh papan Dekidaka (rumus Target yang sama).
      mingguHasil: null,
      mingguPesan: "",
      mintaMingguan(senyap) {
        const fr = document.querySelector(".dl-deki iframe");
        const line = this.activeTab, tahun = this.tahun, bulan = this.bulan;
        const kc = `${line}|${tahun}|${bulan}`, ada = mgCache[kc];
        if (!senyap && ada && Date.now() - ada.t < 600000) { this.mingguHasil = ada.r; this.mingguPesan = ""; this.gambarTrend(); return; }
        if (!senyap) { this.mingguHasil = null; this.mingguPesan = "Menghitung…"; this.gambarTrend(); }
        if (!fr || !fr.contentWindow) { this.mingguPesan = ""; return; }
        const kirim = () => { try { fr.contentWindow.postMessage({ dekidakaMingguan: { line, tahun, bulan } }, "*"); } catch (e) {} };
        kirim();
        // Papan bisa belum siap: ulangi sampai ada jawaban (maks. beberapa kali).
        let sisa = 6;
        const ulang = () => {
          if (senyap || this.mingguHasil || line !== this.activeTab || tahun !== this.tahun || bulan !== this.bulan) return;
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
            { label: "Rata-rata Rasio", data: nilai, borderColor: COL.trend, backgroundColor: COL.trend, borderWidth: 2, pointRadius: 1, tension: 0, spanGaps: true, clip: false },
          ] },
          options: { responsive: true, maintainAspectRatio: false, animation: { duration: 0 }, layout: { padding: { top: 22, right: 14, left: 4 } }, plugins: { legend: legenda(true), tooltip: { callbacks: { label: (it) => it.dataset.label + ": " + it.formattedValue + "%" } } },
            scales: { x: { ...skalaX(), offset: true, ticks: { color: "#000", font: { size: 11, weight: "700" }, autoSkip: false, maxRotation: 0 } }, y: { ...skalaY(), min: ymin, max: ymax, ticks: { ...tick, stepSize: 10, callback: (v) => v + "%" } } } },
          plugins: [labelGaris((v) => v + "%", 1)] });
      },

      // ---------- Kotak foto (1 foto per line, disimpan di Supabase Storage bucket "line-foto") ----------
      fotoUrl: "",
      fotoBesar: false,
      r3dBesar: false,
      r3dTerima: false,
      r3dVer: "",
      // Kotak 3D tidak membalas dalam 7 detik / beda versi -> berarti file machine-page.js belum terganti.
      r3dCek() {
        
        setTimeout(() => {
          if (this.r3dTerima || this.tampil === "tahunan") return;
          this.r3dVer = "lama";
          this.pesan = "Kotak 3D masih memakai file lama - unggah assets/machine-page.js dan folder machines/, lalu Ctrl+F5.";
        }, 7000);
      },
      fotoPesan: "",
      fotoBusy: false,
      fotoJenis: "gambar",   // "gambar" | "video"
      _jenisLokal: {},
      async muatFoto() {
        const line = this.activeTab;
        this.fotoPesan = "";
        try {
          const st = supabaseClient.storage.from("line-foto");
          const { data, error } = await st.list("", { search: line });
          if (line !== this.activeTab) return;
          if (error) throw error;
          const re = new RegExp("^" + line.replace(/[-]/g, "\\-") + "\\.(jpg|jpeg|png|webp|mp4|webm|mov|m4v)$", "i");
          const cocok = (data || []).filter((x) => re.test(x.name))
            .sort((x, y) => String(y.updated_at || y.created_at || "").localeCompare(String(x.updated_at || x.created_at || "")));
          const f = cocok[0];
          if (f) {
            this.fotoJenis = /\.(mp4|webm|mov|m4v)$/i.test(f.name) ? "video" : "gambar";
            this.fotoUrl = st.getPublicUrl(f.name).data.publicUrl + "?v=" + encodeURIComponent(f.updated_at || f.created_at || "");
          } else {
            this.fotoUrl = (this._fotoLokal && this._fotoLokal[line]) || ""; this.fotoJenis = this._jenisLokal[line] || "gambar";
          }
        } catch (e) {
          console.error("Gagal memuat TSK:", e);
          this.fotoUrl = (this._fotoLokal && this._fotoLokal[line]) || ""; this.fotoJenis = this._jenisLokal[line] || "gambar";
        }
      },
      async unggahFoto(ev) {
        const file = ev.target.files && ev.target.files[0]; ev.target.value = "";
        if (!file || !this.isAdmin()) return;
        const line = this.activeTab;
        const video = /^video\//.test(file.type) || /\.(mp4|webm|mov|m4v)$/i.test(file.name);
        if (video && file.size > 50 * 1024 * 1024) { this.fotoPesan = "Video terlalu besar (maks. 50 MB) - perkecil dulu / pendekkan durasinya."; return; }
        this.fotoBusy = true; this.fotoPesan = "";
        try {
          const st = supabaseClient.storage.from("line-foto");
          let blob, nama, tipe;
          if (video) {
            const ext = (file.name.split(".").pop() || "mp4").toLowerCase();
            nama = line + "." + (["mp4", "webm", "mov", "m4v"].includes(ext) ? ext : "mp4");
            tipe = ext === "webm" ? "video/webm" : "video/mp4";
            blob = file;
          } else {
            // Gambar: perkecil dulu (maks. 1600px) supaya ringan.
            const bmp = await createImageBitmap(file);
            const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
            const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
            cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
            blob = await new Promise((res) => cv.toBlob(res, "image/jpeg", 0.85));
            nama = line + ".jpg"; tipe = "image/jpeg";
          }
          const { error } = await st.upload(nama, blob, { upsert: true, contentType: tipe });
          if (error) throw error;
          // Hanya 1 TSK per line: hapus berkas jenis lain milik line ini.
          const lain = ["jpg", "jpeg", "png", "webp", "mp4", "webm", "mov", "m4v"].map((x) => line + "." + x).filter((x) => x !== nama);
          try { await st.remove(lain); } catch (e) {}
          this._fotoLokal = this._fotoLokal || {}; this._fotoLokal[line] = URL.createObjectURL(blob); this._jenisLokal[line] = video ? "video" : "gambar";
          await this.muatFoto();
        } catch (e) {
          console.error("Gagal unggah TSK:", e);
          this.fotoPesan = "Gagal unggah TSK: " + (e.message || e) + (video ? " (video maks. 50 MB)" : " (sudah menjalankan SQL 'Trend Volume + Foto'?)");
        }
        this.fotoBusy = false;
      },
      async hapusFoto() {
        if (!this.isAdmin() || !this.fotoUrl) return;
        if (!confirm("Hapus TSK " + this.activeTab + "?")) return;
        const line = this.activeTab;
        try {
          const { error } = await supabaseClient.storage.from("line-foto").remove(["jpg", "jpeg", "png", "webp", "mp4", "webm", "mov", "m4v"].map((x) => line + "." + x));
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
          if (d.repair3dBuild) { this.r3dTerima = true; this.r3dVer = d.repair3dBuild; if (d.repair3dBuild !== DEKI_VER) this.pesan = "Kotak 3D versi " + d.repair3dBuild + ", halaman versi " + DEKI_VER + " - unggah assets/machine-page.js dan folder machines/, lalu Ctrl+F5."; }
          if (d.repairSiap) this.repairSinkron();
          if (d.repairTotal) this.repair3dTotal = d.repairTotal;
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
          if (d.dekidakaPerjamBulanHasil && !dariBesar) {
            const r = d.dekidakaPerjamBulanHasil;
            if (r.line === this.activeTab && r.tahun === this.tahun && r.bulan === this.bulan) {
              this.perjamBulan = r; this.perjamPesan = r.error || ""; this.bangunPerjam();
            }
          }
          if (d.dekidakaSetOk) { this._dekiAck = true; if (/Dekidaka belum ikut/.test(this.pesan)) this.pesan = ""; }
        });
        window.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (this.topDetail) this.topDetail = null; else if (this.r3dBesar) this.r3dBesar = false; else if (this.fotoBesar) this.fotoBesar = false; else if (this.dekiBuka) this.tutupDekidaka(); } });
        setTimeout(() => { this.dekiSiap = true; }, 8000);   // jaga-jaga kalau sinyal siap tidak datang
      },
      ubahPeriode() {
        // Picker tanggal ikut Bulan/Tahun yang dipilih (hari dipertahankan; bulan berjalan -> hari ini).
        const now = new Date();
        if (this.tahun === now.getFullYear() && this.bulan === now.getMonth() + 1) this.perjamTgl = tglHariIni();
        else { const dh = Number((this.perjamTgl || "").slice(8, 10)) || 1; this.perjamTgl = tglStr(this.tahun, this.bulan, Math.min(dh, this.jumlahHari)); }
        this.tandaiManual();
        this.muatPerjam();
        this.muat();
        if (this.tampil === "bulanan") this.repairSinkron();
      },
      // ---------- Data baru langsung masuk (tanpa refresh) ----------
      // Realtime (Pusher/Supabase lewat RealtimeHub) + cadangan polling 45 dtk kalau realtime tidak aktif/putus.
      segarkanData() {
        clearTimeout(this._segTimer);
        this._segTimer = setTimeout(() => {
          if (!this.bolehLihat() || document.hidden || this.tampil !== "dashboard") return;
          const line = this.activeTab;
          Object.keys(mgCache).forEach((k) => { if (k.indexOf(line + "|") === 0) delete mgCache[k]; });
          const fr = document.querySelector(".dl-deki iframe");
          try { if (fr && fr.contentWindow) fr.contentWindow.postMessage({ dekidakaSegarkan: true }, "*"); } catch (e) {}
          this.muatProblem();
          this.muat(true);
        }, 900);
      },
      mulaiRealtime() {
        if (this._rtDl) return;
        this._rtDl = true;
        if (typeof RealtimeHub !== "undefined") {
          const tabel = ["production_log", "production_log_new", "downtime_log", "dandori_log", "ng_inline_log", "repair_log"];
          try {
            RealtimeHub.subscribe("rt_dashboard_line", tabel.map((table) => ({
              table,
              onChange: (pl) => {
                const m = (pl && ((pl.new && pl.new.mesin) || (pl.old && pl.old.mesin))) || "";
                if (m && m !== this.activeTab) return;
                this.segarkanData();
              },
            })));
          } catch (e) { console.warn("Realtime Dashboard Line gagal:", e); }
        }
        setInterval(() => { if (!document.hidden) this.segarkanData(); }, 45000);
        document.addEventListener("visibilitychange", () => { if (!document.hidden) this.segarkanData(); });
      },
    };
  };
})();
