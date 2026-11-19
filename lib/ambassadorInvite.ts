import bcrypt from "bcryptjs";
import crypto from "crypto";
import { Resend } from "resend";
import { getAmbassadors, saveAmbassador, type Ambassador } from "./ambassadors";
import { getUsers, mutateUsers, type User } from "./users";
import { LINK_DAYS, markInvited, setupToken } from "./passwordSetup";
import { addSubscriber } from "./subscribers";
import { customerReplyTo } from "./replyTo";
import { isEnabled } from "./flags";
import { brand } from "./brand";

/**
 * Inviting an ambassador to their panel (Ambassadors tab → Invite, switch
 * ambassador_panel). Staff give their email (their panel sign-in, or the
 * report email). If no member has it, the site makes an approved member
 * account for them with no password yet; either way the email is linked as
 * their panel sign-in and they get a one-time, 30-day "set your password"
 * link (the same signed links as lib/passwordSetup.ts). Setting it signs
 * them in and lands them on /ambassador.
 *
 * An existing member is never changed (no approving, no new password): a
 * pending or switched-off account is refused so staff decide in Members.
 */

export type InviteResult =
  | { ok: true; ambassador: Ambassador; user: User; created: boolean; emailed: boolean; note: string }
  | { ok: false; error: string; status: number };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const INVITE_SUBJECT = `Your ${brand.shortName} ambassador panel is ready — set your password`;

