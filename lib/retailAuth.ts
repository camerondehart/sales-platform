import crypto from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { Resend } from "resend";
import { canSignIn, findLoginById, touchLogin, type RetailAccount, type RetailLogin } from "./retail";
import { customerReplyTo } from "./replyTo";
import { brand } from "@/lib/brand";

/**
 * Store portal sign-in (/store-portal). Its own cookie and its own token
 * role, so a store session can't open the members' gallery or the dashboard
 * (and a member's session can't open the portal). The ways in match members':
 * password, an emailed 6-digit code, and Face ID / Touch ID (passkeys).
 * New logins get a "set your password" link, signed and one-time (it stops
 * working once a password is set), valid 30 days.
 */

export const STORE_COOKIE = "fp_store";
const SESSION_DAYS = 7;

const secretText = () => {
  const s = process.env.AUTH_SECRET;
  if (!s && process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET missing");
  return s || "dev-secret-please-change-in-production-12345";
};
const SECRET = () => new TextEncoder().encode(secretText());

export async function signStoreToken(login: RetailLogin, account: RetailAccount): Promise<string> {
  return new SignJWT({ role: "store", loginId: login.id, accountId: account.id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(SECRET());
}

/** Sign this login in: sets the portal cookie and notes when. */
export async function startStoreSession(login: RetailLogin, account: RetailAccount): Promise<void> {
  cookies().set(STORE_COOKIE, await signStoreToken(login, account), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * SESSION_DAYS,
  });
  await touchLogin(login.id, "lastSignInAt");
}

export function endStoreSession(): void {
  cookies().delete({ name: STORE_COOKIE, path: "/" });
}

/** The signed-in store login, checked against storage (switched-off logins and accounts are out at once). */
export async function getStoreSession(): Promise<{ account: RetailAccount; login: RetailLogin } | null> {
  const token = cookies().get(STORE_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET());
    if (payload.role !== "store" || typeof payload.loginId !== "string") return null;
    const hit = await findLoginById(payload.loginId);
    if (!hit || hit.account.id !== payload.accountId || !canSignIn(hit)) return null;
    return hit;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ set-password links

export const LINK_DAYS = 30;
const DAY = 86_400_000;
const fingerprint = (hash: string) => crypto.createHash("sha256").update(hash || "").digest("hex").slice(0, 16);
const sign = (id: string, exp: number, hash: string) =>
  crypto.createHmac("sha256", secretText()).update(`store-setpw:${id}:${exp}:${fingerprint(hash)}`).digest("base64url").slice(0, 32);

export function storeSetupToken(login: Pick<RetailLogin, "id" | "passwordHash">, now = Date.now()): string {
  const exp = now + LINK_DAYS * DAY;
  return `${Buffer.from(login.id).toString("base64url")}.${exp.toString(36)}.${sign(login.id, exp, login.passwordHash)}`;
}

export type StoreTokenCheck = { ok: true; account: RetailAccount; login: RetailLogin } | { ok: false; reason: "invalid" | "expired" | "used" };

export async function checkStoreSetupToken(token: string, now = Date.now()): Promise<StoreTokenCheck> {
  const m = /^([A-Za-z0-9_-]+)\.([0-9a-z]+)\.([A-Za-z0-9_-]{32})$/.exec(token || "");
  if (!m) return { ok: false, reason: "invalid" };
  const id = Buffer.from(m[1], "base64url").toString("utf8");
  const exp = parseInt(m[2], 36);
  const hit = await findLoginById(id);
  if (!hit || !canSignIn(hit)) return { ok: false, reason: "invalid" };
  const want = Buffer.from(sign(id, exp, hit.login.passwordHash));
  const got = Buffer.from(m[3]);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return { ok: false, reason: "used" };
  if (!Number.isFinite(exp) || exp < now) return { ok: false, reason: "expired" };
  return { ok: true, ...hit };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function frame(kicker: string, title: string, inner: string) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;background:#f9f9f8;padding:24px 12px;font-family:'Optima',Candara,'Helvetica Neue',sans-serif;color:#61676d;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.05);">
    <div style="background:#85ba45;padding:20px 26px;color:#fff;">
      <div style="font-family:'Libre Baskerville',Georgia,serif;font-style:italic;font-size:1.45rem;">${esc(brand.name)}</div>
      <div style="font-size:0.72rem;letter-spacing:0.16em;text-transform:uppercase;opacity:0.9;margin-top:4px;">${kicker}</div>
    </div>
    <div style="padding:26px;">
      <h1 style="font-family:'Libre Baskerville',Georgia,serif;font-weight:400;font-style:italic;font-size:1.5rem;margin:0 0 14px;color:#4b5156;">${title}</h1>
      ${inner}
    </div>
  </div>
</body></html>`;
}

async function send(to: string, subject: string, html: string, kind: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "Email isn't set up (RESEND_API_KEY missing)." };
  try {
    const r = await new Resend(apiKey).emails.send({
      from: process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev",
      to,
      reply_to: customerReplyTo(),
      subject,
      html,
      tags: [{ name: "kind", value: kind }],
    });
    if (r.error) return { ok: false, error: r.error.message || "The email service refused it." };
    return { ok: true };
  } catch (err) {
    console.error(`[store portal] ${kind} email failed`, err);
    return { ok: false, error: "The email service didn't respond." };
  }
}

export const STORE_SETUP_SUBJECT = `Your ${brand.shortName} store portal is ready — set your password`;

/** The welcome / "email me a link" email: a button to choose a password. Marks the login invited. */
export async function sendStoreSetupLink(account: RetailAccount, login: RetailLogin, siteUrl: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const link = `${siteUrl}/store-portal?t=${storeSetupToken(login)}`;
  const first = esc(login.name.split(/\s+/)[0] || "there");
  const r = await send(
    login.email,
    STORE_SETUP_SUBJECT,
    frame(
      "Store portal",
      `Hi ${first},`,
      `<p style="line-height:1.65;margin:0 0 12px;">${esc(account.name)} has a store portal with ${esc(brand.name)}. You can request more stock there and see everything we've shipped to you.</p>
      <p style="line-height:1.65;margin:0 0 22px;">Choose a password to get started:</p>
      <p style="margin:0 0 24px;text-align:center;">
        <a href="${esc(link)}" style="display:inline-block;background:#85ba45;color:#fff;text-decoration:none;font-weight:700;letter-spacing:0.06em;padding:13px 26px;border-radius:999px;">Set my password</a>
      </p>
      <p style="line-height:1.6;margin:0 0 10px;font-size:0.88rem;">This link works for ${LINK_DAYS} days and only once. After that, sign in at <a href="${esc(siteUrl)}/store-portal" style="color:#4f7f22;">${esc(siteUrl.replace(/^https?:\/\//, ""))}/store-portal</a> with your password, an emailed code, or Face ID once you've added it.</p>
      <p style="line-height:1.6;margin:0;font-size:0.88rem;">Questions? Just reply to this email.</p>`,
    ),
    "store_set_password",
  );
  if (r.ok) await touchLogin(login.id, "invitedAt");
  return r;
}

export function sendStoreCode(to: string, name: string, code: string) {
  return send(
    to,
    `${code} is your store portal code`,
    frame(
      "Store portal sign-in",
      `Hi ${esc(name.split(/\s+/)[0] || "there")},`,
      `<p style="line-height:1.6;margin:0 0 1rem;">Here's your code to sign in to the ${esc(brand.shortName)} store portal:</p>
       <div style="font-family:Consolas,monospace;font-size:2rem;letter-spacing:0.3em;color:#61676d;background:#f9f9f8;border-left:3px solid #85ba45;padding:0.9rem 1.2rem;border-radius:0 6px 6px 0;">${code}</div>
       <p style="line-height:1.6;margin:1rem 0 0;">It works once and expires in 10 minutes. Didn't ask for it? You can ignore this email.</p>`,
    ),
    "store_code",
  );
}
