import { NextResponse } from "next/server";
import { addSubscriberDetailed } from "@/lib/subscribers";
import { sendSubscriberWelcome } from "@/lib/subscriberWelcomeEmail";
import { offerForEvent } from "@/lib/eventOffers";

// Public mailing-list sign-up — the endpoint behind the /join page and the
// QR code used at events. Adds the person to the subscriber list ONLY; it
// never creates a member account.

// Soft per-IP limit with its own generous window. The login limiter (12 per
// 15 min) would be wrong here: an iPad on a booth table shares one IP across
// everyone who signs up on it.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 80;
const hits = new Map<string, { count: number; start: number }>();

function tooMany(ip: string): boolean {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now - rec.start > WINDOW_MS) {
    hits.set(ip, { count: 1, start: now });
    return false;
  }
  rec.count++;
  return rec.count > MAX_PER_WINDOW;
}

export async function POST(req: Request) {
  let body: { name?: string; email?: string; event?: string; website?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  // Honeypot: real people never see this field, bots fill everything in.
  if (body.website) return NextResponse.json({ ok: true });

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  if (tooMany(ip)) {
    return NextResponse.json({ error: "Too many sign-ups right now — try again in a few minutes." }, { status: 429 });
  }

  const email = (body.email || "").trim().toLowerCase();
  const name = (body.name || "").trim().slice(0, 80);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: "Please tell us your name." }, { status: 400 });
  }

  try {
    const result = await addSubscriberDetailed(email, name, "event", body.event);
    if (!result) return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });

    // Welcome email with a gentle nudge toward the shop and the members area.
    // Only for people who are new (or coming back after unsubscribing) —
    // someone already on the list who scans again shouldn't get a second one.
    // Awaited so Vercel doesn't cut the function off before it goes; a
    // failure is logged but never turns the sign-up into an error.
    if (result.isNew) {
      const siteUrl =
        process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || new URL(req.url).origin;
      await sendSubscriberWelcome({
        email: result.sub.email,
        name: result.sub.name,
        event: result.sub.event,
        unsubscribeToken: result.sub.unsubscribeToken,
        siteUrl,
        // The event's welcome code, if staff set one (Marketing → Event sign-up QR code).
        offer: await offerForEvent(body.event),
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Event subscribe failed", err);
    return NextResponse.json({ error: "Something went wrong — please try again." }, { status: 500 });
  }
}
