import { brand } from "@/lib/brand";
// Local pickup instructions — shown on the order confirmation screen,
// in the order email, and on the pay page for pickup orders.

export const PICKUP_ADDRESS = brand.pickup.address;

export const PICKUP_INTRO = "Thank you for your order! Here's how to pick it up:";

export const PICKUP_WHERE = brand.pickup.where;

export const PICKUP_NOTES: readonly string[] = brand.pickup.notes;

export const PICKUP_THANKS =
  `Thanks so much for supporting ${brand.name} — we appreciate you! ${brand.emoji}`;

// HTML block for emails (inline styles, matching the invoice template).
export function pickupInstructionsHtml(): string {
  return `
  <div style="margin-top: 1.5rem; background: #f3f6ec; border-radius: 8px; padding: 1.15rem;">
    <div style="font-size: 0.7rem; letter-spacing: 0.18em; text-transform: uppercase; color: #85ba45; font-weight: 700;">Local pickup</div>
    <p style="margin: 0.7rem 0 0.9rem; line-height: 1.6;">${PICKUP_INTRO}</p>
    <table style="width: 100%; border-collapse: collapse; font-size: 0.92rem;">
      <tr>
        <td style="padding: 0.3rem 0; color: #81858b; width: 120px; vertical-align: top;">Pick-up address</td>
        <td style="padding: 0.3rem 0;"><strong>${PICKUP_ADDRESS}</strong></td>
      </tr>
      <tr>
        <td style="padding: 0.3rem 0; color: #81858b; vertical-align: top;">Where to go</td>
        <td style="padding: 0.3rem 0;">${PICKUP_WHERE}</td>
      </tr>
    </table>
    <div style="margin-top: 0.9rem;">
      <div style="font-size: 0.85rem; color: #61676d; font-weight: 700;">A few notes to make it easy:</div>
      <ul style="margin: 0.4rem 0 0; padding-left: 1.1rem; line-height: 1.6; font-size: 0.9rem;">
        ${PICKUP_NOTES.map((n) => `<li>${n}</li>`).join("")}
      </ul>
    </div>
    <p style="margin: 1rem 0 0; font-size: 0.9rem; line-height: 1.6;">${PICKUP_THANKS}</p>
  </div>`;
}
