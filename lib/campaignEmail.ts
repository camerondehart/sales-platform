import { escapeHtml, hrefSafe } from "./invoiceEmail";
import { brand } from "@/lib/brand";
import type { Theme } from "./campaignThemes";

// Campaign email template, shared by "Send now" and scheduled sends.
// Moved here unchanged from app/api/admin/campaigns/route.ts.

export const CAMPAIGN_SUPPORT_EMAIL = brand.supportEmail;
const SUPPORT_EMAIL = CAMPAIGN_SUPPORT_EMAIL;

// Does this look like the author wrote real HTML, or did they just type?
function looksLikeHtml(s: string): boolean {
  return /<\s*(p|div|h[1-6]|ul|ol|li|table|img|a|br|strong|em|span|section)\b[^>]*>/i.test(s);
}

// Turn plainly-typed text into a properly formatted email body.
//
// Everything is escaped first, so nothing typed can inject markup. Then a few
// familiar conventions are honoured, which means nobody has to know HTML:
//
//   # Heading              -> a heading
//   - item                 -> a bulleted list
//   **bold**  *italic*     -> emphasis
//   [Shop now](https://…)  -> a green button
//   ![QR code](https://…)  -> an image on its own line (e.g. a product QR code)
//   ![Photo|small](https://…) -> the same, small / medium / large (default)
//   ---                    -> a divider
//   https://…              -> becomes a link automatically
//   blank line             -> new paragraph
// `look` (a campaign theme) recolours headings, links and buttons, and swaps
// the divider line for the theme's little divider artwork.
type Look = { accent: string; onAccent: string; heading: string; divider?: string; full: number };
const PLAIN_LOOK: Look = { accent: "#85ba45", onAccent: "#ffffff", heading: "#61676d", full: 480 };
function formatPlainBody(raw: string, look: Look = PLAIN_LOOK): string {
  const esc = (t: string) =>
    t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // NOTE: esc() already turned every "&" into "&amp;", so URLs matched below
  // are ALREADY href-safe. Do not run hrefSafe() on them — that would double
  // encode into "&amp;amp;" and break the link.
  const inline = (t: string) =>
    esc(t)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        `<a href="$2" style="color:${look === PLAIN_LOOK ? "#6fa336" : look.accent};font-weight:600;">$1</a>`)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
      // Bare URLs, but not ones already inside an href we just built
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g,
        `$1<a href="$2" style="color:${look === PLAIN_LOOK ? "#6fa336" : look.accent};">$2</a>`);

  const blocks = raw.replace(/\r\n/g, "\n").split(/\n{2,}/);
  const out: string[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;

    // Divider
    if (lines.every((l) => /^-{3,}$/.test(l))) {
      out.push(
        look.divider
          ? `<div style="text-align:center;margin:1.4rem 0;"><img src="${hrefSafe(look.divider)}" alt="" width="${look.full}" style="max-width:100%;height:auto;display:inline-block;" /></div>`
          : '<hr style="border:none;border-top:1px solid #e8e5e5;margin:1.5rem 0;" />'
      );
      continue;
    }

    // A lone ![alt](url) on its own line becomes an image (product photos, QR codes)
    if (lines.length === 1) {
      const img = lines[0].match(/^!\[([^\]]*)\]\((https:\/\/[^\s)]+)\)$/);
      if (img) {
        const [alt, size] = img[1].split("|").map((x) => x.trim());
        const isQr = /\/api\/qr\//.test(img[2]) || /qr/i.test(alt);
        const width = isQr ? 180 : size === "small" ? 200 : size === "medium" ? 340 : look.full;
        out.push(
          `<div style="text-align:center;margin:1.25rem 0;"><img src="${hrefSafe(img[2])}" alt="${esc(alt)}" width="${width}" style="max-width:100%;height:auto;border-radius:${isQr ? 0 : 10}px;" /></div>`
        );
        continue;
      }
    }

    // A lone [text](url) on its own line becomes a real button
    if (lines.length === 1) {
      const btn = lines[0].match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      if (btn) {
        out.push(
          `<div style="text-align:center;margin:1.5rem 0;"><a href="${hrefSafe(btn[2])}" style="display:inline-block;background:${look.accent};color:${look.onAccent};padding:0.85rem 1.75rem;border-radius:${look === PLAIN_LOOK ? 6 : 999}px;text-decoration:none;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;font-size:0.8rem;">${esc(btn[1])}</a></div>`
        );
        continue;
      }
    }

    // Bulleted list
    if (lines.every((l) => /^[-*•]\s+/.test(l))) {
      const items = lines
        .map((l) => `<li style="margin:0.35rem 0;">${inline(l.replace(/^[-*•]\s+/, ""))}</li>`)
        .join("");
      out.push(`<ul style="margin:0 0 1rem;padding-left:1.25rem;">${items}</ul>`);
      continue;
    }

    // Heading
    const h = lines[0].match(/^(#{1,3})\s+(.*)$/);
    if (h && lines.length === 1) {
      const size = h[1].length === 1 ? "1.35rem" : h[1].length === 2 ? "1.15rem" : "1rem";
      out.push(
        `<h2 style="font-family:'Libre Baskerville',Georgia,serif;font-weight:400;font-style:italic;font-size:${size};color:${look.heading};margin:1.5rem 0 0.6rem;">${inline(h[2])}</h2>`
      );
      continue;
    }

    // Ordinary paragraph; single newlines inside it become line breaks
    out.push(
      `<p style="margin:0 0 1rem;line-height:1.65;">${lines.map(inline).join("<br/>")}</p>`
    );
  }

  return out.join("\n");
}

