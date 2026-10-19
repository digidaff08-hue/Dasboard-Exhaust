# Pusher siap pakai (cadangan untuk Supabase Realtime)

Status sekarang: **terpasang tapi tidak aktif**. Aplikasi tetap memakai Supabase
Realtime seperti biasa. Kapan pun mau, kamu bisa beralih ke Pusher dengan
mengubah satu baris, dan kembali dengan satu baris juga.

## Cara kerjanya

```
Data berubah (aplikasi / sinkron Google Sheets)
        │
        ▼
Trigger di database (per PERNYATAAN, bukan per baris)      migration_pusher_realtime.sql
        │  pg_net: sinyal kecil {tabel, operasi, line}
        ▼
Vercel Function  /api/pusher-notify                        api/pusher-notify.js
        │  menandatangani & meneruskan
        ▼
Pusher  ──►  layar yang membuka line / dashboard itu      assets/realtime.js
        │
        ▼
Layar mengambil ulang data lewat API (seperti sekarang)
```

Pesan ke Pusher **hanya sinyal** ("downtime_log berubah di E-03"), bukan isi
baris. Ukurannya sekitar 100 byte dan tidak membawa data produksi.

Karena trigger berjalan per pernyataan, satu kiriman 200 baris dari Apps
Script hanya menghasilkan **1 sinyal**. UPDATE yang dibatalkan oleh
`zz_skip_unchanged_update` tidak menghasilkan sinyal sama sekali.

Channel Pusher:
- `m-E-03` = semua tabel untuk line E-03 (halaman line, Andon per line)
- `t-production_log` dst. = satu tabel untuk semua line (Dashboard, papan Andon)

## Yang sudah dikerjakan di kode

| Berkas | Isi |
|---|---|
| `assets/realtime.js` (baru) | `RealtimeHub`: satu pintu untuk Supabase atau Pusher + saklar |
| `assets/machine-page.js`, `assets/dashboard-exhaust.js`, `assets/andon.js` | langganan realtime dialihkan lewat `RealtimeHub` (isi handler tidak berubah) |
| `dashboard-exhaust.html`, `andon.html`, `tools/machine-template.html`, `machines/e-0x.html` | memuat `realtime.js` |
| `service-worker.js` | `realtime.js` masuk daftar cache, versi cache dinaikkan ke v91 |
| `api/pusher-notify.js` (baru) | penerima sinyal dari database, meneruskan ke Pusher (tanpa dependensi) |
| `migration_pusher_realtime.sql` (baru) | trigger sinyal, **mati** sampai kamu menyalakannya |
| `migration_pusher_cutover.sql` (baru) | beralih dan kembali (lepas / pasang tabel dari Supabase Realtime) |

Absensi dan cuti (`rt_attendance`, `rt_master_cuti`) **sengaja tetap Supabase
Realtime**, karena dipakai banyak karyawan sekaligus (paket gratis Pusher
dibatasi sekitar 100 koneksi bersamaan) dan jarang berubah. Daftarnya ada di
`REALTIME_TETAP_SUPABASE` di `assets/realtime.js`.

---

## Persiapan (aman dilakukan kapan saja, tidak mengubah perilaku aplikasi)

### 1. Buat aplikasi Pusher
1. Daftar di pusher.com, pilih **Channels**, buat app baru.
2. Pilih cluster **ap1 (Singapore)**. Cluster ini harus sama di semua tempat di bawah.
3. Catat empat nilai dari tab **App Keys**: `app_id`, `key`, `secret`, `cluster`.
4. Tidak perlu mengaktifkan "client events" atau "authorized connections".

### 2. Isi environment variable di Vercel
Vercel > Project > Settings > Environment Variables (Production), lalu **Redeploy**:

| Nama | Isi |
|---|---|
| `PUSHER_APP_ID` | app_id dari Pusher |
| `PUSHER_KEY` | key dari Pusher |
| `PUSHER_SECRET` | secret dari Pusher (rahasia, jangan taruh di kode) |
| `PUSHER_CLUSTER` | `ap1` |
| `NOTIFY_SECRET` | kata sandi acak panjang buatanmu sendiri, mis. hasil `openssl rand -hex 32` |

### 3. Upload versi baru aplikasi
Upload isi folder ini ke Vercel seperti biasa (folder `api/` ikut). Pengaturan
masih `REALTIME_PROVIDER = "supabase"`, jadi belum ada yang berubah untuk pengguna.

Cek fungsi Vercel hidup (ganti alamat dan rahasia):

```bash
curl -X POST https://NAMA-SITUS.vercel.app/api/pusher-notify \
  -H "Content-Type: application/json" \
  -H "x-notify-secret: ISI_NOTIFY_SECRET" \
  -d '{"t":"downtime_log","op":"UPDATE","m":["E-03"],"v":[]}'
```
Hasil yang benar: `{"ok":true,"channels":2}`. Di dashboard Pusher > **Debug Console**
akan muncul event `change` di channel `t-downtime_log` dan `m-E-03`.
`401` berarti `NOTIFY_SECRET` salah, `500` berarti ada env Pusher yang belum diisi,
`502` berarti Pusher menolak (cek app_id/key/secret/cluster).

### 4. Pasang trigger di database
Supabase SQL Editor: jalankan `migration_pusher_realtime.sql` (sekali, aman diulang).
Ini membuat trigger tetapi **belum aktif**.

