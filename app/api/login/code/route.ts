import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { signVisitorToken, VISITOR_COOKIE } from "@/lib/auth";
import { isEnabled } from "@/lib/flags";
import { findUserByEmail } from "@/lib/users";
import { issue, useMemberCode } from "@/lib/loginCodes";
import { sendMemberCode } from "@/lib/authEmails";
import { checkRateLimit, recordFailedAttempt } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Member sign-in with an emailed code (alternative to the password).
 *   { action: "send", email }          → always { ok: true } (never reveals who's a member)
 *   { action: "verify", email, code }  → signs in, same as the password route
 *
 * Members only. Staff who type their email on the member sign-in get the
 * same emailed dashboard link as /admin (the form calls /api/login/link), so
 * a code never signs anyone in to the dashboard.
 */
export async function POST(req: Request) {
  if (!(await isEnabled("email_code_login"))) return NextResponse.json({ error: "off" }, { status: 404 });
  let body: { action?: string; email?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const email = String(body.email || "").trim().toLowerCase().slice(0, 200);
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  if (!email.includes("@")) return NextResponse.json({ error: "Enter your email address." }, { status: 400 });

  if (body.action === "send") {
    const user = await findUserByEmail(email);
    if (user && user.status === "approved") {
      const r = await issue("member", email, ip);
      if (r.ok) await sendMemberCode(user.email, user.name, r.secret);
      else return NextResponse.json({ error: "Too many codes requested — please wait a few minutes." }, { status: 429 });
    } else {
      await new Promise((r) => setTimeout(r, 300 + Math.random() * 300)); // same timing either way
    }
    return NextResponse.json({ ok: true });
  }

  if (body.action === "verify") {
    if (checkRateLimit(email, ip).blocked) {
      await new Promise((r) => setTimeout(r, 600));
      return NextResponse.json({ error: "invalid" }, { status: 401 });
    }
    const ok = await useMemberCode(email, String(body.code || ""));
    const user = ok ? await findUserByEmail(email) : undefined;
    if (!user || user.status !== "approved") {
      recordFailedAttempt(email, ip);
      await new Promise((r) => setTimeout(r, 600));
      return NextResponse.json({ error: "invalid" }, { status: 401 });
    }
    cookies().set(VISITOR_COOKIE, await signVisitorToken(user.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return NextResponse.json({ ok: true, name: user.name });
  }
  return NextResponse.json({ error: "Bad request." }, { status: 400 });
}
