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
titik → popup isi **Qty** + **Kategori Repair** → simpan.

- **1 model 3D = 1 part** — karena bisa diputar 360°, tidak perlu lagi
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
