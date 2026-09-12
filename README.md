# Welding Exhaust — Sistem Input Produksi & Downtime

Aplikasi web (HTML + Alpine.js + Supabase) untuk mencatat data produksi dan
downtime **6 line Welding: E-02, E-03, E-04, E-05, E-06, E-07**. Bisa
diinstall di HP (PWA). Tampilan app tetap bisa dibuka tanpa sinyal, dan
simpan data **Input Produksi** (alur lama & baru) serta **Downtime** saat
sinyal putus akan diantrekan di HP lalu disinkron otomatis begitu online.
NG Inline (ada foto), Repair (titik 3D), dan semua proses edit/hapus tetap
butuh koneksi.

Project ini awalnya adaptasi dari sistem serupa milik dept Press, sudah
direstrukturisasi total untuk Welding (line flat, tanpa sub-stasiun).

---

## Struktur project

```
├── login.html / index.html                      # Login & Dashboard
├── dashboard-exhaust.html                        # Dashboard Exhaust (ringkasan per line, di atas Dashboard)
├── plan-produksi.html                            # Plan Produksi Harian (di bawah Dashboard)
├── input-produksi.html                           # Pilih line → catat produksi/downtime
├── input-attendance.html                         # Absensi harian (admin/leader)
├── master-data.html                              # Master data umum: Total Orang, OT, Shift, Hari Libur, Scrap, Safety (admin)
├── data-mentah.html                              # Lihat & export data mentah (admin)
├── reset-password.html                           # Halaman ganti password (dari link email)
├── manifest.json / service-worker.js             # PWA (install ke HP + cache offline)
├── machines/e-02.html ... e-07.html              # 6 halaman line Welding
├── assets/
│   ├── style.css
│   ├── supabaseClient.js                          # ISI URL & KEY SUPABASE DI SINI
│   └── machine-page.js                            # Logika Alpine.js, dipakai semua 6 line
│
├── schema_welding.sql                             # 1) Jalankan sekali di project Supabase baru
├── migration_downtime_format_v2.sql               # 2) Tambah field form downtime (PIC, Area, dst)
├── migration_downtime_format_v3.sql               # 3) Cascading dropdown Problem Kategori/Detail
├── seed_welding_part_numbers.sql                  # 4) Isi awal Part Number + Std Cycle Time
├── seed_downtime_master.sql                       # 5) Isi awal Problem Kategori/Detail/Area
├── seed_nonproduksi_types.sql                     # 6) Isi awal jenis Non-Produksi (Dandori)
├── migration_nonproduksi_kode.sql                  # 6b) Tambah kode jenis Non-Produksi (A, B, B1, dst)
├── migration_repair_v1.sql                        # 7) Tab Repair (titik di gambar, versi lama)
├── migration_repair_v2.sql                        # 8) Rename label titik + seed Kategori Repair
├── migration_repair_v3_3d.sql                     # 9) Repair jadi 3D (.stl) -- jalankan setelah v1 & v2
├── migration_repair_v4_point_normals.sql          # 10) Arah normal Point (biar ketutup model saat diputar)
├── migration_repair_v5_part_number.sql            # 11) Tambah Part No (dropdown) di popup Repair, sebelum Qty
├── migration_repair_v6_per_line.sql               # 12) Part 3D Repair jadi per-line (dulu shared semua line)
├── migration_repair_v7_fix_delete.sql              # 13) Perbaiki hapus Part 3D yang sudah ada riwayat Repair-nya
├── migration_repair_v8_part_color.sql              # 14) Warna custom per Part 3D (file .stl tidak simpan warna)
├── migration_plan_produksi.sql                     # 15) Tabel Plan Harian (per part/line/shift) + Backlog + RPC actual
├── migration_enable_realtime.sql                   # 16) Aktifkan Supabase Realtime (live update antar tab/HP)
├── patch_security_profiles_role.sql                # WAJIB: kunci role/jabatan/NIK supaya user biasa tidak bisa jadi admin
└── reset_welding.sql                              # Utilitas: reset total kalau setup gagal di tengah
```

---

## Setup dari nol (project Supabase baru)

1. Buat project baru di https://supabase.com
2. **SQL Editor** → jalankan file-file di atas **sesuai urutan angkanya** (1 → 6)
3. **Project Settings > API Keys** → salin `Project URL` dan key
   `sb_publishable_...` → isi ke `assets/supabaseClient.js`
