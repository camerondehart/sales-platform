import { NextResponse } from "next/server";
import { tooMany } from "@/lib/publicLimits";
import { Resend } from "resend";
import { getOrderByToken, updateOrder, isCompleted } from "@/lib/orders";
import { awardLoyaltyPoints } from "@/lib/loyalty";
import { escapeHtml } from "@/lib/invoiceEmail";

export async function GET(req: Request) {
  const limited = tooMany(req, "pay-view", { max: 60, minutes: 10 });
  if (limited) return limited;
  const token = new URL(req.url).searchParams.get("token") || "";
  const order = await getOrderByToken(token);
  if (!order) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({
    order: {
      shortId: order.id.slice(-6).toUpperCase(),
      userName: order.userName,
      items: order.items,
      shippingMethod: order.shippingMethod,
      shippingCost: order.shippingCost,
      subtotal: order.subtotal,
      discount: order.discount || 0,
      total: order.total,
      status: order.status,
      // Cash-at-pickup orders confirm collection instead of payment.
      paymentMethod: order.paymentMethod || "invoice",
      createdAt: order.createdAt,
    },
  });
}

export async function POST(req: Request) {
  const limited = tooMany(req, "pay-confirm", { max: 12, minutes: 10 });
  if (limited) return limited;
  let token = "";
  try {
    token = (await req.json()).token || "";
  } catch {}
  const order = await getOrderByToken(token);
  if (!order) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // A cash-at-pickup order isn't reporting a transfer, it's reporting that the
  // customer collected the order and handed over cash. That lands on
  // "completed" rather than "paid" so it leaves the fulfilment queue.
  const isCashPickup =
    order.paymentMethod === "cash" && order.shippingMethod === "pickup";

  // Idempotent: already confirmed (or beyond) just reports success.
  if (order.status === "paid" || isCompleted(order.status)) {
    return NextResponse.json({ ok: true, status: order.status, alreadyPaid: true });
  }
  if (order.status !== "pending") {
    return NextResponse.json(
      { error: `This order can no longer be confirmed (status: ${order.status}).` },
      { status: 400 }
    );
  }

  const now = Date.now();
  const nextStatus = isCashPickup ? "completed" : "paid";
  await updateOrder(
    order.id,
    isCashPickup
      ? { status: "completed", pickedUpAt: now, paidAt: now }
      : { status: "paid", paidAt: now }
  );
  await awardLoyaltyPoints(order);

  // Notify the admin — best-effort.
  const apiKey = process.env.RESEND_API_KEY;
  const adminEmail = process.env.INQUIRY_TO_EMAIL;
  if (apiKey && adminEmail) {
    try {
      const siteUrl =
        process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || new URL(req.url).origin;
      const adminLink = `${siteUrl}/admin?order=${order.id}`;
      const resend = new Resend(apiKey);
      const ref = order.id.slice(-6).toUpperCase();
      await resend.emails.send({
        from: process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev",
        to: adminEmail,
        subject: isCashPickup
          ? `🧺 Order ${ref} picked up by ${order.userName} (cash)`
          : `💰 Order ${ref} marked paid by ${order.userName}`,
        html: isCashPickup
          ? `<p><strong>${escapeHtml(order.userName)}</strong> (${escapeHtml(order.userEmail)}) confirmed they collected order <strong>${order.id}</strong> and left <strong>$${order.total.toFixed(
              2
            )}</strong> in cash.</p><p>The order is now marked <strong>Completed</strong>. Check the cash matches, then you're done.</p><p style="margin-top:1rem;"><a href="${adminLink}" style="display:inline-block;background:#85ba45;color:white;padding:0.7rem 1.4rem;border-radius:4px;text-decoration:none;font-weight:700;">Open this order in admin</a></p>`
          : `<p><strong>${escapeHtml(order.userName)}</strong> (${escapeHtml(order.userEmail)}) marked order <strong>${order.id}</strong> ($${order.total.toFixed(
              2
            )}) as paid. Verify the payment arrived, then ship or hand off.</p><p style="margin-top:1rem;"><a href="${adminLink}" style="display:inline-block;background:#85ba45;color:white;padding:0.7rem 1.4rem;border-radius:4px;text-decoration:none;font-weight:700;">Open this order in admin</a></p>`,
      });
    } catch (err) {
      console.error("Failed to send confirmation notification", err);
    }
  }

  return NextResponse.json({ ok: true, status: nextStatus });
}
