import { escapeHtml, hrefSafe } from "./invoiceEmail";
import { currentRate, termsOf, type Ambassador } from "./ambassadors";
import type { AmbassadorStats } from "./ambassadorStats";
import { brand, TEAM } from "./brand";

/**
 * The progress report emailed to an ambassador: a warm note, how their page
 * did in the period, what they've earned, paid and still owed, their top
 * products and where their trial stands. Never includes customers' names or
 * details — only totals and product names.
 */

export type ReportPeriod = "this-month" | "last-month" | "30-days" | "since-start";
export const REPORT_PERIODS: Record<ReportPeriod, string> = {
  "this-month": "This month so far",
  "last-month": "Last month",
  "30-days": "The last 30 days",
  "since-start": "Since you started",
};

export const DEFAULT_NOTE =
  `Here's a little update on how things are going. Thank you so much for sharing ${brand.shortName} with your community. It means the world to us, and it's been such a joy watching your people find their favorites.`;
export const DEFAULT_SIGNOFF = `With gratitude,\n${TEAM}`;

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const longDay = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });
const GREEN = "#85ba45", DEEP = "#6fa336", INK = "#61676d", SOFT = "#81858b";

function para(text: string): string {
  return text
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 1rem;line-height:1.65;">${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

function tile(label: string, value: string, sub = ""): string {
  return `<td width="50%" style="padding:6px;vertical-align:top;">
    <div style="border:1px solid #e9e9e3;border-radius:12px;padding:14px 16px;background:#fbfbf9;">
      <div style="font-size:0.66rem;letter-spacing:0.16em;text-transform:uppercase;font-weight:700;color:${DEEP};">${label}</div>
      <div style="font-family:'Libre Baskerville',Georgia,serif;font-size:1.55rem;color:#4f5559;margin-top:4px;">${value}</div>
      ${sub ? `<div style="font-size:0.8rem;color:${SOFT};margin-top:2px;">${sub}</div>` : ""}
    </div></td>`;
}

export function buildAmbassadorReport(opts: {
  ambassador: Ambassador;
  period: ReportPeriod;
  periodLabel: string;
  stats: AmbassadorStats;
  siteUrl: string;
  note?: string;
  signoff?: string;
}): { subject: string; html: string } {
  const { ambassador: a, stats: s, siteUrl } = opts;
  const t = termsOf(a);
  const first = escapeHtml(a.name.trim().split(/\s+/)[0] || a.name);
  const rate = currentRate(t);
  const page = `${siteUrl.replace(/\/$/, "")}/${a.slug}`;
  const shownPage = page.replace(/^https?:\/\/(www\.)?/, "");

  const trial =
    s.trial.status === "trial"
      ? `You're on day ${s.trial.day} of your ${s.trial.length}-day trial. We'll review everything together around ${longDay(s.trial.ends!)}.`
      : s.trial.status === "review"
        ? `Your ${s.trial.length}-day trial wrapped up on ${longDay(s.trial.ends!)}. Let's find a time to talk about how it went and what's next.`
        : "";

  const products = s.topProducts.length
    ? `<div style="margin:1.4rem 0 0;">
        <div style="font-size:0.7rem;letter-spacing:0.16em;text-transform:uppercase;font-weight:700;color:${DEEP};margin-bottom:8px;">Your community's favorites</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          ${s.topProducts.map((p) => `<tr><td style="padding:6px 0;border-bottom:1px solid #f0f0ea;">${escapeHtml(p.name)}</td><td align="right" style="padding:6px 0;border-bottom:1px solid #f0f0ea;color:${SOFT};">${p.units} sold</td></tr>`).join("")}
        </table></div>`
    : "";

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;font-family:'Optima','Helvetica Neue',sans-serif;background:#f9f9f8;padding:20px;color:${INK};">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.05);">
    <div style="background:${GREEN};padding:22px 24px;color:#ffffff;">
      <div style="font-size:0.66rem;letter-spacing:0.2em;text-transform:uppercase;opacity:0.9;margin-bottom:4px;">Your ambassador update · ${escapeHtml(opts.periodLabel)}</div>
      <h1 style="margin:0;font-family:'Libre Baskerville',Georgia,serif;font-style:italic;font-weight:400;font-size:1.6rem;">${escapeHtml(brand.name)}</h1>
    </div>
    <div style="padding:26px 24px 8px;">
      <p style="margin:0 0 0.9rem;font-size:1.05rem;">Hi ${first},</p>
      ${para(opts.note?.trim() || DEFAULT_NOTE)}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0.4rem -6px 0;">
        <tr>${tile("Page visits", s.visits.toLocaleString("en-US"), s.qrScans ? `${s.qrScans} from your QR code` : "")}${tile("Orders", String(s.orders), s.units ? `${s.units} item${s.units === 1 ? "" : "s"}` : "")}</tr>
        <tr>${tile("Sales", money(s.sales), s.pendingSales ? `+ ${money(s.pendingSales)} awaiting payment` : "")}${tile("You earned", money(s.earned), s.pending ? `+ ${money(s.pending)} once those are paid` : `${rate}% commission`)}</tr>
      </table>
      <div style="margin:1.2rem 0 0;border:2px solid #d9e6c6;border-radius:14px;padding:16px 18px;background:#f6faef;">
        <div style="font-size:0.7rem;letter-spacing:0.16em;text-transform:uppercase;font-weight:700;color:${DEEP};margin-bottom:8px;">Since you started</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:0.95rem;">
          <tr><td style="padding:3px 0;">Commission earned</td><td align="right" style="padding:3px 0;">${money(s.earnedAllTime)}</td></tr>
          <tr><td style="padding:3px 0;">Paid to you</td><td align="right" style="padding:3px 0;">${money(s.paidOut)}</td></tr>
          <tr><td style="padding:6px 0 0;border-top:1px solid #d9e6c6;"><strong>Coming your way</strong></td><td align="right" style="padding:6px 0 0;border-top:1px solid #d9e6c6;"><strong>${money(s.owed)}</strong></td></tr>
        </table>
        <div style="font-size:0.8rem;color:${SOFT};margin-top:8px;">Commission is ${rate}% of product sales after discounts (shipping not included), counted once an order is paid. Payouts are ${t.payoutSchedule === "on request" ? "made on request" : t.payoutSchedule}.</div>
      </div>
      ${products}
      ${trial ? `<p style="margin:1.4rem 0 0;line-height:1.65;">${escapeHtml(trial)}</p>` : ""}
      ${t.growthOn || !t.growthPct ? "" : t.growthGoal ? `<p style="margin:1rem 0 0;line-height:1.65;">Room to grow: your commission rises to ${t.growthPct}% ${escapeHtml(/^(once|when|after|by)\b/i.test(t.growthGoal) ? t.growthGoal : `once ${t.growthGoal}`)}.</p>` : ""}
      <div style="text-align:center;margin:1.6rem 0 0.4rem;">
        <a href="${hrefSafe(page)}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:${GREEN};color:#ffffff;font-weight:700;font-size:0.8rem;letter-spacing:0.14em;text-transform:uppercase;text-decoration:none;">Visit your page</a>
        <div style="font-size:0.85rem;color:${SOFT};margin-top:8px;">${escapeHtml(shownPage)}${a.discountCode ? ` · your code <strong style="color:${INK};letter-spacing:0.08em;">${escapeHtml(a.discountCode)}</strong>` : ""}</div>
      </div>
      <div style="margin:1.6rem 0 1.2rem;">${para(opts.signoff?.trim() || DEFAULT_SIGNOFF)}</div>
    </div>
    <div style="padding:14px 24px;background:#f3f6ec;font-size:0.75rem;color:${SOFT};text-align:center;line-height:1.5;">
      Questions about your numbers or payouts? Just reply to this email.
    </div>
  </div>
</body></html>`;

  return { subject: `Your ${brand.shortName} update: ${opts.periodLabel}`, html };
}
