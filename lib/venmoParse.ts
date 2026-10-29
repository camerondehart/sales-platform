/**
 * Reads a Venmo "<Name> paid you $X" email (raw RFC 822 text, as forwarded by
 * Gmail). No imports, so the unit test can load it on its own.
 *
 * ASSUMPTIONS (until real redacted Venmo emails are added as fixtures):
 *  - The subject is "<Name> paid you $12.34" (Gmail's auto-forward keeps it;
 *    a "Fwd:" prefix is ignored). "You paid …" and requests are not payments.
 *  - The note is the first short line after the "paid you" line in the body.
 *  - A transaction ID appears as "Transaction ID" / "Payment ID" + digits.
 * Anything that doesn't fit comes back with ok: false and is quarantined.
 */

export type ParsedVenmo =
  | { ok: true; payer: string; amount: number; note: string; txnId?: string; sentAt?: number; text: string }
  | { ok: false; error: string };

type Part = { headers: Map<string, string>; body: string };

/** Header block + body; header names lower-cased, folded lines joined. Last value wins except where noted. */
export function splitMessage(raw: string): { headers: Map<string, string>; all: Array<[string, string]>; body: string } {
  const text = raw.replace(/\r\n/g, "\n");
  const cut = text.indexOf("\n\n");
  const head = cut === -1 ? text : text.slice(0, cut);
  const body = cut === -1 ? "" : text.slice(cut + 2);
  const all: Array<[string, string]> = [];
  for (const line of head.split("\n")) {
    if (/^[ \t]/.test(line) && all.length) all[all.length - 1][1] += " " + line.trim();
    else {
      const i = line.indexOf(":");
      if (i > 0) all.push([line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim()]);
    }
  }
  const headers = new Map<string, string>();
  // First occurrence wins (the top-most header is the one mail clients show for most fields).
  for (const [k, v] of all) if (!headers.has(k)) headers.set(k, v);
  return { headers, all, body };
}

function param(value: string, name: string): string | undefined {
  const m = value.match(new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, "i"));
  return m ? (m[1] ?? m[2]) : undefined;
}

function decodeQP(s: string): Uint8Array {
  const soft = s.replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < soft.length; i++) {
    const c = soft[i];
    if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(soft.slice(i + 1, i + 3))) {
      out.push(parseInt(soft.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      const code = soft.charCodeAt(i);
      if (code < 128) out.push(code);
      else out.push(...Array.from(new TextEncoder().encode(c)));
    }
  }
  return new Uint8Array(out);
}

function decodeB64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/=]/g, "");
  const bin = typeof atob === "function" ? atob(clean) : Buffer.from(clean, "base64").toString("binary");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toText(bytes: Uint8Array, charset?: string): string {
  try {
    return new TextDecoder((charset || "utf-8").toLowerCase()).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function decodeBody(body: string, headers: Map<string, string>): string {
  const enc = (headers.get("content-transfer-encoding") || "").toLowerCase();
  const charset = param(headers.get("content-type") || "", "charset");
  if (enc === "base64") return toText(decodeB64(body), charset);
  if (enc === "quoted-printable") return toText(decodeQP(body), charset);
  return body;
}

/** Leaf parts of a (possibly nested) MIME message. */
export function mimeParts(raw: string, depth = 0): Part[] {
  const { headers, body } = splitMessage(raw);
  const type = (headers.get("content-type") || "text/plain").toLowerCase();
  if (type.startsWith("multipart/") && depth < 6) {
    const boundary = param(headers.get("content-type") || "", "boundary");
    if (!boundary) return [];
    const chunks = body.replace(/\r\n/g, "\n").split(`--${boundary}`);
    return chunks
      .slice(1)
      .filter((c) => !c.startsWith("--"))
      .flatMap((c) => mimeParts(c.replace(/^\n/, ""), depth + 1));
  }
  if (type.startsWith("message/rfc822") && depth < 6) return mimeParts(decodeBody(body, headers), depth + 1);
  return [{ headers, body: decodeBody(body, headers) }];
}

/** Decode =?utf-8?Q?…?= / =?utf-8?B?…?= words in a header. */
export function decodeWords(s: string): string {
  // Whitespace between two encoded words isn't part of the text.
  return s.replace(/(=\?[^?]+\?[bqBQ]\?[^?]*\?=)\s+(?==\?)/g, "$1").replace(/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g, (_m, cs: string, e: string, data: string) =>
    e.toUpperCase() === "B" ? toText(decodeB64(data), cs) : toText(decodeQP(data.replace(/_/g, " ")), cs)
  );
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|td|th|h[1-6]|li|table|section)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** The readable text of a message: text/plain if present, else the HTML part as text. */
export function messageText(raw: string): string {
  const parts = mimeParts(raw);
  const plain = parts.find((p) => (p.headers.get("content-type") || "text/plain").toLowerCase().startsWith("text/plain"));
  if (plain && plain.body.trim()) return plain.body.replace(/\r\n/g, "\n").trim();
  const html = parts.find((p) => (p.headers.get("content-type") || "").toLowerCase().startsWith("text/html"));
  return html ? htmlToText(html.body) : "";
}

/** "a@b.com" from "Name <a@b.com>". */
export function addressOf(v: string): string {
  const m = v.match(/<([^>]+)>/);
  return (m ? m[1] : v).trim().toLowerCase();
}

const PAID = /^(?:(?:fwd?|fw):\s*)*(.{1,80}?) paid you \$([\d,]+(?:\.\d{1,2})?)\s*$/i;

export function parseVenmo(raw: string): ParsedVenmo {
  const { headers } = splitMessage(raw);
  const subject = decodeWords(headers.get("subject") || "").replace(/\s+/g, " ").trim();
  const text = messageText(raw);
  let m = subject.match(PAID);
  if (!m) {
    // Some formats put it only in the body.
    const line = text.split("\n").find((l) => / paid you \$/i.test(l));
    m = line ? line.trim().match(PAID) : null;
  }
  if (!m) return { ok: false, error: /^you paid|request/i.test(subject) ? "Not an incoming payment." : "Doesn't look like a “paid you” email." };
  const payer = m[1].replace(/^["']|["']$/g, "").trim();
  const amount = Math.round(Number(m[2].replace(/,/g, "")) * 100) / 100;
  if (!payer || !(amount > 0) || amount > 100000) return { ok: false, error: "Couldn't read the payer or the amount." };

  // Note: the first short line after the "paid you" line that isn't the amount or boilerplate.
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const at = lines.findIndex((l) => / paid you/i.test(l));
  let note = "";
  for (const l of lines.slice(at === -1 ? 0 : at + 1, (at === -1 ? 0 : at + 1) + 6)) {
    if (/^[-+]?\s*\$\s*[\d,]+(\.\d{1,2})?$/.test(l)) continue;
    if (/^(transaction|payment) id|^date|^see transaction|^view|^like|^comment|^venmo|^privacy|^this|^\w+ \d{1,2}, \d{4}/i.test(l)) break;
    if (l.length > 280) break;
    note = l;
    break;
  }
  const txn = text.match(/(?:transaction|payment)\s*id[:#\s]*([0-9]{8,30})/i);
  const date = Date.parse(headers.get("date") || "");
  return { ok: true, payer, amount, note, txnId: txn?.[1], sentAt: Number.isFinite(date) ? date : undefined, text: text.slice(0, 6000) };
}
