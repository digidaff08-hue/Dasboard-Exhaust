// =====================================================================
// Supabase Edge Function: andon-push
// Mengirim notifikasi push ke HP tim supporting saat ada panggilan Andon.
//
// Dipanggil oleh:
//   1. Database Webhook (tabel andon_call, event INSERT)  -> kirim ke tim
//   2. Halaman Andon, tombol "Tes notifikasi" ({ test: true }) -> hanya
//      ke HP user yang menekan (butuh login)
//
// Secrets yang wajib diisi (Edge Functions > Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mis. mailto:admin@futaba.co.id)
// SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY sudah otomatis tersedia.
// =====================================================================
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Sub = { id: string; endpoint: string; p256dh: string; auth: string; user_id: string };

function jamWIB(iso?: string) {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
}

// deno-lint-ignore no-explicit-any
async function kirim(admin: any, subs: Sub[], payload: Record<string, unknown>) {
  let terkirim = 0, gagal = 0, dihapus = 0;
  const body = JSON.stringify(payload);
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
        { TTL: 600, urgency: "high" },     // high = dikirim segera walau HP hemat daya
      );
      terkirim++;
      await admin.from("push_subscriptions").update({ last_ok_at: new Date().toISOString() }).eq("id", s.id);
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      // 404/410 = langganan sudah tidak berlaku (aplikasi dihapus / izin dicabut)
      if (code === 404 || code === 410) {
        await admin.from("push_subscriptions").delete().eq("id", s.id);
        dihapus++;
      } else {
        gagal++;
        console.error("push gagal", code, (e as Error).message);
      }
    }
  }));
  return { terkirim, gagal, dihapus, total: subs.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return json({ error: "Secret VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY belum diisi." }, 500);
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { /* kosong */ }

  // ---- 2) Tes dari halaman Andon: kirim ke HP user itu sendiri ----
  if (body.test) {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = await admin.auth.getUser(token);
    if (!u?.user) return json({ error: "Harus login." }, 401);
    const { data: subs } = await admin.from("push_subscriptions")
      .select("id,endpoint,p256dh,auth,user_id").eq("user_id", u.user.id);
    const hasil = await kirim(admin, (subs ?? []) as Sub[], {
      title: "🔔 Tes notifikasi Andon",
      body: "Notifikasi HP ini sudah aktif. Panggilan Andon akan masuk seperti ini walau layar terkunci.",
      tag: "andon-tes", url: "/andon.html",
    });
    return json({ ok: true, ...hasil });
  }

  // ---- 1) Database Webhook: panggilan baru ----
  // ---- 3) Pengulangan / eskalasi (webhook tabel andon_ping, diisi pg_cron) ----
  if (body.type === "INSERT" && body.table === "andon_ping" && body.record) {
    const ping = body.record;
    const { data: c } = await admin.from("andon_call").select("*").eq("id", ping.call_id).maybeSingle();
    if (!c || c.status !== "memanggil") return json({ ok: true, lewati: "sudah diterima / selesai" });
    const menit = Math.max(1, Math.round((Date.now() - new Date(c.dipanggil_at).getTime()) / 60000));
    if (ping.jenis === "eskalasi") {
      const { data: subs, error } = await admin.rpc("andon_push_eskalasi");
      if (error) return json({ error: error.message }, 500);
      const hasil = await kirim(admin, (subs ?? []) as Sub[], {
        title: `⚠️ ESKALASI · ${c.mesin} belum direspons ${menit} menit`,
        body: `Panggilan ${c.tim}${c.keterangan ? " · " + c.keterangan : ""}\ndipanggil ${c.dipanggil_nama ?? "-"} · ${jamWIB(c.dipanggil_at)}`,
        tag: `andon-esk-${c.id}`, url: "/andon.html", id: c.id,
      });
      return json({ ok: true, eskalasi: true, ...hasil });
    }
    const { data: subs, error } = await admin.rpc("andon_push_tujuan", { p_tim: c.tim });
    if (error) return json({ error: error.message }, 500);
    const hasil = await kirim(admin, (subs ?? []) as Sub[], {
      title: `🔁 MASIH MENUNGGU · ${c.mesin} memanggil ${c.tim}`,
      body: `Sudah ${menit} menit belum ada yang menerima.${c.keterangan ? "\n" + c.keterangan : ""}`,
      tag: `andon-${c.id}`,          // tag sama -> menggantikan notifikasi lama & berbunyi lagi
      url: "/andon.html", id: c.id,
    });
    return json({ ok: true, ulang: ping.ke, ...hasil });
  }

  const rec = body.record;
  if (body.type !== "INSERT" || body.table !== "andon_call" || !rec) return json({ ok: true, lewati: true });
  if (rec.status !== "memanggil") return json({ ok: true, lewati: true });

  const { data: subs, error } = await admin.rpc("andon_push_tujuan", { p_tim: rec.tim });
  if (error) return json({ error: error.message }, 500);

  const hasil = await kirim(admin, (subs ?? []) as Sub[], {
    title: `📞 ${rec.mesin} memanggil ${rec.tim}`,
    body: `${rec.keterangan ? rec.keterangan + "\n" : ""}oleh ${rec.dipanggil_nama ?? "-"} · ${jamWIB(rec.dipanggil_at)}`,
    tag: `andon-${rec.id}`,
    url: "/andon.html",
    id: rec.id,
  });
  return json({ ok: true, ...hasil });
});
