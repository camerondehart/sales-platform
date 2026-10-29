// Shared invoice email template — used by customer checkout AND the
// admin "Generate invoice" flow, so both send identical invoices with
// payment instructions and the mark-as-paid confirmation button.

import type { Order } from "./orders";
import { parsePrice } from "./orders";
import { pickupInstructionsHtml } from "./pickup";
import { brand } from "@/lib/brand";

// Payment handles come from brand.config.ts; the memo customers are asked to include.
export const VENMO_HANDLE = brand.payments.venmoHandle;
export const PAYMENT_MEMO = "Order";

// The memo customers send with payment, e.g. "Order for Bailey Gadaffi #4K9Q2X".
// The #ref lets the Venmo inbox match the payment to its order.
export function paymentMemo(customerName?: string, ref?: string): string {
  const name = (customerName || "").trim().replace(/\s+/g, " ");
  const base = name ? `Order for ${name}` : PAYMENT_MEMO;
  return ref ? `${base} #${ref}` : base;
}

// Build a Venmo deep link that opens the app (or venmo.com on desktop)
// with the recipient, amount, and memo already filled in.
/**
 * A URL safe to drop into an HTML href.
 *
 * Query separators must be written as &amp; inside an attribute. Left raw,
 * "&note=" is a valid legacy character reference for &not (¬) followed by
 * "e=", so lenient parsers — and email clients are famously lenient — mangle
 * the link into "...&amount=67.98¬e=Consultation...", losing the memo and
 * corrupting the amount. Escaping removes the ambiguity entirely; every
 * parser turns &amp; back into & before following the link.
 */
export function hrefSafe(url: string): string {
  return url.replace(/&/g, "&amp;");
}

export function venmoLink(amount: number, customerName?: string, ref?: string): string {
  // Note: build the query manually. URLSearchParams encodes spaces as "+",
  // which Venmo renders literally in the memo ("Order+for+Name").
  // encodeURIComponent uses %20, which Venmo decodes correctly.
  const note = encodeURIComponent(paymentMemo(customerName, ref));
  return `https://venmo.com/${VENMO_HANDLE}?txn=pay&amount=${amount.toFixed(2)}&note=${note}`;
}

// How customers pay. Shown on every invoice.
export function paymentInstructionsHtml(customerName?: string, ref?: string): string {
  const ways: string[] = [];
  if (VENMO_HANDLE) ways.push(`<strong>Venmo</strong> (<strong>@${escapeHtml(VENMO_HANDLE)}</strong>)`);
  if (brand.payments.zelle) ways.push(`<strong>Zelle</strong> (<strong>${escapeHtml(brand.payments.zelle)}</strong>)`);
  const via = ways.length ? `via ${ways.join(" or ")}` : "using the payment details we've shared with you";
  return `
  Send your payment ${via},
  with <strong>&ldquo;${escapeHtml(paymentMemo(customerName, ref))}&rdquo;</strong> in the memo/note line.`;
}

// Kept for reference/back-compat.
export const PAYMENT_INSTRUCTIONS_HTML = paymentInstructionsHtml();

