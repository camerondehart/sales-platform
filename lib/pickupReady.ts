import { Resend } from "resend";
import { auditSystem } from "./audit";
import { isEnabled } from "./flags";
import { escapeHtml, itemsTable } from "./invoiceEmail";
import { getOrderById, getOrders, normalizeStatus, updateOrder, type Order } from "./orders";
import { pickupInstructionsHtml } from "./pickup";
import { customerReplyTo } from "./replyTo";

/**
 * "Ready for pickup" message, so a pickup order is never marked completed
 * without the customer being told it's waiting.
 *
 * Staff press "Ready for pickup" in order details to email the customer the
 * pickup details. If a pickup order still hasn't had it a day after it was
 * paid (or placed, for cash at pickup), the cron tick sends it automatically
 * and emails the staff inbox so staff make sure the order is packed.
 * Only orders placed after this shipped (PICKUP_READY_FROM), so old orders
 * never get a sudden batch of emails. Switch `pickup_ready`.
 */

export const PICKUP_READY_FROM = Date.UTC(2026, 10, 24, 5, 0); // Nov 23 2026, 9pm US Pacific: older orders never get one
const DAY = 86_400_000;

/** Orders that should get a ready message: pickup, not collected, not a gift card or off-site sale. */
export function needsReady(o: Order): boolean {
  if (o.shippingMethod !== "pickup" || o.giftCardOrder || o.offSite || o.isInquiry) return false;
  if (o.pickupReadyAt) return false;
  const st = normalizeStatus(o.status);
  return st === "paid" || (st === "pending" && o.paymentMethod === "cash");
}

/** When the one-day clock starts: paid time, or order time for cash at pickup. */
export const readyClockFrom = (o: Order) => (normalizeStatus(o.status) === "paid" ? o.paidAt || o.createdAt : o.createdAt);

export function autoDue(o: Order, now = Date.now()): boolean {
  return needsReady(o) && o.createdAt >= PICKUP_READY_FROM && now - readyClockFrom(o) >= DAY;
}

export function pickupReadyHtml(o: Order): string {
  const first = escapeHtml((o.userName || "").split(/\s+/)[0] || "there");
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
  <body style="font-family: 'Optima', 'Helvetica Neue', sans-serif; background: #f9f9f8; padding: 20px; color: #61676d;">
    <div style="max-width: 560px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden;">
      <div style="background: #85ba45; padding: 20px 24px; color: white;">
        <h1 style="margin: 0; font-family: 'Libre Baskerville', Georgia, serif; font-style: italic; font-weight: 400; font-size: 1.5rem;">Ready for pickup</h1>
        <p style="margin: 8px 0 0; opacity: 0.85;">Order ref ${o.id.slice(-6).toUpperCase()}</p>
      </div>
      <div style="padding: 24px;">
        <p style="margin: 0 0 1rem; line-height: 1.6;">Hi ${first}, your order is ready and waiting for you.</p>
        ${itemsTable(o)}
        ${o.paymentMethod === "cash" && normalizeStatus(o.status) === "pending" ? `<p style="margin: 1rem 0 0;"><strong>Please bring $${o.total.toFixed(2)} in cash.</strong></p>` : ""}
        ${pickupInstructionsHtml()}
        <div style="margin-top: 2rem; font-size: 0.8rem; color: #81858b; border-top: 1px solid #abaeb2; padding-top: 1rem;">
          Questions? Just reply to this email.
        </div>
      </div>
    </div>
  </body></html>`;
}

async function send(to: string, subject: string, html: string, replyTo?: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !to) return false;
  try {
    const r = await new Resend(apiKey).emails.send({ from: process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev", to, subject, html, ...(replyTo ? { reply_to: replyTo } : {}) });
    return !r.error;
  } catch (err) {
    console.error("[pickup-ready] send failed", err);
    return false;
  }
}

/** Send the ready message for one order. Claims the order first so two runs never both send. */
export async function sendPickupReady(id: string, by: "staff" | "auto"): Promise<{ ok: boolean; error?: string; order?: Order }> {
  const o = await getOrderById(id);
  if (!o) return { ok: false, error: "Order not found." };
  if (o.shippingMethod !== "pickup") return { ok: false, error: "That isn't a pickup order." };
  if (o.pickupReadyAt) return { ok: false, error: "The ready message already went out." };
  const claimed = await updateOrder(id, { pickupReadyAt: Date.now(), pickupReadyBy: by });
  const ok = await send(o.userEmail, "Your order is ready for pickup", pickupReadyHtml(o), customerReplyTo());
  const order = ok ? claimed || undefined : (await updateOrder(id, { pickupReadyFailed: true })) || undefined;
  await auditSystem({
    action: "order.pickup_ready",
    ...(by === "staff" ? { actor: "admin", actorType: "admin" as const, source: "human" as const } : {}),
    targetType: "order",
    targetId: id,
    ok,
    note: `${by === "auto" ? "Sent automatically (a day without one)" : "Sent by staff"}: ready-for-pickup email to ${o.userName}${ok ? "" : " FAILED"}`,
  });
  return ok ? { ok, order } : { ok, error: "The email didn't send. Try again or contact them directly.", order };
}

/** Cron tick: send overdue ready messages and nudge the staff inbox for each. */
export async function runPickupReady(staffTo: string, siteUrl: string): Promise<{ sent: string[] }> {
  if (!(await isEnabled("pickup_ready"))) return { sent: [] };
  const due = (await getOrders()).filter((o) => autoDue(o)).slice(0, 10);
  const sent: string[] = [];
  for (const o of due) {
    const r = await sendPickupReady(o.id, "auto");
    if (!r.ok && !r.order) continue;
    sent.push(o.id);
    const ref = o.id.slice(-6).toUpperCase();
    await send(
      staffTo,
      `Pickup ${ref} for ${o.userName}: ${r.ok ? "ready message sent" : "ready message FAILED"} — please check it's packed`,
      `<p>Hi,</p><p>${escapeHtml(o.userName)}'s pickup order <strong>${ref}</strong> went a day without a "ready for pickup" message, so the site ${r.ok ? "sent it automatically just now" : "tried to send it, but the email failed — please contact them"}.</p>${itemsTable(o)}<p>Please make sure it's packed and waiting. Mark it Completed only once they've collected it.</p><p><a href="${siteUrl}/admin?tab=orders">Open orders</a></p>`
    );
  }
  return { sent };
}
