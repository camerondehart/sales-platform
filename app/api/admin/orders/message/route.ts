import { NextResponse } from "next/server";
import { Resend } from "resend";
import { isAdmin } from "@/lib/auth";
import { getOrders } from "@/lib/orders";
import { audited } from "@/lib/audit";
import { brand } from "@/lib/brand";

// Send a custom email from the admin to an order's customer.
async function POST_handler(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { orderId, message, subject, includePayLink } = await req.json();
  if (!orderId || !message?.trim()) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  const order = (await getOrders()).find((o) => o.id === orderId);
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev";
  if (!apiKey) {
    return NextResponse.json({ error: "Resend API key missing" }, { status: 500 });
  }

  // Optional "Pay now" button for an order still waiting on payment by invoice.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || new URL(req.url).origin;
  const ref = order.id.slice(-6).toUpperCase();
  const payButton =
    includePayLink === true && order.status === "pending" && order.paymentMethod !== "cash" && order.paymentToken
      ? `<div style="text-align: center; margin-top: 1.5rem;">
      <a href="${siteUrl}/pay/${encodeURIComponent(order.paymentToken)}" style="display: inline-block; background: #85ba45; color: white; padding: 0.85rem 1.6rem; border-radius: 6px; text-decoration: none; font-weight: 700;">View &amp; pay order ${ref} — $${order.total.toFixed(2)}</a>
    </div>`
      : "";

  const html = `
  <div style="font-family: 'Optima', Candara, 'Helvetica Neue', sans-serif; max-width: 560px; margin: 0 auto; padding: 2rem; color: #61676d; background: #f9f9f8;">
    <div style="font-size: 0.7rem; letter-spacing: 0.18em; text-transform: uppercase; color: #85ba45; font-weight: 700; margin-bottom: 1rem;">A message from ${brand.members}</div>
    <h1 style="font-family: 'Libre Baskerville', Georgia, serif; font-size: 1.4rem; font-weight: 400; font-style: italic; margin: 0 0 1.5rem;">Hello, ${escapeHtml(order.userName)}</h1>
    <div style="white-space: pre-wrap; line-height: 1.6; background: white; padding: 1.25rem; border-radius: 6px; border-left: 3px solid #85ba45;">${escapeHtml(message)}</div>
    ${payButton}
    <div style="margin-top: 1.5rem; font-size: 0.8rem; color: #81858b;">Regarding your order ${order.id.slice(-6).toUpperCase()}. To get back to us, reach out to <a href="mailto:${brand.supportEmail}" style="color: #6fa336;">${brand.supportEmail}</a>.</div>
  </div>`;

  try {
    const resend = new Resend(apiKey);
    const r = await resend.emails.send({
      from: fromEmail,
      to: order.userEmail,
      reply_to: process.env.INQUIRY_TO_EMAIL || undefined,
      subject: subject?.trim() || `About your order ${ref} — ${brand.members}`,
      html,
    });
    // Resend reports problems in the result rather than by throwing.
    if (r.error) {
      console.error("Resend rejected order message", r.error);
      return NextResponse.json({ error: `The email wasn't sent: ${r.error.message || "rejected by the mail service"}` }, { status: 502 });
    }
    return NextResponse.json({ ok: true, sentTo: order.userEmail, payLink: !!payButton });
  } catch (err) {
    console.error("Failed to send message", err);
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
  }
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// One audit-log entry per request (see lib/audit.ts).
export const POST = audited("order.email_sent", "order", POST_handler);
