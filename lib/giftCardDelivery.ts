// Gift card delivery and cancel, called where payment gets CONFIRMED
// (staff status change, Venmo/Zelle confirm or link) and on cancel.
// See lib/giftCards.ts for the rules.

import { Resend } from "resend";
import { brand } from "./brand";
import { customerReplyTo } from "./replyTo";
import { escapeHtml } from "./invoiceEmail";
import { updateOrder, isCompleted, type Order } from "./orders";
import { findUserByEmail } from "./users";
import { activateForOrder, voidForOrder, markEmailed, returnHold, retakeHold, type GiftCard } from "./giftCards";
import { giftMoney, GIFT_OCCASIONS } from "./giftCardRules";

export function siteUrlFrom(req?: Request): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (env) return env;
  if (req) return new URL(req.url).origin;
  return process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "";
}

// Email can't run the animation, so each occasion gets a still version of its card.
const EMAIL_LOOK: Record<string, { bg: string; ink: string; accent: string; mark: string }> = {
  birthday: { bg: "linear-gradient(135deg,#f9c6b8 0%,#f4a7b9 45%,#c99be0 100%)", ink: "#4a2340", accent: "#fff6e6", mark: "🎈" },
  holidays: { bg: "linear-gradient(135deg,#1f4d3a 0%,#2f6b4f 55%,#7a2f2f 100%)", ink: "#fff8e8", accent: "#e9c46a", mark: "❄️" },
  "just-because": { bg: "linear-gradient(135deg,#e8efd9 0%,#b9d39a 50%,#85ba45 100%)", ink: "#2f3a24", accent: "#fffdf5", mark: "🍄" },
  "thank-you": { bg: "linear-gradient(135deg,#efe6f7 0%,#d7c4ec 50%,#b49bd6 100%)", ink: "#3a2a4f", accent: "#fffdf8", mark: "🌸" },
};

function cardBlock(c: GiftCard): string {
  const look = EMAIL_LOOK[c.occasion] || EMAIL_LOOK["just-because"];
  const line = c.kind === "bonus" ? "Bonus credit" : GIFT_OCCASIONS.find((o) => o.key === c.occasion)?.line || "A gift for you";
  return `
  <div style="background:#85ba45;background:${look.bg};border-radius:16px;padding:22px 24px;color:${look.ink};font-family:'Libre Baskerville',Georgia,serif;">
    <div style="font-size:12px;letter-spacing:0.2em;text-transform:uppercase;opacity:0.8;font-family:Arial,sans-serif;">${escapeHtml(brand.shortName)} &middot; Gift card</div>
    <div style="font-size:26px;font-style:italic;margin:14px 0 4px;">${look.mark} ${escapeHtml(line)}</div>
    <div style="font-size:15px;">For ${escapeHtml(c.toName)}${c.kind === "gift" ? ` &middot; from ${escapeHtml(c.fromName)}` : ""}</div>
    <div style="font-size:40px;font-weight:700;margin-top:14px;font-family:Arial,sans-serif;">${giftMoney(c.amount)}</div>
  </div>`;
}

