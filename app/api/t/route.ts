import { isBot, recordEvent } from "@/lib/traffic";
import { clientIp, overLimit } from "@/lib/assistant/limits";
import { isEnabled } from "@/lib/flags";

export const dynamic = "force-dynamic";

/**
 * Cookie-free event counter endpoint (see lib/track.ts / lib/traffic.ts).
 * Always answers 204 quickly; bad, bot and over-limit events are just dropped.
 */
export async function POST(req: Request) {
  try {
    const ua = req.headers.get("user-agent") || "";
    if (isBot(ua) || !(await isEnabled("analytics_v2"))) return new Response(null, { status: 204 });
    // Generous per-IP cap so a script can't skew the numbers. The IP is only
    // used for this in-memory limit and is never stored.
    if (overLimit(`t:${clientIp(req)}`, 240, 60_000)) return new Response(null, { status: 204 });
    const text = await req.text();
    if (text.length > 2000) return new Response(null, { status: 204 });
    const body = JSON.parse(text) as { e?: unknown; p?: unknown };
    const props = body.p && typeof body.p === "object" ? (body.p as Record<string, unknown>) : {};
    recordEvent(String(body.e || ""), props, { country: req.headers.get("x-vercel-ip-country") || undefined });
  } catch {
    /* ignore malformed */
  }
  return new Response(null, { status: 204 });
}
