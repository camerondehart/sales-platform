/**
 * Match a verified Venmo payment to an unpaid order. No imports, so the unit
 * test can load it on its own. Nothing here marks anything paid: it only
 * suggests, and staff confirm every match.
 *
 *  strong — the note (or email) has the order's #ref, e.g. "#4K9Q2X"
 *  medium — exact amount AND the payer's name matches the customer
 *  weak   — exact amount only: shown in the Venmo inbox, never suggested
 * When the ref's order and the amount disagree it's still strong, but flagged,
 * and bulk "confirm all" skips it.
 */

export type MatchOrder = { id: string; userName: string; total: number; createdAt: number };
export type MatchPayment = { payer: string; amount: number; note: string; text?: string };
export type Match = {
  strength: "strong" | "medium" | "weak" | "none";
  orderId?: string;
  /** Other orders it could be (for the inbox). */
  candidates: string[];
  why: string;
  amountDiffers?: boolean;
};

export const refOf = (orderId: string) => orderId.slice(-6).toUpperCase();

const norm = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z\s'-]/g, " ").replace(/['-]/g, "").split(/\s+/).filter(Boolean);

function lev(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Does the Venmo name look like the customer's? (first + last, or a close spelling) */
export function namesMatch(venmoName: string, customerName: string): boolean {
  const a = norm(venmoName), b = norm(customerName);
  if (!a.length || !b.length) return false;
  if (a.join(" ") === b.join(" ")) return true;
  const [af, al] = [a[0], a[a.length - 1]], [bf, bl] = [b[0], b[b.length - 1]];
  if (a.length > 1 && b.length > 1) {
    if (al === bl && (af === bf || af[0] === bf[0])) return true; // "Sam Lee" ~ "Samantha Lee"
    if (lev(a.join(""), b.join("")) <= 2 && a.join("").length >= 6) return true; // typo
  }
  return false;
}

const sameMoney = (a: number, b: number) => Math.abs(a - b) < 0.005;

/** "#4K9Q2X" anywhere, or a bare 6-character ref in the note itself. */
export function refsIn(p: MatchPayment): string[] {
  const out = new Set<string>();
  const visible = `${p.note}\n${(p.text || "").replace(/https?:\/\/\S+/g, " ")}`;
  for (const m of visible.matchAll(/#\s?([A-Za-z0-9]{6})(?![A-Za-z0-9])/g)) out.add(m[1].toUpperCase());
  for (const m of p.note.matchAll(/(?<![A-Za-z0-9])([A-Za-z0-9]{6})(?![A-Za-z0-9])/g)) out.add(m[1].toUpperCase());
  return Array.from(out);
}

/** `orders` = the orders still waiting for payment. */
export function matchPayment(p: MatchPayment, orders: MatchOrder[]): Match {
  const byRef = new Map(orders.map((o) => [refOf(o.id), o]));
  const refHits = refsIn(p).map((r) => byRef.get(r)).filter((o): o is MatchOrder => !!o);
  if (refHits.length === 1) {
    const o = refHits[0];
    const differs = !sameMoney(o.total, p.amount);
    return {
      strength: "strong",
      orderId: o.id,
      candidates: [],
      why: differs ? `Note has #${refOf(o.id)}, but the order is $${o.total.toFixed(2)} and they paid $${p.amount.toFixed(2)}` : `Note has #${refOf(o.id)} and the amount matches`,
      amountDiffers: differs || undefined,
    };
  }
  const sameAmount = orders.filter((o) => sameMoney(o.total, p.amount));
  const named = sameAmount.filter((o) => namesMatch(p.payer, o.userName));
  if (refHits.length > 1) return { strength: "weak", candidates: refHits.map((o) => o.id), why: "The note mentions more than one order" };
  if (named.length === 1) return { strength: "medium", orderId: named[0].id, candidates: [], why: `Same amount, and ${p.payer} looks like ${named[0].userName}` };
  if (named.length > 1) return { strength: "weak", candidates: named.map((o) => o.id), why: `${named.length} unpaid orders from that name for that amount` };
  if (sameAmount.length) return { strength: "weak", candidates: sameAmount.map((o) => o.id), why: `Only the amount matches (${sameAmount.length} order${sameAmount.length === 1 ? "" : "s"})` };
  return { strength: "none", candidates: [], why: "No unpaid order has this amount or #ref" };
}