function shell(title: string, body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
  <body style="font-family:'Optima','Helvetica Neue',sans-serif;background:#f9f9f8;padding:20px;color:#61676d;">
    <div style="max-width:560px;margin:0 auto;background:white;border-radius:10px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.05);">
      <div style="padding:22px 24px 6px;">
        <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#85ba45;font-weight:700;">${escapeHtml(brand.members)} &middot; ${escapeHtml(brand.name)}</div>
        <h1 style="margin:8px 0 0;font-family:'Libre Baskerville',Georgia,serif;font-weight:400;font-style:italic;font-size:22px;color:#4a4f54;">${escapeHtml(title)}</h1>
      </div>
      <div style="padding:16px 24px 26px;">${body}</div>
    </div>
  </body></html>`;
}

const button = (href: string, label: string) =>
  `<div style="text-align:center;margin-top:20px;"><a href="${href}" style="display:inline-block;background:#85ba45;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;font-size:13px;">${label}</a></div>`;

export function recipientEmail(c: GiftCard, site: string): { subject: string; html: string } {
  const link = `${site}/gift/${c.token}`;
  return {
    subject: `${c.fromName} sent you a ${giftMoney(c.amount)} ${brand.shortName} gift card`,
    html: shell(`${c.fromName} sent you a gift card`, `
      ${cardBlock(c)}
      ${c.note ? `<div style="margin-top:18px;padding:14px 16px;background:#f4f1ea;border-left:3px solid #85ba45;border-radius:0 6px 6px 0;font-style:italic;color:#4a4f54;">&ldquo;${escapeHtml(c.note)}&rdquo;<div style="font-style:normal;margin-top:6px;font-size:13px;">&mdash; ${escapeHtml(c.fromName)}</div></div>` : ""}
      <p style="margin-top:18px;line-height:1.55;">Your card is ready to spend in ${escapeHtml(brand.members)}'s members' shop. It's already in your account if you're a member with this email; otherwise add it under <strong>Account &rarr; Gift cards</strong> with this code:</p>
      <div style="text-align:center;font-family:'Courier New',monospace;font-size:20px;letter-spacing:0.12em;font-weight:700;color:#4a4f54;background:#f4f1ea;border-radius:6px;padding:10px;">${c.code}</div>
      <p style="font-size:13px;margin-top:10px;">It never expires. Keep this email: the code works like cash.</p>
      ${button(link, "Open your gift card")}`),
  };
}

export function buyerEmail(gifts: GiftCard[], bonuses: GiftCard[], site: string): { subject: string; html: string } {
  const g = gifts[0];
  const bonusTotal = bonuses.reduce((n, b) => n + b.amount, 0);
  return {
    subject: `Your gift card for ${g.toName} is on its way`,
    html: shell("Your gift card is on its way", `
      <p style="line-height:1.55;">Thank you! We've confirmed your payment and sent your ${giftMoney(g.amount)} gift card to <strong>${escapeHtml(g.toName)}</strong>.</p>
      ${cardBlock(g)}
      ${bonusTotal > 0 ? `<p style="margin-top:18px;line-height:1.55;">And a thank-you from us: <strong>${giftMoney(bonusTotal)} bonus credit</strong> is now in your account. It's used automatically at checkout in the members' shop.</p>` : ""}
      ${button(`${site}/gallery?giftcards=1`, "See your gift cards")}`),
  };
}

async function send(to: string, mail: { subject: string; html: string }): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !to) return false;
  try {
    const r = await new Resend(apiKey).emails.send({ from: process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev", to, reply_to: customerReplyTo(), subject: mail.subject, html: mail.html });
    if (r.error) console.error("[gift cards] email refused", r.error);
    return !r.error;
  } catch (err) {
    console.error("[gift cards] email failed", err);
    return false;
  }
}

/**
 * Payment for a gift card order is confirmed: activate its cards, give the
 * bonus, email the recipient and the buyer, and complete the order (nothing
 * to ship). Safe to call again. Returns the cards activated by this call.
 */
export async function deliverGiftCards(order: Order, site: string): Promise<GiftCard[]> {
  if (!order.giftCardOrder) return [];
  const done = await activateForOrder(order.id, async (email) => {
    const u = await findUserByEmail(email).catch(() => undefined);
    return u && u.status === "approved" ? u : undefined;
  });
  if (!isCompleted(order.status) && order.status !== "cancelled") {
    const now = Date.now();
    await updateOrder(order.id, { status: "completed", completedAt: now, paidAt: order.paidAt || now }).catch((err) => console.error("[gift cards] complete order", err));
  }
  if (!done.length) return done;
  const gifts = done.filter((c) => c.kind === "gift");
  const bonuses = done.filter((c) => c.kind === "bonus");
  const emailed: string[] = [];
  for (const c of gifts) if (!c.emailedAt && (await send(c.toEmail, recipientEmail(c, site)))) emailed.push(c.id);
  if (gifts.length) await send(order.userEmail, buyerEmail(gifts, bonuses, site));
  await markEmailed(emailed).catch(() => {});
  return done;
}

/** A status change on any order: gift cards and gift card balance follow it. */
export async function giftCardsFollowStatus(before: Order | null, after: Order, site: string, byStaff: boolean): Promise<{ delivered?: number; voided?: number; spentWarning?: string; returned?: number; retaken?: number }> {
  const out: { delivered?: number; voided?: number; spentWarning?: string; returned?: number; retaken?: number } = {};
  const wasCancelled = before?.status === "cancelled";
  if (after.status === "cancelled" && !wasCancelled) {
    if (after.giftCardOrder) {
      const v = await voidForOrder(after.id);
      out.voided = v.voided;
      if (v.spent.length) out.spentWarning = `${v.spent.length} card(s) from this order were already partly spent, so they stay active.`;
    }
    if (after.giftHold) out.returned = await returnHold(after.giftHold, after.id);
    return out;
  }
  if (wasCancelled && after.status !== "cancelled" && after.giftHold) {
    const r = await retakeHold(after.giftHold, after.id);
    out.retaken = r.taken;
    if (r.taken + 0.001 < r.wanted) out.spentWarning = `Only ${giftMoney(r.taken)} of the ${giftMoney(r.wanted)} gift card balance could be taken again; collect the rest another way.`;
  }
  // Staff setting Paid or Completed is the payment confirmation.
  if (after.giftCardOrder && byStaff && (after.status === "paid" || isCompleted(after.status))) {
    out.delivered = (await deliverGiftCards(after, site)).length;
  }
  return out;
}
