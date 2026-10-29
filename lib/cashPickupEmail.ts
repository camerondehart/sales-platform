import type { Order } from "./orders";
import { escapeHtml, itemsTable } from "./invoiceEmail";
import { pickupInstructionsHtml } from "./pickup";
import { brand } from "./brand";

// Moved here from app/api/checkout/route.ts so the public shop's cash-at-pickup
// orders get the same email ("shop" names the header: members' or public shop).
// Confirmation for cash-at-pickup orders: no payment link, pickup details instead.
export function buildCashPickupEmail(order: Order, payLink: string, shop = brand.members): string {
  return `
  <!DOCTYPE html>
  <html><head><meta charset="UTF-8"></head>
  <body style="font-family: 'Optima', 'Helvetica Neue', sans-serif; background: #f9f9f8; padding: 20px; color: #61676d;">
    <div style="max-width: 560px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
      <div style="background: #85ba45; padding: 20px 24px; color: white;">
        <h1 style="margin: 0; font-family: 'Libre Baskerville', Georgia, serif; font-style: italic; font-weight: 400; font-size: 1.5rem;">${escapeHtml(shop)}</h1>
        <p style="margin: 8px 0 0; opacity: 0.85;">Order confirmed &middot; Ref ${order.id.slice(-6).toUpperCase()}</p>
      </div>
      <div style="padding: 24px;">
        <div style="margin-bottom: 1.25rem;">
          <div style="font-size: 0.7rem; letter-spacing: 0.18em; text-transform: uppercase; color: #85ba45;">Thank you,</div>
          <h2 style="margin: 0.4rem 0 0; font-family: 'Libre Baskerville', Georgia, serif; font-weight: 400;">${escapeHtml(order.userName)}</h2>
        </div>
        ${itemsTable(order)}
        <div style="text-align: right; margin-top: 1rem;">
          <div style="margin: 0.4rem 0;">Subtotal: <strong>$${order.subtotal.toFixed(2)}</strong></div>
          ${order.discount && order.discount > 0 ? `<div style="margin: 0.4rem 0; color: #6fa336;">Promo savings: <strong>−$${order.discount.toFixed(2)}</strong></div>` : ""}
          <div style="margin: 0.4rem 0;">Local pickup: <strong>Free</strong></div>
          <div style="margin: 0.9rem 0 0; font-size: 1.2rem; border-top: 1px solid #abaeb2; padding-top: 0.9rem;">Due at pickup: <strong>$${order.total.toFixed(2)}</strong></div>
        </div>
        <div style="margin-top: 1.25rem; background: #fdf6e3; border-left: 3px solid #a2a434; padding: 0.9rem 1rem; border-radius: 0 6px 6px 0;">
          <strong>Paying with cash at pickup.</strong> Please bring $${order.total.toFixed(2)}. No payment is needed beforehand.
        </div>
        ${pickupInstructionsHtml()}

        <div style="margin-top: 1.5rem; border: 2px solid #85ba45; border-radius: 8px; padding: 1.1rem 1.2rem; text-align: center;">
          <div style="font-size: 0.7rem; letter-spacing: 0.16em; text-transform: uppercase; color: #6fa336; font-weight: 700;">After you collect it</div>
          <p style="margin: 0.6rem 0 1rem; color: #61676d; font-size: 0.92rem; line-height: 1.5;">
            Once you've picked up your order and left your cash, tap below so we know
            it's all squared away.
          </p>
          <a href="${payLink}" style="display: inline-block; background: #85ba45; color: white; padding: 0.85rem 1.6rem; border-radius: 6px; text-decoration: none; font-weight: 700;">
            I picked up and paid cash
          </a>
        </div>

        ${order.note ? `<div style="margin-top: 1.25rem; background: #e8e5e5; padding: 1rem; border-radius: 4px; font-size: 0.9rem;"><strong>Your note:</strong><br/>${escapeHtml(order.note)}</div>` : ""}
        <div style="margin-top: 2rem; font-size: 0.8rem; color: #81858b; border-top: 1px solid #abaeb2; padding-top: 1rem;">
          Questions? Reach out to <a href="mailto:${brand.supportEmail}" style="color: #6fa336;">${brand.supportEmail}</a>.
        </div>
      </div>
    </div>
  </body></html>`;
}
