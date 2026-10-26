import { NextResponse } from "next/server";
import { findUserByEmail } from "@/lib/users";
import { sendSetupLink } from "@/lib/passwordSetup";
import { tooMany } from "@/lib/publicLimits";
import { overLimit } from "@/lib/assistant/limits";

export const dynamic = "force-dynamic";

/**
 * "First time here? Email me a link" — and the button on an expired link.
 * Always the same neutral answer, so it never reveals who has an account.
 */
export async function POST(req: Request) {
  const limited = tooMany(req, "set-password-link", { max: 5, minutes: 15 });
  if (limited) return limited;
  const body = (await req.json().catch(() => ({}))) as { email?: string };
  const email = String(body.email || "").trim().toLowerCase();
  const neutral = NextResponse.json({ ok: true, message: "If there's an account for that email, a link to set your password is on its way. Check your inbox (and spam) in a minute." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Please enter your email address." }, { status: 400 });
  // At most 3 links an hour to one address, whoever asks.
  if (overLimit(`setpw-link:${email}`, 3, 60 * 60_000)) return neutral;
  const user = await findUserByEmail(email);
  if (user && user.status === "approved") {
    const site = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || new URL(req.url).origin;
    const r = await sendSetupLink(user, site);
    if (!r.ok) console.error("[set-password link] not sent", r.error);
  }
  return neutral;
}
