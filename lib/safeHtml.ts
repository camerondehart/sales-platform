/**
 * Keep the "basic HTML" staff type into the site banner basic (2026-11-22).
 *
 * The banner shows on every page for every visitor, so whatever reaches it
 * runs for every member. Formatting tags, links and inline styles stay;
 * scripts, frames, forms, event handlers (onclick=…) and javascript: links
 * are dropped. Text is never removed: an unknown tag's text stays, only the
 * tag goes. Pure and browser-safe, so the dashboard preview shows the same.
 */

const KEEP_TAGS = new Set([
  "a", "b", "strong", "i", "em", "u", "s", "small", "mark", "sup", "sub",
  "br", "span", "p", "div", "code",
]);
/** Dropped together with everything inside them. */
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|template|noscript|textarea|select|svg|math)\b[\s\S]*?<\/\1\s*>/gi;
const KEEP_ATTRS = new Set(["href", "target", "rel", "style", "class", "title"]);

/** A link is allowed to go to a web page, an email, a phone number or a page on this site. */
export function safeHref(raw: string): string | null {
  const v = String(raw || "").trim();
  if (!v) return null;
  // Browsers ignore tabs/newlines/control characters inside a scheme ("java\tscript:").
  const squashed = v.replace(/[\u0000- \u007f]+/g, "").toLowerCase();
  if (/^(https?:|mailto:|tel:)/.test(squashed)) return v;
  if (/^[a-z][a-z0-9+.-]*:/.test(squashed)) return null; // javascript:, data:, vbscript:, …
  if (squashed.startsWith("//")) return null; // protocol-relative: another site in disguise
  return v; // /path, #anchor, ?query
}

function safeStyle(raw: string): string | null {
  const v = String(raw || "");
  return /url\s*\(|expression\s*\(|javascript:|@import|behavior\s*:|-moz-binding|[<>]/i.test(v) ? null : v;
}

const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&colon;/gi, ":")
    .replace(/&tab;/gi, "\t")
    .replace(/&newline;/gi, "\n")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function cleanTag(tag: string): string {
  const m = tag.match(/^<\s*(\/)?\s*([a-zA-Z][a-zA-Z0-9]*)([\s\S]*?)(\/)?\s*>$/);
  if (!m) return "";
  const closing = !!m[1];
  const name = m[2].toLowerCase();
  if (!KEEP_TAGS.has(name)) return "";
  if (closing) return name === "br" ? "" : `</${name}>`;
  const attrs: string[] = [];
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let a: RegExpExecArray | null;
  while ((a = re.exec(m[3] || ""))) {
    const key = a[1].toLowerCase();
    if (!KEEP_ATTRS.has(key)) continue;
    const value = decodeEntities(a[2] ?? a[3] ?? a[4] ?? "");
    if (key === "href") {
      if (name !== "a") continue;
      const href = safeHref(value);
      if (href === null) continue;
      attrs.push(`href="${escAttr(href)}"`);
    } else if (key === "style") {
      const style = safeStyle(value);
      if (style !== null) attrs.push(`style="${escAttr(style)}"`);
    } else if (key === "target") {
      if (/^_(blank|self)$/i.test(value)) attrs.push(`target="${value.toLowerCase()}"`);
    } else {
      attrs.push(`${key}="${escAttr(value)}"`);
    }
  }
  if (name === "a" && attrs.some((x) => x === 'target="_blank"') && !attrs.some((x) => x.startsWith("rel="))) attrs.push('rel="noopener noreferrer"');
  return `<${name}${attrs.length ? " " + attrs.join(" ") : ""}>`;
}

/** Banner-safe HTML: same look, nothing that can run. */
export function safeBannerHtml(input: string): string {
  const s = String(input || "")
    .replace(/<!--[\s\S]*?(-->|$)/g, "")
    .replace(DROP_WITH_CONTENT, "");
  let out = "";
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf("<", i);
    if (lt === -1) {
      out += s.slice(i);
      break;
    }
    out += s.slice(i, lt);
    // A real tag starts "<letter" or "</letter"; anything else is a plain "<".
    if (!/^<\/?\s*[a-zA-Z]/.test(s.slice(lt, lt + 3))) {
      out += "&lt;";
      i = lt + 1;
      continue;
    }
    // Find the tag's end, skipping ">" inside quoted attribute values.
    let j = lt + 1;
    let quote = "";
    for (; j < s.length; j++) {
      const c = s[j];
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
    }
    if (j >= s.length) {
      out += s.slice(lt).replace(/</g, "&lt;");
      break;
    }
    out += cleanTag(s.slice(lt, j + 1));
    i = j + 1;
  }
  // Any tag-like text left after the pass (e.g. "<scr<script>ipt>") is shown, not run.
  return out.replace(/<(?!\/?(a|b|strong|i|em|u|s|small|mark|sup|sub|br|span|p|div|code)\b)/gi, "&lt;");
}
