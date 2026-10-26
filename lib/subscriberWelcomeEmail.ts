import { Resend } from "resend";
import { escapeHtml } from "@/lib/invoiceEmail";
import type { LiveOffer } from "@/lib/eventOffers";
import { customerReplyTo } from "@/lib/replyTo";
import { brand } from "@/lib/brand";

const fmtDate = (t: number) => new Date(t).toLocaleDateString("en-US", { timeZone: brand.timezone, month: "long", day: "numeric", year: "numeric" });

// The email a brand-new mailing-list subscriber gets, e.g. after scanning the
// QR code at an event. It's a soft funnel: browse the shop, learn about the
// members area, see what's coming up. Never blocks the sign-up itself.

const SUPPORT_EMAIL = brand.supportEmail;

function btn(href: string, label: string, primary = true): string {
  const bg = primary ? "#85ba45" : "#ffffff";
  const fg = primary ? "#ffffff" : "#6fa336";
  const border = primary ? "#85ba45" : "#85ba45";
  return `<a href="${href}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:${bg};color:${fg};border:1.5px solid ${border};font-weight:700;font-size:0.8rem;letter-spacing:0.14em;text-transform:uppercase;text-decoration:none;">${label}</a>`;
}

function block(icon: string, title: string, text: string, cta: string): string {
  return `
    <tr><td style="padding:0 0 14px;">
      <div style="border:1px solid #e9e9e3;border-radius:12px;padding:18px 20px;background:#fbfbf9;">
        <div style="font-size:1.4rem;line-height:1;margin-bottom:8px;">${icon}</div>
        <div style="font-size:0.7rem;letter-spacing:0.16em;text-transform:uppercase;font-weight:700;color:#6fa336;margin-bottom:6px;">${title}</div>
        <p style="margin:0 0 12px;line-height:1.6;color:#61676d;">${text}</p>
        ${cta}
      </div>
    </td></tr>`;
}

/** The event's welcome gift: the code, big, with its small print. */
function offerBlock(o: LiveOffer, siteUrl: string): string {
  const terms = [
    o.oncePerPerson ? "One use per person" : "",
    o.minOrderAmount ? `on orders of $${o.minOrderAmount.toFixed(2)}+` : "",
    o.expiresAt ? `use by ${escapeHtml(fmtDate(o.expiresAt))}` : "",
  ].filter(Boolean).join(" · ");
  return `
      <div style="border:2px dashed #85ba45;border-radius:14px;padding:20px 20px 22px;margin:0 0 1.4rem;text-align:center;background:#f6faef;">
        <div style="font-size:0.7rem;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;color:#6fa336;margin-bottom:6px;">Your welcome gift</div>
        <div style="font-family:'Libre Baskerville',Georgia,serif;font-style:italic;font-size:1.5rem;color:#4f5559;margin-bottom:10px;">${escapeHtml(o.text)} your order</div>
        <div style="display:inline-block;font-family:Consolas,monospace;font-size:1.5rem;letter-spacing:0.18em;color:#4f5559;background:#ffffff;border:1px solid #d9e6c6;border-radius:8px;padding:10px 18px;margin-bottom:10px;">${escapeHtml(o.code)}</div>
        <div style="font-size:0.85rem;color:#81858b;margin-bottom:14px;">Enter it at checkout${terms ? ` · ${terms}` : ""}.</div>
        ${btn(`${siteUrl}/retail`, "Shop now")}
      </div>`;
}

export function subscriberWelcomeHtml(opts: {
  name?: string;
  siteUrl: string;
  unsubUrl: string;
  event?: string;
  offer?: LiveOffer | null;
}): string {
  const { name, siteUrl, unsubUrl, event, offer } = opts;
  const first = name ? escapeHtml(name.trim().split(/\s+/)[0]) : "";
  const where = event ? ` at ${escapeHtml(event)}` : "";

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;font-family:'Optima','Helvetica Neue',sans-serif;background:#f9f9f8;padding:20px;color:#61676d;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.05);">
    <div style="background:#85ba45;padding:22px 24px;color:#ffffff;">
      <div style="font-size:0.66rem;letter-spacing:0.2em;text-transform:uppercase;opacity:0.85;margin-bottom:4px;">Welcome to the list</div>
      <h1 style="margin:0;font-family:'Libre Baskerville',Georgia,serif;font-style:italic;font-weight:400;font-size:1.6rem;">${brand.name}</h1>
    </div>
    <div style="padding:26px 24px 10px;line-height:1.65;">
      <p style="margin:0 0 0.9rem;font-size:1.05rem;">${first ? `Hi ${first},` : "Hello,"}</p>
      <p style="margin:0 0 1.2rem;">Lovely to meet you${where}. You're on the list now — expect new batches, class dates and the occasional note from us, a few times a month at most.</p>
      ${offer ? offerBlock(offer, siteUrl) : ""}
      <p style="margin:0 0 1.4rem;">While you're here, three places to start:</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        ${block(brand.emoji, "The shop", `${brand.productsPhrase[0].toUpperCase()}${brand.productsPhrase.slice(1)}. Open to everyone, no account needed.`, btn(`${siteUrl}/retail`, "Browse the shop"))}
        ${block("🌿", brand.members, "Our members-only side: a private catalog, early access to events, and loyalty points on every order. Approval usually takes under a day.", btn(`${siteUrl}/`, "Explore membership", false))}
        ${block("📅", "Classes &amp; events", "Workshops, classes and pop-ups. Members hear first, but many are open to all.", `<a href="${siteUrl}/events" style="color:#6fa336;font-weight:700;text-decoration:none;">See what's coming up →</a>`)}
      </table>
      <p style="margin:1.2rem 0 0.4rem;font-size:0.95rem;">Curious about who we are? <a href="${siteUrl}/about" style="color:#6fa336;">Read our story.</a></p>
    </div>
    <div style="padding:16px 24px;background:#f3f6ec;font-size:0.75rem;color:#81858b;text-align:center;line-height:1.5;">
      Questions? Reply to <a href="mailto:${SUPPORT_EMAIL}" style="color:#6fa336;">${SUPPORT_EMAIL}</a>.<br/><br/>
      You're receiving this because you joined the ${brand.name} mailing list${where}.<br/>
      <a href="${unsubUrl}" style="color:#6fa336;">Unsubscribe</a>
    </div>
  </div>
</body></html>`;
}

/** Fire-and-report. Returns true on success; never throws. */
export async function sendSubscriberWelcome(opts: {
  email: string;
  name?: string;
  event?: string;
  unsubscribeToken: string;
  siteUrl: string;
  offer?: LiveOffer | null;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev";
  const replyTo = customerReplyTo(); // support@ (CUSTOMER_REPLY_TO), like every customer email
  if (!apiKey) return false;

  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from: fromEmail,
      to: opts.email,
      reply_to: replyTo,
      subject: opts.offer ? `Welcome to ${brand.name} — here's ${opts.offer.text} ${brand.emoji}` : `Welcome to ${brand.name} ${brand.emoji}`,
      html: subscriberWelcomeHtml({
        name: opts.name,
        event: opts.event,
        offer: opts.offer,
        siteUrl: opts.siteUrl,
        unsubUrl: `${opts.siteUrl}/unsubscribe?token=${opts.unsubscribeToken}`,
      }),
    });
    if (result.error) {
      console.error("Subscriber welcome email rejected:", result.error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Subscriber welcome email failed:", err);
    return false;
  }
}
