/**
 * "Set your password" links for members who've never chosen one here (people
 * imported from the old store). The link is signed, lasts 30 days, and stops
 * working as soon as a password is set — the signature includes a fingerprint
 * of the current password hash, so it can only be used once.
 */

import crypto from "crypto";
import { Resend } from "resend";
import { getUsers, mutateUsers, type User } from "./users";
import { brand } from "@/lib/brand";

export const LINK_DAYS = 30;
const DAY = 86_400_000;

const secret = () => process.env.AUTH_SECRET || "dev-secret-please-change-in-production-12345";
const fingerprint = (hash: string) => crypto.createHash("sha256").update(hash || "").digest("hex").slice(0, 16);
const sign = (id: string, exp: number, hash: string) =>
  crypto.createHmac("sha256", secret()).update(`setpw:${id}:${exp}:${fingerprint(hash)}`).digest("base64url").slice(0, 32);

export function setupToken(u: Pick<User, "id" | "passwordHash">, now = Date.now()): string {
  const exp = now + LINK_DAYS * DAY;
  return `${Buffer.from(u.id).toString("base64url")}.${exp.toString(36)}.${sign(u.id, exp, u.passwordHash)}`;
}

export type TokenCheck = { ok: true; user: User } | { ok: false; reason: "invalid" | "expired" | "used" };

export async function checkSetupToken(token: string, now = Date.now()): Promise<TokenCheck> {
  const m = /^([A-Za-z0-9_-]+)\.([0-9a-z]+)\.([A-Za-z0-9_-]{32})$/.exec(token || "");
  if (!m) return { ok: false, reason: "invalid" };
  const id = Buffer.from(m[1], "base64url").toString("utf8");
  const exp = parseInt(m[2], 36);
  const user = (await getUsers()).find((u) => u.id === id);
  if (!user || user.status !== "approved") return { ok: false, reason: "invalid" };
  const want = Buffer.from(sign(id, exp, user.passwordHash));
  const got = Buffer.from(m[3]);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) {
    // Right person, but the password has changed since the link was made.
    return { ok: false, reason: "used" };
  }
  if (!Number.isFinite(exp) || exp < now) return { ok: false, reason: "expired" };
  return { ok: true, user };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function setupEmailHtml(firstName: string, link: string, siteUrl: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;background:#f9f9f8;padding:24px 12px;font-family:'Optima',Candara,'Helvetica Neue',sans-serif;color:#61676d;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.05);">
    <div style="background:#85ba45;padding:20px 26px;color:#fff;">
      <div style="font-family:'Libre Baskerville',Georgia,serif;font-style:italic;font-size:1.45rem;">${brand.members}</div>
      <div style="font-size:0.72rem;letter-spacing:0.16em;text-transform:uppercase;opacity:0.9;margin-top:4px;">${brand.name}</div>
    </div>
    <div style="padding:26px;">
      <h1 style="font-family:'Libre Baskerville',Georgia,serif;font-weight:400;font-style:italic;font-size:1.5rem;margin:0 0 14px;color:#4b5156;">Hi ${esc(firstName)},</h1>
      <p style="line-height:1.65;margin:0 0 12px;">${brand.shortName} has a new home, and your account came with you — your details are already there.</p>
      <p style="line-height:1.65;margin:0 0 22px;">All you need to do is choose a password. It takes a few seconds:</p>
      <p style="margin:0 0 24px;text-align:center;">
        <a href="${esc(link)}" style="display:inline-block;background:#85ba45;color:#fff;text-decoration:none;font-weight:700;letter-spacing:0.06em;padding:13px 26px;border-radius:999px;">Set my password</a>
      </p>
      <p style="line-height:1.6;margin:0 0 10px;font-size:0.88rem;">This link works for ${LINK_DAYS} days and only once. If it has expired, go to <a href="${esc(siteUrl)}" style="color:#4f7f22;">${esc(siteUrl.replace(/^https?:\/\//, ""))}</a> and choose <em>“First time here? Email me a link”</em> on the sign-in screen.</p>
      <p style="line-height:1.6;margin:0;font-size:0.88rem;">Questions? Just reply to this email.</p>
    </div>
    <div style="padding:14px 26px;font-size:0.75rem;color:#81858b;border-top:1px solid #eee;">You're getting this because you had an account with ${brand.name}. It's a one-time account email, not a newsletter.</div>
  </div>
</body></html>`;
}

export const SETUP_SUBJECT = `Your ${brand.shortName} account is ready — set your password`;

/** Send one link now (staff button, or the member asking for a new one). Marks the member as invited. */
export async function sendSetupLink(user: User, siteUrl: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "Email isn't set up (RESEND_API_KEY missing)." };
  const link = `${siteUrl}/welcome?t=${setupToken(user)}`;
  try {
    const r = await new Resend(apiKey).emails.send({
      from: process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev",
      to: user.email,
      reply_to: process.env.INQUIRY_TO_EMAIL || undefined,
      subject: SETUP_SUBJECT,
      html: setupEmailHtml(user.name.split(" ")[0] || user.name, link, siteUrl),
      tags: [{ name: "kind", value: "set_password" }],
    });
    if (r.error) return { ok: false, error: r.error.message || "The email service refused it." };
  } catch (err) {
    console.error("[set-password] send failed", err);
    return { ok: false, error: "The email service didn't respond." };
  }
  await markInvited([user.id]).catch(() => {});
  return { ok: true };
}

export async function markInvited(ids: string[], at = Date.now()): Promise<void> {
  if (!ids.length) return;
  const want = new Set(ids);
  await mutateUsers((users) => {
    let changed = false;
    for (const u of users)
      if (want.has(u.id)) {
        u.inviteSentAt = at;
        u.inviteCount = (u.inviteCount || 0) + 1;
        changed = true;
      }
    return { users: changed ? users : null, result: undefined };
  });
}