// Wrap admin-authored HTML in the house template + unsubscribe footer.
// With a theme (lib/campaignThemes.ts) and its artwork (lib/emailArt.ts) it
// uses the seasonal newsletter layout; without one, the original plain look.
export function wrapCampaign(
  bodyHtml: string,
  unsubUrl: string,
  name?: string,
  opts?: { theme?: Theme | null; art?: { header: string; divider: string } }
): string {
  if (opts?.theme && opts.art) return wrapThemed(bodyHtml, unsubUrl, name, opts.theme, opts.art);
  return `
  <!DOCTYPE html>
  <html><head><meta charset="UTF-8"></head>
  <body style="font-family:'Optima','Helvetica Neue',sans-serif;background:#f9f9f8;padding:20px;color:#61676d;">
    <div style="max-width:560px;margin:0 auto;background:white;border-radius:8px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.05);">
      <div style="background:#85ba45;padding:20px 24px;color:white;">
        <h1 style="margin:0;font-family:'Libre Baskerville',Georgia,serif;font-style:italic;font-weight:400;font-size:1.5rem;">${brand.name}</h1>
      </div>
      <div style="padding:24px;line-height:1.65;">
        ${name ? `<p style="margin:0 0 1rem;">Hi ${escapeHtml(name.split(" ")[0])},</p>` : ""}
        ${looksLikeHtml(bodyHtml) ? bodyHtml : formatPlainBody(bodyHtml)}
      </div>
      <div style="padding:16px 24px;background:#f3f6ec;font-size:0.75rem;color:#81858b;text-align:center;line-height:1.5;">
        Questions? Reply to
        <a href="mailto:${SUPPORT_EMAIL}" style="color:#6fa336;">${SUPPORT_EMAIL}</a>.<br/><br/>
        You're receiving this because you subscribed to updates from ${brand.name}.<br/>
        <a href="${unsubUrl}" style="color:#6fa336;">Unsubscribe</a>
      </div>
    </div>
  </body></html>`;
}


/** The seasonal newsletter: banner artwork, themed colours, divider art, soft footer. Tables for email clients. */
function wrapThemed(bodyHtml: string, unsubUrl: string, name: string | undefined, t: Theme, art: { header: string; divider: string }): string {
  const look: Look = { accent: t.accent, onAccent: t.onAccent, heading: "#3f4549", divider: art.divider, full: 536 };
  const body = looksLikeHtml(bodyHtml) ? bodyHtml : formatPlainBody(bodyHtml, look);
  return `
  <!DOCTYPE html>
  <html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
  <body style="margin:0;padding:0;background:${t.soft};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${t.soft};">
      <tr><td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 2px 10px rgba(40,44,36,0.08);">
          <tr><td style="padding:0;line-height:0;"><img src="${hrefSafe(art.header)}" width="600" alt="" style="display:block;width:100%;max-width:600px;height:auto;border:0;" /></td></tr>
          <tr><td align="center" style="padding:22px 32px 0;font-family:'Helvetica Neue',Arial,sans-serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;font-weight:700;color:${t.kicker};">${escapeHtml(brand.name)}</td></tr>
          <tr><td style="padding:14px 32px 8px;font-family:'Optima','Helvetica Neue',Arial,sans-serif;font-size:16px;line-height:1.65;color:#4f555a;">
            ${name ? `<p style="margin:0 0 1rem;">Hi ${escapeHtml(name.split(" ")[0])},</p>` : ""}
            ${body}
          </td></tr>
          <tr><td align="center" style="padding:8px 32px 0;line-height:0;"><img src="${hrefSafe(art.divider)}" width="536" alt="" style="display:block;width:100%;max-width:536px;height:auto;border:0;" /></td></tr>
          <tr><td align="center" style="padding:18px 32px 26px;font-family:'Helvetica Neue',Arial,sans-serif;font-size:12px;line-height:1.6;color:#81858b;background:#ffffff;">
            Questions? Just reply, or write to <a href="mailto:${SUPPORT_EMAIL}" style="color:${t.accent};">${SUPPORT_EMAIL}</a>.<br/>
            You're receiving this because you subscribed to updates from ${brand.name}.<br/>
            <a href="${unsubUrl}" style="color:${t.accent};">Unsubscribe</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
}

/**
 * Tag links to this site with the campaign id, so visits and sales that come
 * from the email show up against the campaign in Analytics.
 */
export function tagCampaignLinks(html: string, campaignId: string, siteUrl: string): string {
  const hosts = new Set(brand.domains.flatMap((d) => [d, `www.${d.replace(/^www\./, "")}`]));
  try {
    hosts.add(new URL(siteUrl).host);
  } catch {
    /* ignore */
  }
  return html.replace(/href="(https?:\/\/[^"]+)"/g, (m, url: string) => {
    try {
      const u = new URL(url.replace(/&amp;/g, "&"));
      if (!hosts.has(u.host) || u.pathname.startsWith("/unsubscribe")) return m;
      u.searchParams.set("utm_source", "email");
      u.searchParams.set("utm_campaign", campaignId);
      return `href="${u.toString().replace(/&/g, "&amp;")}"`;
    } catch {
      return m;
    }
  });
}
