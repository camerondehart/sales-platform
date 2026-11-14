import { NextResponse } from "next/server";
import { isEnabled } from "@/lib/flags";
import { canSignIn, findLogin, setLoginPassword, verifyRetailPassword } from "@/lib/retail";
import { checkStoreSetupToken, endStoreSession, sendStoreCode, sendStoreSetupLink, startStoreSession } from "@/lib/retailAuth";
import { issue, useStoreCode } from "@/lib/loginCodes";
import { checkRateLimit, recordFailedAttempt } from "@/lib/rateLimit";
import { tooMany } from "@/lib/publicLimits";
import { overLimit, clientIp } from "@/lib/assistant/limits";
import { auditSystem } from "@/lib/audit";
import { portalOn, siteUrlOf } from "@/lib/retailPortal";

export const dynamic = "force-dynamic";

/**
 * Store portal sign-in (switch retail_portal). One route, by action:
 *   { action: "password", email, password }  → signs in
 *   { action: "send-code", email }           → emails a 6-digit code (always { ok: true })
 *   { action: "verify-code", email, code }   → signs in
 *   { action: "link", email }                → emails a set-password link (always the same answer)
 *   { action: "set-password", t, password }  → chooses a password with that link, signs in
 *   { action: "logout" }
 * Answers never reveal whether an email has a store login.
 */
export async function POST(req: Request) {
  if (!(await portalOn())) return NextResponse.json({ error: "The store portal is closed right now." }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; email?: string; password?: string; code?: string; t?: string };
  const ip = clientIp(req);
  const email = String(body.email || "").trim().toLowerCase().slice(0, 200);
  const wait = () => new Promise((r) => setTimeout(r, 500 + Math.random() * 200));

  if (body.action === "logout") {
    endStoreSession();
    return NextResponse.json({ ok: true });
  }

  if (body.action === "password") {
    const key = `store:${email || "none"}`;
    if (checkRateLimit(key, ip).blocked) {
      await wait();
      return NextResponse.json({ error: "Too many tries. Please wait 15 minutes, or sign in with an emailed code." }, { status: 429 });
    }
    const hit = email ? await verifyRetailPassword(email, String(body.password || "")) : null;
    if (!hit || !canSignIn(hit)) {
      recordFailedAttempt(key, ip);
      await wait();
      return NextResponse.json({ error: "That email and password don't match a store login." }, { status: 401 });
    }
    await startStoreSession(hit.login, hit.account);
    return NextResponse.json({ ok: true, name: hit.login.name });
  }

  if (body.action === "send-code") {
    if (!(await isEnabled("email_code_login"))) return NextResponse.json({ error: "Emailed codes are switched off. Use your password." }, { status: 404 });
    if (!email.includes("@")) return NextResponse.json({ error: "Enter your email address." }, { status: 400 });
    const hit = await findLogin(email);
    if (canSignIn(hit)) {
      const r = await issue("store", email, ip);
      if (!r.ok) return NextResponse.json({ error: "Too many codes requested. Please wait a few minutes." }, { status: 429 });
      await sendStoreCode(hit!.login.email, hit!.login.name, r.secret);
    } else {
      await new Promise((r) => setTimeout(r, 300 + Math.random() * 300));
    }
    return NextResponse.json({ ok: true });
  }

  if (body.action === "verify-code") {
    const key = `store:${email || "none"}`;
    if (checkRateLimit(key, ip).blocked) {
      await wait();
      return NextResponse.json({ error: "That code didn't work." }, { status: 401 });
    }
    const ok = email ? await useStoreCode(email, String(body.code || "")) : null;
    const hit = ok ? await findLogin(email) : null;
    if (!canSignIn(hit)) {
      recordFailedAttempt(key, ip);
      await wait();
      return NextResponse.json({ error: "That code didn't work. Check it, or ask for a new one." }, { status: 401 });
    }
    await startStoreSession(hit!.login, hit!.account);
    return NextResponse.json({ ok: true, name: hit!.login.name });
  }

  if (body.action === "link") {
    const limited = tooMany(req, "store-setpw-link", { max: 5, minutes: 15 });
    if (limited) return limited;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Please enter your email address." }, { status: 400 });
    const neutral = NextResponse.json({ ok: true, message: "If that email has a store login, a link to set your password is on its way. Check your inbox (and spam) in a minute." });
    if (overLimit(`store-setpw:${email}`, 3, 60 * 60_000)) return neutral;
    const hit = await findLogin(email);
    if (canSignIn(hit)) {
      const r = await sendStoreSetupLink(hit!.account, hit!.login, siteUrlOf(req));
      if (!r.ok) console.error("[store portal] link not sent", r.error);
    }
    return neutral;
  }

  if (body.action === "set-password") {
    const limited = tooMany(req, "store-set-password", { max: 10, minutes: 15 });
    if (limited) return limited;
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < 8) return NextResponse.json({ error: "Please use at least 8 characters." }, { status: 400 });
    const check = await checkStoreSetupToken(String(body.t || ""));
    if (!check.ok) {
      const msg = { expired: "This link has expired.", used: "This link has already been used (or the password was changed since).", invalid: "This link isn't valid." }[check.reason];
      return NextResponse.json({ error: msg, reason: check.reason }, { status: 400 });
    }
    const r = await setLoginPassword(check.login.id, password);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    await startStoreSession(check.login, check.account);
    await auditSystem({
      action: "retail.set_password",
      actor: check.login.email,
      actorType: "store",
      targetType: "retail",
      targetId: check.account.id,
      ok: true,
      note: `Store login for ${check.account.name} chose a password with their link`,
      ip,
    }).catch(() => {});
    return NextResponse.json({ ok: true, name: check.login.name });
  }

  return NextResponse.json({ error: "Bad request." }, { status: 400 });
}
