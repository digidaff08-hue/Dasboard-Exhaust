// =====================================================================
// Vercel Function: /api/pusher-notify
//
// Menerima SINYAL KECIL dari database Supabase (lewat trigger + pg_net,
// lihat migration_pusher_realtime.sql) lalu meneruskannya ke Pusher.
// Isi sinyal bukan data baris, hanya "tabel X berubah di line Y":
//   { "t": "downtime_log", "op": "UPDATE", "m": ["E-03"], "v": [] }
//
// Pusher menerima event "change" di channel:
//   t-<tabel>   (semua pendengar tabel itu, mis. Dashboard)
//   m-<mesin>   (pendengar satu line, mis. halaman line E-03)
//
// Tanpa dependensi (tidak perlu package.json): tanda tangan Pusher
// dihitung sendiri dengan modul crypto bawaan Node.
//
// ENVIRONMENT VARIABLES (Vercel > Project > Settings > Environment Variables):
//   PUSHER_APP_ID   PUSHER_KEY   PUSHER_SECRET   PUSHER_CLUSTER (mis. ap1)
//   NOTIFY_SECRET   kata sandi acak panjang; SAMA dengan kolom "secret" di
//                   tabel private.pusher_config (lihat migration SQL)
// =====================================================================
const crypto = require("crypto");

// Hanya tabel ini yang boleh memicu event (jaga-jaga kalau endpoint disalahgunakan).
const ALLOWED_TABLES = new Set([
  "production_log", "production_log_new", "downtime_log", "dandori_log",
  "ng_inline_log", "repair_log", "repair_views", "repair_points",
  "andon_call", "andon_setting",
  // tabel absensi/cuti (kalau nanti ikut Pusher, lihat REALTIME_TETAP_SUPABASE)
  "attendance_leave", "cuti_jatah", "hari_libur", "leave_requests",
]);
const OPS = new Set(["INSERT", "UPDATE", "DELETE"]);
const SAFE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_MESIN = 20;
const MAX_VIEW = 50;

function md5(s) { return crypto.createHash("md5").update(s, "utf8").digest("hex"); }
function hmac(secret, s) { return crypto.createHmac("sha256", secret).update(s, "utf8").digest("hex"); }

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

// Susun request ke Pusher REST API: POST /apps/{id}/events
// Dokumentasi tanda tangan: string_to_sign = "POST\n{path}\n{query diurut abjad}"
function buildPusherRequest({ appId, key, secret, cluster, body, timestamp }) {
  const path = `/apps/${appId}/events`;
  const bodyStr = JSON.stringify(body);
  const params = {
    auth_key: key,
    auth_timestamp: String(timestamp),
    auth_version: "1.0",
    body_md5: md5(bodyStr),
  };
  const query = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
  const signature = hmac(secret, `POST\n${path}\n${query}`);
  return {
    url: `https://api-${cluster}.pusher.com${path}?${query}&auth_signature=${signature}`,
    body: bodyStr,
  };
}

// Validasi & bentuk event dari sinyal. Balikan null kalau tidak valid.
function buildEvent(sig) {
  if (!sig || typeof sig !== "object") return null;
  const t = String(sig.t || "");
  const op = String(sig.op || "");
  if (!ALLOWED_TABLES.has(t) || !OPS.has(op)) return null;
  const m = (Array.isArray(sig.m) ? sig.m : []).map(String).filter((x) => SAFE.test(x)).slice(0, MAX_MESIN);
  const v = (Array.isArray(sig.v) ? sig.v : []).map(String).filter((x) => SAFE.test(x)).slice(0, MAX_VIEW);
  const channels = ["t-" + t].concat(m.map((x) => "m-" + x));
  return { name: "change", channels, data: JSON.stringify({ t, op, m, v }) };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });

  const notifySecret = process.env.NOTIFY_SECRET;
  if (!notifySecret || !safeEqual(req.headers["x-notify-secret"], notifySecret)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const { PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, PUSHER_CLUSTER } = process.env;
  if (!PUSHER_APP_ID || !PUSHER_KEY || !PUSHER_SECRET || !PUSHER_CLUSTER) {
    return res.status(500).json({ error: "pusher env belum lengkap" });
  }

  let sig = req.body;
  if (typeof sig === "string") { try { sig = JSON.parse(sig); } catch (e) { sig = null; } }
  const event = buildEvent(sig);
  if (!event) return res.status(400).json({ error: "sinyal tidak valid" });

  const reqInfo = buildPusherRequest({
    appId: PUSHER_APP_ID, key: PUSHER_KEY, secret: PUSHER_SECRET, cluster: PUSHER_CLUSTER,
    body: event, timestamp: Math.floor(Date.now() / 1000),
  });

  try {
    const r = await fetch(reqInfo.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: reqInfo.body,
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      console.error("Pusher menolak:", r.status, text.slice(0, 200));
      return res.status(502).json({ error: "pusher " + r.status });
    }
    return res.status(200).json({ ok: true, channels: event.channels.length });
  } catch (err) {
    console.error("Gagal menghubungi Pusher:", err);
    return res.status(502).json({ error: "gagal menghubungi pusher" });
  }
};

// Dibuka untuk pengujian (tidak dipakai Vercel).
module.exports._internal = { buildPusherRequest, buildEvent, md5, hmac };
