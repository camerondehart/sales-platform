import { NextResponse } from "next/server";
import { isAdmin, adminActor } from "@/lib/auth";
import { getOrderById, updateOrder, normalizeStatus } from "@/lib/orders";
import { awardLoyaltyPoints } from "@/lib/loyalty";
import { audited, auditDetail } from "@/lib/audit";
import { decide, getPayment, inbox } from "@/lib/venmoInbox";
import { refOf } from "@/lib/venmoMatch";

// Orders → Venmo payments. GET the inbox (with fresh match suggestions);
// POST a staff decision. Nothing is ever marked paid without one of these.
export const dynamic = "force-dynamic";

const money = (n?: number) => (typeof n === "number" ? `$${n.toFixed(2)}` : "?");

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { rows, orders, setup } = await inbox();
  return NextResponse.json(
    {
      payments: rows.map(({ text: _t, ...r }) => r),
      orders: orders.map((o) => ({ id: o.id, ref: refOf(o.id), name: o.userName, email: o.userEmail, total: o.total, createdAt: o.createdAt, expired: !!o.expiredAt })),
      setup,
      accountEmailSet: !!process.env.VENMO_ACCOUNT_EMAIL?.trim(),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/** Mark one order paid from one verified payment. */
async function confirmOne(paymentId: string, orderId: string, by: string) {
  const p = await getPayment(paymentId);
  if (!p) return { ok: false as const, status: 404, error: "That payment isn't in the inbox." };
  if (!p.verified) return { ok: false as const, status: 400, error: "Quarantined payments can't be matched." };
  const o = await getOrderById(orderId);
  if (!o) return { ok: false as const, status: 404, error: "That order no longer exists." };
  if (normalizeStatus(o.status) !== "pending" || o.paidAt) return { ok: false as const, status: 409, error: `Order ${refOf(o.id)} is already ${normalizeStatus(o.status)}.` };
  const claimed = await decide(paymentId, { state: "confirmed", orderId }, by);
  if (!claimed.ok) return { ok: false as const, status: 409, error: claimed.error };
  const updated = await updateOrder(orderId, { status: "paid", paidAt: Date.now() });
  if (updated) await awardLoyaltyPoints(updated);
  return { ok: true as const, order: updated, payment: claimed.payment, before: { status: o.status, total: o.total } };
}

async function POST_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; paymentId?: string; orderId?: string; paymentIds?: string[] };
  const by = (await adminActor().catch(() => "admin")) || "admin";
  const paymentId = String(body.paymentId || "").slice(0, 80);
  const orderId = String(body.orderId || "").slice(0, 80);

  if (body.action === "confirm") {
    if (!paymentId || !orderId) return NextResponse.json({ error: "Need the payment and the order." }, { status: 400 });
    const r = await confirmOne(paymentId, orderId, by);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    auditDetail({
      action: "venmo.confirm",
      targetId: orderId,
      before: r.before,
      after: { status: "paid", venmo: { id: paymentId, payer: r.payment.payer, amount: r.payment.amount, note: r.payment.note } },
      note: `Venmo ${money(r.payment.amount)} from ${r.payment.payer} → order ${refOf(orderId)}`,
    });
    return NextResponse.json({ ok: true, order: r.order });
  }

  // Bulk: strong matches only (#ref in the note AND the amount matches).
  if (body.action === "confirm_strong") {
    const want = Array.isArray(body.paymentIds) ? new Set(body.paymentIds.map(String)) : null;
    const { rows } = await inbox();
    const strong = rows.filter((r) => r.match?.strength === "strong" && !r.match.amountDiffers && r.match.orderId && (!want || want.has(r.id)));
    const done: Array<{ paymentId: string; orderId: string; ref: string; amount?: number; payer?: string }> = [];
    const skipped: Array<{ paymentId: string; error: string }> = [];
    for (const r of strong) {
      const x = await confirmOne(r.id, r.match!.orderId!, by);
      if (x.ok) done.push({ paymentId: r.id, orderId: r.match!.orderId!, ref: refOf(r.match!.orderId!), amount: r.amount, payer: r.payer });
      else skipped.push({ paymentId: r.id, error: x.error });
    }
    auditDetail({ action: "venmo.confirm_bulk", after: { confirmed: done, skipped }, note: `${done.length} Venmo payment(s) marked paid` });
    return NextResponse.json({ ok: true, confirmed: done.length, skipped });
  }

  if (body.action === "reject" || body.action === "dismiss") {
    if (!paymentId) return NextResponse.json({ error: "Need the payment." }, { status: 400 });
    const r = await decide(paymentId, body.action === "reject" ? { state: "rejected", orderId: orderId || undefined } : { state: "dismissed" }, by);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
    auditDetail({
      action: body.action === "reject" ? "venmo.not_a_match" : "venmo.dismiss",
      targetId: orderId || paymentId,
      after: { venmo: { id: paymentId, payer: r.payment.payer, amount: r.payment.amount }, orderId: orderId || undefined },
      note: body.action === "reject" ? `Venmo ${money(r.payment.amount)} from ${r.payment.payer} is not order ${orderId ? refOf(orderId) : "?"}` : `Venmo email dismissed`,
    });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

export const POST = audited("venmo.decision", "order", POST_handler);
