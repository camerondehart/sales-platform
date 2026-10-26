import { Resend } from "resend";
import { buildInvoiceEmail } from "./invoiceEmail";
import type { Order } from "./orders";
import { brand } from "@/lib/brand";

/**
 * Send the original invoice email again for an order that's still unpaid.
 * Same template and pay link the customer got at checkout — amounts are read
 * from the saved order and are never changed here.
 */
export function canResendInvoice(o: Order): { ok: true } | { ok: false; reason: string } {
  if (o.isInquiry || o.status === "inquiry") return { ok: false, reason: "That's an inquiry, not an invoice." };
  if (o.status !== "pending") return { ok: false, reason: `That order is ${o.status}, so there's nothing to pay.` };
  if (o.paymentMethod === "cash") return { ok: false, reason: "That order is paid in cash at pickup — there's no invoice to resend." };
  if (!o.paymentToken) return { ok: false, reason: "That order has no payment link." };
  return { ok: true };
}

export async function resendInvoice(o: Order, siteOrigin: string): Promise<{ ok: true; sentTo: string } | { ok: false; error: string }> {
  const check = canResendInvoice(o);
  if (!check.ok) return { ok: false, error: check.reason };
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "Email isn't set up on this site (RESEND_API_KEY missing)." };
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || siteOrigin;
  const payLink = `${siteUrl}/pay/${o.paymentToken}`;
  const ref = o.id.slice(-6).toUpperCase();
  const subject =
    o.source === "retail"
      ? `Your order from ${brand.name} (Ref ${ref}) — copy`
      : `Your invoice — ${brand.name} (Ref ${ref}) — copy`;
  try {
    const r = await new Resend(apiKey).emails.send({
      from: process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev",
      to: o.userEmail,
      reply_to: process.env.INQUIRY_TO_EMAIL || undefined,
      subject,
      html: buildInvoiceEmail(o, payLink, o.note),
    });
    if (r.error) return { ok: false, error: `The email wasn't sent: ${r.error.message || "rejected by the mail service"}` };
    return { ok: true, sentTo: o.userEmail };
  } catch (err) {
    console.error("[invoice] resend failed", err);
    return { ok: false, error: "The email service didn't respond. Try again in a moment." };
  }
}
