# Welding Exhaust — Sistem Input Produksi & Downtime

Aplikasi web (HTML + Alpine.js + Supabase) untuk mencatat data produksi dan
downtime **6 line Welding: E-02, E-03, E-04, E-05, E-06, E-07**. Bisa
diinstall di HP (PWA) dan tetap bisa dipakai tanpa sinyal (mode offline).

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
├── input-scrap.html                              # Scrap Top End bulanan (admin/leader)
├── input-safety.html                              # Catat insiden safety (admin/leader)
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
├── migration_repair_v1.sql                        # 7) Tab Repair (titik di gambar, versi lama)
├── migration_repair_v2.sql                        # 8) Rename label titik + seed Kategori Repair
├── migration_repair_v3_3d.sql                     # 9) Repair jadi 3D (.stl) -- jalankan setelah v1 & v2
├── migration_repair_v4_point_normals.sql          # 10) Arah normal Point (biar ketutup model saat diputar)
├── migration_repair_v5_part_number.sql            # 11) Tambah Part No (dropdown) di popup Repair, sebelum Qty
├── migration_repair_v6_per_line.sql               # 12) Part 3D Repair jadi per-line (dulu shared semua line)
├── migration_repair_v7_fix_delete.sql              # 13) Perbaiki hapus Part 3D yang sudah ada riwayat Repair-nya
├── migration_repair_v8_part_color.sql              # 14) Warna custom per Part 3D (file .stl tidak simpan warna)
├── migration_plan_produksi.sql                     # 15) Tabel Plan Harian (per part/line/shift) + Backlog + RPC actual
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
Part Number (dropdown, ketik atau pilih) → Qty → NG → Break, dsb. Master
Part Number & Std Cycle Time dikelola di tab **Master Data** tiap line.

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

## Yang masih bisa dikembangkan
- **Part Number** di form Input Produksi masih combo box (bisa ketik
  manual selain pilih dari list) — belum diubah jadi dropdown murni
  seperti Problem Kategori/Detail/Area.
- **Data historis** (kalau ada data lama dari sistem sebelumnya) belum
  dipindah/disesuaikan ke skema Welding ini.
- **Export ke Excel** belum dibangun.

## Kalau ada bug/error
Screenshot **tab Console** di browser (`F12` → Console, atau Safari:
Develop > Show Web Inspector) — itu paling cepat untuk melacak
penyebabnya.
