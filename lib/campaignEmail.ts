import { escapeHtml, hrefSafe } from "./invoiceEmail";
import { brand } from "@/lib/brand";

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
//   ---                    -> a divider
//   https://…              -> becomes a link automatically
//   blank line             -> new paragraph
function formatPlainBody(raw: string): string {
  const esc = (t: string) =>
    t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // NOTE: esc() already turned every "&" into "&amp;", so URLs matched below
  // are ALREADY href-safe. Do not run hrefSafe() on them — that would double
  // encode into "&amp;amp;" and break the link.
  const inline = (t: string) =>
    esc(t)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" style="color:#6fa336;font-weight:600;">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
      // Bare URLs, but not ones already inside an href we just built
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g,
        '$1<a href="$2" style="color:#6fa336;">$2</a>');

  const blocks = raw.replace(/\r\n/g, "\n").split(/\n{2,}/);
  const out: string[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;

    // Divider
    if (lines.every((l) => /^-{3,}$/.test(l))) {
      out.push('<hr style="border:none;border-top:1px solid #e8e5e5;margin:1.5rem 0;" />');
      continue;
    }

    // A lone ![alt](url) on its own line becomes an image (product photos, QR codes)
    if (lines.length === 1) {
      const img = lines[0].match(/^!\[([^\]]*)\]\((https:\/\/[^\s)]+)\)$/);
      if (img) {
        const isQr = /\/api\/qr\//.test(img[2]) || /qr/i.test(img[1]);
        out.push(
          `<div style="text-align:center;margin:1.25rem 0;"><img src="${hrefSafe(img[2])}" alt="${esc(img[1])}" width="${isQr ? 180 : 480}" style="max-width:100%;height:auto;border-radius:${isQr ? 0 : 8}px;" /></div>`
        );
        continue;
      }
    }

    // A lone [text](url) on its own line becomes a real button
    if (lines.length === 1) {
      const btn = lines[0].match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      if (btn) {
        out.push(
          `<div style="text-align:center;margin:1.5rem 0;"><a href="${hrefSafe(btn[2])}" style="display:inline-block;background:#85ba45;color:#ffffff;padding:0.85rem 1.75rem;border-radius:6px;text-decoration:none;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;font-size:0.8rem;">${esc(btn[1])}</a></div>`
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
        `<h2 style="font-family:'Libre Baskerville',Georgia,serif;font-weight:400;font-style:italic;font-size:${size};color:#61676d;margin:1.5rem 0 0.6rem;">${inline(h[2])}</h2>`
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
export function wrapCampaign(bodyHtml: string, unsubUrl: string, name?: string): string {
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
