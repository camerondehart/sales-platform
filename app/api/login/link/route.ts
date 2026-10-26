import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, signAdminToken } from "@/lib/auth";
import { isEnabled } from "@/lib/flags";
import { findAdmin } from "@/lib/admins";
import { issue, useAdminLink } from "@/lib/loginCodes";
import { sendAdminLink } from "@/lib/authEmails";
import { auditSystem } from "@/lib/audit";
import { checkRateLimit, recordFailedAttempt } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Staff sign-in by emailed link. The shared admin password keeps working.
 *   { action: "send", email }   → always { ok: true } (never reveals who's staff)
 *   { action: "verify", token } → signs in as that staff member
 * The link opens /admin/link#<token>; the token sits after "#" so it never
 * reaches server logs, and the page only uses it when the person taps
 * "Sign in" (email scanners that open links can't use it up).
 */
export async function POST(req: Request) {
  if (!(await isEnabled("admin_magic_link"))) return NextResponse.json({ error: "off" }, { status: 404 });
  let body: { action?: string; email?: string; token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const h = req.headers;
  const ip = (h.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const meta = { ip, userAgent: (h.get("user-agent") || "").slice(0, 200) || undefined };

  if (body.action === "send") {
    const email = String(body.email || "").trim().toLowerCase().slice(0, 200);
    const admin = await findAdmin(email);
    if (admin) {
      const r = await issue("admin", admin.email, ip);
      if (!r.ok) return NextResponse.json({ error: "Too many links requested — please wait a few minutes." }, { status: 429 });
      const site = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || new URL(req.url).origin;
      await sendAdminLink(admin.email, admin.name, `${site}/admin/link#${r.secret}`);
    } else {
      await new Promise((r) => setTimeout(r, 300 + Math.random() * 300));
    }
    return NextResponse.json({ ok: true });
  }

  if (body.action === "verify") {
    if (checkRateLimit("admin-link", ip).blocked) {
      await new Promise((r) => setTimeout(r, 600));
      return NextResponse.json({ error: "invalid" }, { status: 401 });
    }
    const email = await useAdminLink(String(body.token || ""));
    const admin = email ? await findAdmin(email) : null;
    if (!admin) {
      recordFailedAttempt("admin-link", ip);
      await new Promise((r) => setTimeout(r, 600));
      return NextResponse.json({ error: "invalid" }, { status: 401 });
    }
    cookies().set(ADMIN_COOKIE, await signAdminToken(admin.email), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
    await auditSystem({ action: "admin.signin", actor: admin.email, actorType: "admin", source: "human", targetType: "admin", targetId: admin.email, ok: true, note: "Signed in with an emailed link", ...meta });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Bad request." }, { status: 400 });
}
