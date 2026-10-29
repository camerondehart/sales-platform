import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { recordCounter } from "@/lib/traffic";
import { mutateSubscribers } from "@/lib/subscribers";
import { ingest } from "@/lib/venmoInbox";

export const dynamic = "force-dynamic";

/**
 * Resend webhook → campaign opens, clicks, bounces and spam complaints.
 *
 * Set up once in Resend (Webhooks → Add endpoint):
 *   URL:    https://<your-domain>/api/webhooks/resend
 *   Events: email.opened, email.clicked, email.bounced, email.complained
 * then copy its "Signing secret" into Vercel as RESEND_WEBHOOK_SECRET.
 *
 * Every request is verified with that secret (Resend signs with Svix);
 * anything unsigned or stale is rejected. A spam complaint automatically
 * unsubscribes that address.
 *
 * Also email.received (Resend receiving): forwarded Venmo emails and Gmail's
 * forwarding confirmation go to the Venmo inbox (lib/venmoInbox.ts). The
 * webhook only carries metadata, so the raw message is fetched from Resend.
 */

const RESEND_API = (process.env.RESEND_BASE_URL || "https://api.resend.com").replace(/\/$/, "");

async function fetchRaw(emailId: string): Promise<string> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY missing");
  const r = await fetch(`${RESEND_API}/emails/receiving/${encodeURIComponent(emailId)}`, { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" });
  if (!r.ok) throw new Error(`Resend said ${r.status} for the received email`);
  const d = (await r.json()) as { raw?: { download_url?: string } };
  const url = d.raw?.download_url;
  if (!url) throw new Error("Resend sent no raw message link");
  const m = await fetch(url, { cache: "no-store" });
  if (!m.ok) throw new Error(`Raw message download failed (${m.status})`);
  return m.text();
}

function verify(secret: string, id: string, ts: string, body: string, header: string): boolean {
  const t = Number(ts);
  if (!id || !Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > 5 * 60) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest();
  return header.split(" ").some((part) => {
    const [ver, sig] = part.split(",");
    if (ver !== "v1" || !sig) return false;
    const got = Buffer.from(sig, "base64");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

function campaignOf(tags: unknown): string {
  if (Array.isArray(tags)) {
    const t = tags.find((x) => x && (x as { name?: string }).name === "campaign") as { value?: string } | undefined;
    return String(t?.value || "").replace(/[^\w-]/g, "").slice(0, 40);
  }
  if (tags && typeof tags === "object") return String((tags as Record<string, unknown>).campaign || "").replace(/[^\w-]/g, "").slice(0, 40);
  return "";
}

export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook not configured (RESEND_WEBHOOK_SECRET)." }, { status: 503 });
  const body = await req.text();
  const ok = verify(secret, req.headers.get("svix-id") || "", req.headers.get("svix-timestamp") || "", body, req.headers.get("svix-signature") || "");
  if (!ok) return NextResponse.json({ error: "Bad signature." }, { status: 401 });

  let evt: { type?: string; data?: { tags?: unknown; to?: string[] | string } };
  try {
    evt = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Bad JSON." }, { status: 400 });
  }
  if (evt.type === "email.received") {
    const emailId = String((evt.data as { email_id?: string; id?: string })?.email_id || (evt.data as { id?: string })?.id || "");
    if (!emailId) return NextResponse.json({ error: "No email id." }, { status: 400 });
    try {
      const r = await ingest(await fetchRaw(emailId));
      return NextResponse.json({ ok: true, ...r });
    } catch (err) {
      // 500 so Resend retries; ingest is idempotent.
      console.error("[webhook] inbound email failed", err);
      return NextResponse.json({ error: "Couldn't take that email right now." }, { status: 500 });
    }
  }
  const campaign = campaignOf(evt.data?.tags);
  switch (evt.type) {
    case "email.opened":
      recordCounter("e:email_open");
      if (campaign) recordCounter(`eo:${campaign}`);
      break;
    case "email.clicked":
      recordCounter("e:email_click");
      if (campaign) recordCounter(`ec:${campaign}`);
      break;
    case "email.bounced":
      recordCounter("e:email_bounce");
      if (campaign) recordCounter(`eb:${campaign}`);
      break;
    case "email.complained": {
      recordCounter("e:email_complaint");
      const to = (Array.isArray(evt.data?.to) ? evt.data?.to : [evt.data?.to]).filter(Boolean).map((e) => String(e).toLowerCase());
      if (to.length) {
        await mutateSubscribers((all) => {
          let changed = false;
          for (const s of all) {
            if (to.includes(s.email.toLowerCase()) && !s.unsubscribedAt) {
              s.unsubscribedAt = Date.now();
              changed = true;
            }
          }
          return { subs: changed ? all : null, result: undefined };
        });
      }
      break;
    }
  }
  return NextResponse.json({ ok: true });
}