4. **Authentication > Providers > Email** → matikan "Confirm email"
   (supaya user baru bisa langsung login tanpa verifikasi email)
5. Upload seluruh isi folder ini ke repo GitHub → connect ke Vercel → Deploy
6. Di Vercel: **Settings > Deployment Protection** → pastikan **Vercel
   Authentication = Disabled**
7. Buka `login.html` → Daftar akun pertama, lalu jadikan admin lewat SQL:
   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = 'email-anda@contoh.com');
   ```

Kalau Supabase-nya sudah pernah dipakai sebelumnya dan setup sempat gagal
di tengah jalan (misal error "type already exists"), jalankan
`reset_welding.sql` dulu sebelum mengulang dari `schema_welding.sql`.

---

## Struktur data & alur form

### Line (6, flat — tanpa sub-stasiun)
E-02, E-03, E-04, E-05, E-06, E-07 — masing-masing 1 mesin = 1 line.

### Form Produksi
Part Number (dropdown murni, pilih dari list) → Qty → NG → Break, dsb.
Master Part Number & Std Cycle Time dikelola di tab **Master Data** tiap
line. (Combo box ketik-manual masih dipakai khusus di form Plan Harian
— `plan-produksi.html` — untuk pilih Part Number saat bikin rencana.)

### Form Downtime
Field wajib diisi (kecuali **Menit Tunggu** & **Ket**, boleh kosong):

| Field | Tipe | Sumber |
|---|---|---|
| Kategori | chip (klik) | MACHINE / MATERIAL / METHODE / MAN |
| PIC | chip (klik) | DIES / MESIN / PE / PROD / PC-SUPP / QC / PRESS |
| Menit Tunggu | angka manual | *(opsional)* |
| Ket | teks manual | *(opsional)* |
| Problem Kategori | dropdown, ke-filter otomatis sesuai PIC yang dipilih | tabel `downtime_problems` |
| Problem Detail | dropdown, ke-filter otomatis sesuai Problem Kategori yang dipilih | tabel `downtime_causes` |
| Area | dropdown | tabel `downtime_areas` |
| Countermeasure | teks manual | — |
| Status | chip (klik) | Temporary Action / Permanent Action |
| Total Losstime | otomatis (1 angka desimal) | dihitung dari jam mulai–selesai |

Problem Kategori, Problem Detail, dan Area **shared lintas semua 6 line**
(tidak per-line) — dikelola di tab Master Data mana saja, otomatis
kepakai di semua line.

### Non-Produksi (tab Dandori)
Jenis: Agenda Perusahaan, Meeting Awal, Meeting Akhir, 5S, Equipment, SPM,
Watari — dikelola per line di tabel `nonproduksi_types`.

### Repair (klik titik di model 3D part, bisa diputar)
Tab baru setelah NG Inline. Konsepnya: model 3D part (file `.stl`, bisa
diputar/zoom bebas pakai Three.js) ditandai titik-titik lokasi — klik
titik → popup isi **Part No** (dropdown, dari Part Number line
tersebut) + **Qty** + **Kategori Repair** → simpan.

- **1 model 3D = 1 part, dan setiap line kelola part 3D-nya sendiri**
  — kalau ada part yang sama dipakai di beberapa line, tinggal
  upload/tandai lagi part itu di line-line yang butuh (boleh pakai
  file `.stl` yang sama). Karena bisa diputar 360°, tidak perlu lagi
  pisah "Tampak Depan"/"Tampak Belakang" seperti versi foto 2D
  sebelumnya. Kalau ada part lain yang perlu di-tandai juga, tinggal
  tambah lewat tab **Master Data > Repair — Model 3D Part** (upload
  `.stl` baru).
- **Part pertama sudah diisi**: `25051-BZ040 / C15-01137`, file-nya ada
  statis di `assets/repair/25051-BZ040_C15-01137.stl` (ikut di paket
  ini). Belum ada titik Repair sama sekali di part ini — silakan
  ditandai sendiri lewat "Mode Edit Point".
- **Titik disimpan sebagai koordinat 3D (x, y, z)** di ruang koordinat
  asli file STL, bukan lagi persen posisi di foto — otomatis tetap
  nempel di permukaan model walau diputar/di-zoom.
- **Titik dikelola manual oleh admin/leader** — toggle "Mode Edit
  Point" di tab Repair, lalu klik langsung di permukaan model 3D buat
  nambah titik (klik titik yang sudah ada buat menghapusnya).
- **Kategori Repair** — master data kosong dulu (`repair_kategori`),
  diisi lewat tab Master Data > Repair — Kategori Repair.
- Model 3D dirender pakai [Three.js](https://threejs.org) yang dimuat
  lewat CDN saat tab Repair pertama kali dibuka (butuh koneksi internet
  pas pertama load; setelah itu browser biasanya sudah cache library-nya).

---

## Dashboard Exhaust (menu paling atas)
Ringkasan **per line** (bukan KPI gabungan seperti Dashboard biasa) —
6 kartu (E-02 s/d E-07), masing-masing menampilkan: status (OFF/POOR/
FAIR/GOOD berdasar OEE), part terakhir, Output, NG, Downtime, GSPH vs
Target, dan Performance. Filter tanggal + shift, klik kartu langsung ke
halaman detail line-nya.

## Plan Produksi (menu di bawah Dashboard)
Rencana produksi harian, 1 baris = 1 Part Number (bisa dipakai lintas
line). Alur kerja:

1. **Panel Plan Harian** — matrix Part Number × Line (E-02..E-07),
   kolom **Backlog** & **Plan Awal** (total plan hari itu), baris
   **TOTAL PLAN HARIAN** di bawah.
2. **Kapasitas Harian** — stacked bar chart, breakdown plan per Part
   Number di tiap line.
3. **Input / Edit Plan** (khusus admin/leader) — form tambah/ubah plan
   per (Part Number, Line, Shift), plus form Backlog terpisah (backlog
   melekat ke Part Number, tidak per line).
4. **Shift 1 / Shift 2** — tabel Plan vs Actual per line untuk tiap
   Part Number di shift tersebut, kolom **Balance** = Actual − Plan
   (hijau kalau tercapai/lebih, merah kalau kurang). **Actual** dihitung
   otomatis dari data Input Produksi yang sudah ada (RPC
   `plan_produksi_actual`), tidak perlu isi manual.

Setup: jalankan `migration_plan_produksi.sql` (butuh schema_welding.sql
sudah jalan lebih dulu, karena pakai type `machine_type` & tabel
`profiles`).

---

## Export Excel
Setiap halaman line (E-02...E-07) punya tombol **⬇ Export Excel** (pakai
library [SheetJS](https://sheetjs.com/) via CDN) di 4 tab, per bulan:
- Riwayat Produksi
- Downtime
- NG Inline
- Repair

File turun sebagai `.xlsx` (nama file: `<Jenis>_<Line>_<Bulan>.xlsx`).
Halaman **Data Mentah** juga punya export `.xlsx`. Dashboard Exhaust
belum punya tombol export (fungsi CSV lama yang tidak pernah punya tombol
sudah dihapus).

---

## Yang masih bisa dikembangkan
- **Data historis** (kalau ada data lama dari sistem sebelumnya) belum
  dipindah/disesuaikan ke skema Welding ini.
- **Export Excel di Plan Produksi** belum ada — `plan-produksi.html`
  belum punya tombol export (halaman per-line E-02..E-07 sudah punya,
  lihat bagian "Export Excel" di atas).
- **Offline untuk NG Inline & Repair** belum ada (lihat catatan offline
  di bagian atas).
- **File SQL belum lengkap**: tabel `attendance_leave`,
  `attendance_shift_weekly`, `hari_libur`, `karyawan_master` dan beberapa
  RPC dashboard (`dashboard_harian_*`, `dashboard_qc_repair_*`,
  `dashboard_qc_produksi_*`, `dashboard_tahunan_*`) dipakai aplikasi
  tetapi definisinya tidak ada di folder ini (dibuat langsung di
  Supabase). Setup dari nol belum bisa hanya pakai file di sini.

> Catatan: dua poin lama di sini (Part Number combo box & Export Excel)
> sudah selesai dikerjakan, sudah dihapus dari daftar per audit kode
> September 2026.

## Kalau ada bug/error
Screenshot **tab Console** di browser (`F12` → Console, atau Safari:
Develop > Show Web Inspector) — itu paling cepat untuk melacak
penyebabnya.

---

## Realtime (update otomatis antar tab/HP)
Halaman line (E-02...E-07) otomatis dapat perubahan data **secara live**
dari device/tab lain lewat Supabase Realtime — tanpa perlu reload.
Berlaku untuk: Input Produksi, Input Produksi NEW, Downtime,
Non-Produksi/Dandori, NG Inline, dan Repair (termasuk titik 3D-nya).

**Wajib jalankan sekali** `migration_enable_realtime.sql` di Supabase SQL
Editor supaya fitur ini aktif (kalau belum dijalankan, tabel-tabelnya
belum terdaftar untuk kirim event realtime — form tetap jalan normal
seperti biasa, cuma tidak ada auto-update-nya).

Cara cek: buka line yang sama di 2 tab/HP berbeda, simpan data (misal
NG Inline) di salah satunya — tab satunya harus otomatis muncul data
barunya dalam ±1 detik tanpa perlu di-refresh.

---

## Catatan perbaikan (audit kode, September 2026)

**Bug yang diperbaiki**
- `init()` dulu jalan 2x di semua halaman (atribut `x-init="init()"`
  dobel dengan pemanggilan otomatis Alpine) -- fetch data, interval, dan
  listener jadi dobel. Atribut `x-init="init()"` sudah dihapus.
  **Jangan ditambahkan lagi**: Alpine otomatis memanggil `init()`.
- `reset-password.html`: variabel `showPassword` belum dideklarasikan
  sehingga kolom password tampil sebagai teks biasa.
- Antrean offline (`assets/machine-page.js`): data baru yang masuk saat
  sinkron bisa hilang, 2 tab bisa sinkron item yang sama (data dobel),
  dan item yang ditolak server dicoba ulang selamanya. Sekarang: baca
  ulang antrean sebelum simpan, kunci lintas tab (Web Locks), produksi
  dikirim sebelum downtime, dan item yang ditolak 5x dipindah ke
  localStorage `offline_queue_failed_v2`.
- Tabel Shift 1/Shift 2 di Plan Produksi & Plan Harian (Dashboard
  Exhaust): kolom **Act** tidak pernah tampil karena `x-for` berisi 2
  elemen root.
- Field **Jumlah MP** (alur Input Produksi NEW) sekarang muncul kalau Std
  MP part belum diisi di Master Data (dulu selalu tersembunyi).
- Tanggal default Attendance & Plan Harian di Dashboard Exhaust dulu
  mundur 1 hari antara jam 00:00-07:00 WIB (pakai UTC).
- Render 3D di tab Repair sekarang berhenti saat pindah tab (hemat
  baterai HP).
- Loading model 3D Repair dipercepat: file model part aktif mulai
  diunduh di belakang layar setelah halaman line terbuka; library Three.js
  & file model diunduh bersamaan (dulu berurutan); file hasil upload
  disimpan permanen di HP (Cache Storage `repair-models-v1`, hanya di
  https) sehingga cukup diunduh sekali; loader .3mf hanya dimuat kalau ada
  part .3mf; overlay menampilkan tahap & persen unduhan; part yang sama
  tidak lagi bisa dimuat 2x bersamaan. Prefetch dilewati kalau mode hemat
  data browser aktif.
- Tombol **▶ Mulai Produksi** sekarang menunggu riwayat produksi/
  non-produksi selesai dimuat (di belakang layar) sebelum menghitung jeda,
  supaya deteksi jeda Non-Produksi tidak meleset kalau diklik terlalu
  cepat. Layar "Memuat data..." TIDAK ikut menunggu data ini (sempat
  dicoba, bikin loading awal lebih lama).
- Pesan notifikasi tidak lagi hilang lebih cepat dari 4 detik, link reset
  password tidak terkirim dobel, service worker tidak menyimpan halaman
  error, icon PWA sudah ukuran 192 & 512 yang benar.

**Keamanan** -- jalankan `patch_security_profiles_role.sql` di Supabase.
Masih terbuka (butuh keputusan): `email_for_nik` bisa dipanggil tanpa
login, pendaftaran akun terbuka untuk umum, dan semua user login bisa
tambah/ubah/hapus data produksi.

**File yang dihapus**: `assets/repair/view-1.png` & `view-2.png` (sisa
Repair 2D), `migration_cleanup_downtime_master_duplicates.sql` v1-v3
(cukup pakai `_v4`, standalone), `cek_definisi_rpc_dashboard_qc_ng.sql`,
`diagnostik_problem_kategori.sql`.

**Perlu dicek**: rumus Straightpass di form Input Produksi baru
(`1 - total_repair_menit / qty`), dan RPC `performance_aggregate` /
`plan_produksi_actual` versi di folder ini baru membaca `production_log`
(belum `production_log_new`). `performance_aggregate` didefinisikan di
beberapa file migration -- jalankan sesuai urutan supaya versi terbaru
tidak tertimpa.
