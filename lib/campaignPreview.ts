/**
 * The inbox preview line of a campaign: the grey text inboxes show after the
 * subject. It's written into the email as hidden text at the very top
 * (lib/campaignEmail.ts), so inboxes show it instead of grabbing "Brand name
 * Hi Bailey, …". Staff can write their own; otherwise it's the
 * first sentence or two of the message. Client-safe (the composer shows it).
 */

export const PREVIEW_LINE_MAX = 150;

function decodeBasic(t: string): string {
  return t
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/gi, "'");
}

function clip(t: string, max = PREVIEW_LINE_MAX): string {
  const s = t.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:–—-]+$/, "")}…`;
}

/** Plain text of one block of the composer's format. */
function plain(block: string): string {
  return block
    .replace(/\[\[PHOTO\]\]/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^-{3,}$/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The automatic preview line: the first paragraph of the message (a heading if that's all there is). */
export function autoPreviewLine(body: string): string {
  const raw = String(body || "");
  if (/<\s*(p|div|h[1-6]|ul|table|img|a|br)\b/i.test(raw)) {
    const text = decodeBasic(raw.replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " "));
    return clip(text);
  }
  const blocks = raw.replace(/\r\n/g, "\n").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const isText = (b: string) => !/^#{1,3}\s/.test(b) && !/^!\[/.test(b) && !/^-{3,}$/.test(b) && !/^\[[^\]]+\]\([^)]+\)$/.test(b) && b !== "[[PHOTO]]";
  const first = blocks.find((b) => isText(b) && plain(b)) ?? blocks.find((b) => plain(b)) ?? "";
  return clip(plain(first));
}

/** What a campaign's preview line will be: the staff's own, or the automatic one. */
export function previewLine(body: string, custom?: string): string {
  const own = String(custom || "").replace(/\s+/g, " ").trim();
  return own ? clip(own) : autoPreviewLine(body);
}