export function itemsTable(order: Order): string {
  const rows = order.items
    .map(
      (i) => `
      <tr style="border-bottom: 1px solid #e8e5e5;">
        <td style="padding: 0.6rem 0;">${escapeHtml(i.productName)}${i.restocking ? `<div style="font-size: 0.78rem; color: #a2a434; margin-top: 2px;">Currently restocking: sent as soon as it's back in</div>` : ""}</td>
        <td style="padding: 0.6rem 0; text-align: center;">${i.quantity}</td>
        <td style="padding: 0.6rem 0; text-align: right;">${escapeHtml(i.price)}</td>
        <td style="padding: 0.6rem 0; text-align: right;">$${(parsePrice(i.price) * i.quantity).toFixed(2)}</td>
      </tr>`
    )
    .join("");
  return `
    <table style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr>
          <th style="text-align: left; padding-bottom: 0.5rem; border-bottom: 1px solid #abaeb2;">Product</th>
          <th style="text-align: center; padding-bottom: 0.5rem; border-bottom: 1px solid #abaeb2;">Qty</th>
          <th style="text-align: right; padding-bottom: 0.5rem; border-bottom: 1px solid #abaeb2;">Price</th>
          <th style="text-align: right; padding-bottom: 0.5rem; border-bottom: 1px solid #abaeb2;">Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

export function addressBlock(order: Order): string {
  const a = order.shippingAddress;
  if (!a) return "";
  return `
    <div style="margin-top: 1.25rem; font-size: 0.9rem;">
      <strong>${order.shippingMethod === "pickup" ? "Contact address" : "Ship to"}:</strong><br/>
      ${escapeHtml(a.addressLine1)}<br/>
      ${a.addressLine2 ? escapeHtml(a.addressLine2) + "<br/>" : ""}
      ${escapeHtml(a.city)}, ${escapeHtml(a.state)} ${escapeHtml(a.postalCode)}
    </div>`;
}

export function buildInvoiceEmail(order: Order, payLink: string, note?: string | null): string {
  const shippingLabel =
    order.shippingMethod === "pickup" ? "Local pickup" : "Shipping / adjustment";
  return `
  <!DOCTYPE html>
  <html><head><meta charset="UTF-8"></head>
  <body style="font-family: 'Optima', 'Helvetica Neue', sans-serif; background: #f9f9f8; padding: 20px; color: #61676d;">
    <div style="max-width: 560px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
      <div style="background: #85ba45; padding: 20px 24px; color: white;">
        <h1 style="margin: 0; font-family: 'Libre Baskerville', Georgia, serif; font-style: italic; font-weight: 400; font-size: 1.5rem;">${brand.name}</h1>
        <p style="margin: 8px 0 0; opacity: 0.85;">Invoice · Ref ${order.id.slice(-6).toUpperCase()}</p>
      </div>
      <div style="padding: 24px;">
        <div style="margin-bottom: 1.5rem;">
          <div style="font-size: 0.7rem; letter-spacing: 0.18em; text-transform: uppercase; color: #85ba45;">Thank you,</div>
          <h2 style="margin: 0.4rem 0 0; font-family: 'Libre Baskerville', Georgia, serif; font-weight: 400;">${escapeHtml(order.userName)}</h2>
        </div>
        ${itemsTable(order)}
        <div style="text-align: right; margin-top: 1rem;">
          <div style="margin: 0.4rem 0;">Subtotal: <strong>$${order.subtotal.toFixed(2)}</strong></div>
          ${order.bundles?.length ? order.bundles.map((b) => `<div style="margin: 0.4rem 0; color: #6fa336;">${escapeHtml(b.name)} bundle${b.sets > 1 ? ` ×${b.sets}` : ""}: <strong>−$${b.savings.toFixed(2)}</strong></div>`).join("") : ""}
          ${order.discount && order.discount - (order.bundleSavings || 0) > 0.004 ? `<div style="margin: 0.4rem 0; color: #6fa336;">${order.bundleSavings ? "Other savings" : "Promo savings"}: <strong>−$${(order.discount - (order.bundleSavings || 0)).toFixed(2)}</strong></div>` : ""}
          <div style="margin: 0.4rem 0;">${shippingLabel}: <strong>${order.shippingCost === 0 ? "Free" : `$${order.shippingCost.toFixed(2)}`}</strong></div>
          <div style="margin: 0.9rem 0 0; font-size: 1.2rem; border-top: 1px solid #abaeb2; padding-top: 0.9rem;">Total: <strong>$${order.total.toFixed(2)}</strong></div>
        </div>
        ${addressBlock(order)}
        ${order.shippingMethod === "pickup" ? pickupInstructionsHtml() : ""}
        ${note ? `<div style="margin-top: 1.25rem; background: #e8e5e5; padding: 1rem; border-radius: 4px; font-size: 0.9rem;"><strong>Note:</strong><br/>${escapeHtml(note)}</div>` : ""}
        <div style="margin-top: 1.75rem; background: #f3f6ec; padding: 1.25rem; border-radius: 8px;">
          <div style="font-size: 0.7rem; letter-spacing: 0.18em; text-transform: uppercase; color: #85ba45; font-weight: 700; text-align: center;">Completing your consultation &mdash; 2 steps</div>

          <!-- STEP 1 -->
          <div style="margin-top: 1.1rem; background: white; border-radius: 8px; padding: 1.1rem; border: 1px solid #dfe6d2;">
            <div style="font-weight: 700; color: #61676d; margin-bottom: 0.4rem;">
              <span style="display: inline-block; background: #008CFF; color: white; width: 22px; height: 22px; border-radius: 50%; text-align: center; line-height: 22px; font-size: 0.8rem; margin-right: 6px;">1</span>
              Send your payment
            </div>
            <p style="margin: 0.5rem 0 0; line-height: 1.6; font-size: 0.92rem;">${paymentInstructionsHtml(order.userName, order.id.slice(-6).toUpperCase())}</p>
            ${VENMO_HANDLE ? `<div style="text-align: center; margin-top: 0.9rem;">
              <a href="${hrefSafe(venmoLink(order.total, order.userName, order.id.slice(-6).toUpperCase()))}" style="display: inline-block; background: #008CFF; color: white; padding: 0.75rem 1.5rem; border-radius: 4px; text-decoration: none; font-weight: 700; font-size: 0.85rem;">Pay $${order.total.toFixed(2)} with Venmo</a>
              <p style="font-size: 0.72rem; color: #81858b; margin: 0.5rem 0 0;">Opens Venmo with the amount and memo filled in. This does <strong>not</strong> notify us on its own.</p>
            </div>` : ""}
          </div>

          <div style="text-align: center; color: #85ba45; font-size: 1.3rem; line-height: 1; margin: 0.5rem 0;">&#8595;</div>

          <!-- STEP 2 -->
          <div style="background: white; border-radius: 8px; padding: 1.1rem; border: 2px solid #85ba45;">
            <div style="font-weight: 700; color: #61676d; margin-bottom: 0.4rem;">
              <span style="display: inline-block; background: #85ba45; color: white; width: 22px; height: 22px; border-radius: 50%; text-align: center; line-height: 22px; font-size: 0.8rem; margin-right: 6px;">2</span>
              Come back here and tell us
            </div>
            <p style="margin: 0.5rem 0 0; line-height: 1.6; font-size: 0.92rem;">
              After paying, <strong>you must click the green button below</strong> so we know your payment is on the way. Your order isn't confirmed until you do.
            </p>
            <div style="text-align: center; margin-top: 0.9rem;">
              <a href="${payLink}" style="display: inline-block; background: #85ba45; color: white; padding: 0.85rem 1.75rem; border-radius: 4px; text-decoration: none; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; font-size: 0.8rem;">I've sent my payment</a>
            </div>
          </div>

          <p style="font-size: 0.78rem; color: #81858b; margin: 1rem 0 0; line-height: 1.55; text-align: center;"><strong>Please note:</strong> if your order doesn't come up right away, give it a minute and try again &mdash; the system may just be updating.</p>
        </div>
        <div style="margin-top: 2rem; font-size: 0.8rem; color: #81858b; border-top: 1px solid #abaeb2; padding-top: 1rem;">
          Thank you for shopping with ${brand.name}. Questions? Reach out to <a href="mailto:${brand.supportEmail}" style="color: #6fa336;">${brand.supportEmail}</a>.
        </div>
      </div>
    </div>
  </body></html>`;
}

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
