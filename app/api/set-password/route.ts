import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { signVisitorToken, VISITOR_COOKIE } from "@/lib/auth";
import { checkSetupToken } from "@/lib/passwordSetup";
import { setUserPassword } from "@/lib/users";
import { tooMany } from "@/lib/publicLimits";
import { auditSystem } from "@/lib/audit";
import { clientIp } from "@/lib/assistant/limits";

export const dynamic = "force-dynamic";

/** The /welcome page's form: choose a password with a set-password link, then you're signed in. */
export async function POST(req: Request) {
  const limited = tooMany(req, "set-password", { max: 10, minutes: 15 });
  if (limited) return limited;
  const body = (await req.json().catch(() => ({}))) as { t?: string; password?: string };
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 8) return NextResponse.json({ error: "Please use at least 8 characters." }, { status: 400 });
  if (password.length > 200) return NextResponse.json({ error: "That password is too long." }, { status: 400 });
  const check = await checkSetupToken(String(body.t || ""));
  if (!check.ok) {
    const msg = {
      expired: "This link has expired.",
      used: "This link has already been used (or your password was changed since).",
      invalid: "This link isn't valid.",
    }[check.reason];
    return NextResponse.json({ error: msg, reason: check.reason }, { status: 400 });
  }
  const r = await setUserPassword(check.user.id, password);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 });
  cookies().set(VISITOR_COOKIE, await signVisitorToken(check.user.id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  await auditSystem({
    action: "member.set_password",
    actor: check.user.email,
    actorType: "member",
    targetType: "member",
    targetId: check.user.id,
    ok: true,
    note: "Chose a password with their set-password link",
    ip: clientIp(req),
  }).catch(() => {});
  return NextResponse.json({ ok: true, name: check.user.name });
}