Prasyarat: jalankan juga `migration_hemat_realtime_sheet_sync.sql` lebih dulu
kalau belum, supaya update yang isinya sama tidak menghasilkan sinyal.

### 5. Nyalakan pengiriman sinyal
```sql
update private.pusher_config
   set url     = 'https://NAMA-SITUS.vercel.app/api/pusher-notify',
       secret  = 'ISI-SAMA-DENGAN-NOTIFY_SECRET',
       enabled = true
 where id = 1;
```
Mulai sekarang tiap perubahan data mengirim sinyal ke Pusher. Layar yang masih
memakai Supabase tidak terpengaruh. Mematikan kembali kapan saja:
`update private.pusher_config set enabled = false where id = 1;`

Cek pengiriman dari database:
```sql
select id, status_code, error_msg, created
  from net._http_response order by created desc limit 20;
```
`status_code` 200 berarti sampai ke Vercel.

### 6. Isi kunci Pusher di aplikasi
Buka `assets/realtime.js`, isi:
```js
const PUSHER_KEY = "KEY-DARI-PUSHER";   // key, BUKAN secret
const PUSHER_CLUSTER = "ap1";
```
Upload. Key ini publik (aman ada di frontend), berbeda dengan secret.

---

## Uji coba di satu perangkat (tanpa mengganggu yang lain)

Buka halaman apa pun dengan `?rt=pusher` di akhir alamat, mis.
`https://NAMA-SITUS.vercel.app/machines/e-03.html?rt=pusher`.
Pilihan itu tersimpan di browser perangkat itu saja.

1. Di perangkat A buka halaman line E-03 dengan `?rt=pusher`.
2. Di perangkat B (tanpa `?rt`) simpan data di line E-03.
3. Perangkat A harus ter-update sendiri dalam beberapa detik.
4. Di Pusher Debug Console terlihat event dan jumlah koneksi.

Kembali ke normal di perangkat itu: `?rt=supabase` atau `?rt=reset`.

Yang sebaiknya dicoba: halaman line, Dashboard (tab yang dibuka berpindah-pindah),
Andon (panggil dari satu HP, lihat papan Andon), simpan data lewat sinkron Sheets.

---

## Beralih penuh ke Pusher

1. Di `assets/realtime.js` ubah `const REALTIME_PROVIDER = "pusher";` lalu upload.
   Perangkat memuat versi baru lewat service worker (versi cache sudah dinaikkan).
2. Tunggu sampai perangkat lapangan sudah membuka ulang aplikasi. Perangkat yang
   masih memakai versi lama tetap mendengarkan Supabase.
3. Setelah semua beralih, jalankan **Blok A** di `migration_pusher_cutover.sql`.
   Ini melepas tabel dari Supabase Realtime sehingga egress Realtime-nya berhenti.

## Kembali ke Supabase Realtime

1. Jalankan **Blok B** di `migration_pusher_cutover.sql` (pasang tabel kembali).
2. Ubah `REALTIME_PROVIDER` di `assets/realtime.js` ke `"supabase"` lalu upload.
3. Opsional: `update private.pusher_config set enabled = false where id = 1;`

Kalau `PUSHER_KEY` kosong atau pustaka Pusher gagal dimuat, aplikasi otomatis
memakai Supabase, jadi salah konfigurasi tidak mematikan fitur realtime.

---

## Hal yang perlu diketahui

- **Batas paket gratis Pusher** (sekitar 200 ribu pesan per hari dan 100 koneksi
  bersamaan; cek halaman harga Pusher). Pusher menghitung pesan per koneksi
  penerima, jadi satu sinyal untuk 7 layar tetap dihitung 7. Perbaikan sinkron
  Sheets (hanya kirim baris yang berubah) tetap wajib agar jumlah sinyal kecil.
- **Koneksi**: tiap tab/perangkat yang terbuka = 1 koneksi. Dashboard memutus koneksi
  saat tab disembunyikan, dan `RealtimeHub` memutus koneksi Pusher kalau tidak ada
  yang didengarkan.
- **Channel publik**: siapa pun yang tahu key Pusher dan nama channel bisa
  *mendengar* sinyal (hanya "tabel X berubah di line Y", tanpa data). Mereka tidak
  bisa mengirim, karena itu butuh secret. Kalau ini dianggap sensitif, langkah
  berikutnya adalah channel privat dengan endpoint otorisasi.
- **Event yang terlewat saat koneksi putus** tidak dikirim ulang oleh Pusher. Karena
  itu, setelah koneksi pulih, `RealtimeHub` otomatis meminta semua halaman
  mengambil data sekali lagi.
- **Andon** tetap punya polling cadangan 30 detik (tidak diubah).
- Jalur sinyal ini tergantung Supabase aktif. Kalau project dibatasi, tidak ada
  perubahan data dan tidak ada sinyal.
- Yang sudah diuji di sini: tanda tangan Pusher dibandingkan dengan library resmi
  `pusher`, trigger dan agregasi di Postgres 16 (pg_net diganti tiruan), serta
  adaptor dan kode langganan asli dengan Supabase/Pusher tiruan. **Belum** diuji
  dengan akun Pusher, Vercel, dan Supabase yang sebenarnya.