/** `kind`: "new" = account just made, "setup" = member who never chose a password, "member" = already signs in. */
export function inviteEmailHtml(firstName: string, link: string, siteUrl: string, kind: "new" | "setup" | "member"): string {
  const host = siteUrl.replace(/^https?:\/\//, "");
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;background:#f9f9f8;padding:24px 12px;font-family:'Optima',Candara,'Helvetica Neue',sans-serif;color:#61676d;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.05);">
    <div style="background:#85ba45;padding:20px 26px;color:#fff;">
      <div style="font-family:'Libre Baskerville',Georgia,serif;font-style:italic;font-size:1.45rem;">${esc(brand.name)}</div>
      <div style="font-size:0.72rem;letter-spacing:0.16em;text-transform:uppercase;opacity:0.9;margin-top:4px;">Ambassador panel</div>
    </div>
    <div style="padding:26px;">
      <h1 style="font-family:'Libre Baskerville',Georgia,serif;font-weight:400;font-style:italic;font-size:1.5rem;margin:0 0 14px;color:#4b5156;">Hi ${esc(firstName)},</h1>
      <p style="line-height:1.65;margin:0 0 12px;">Your ${esc(brand.shortName)} ambassador panel is ready. It shows how your page is doing: visits, orders, what you've earned, and the products you feature.${kind === "new" ? " We've also made you a member account, so you can shop ${esc(brand.members)} too." : ""}</p>
      <p style="line-height:1.65;margin:0 0 22px;">${kind === "member" ? "Sign in the way you always do with this email address and you'll land on your panel:" : "Choose a password to get started:"}</p>
      <p style="margin:0 0 24px;text-align:center;">
        <a href="${esc(link)}" style="display:inline-block;background:#85ba45;color:#fff;text-decoration:none;font-weight:700;letter-spacing:0.06em;padding:13px 26px;border-radius:999px;">${kind === "member" ? "Open my panel" : "Set my password"}</a>
      </p>
      <p style="line-height:1.6;margin:0 0 10px;font-size:0.88rem;">${kind === "member" ? "" : `This link works for ${LINK_DAYS} days and only once. After that, `}${kind === "member" ? "Any time, s" : "s"}ign in at <a href="${esc(siteUrl)}" style="color:#4f7f22;">${esc(host)}</a> with this email address and you'll go straight to your panel.</p>
      <p style="line-height:1.6;margin:0;font-size:0.88rem;">Questions? Just reply to this email.</p>
    </div>
  </div>
</body></html>`;
}

async function sendInvite(user: User, siteUrl: string, kind: "new" | "setup" | "member"): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "Email isn't set up (RESEND_API_KEY missing)." };
  // A member who already has a password gets the sign-in page, never a password link.
  const link = kind === "member" ? `${siteUrl}/?next=/ambassador` : `${siteUrl}/welcome?t=${setupToken(user)}`;
  try {
    const r = await new Resend(apiKey).emails.send({
      from: process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev",
      to: user.email,
      reply_to: customerReplyTo(),
      subject: kind === "member" ? `Your ${brand.shortName} ambassador panel is ready` : INVITE_SUBJECT,
      html: inviteEmailHtml(user.name.split(" ")[0] || user.name, link, siteUrl, kind),
      tags: [{ name: "kind", value: "ambassador_invite" }],
    });
    if (r.error) return { ok: false, error: r.error.message || "The email service refused it." };
  } catch (err) {
    console.error("[ambassador invite] send failed", err);
    return { ok: false, error: "The email service didn't respond." };
  }
  if (kind !== "member") await markInvited([user.id]).catch(() => {});
  return { ok: true };
}

/** `email` = what staff typed (optional): else their panel sign-in, else their report email. */
export async function inviteAmbassador(id: string, emailIn: unknown, siteUrl: string): Promise<InviteResult> {
  if (!(await isEnabled("ambassador_panel").catch(() => false))) return { ok: false, error: "Turn on Ambassador panel in Settings → Feature switches first.", status: 400 };
  const a = (await getAmbassadors()).find((x) => x.id === id);
  if (!a) return { ok: false, error: "That ambassador no longer exists.", status: 404 };
  if (!a.active) return { ok: false, error: `${a.name}'s page is off. Turn it on before inviting them.`, status: 400 };
  const email = String(emailIn || a.account || a.email || "").trim().toLowerCase().slice(0, 200);
  if (!email) return { ok: false, error: "Add their email first.", status: 400 };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "That email address doesn't look right.", status: 400 };
  const other = (await getAmbassadors()).find((x) => x.id !== a.id && x.account === email);
  if (other) return { ok: false, error: `${email} already opens ${other.name}'s panel.`, status: 409 };

  const existing = (await getUsers()).find((u) => u.email.toLowerCase() === email);
  if (existing && existing.status === "pending") return { ok: false, error: `${email} has a membership request waiting. Approve it in Members first, then invite them again.`, status: 409 };
  if (existing && existing.status !== "approved") return { ok: false, error: `${email}'s member account isn't active. Check it in Members first.`, status: 409 };

  let user = existing;
  let created = false;
  if (!user) {
    const now = Date.now();
    const hash = await bcrypt.hash(crypto.randomBytes(24).toString("hex"), 10);
    const made = await mutateUsers<User | "taken">((users) => {
      const hit = users.find((u) => u.email.toLowerCase() === email);
      if (hit) return { users: null, result: "taken" as const };
      const u: User = {
        id: `u_${now.toString(36)}_${crypto.randomBytes(4).toString("hex")}`,
        email,
        name: a.name,
        // Never usable: they choose their own with the emailed link.
        passwordHash: hash,
        status: "approved",
        createdAt: now,
        approvedAt: now,
        needsPassword: true,
        // The invite is their welcome: no separate "you're approved" email.
        welcomeEmailSentAt: now,
      };
      return { users: [...users, u], result: u };
    });
    if (made === "taken") return { ok: false, error: "Someone just made an account with that email. Try again.", status: 409 };
    user = made;
    created = true;
    // Every new member joins the mailing list; never blocks the invite.
    await addSubscriber(email, a.name, "member").catch(() => null);
  }

  // Link it as their panel sign-in (only that field changes).
  const linked = a.account === email ? { ok: true as const, ambassador: a } : await saveAmbassador(a.id, { ...a, account: email });
  if (!linked.ok) return { ok: false, error: linked.error, status: linked.status };

  const kind = created ? "new" : user.needsPassword ? "setup" : "member";
  const r = await sendInvite(user, siteUrl, kind);
  const note = kind === "new"
    ? `Made an approved member account for ${email} and emailed a set-password link.`
    : kind === "setup"
      ? `Linked ${email} and emailed a set-password link.`
      : `Linked ${email} (already a member) and emailed them that their panel is ready.`;
  return { ok: true, ambassador: linked.ambassador, user, created, emailed: r.ok, note: r.ok ? note : `${note.replace(/ and emailed.*$/, ".")} The email didn't go out: ${r.error}` };
}
