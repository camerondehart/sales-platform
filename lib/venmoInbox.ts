import path from "path";
import crypto from "crypto";
import { promises as fs } from "fs";
import { VersionedStore } from "./versionedStore";
import { getOrders, normalizeStatus, type Order } from "./orders";
import { parseVenmo, splitMessage, addressOf, decodeWords, messageText } from "./venmoParse";
import { verifyVenmo } from "./venmoVerify";
import { matchPayment, type Match } from "./venmoMatch";

/**
 * Venmo inbox: Venmo's "paid you" emails, forwarded from the owner's Gmail to
 * the site's Resend inbound address. Each one is checked (lib/venmoVerify.ts),
 * read (lib/venmoParse.ts) and saved with its raw message. Matches to unpaid
 * orders are worked out fresh every time they're shown (lib/venmoMatch.ts),
 * and only staff ever mark anything paid.
 */

export type VenmoPayment = {
  id: string;
  receivedAt: number;
  subject: string;
  /** Passed every check: the only ones that can be matched. */
  verified: boolean;
  /** Why it's quarantined (when not verified). */
  reason?: string;
  payer?: string;
  amount?: number;
  note?: string;
  txnId?: string;
  sentAt?: number;
  /** The visible text, for #ref search and staff to read (trimmed). */
  text?: string;
  rawUrl?: string;
  state: "new" | "confirmed" | "rejected" | "dismissed";
  /** Order it was confirmed against, or the one staff said it isn't. */
  orderId?: string;
  /** Orders staff said "not a match" to. */
  notOrders?: string[];
  decidedAt?: number;
  decidedBy?: string;
};

/** Gmail's forwarding confirmation (and anything else from Google), shown in Venmo → Setup. */
export type SetupMessage = { id: string; receivedAt: number; from: string; subject: string; text: string };

const payments = new VersionedStore<VenmoPayment>({
  name: "venmo-payments",
  legacyKey: "venmo-payments.json",
  localFile: path.join(process.cwd(), "data", "venmo-payments.json"),
  keep: 8,
  reconcileLegacy: false,
});
const setup = new VersionedStore<SetupMessage>({
  name: "inbound-setup",
  legacyKey: "inbound-setup.json",
  localFile: path.join(process.cwd(), "data", "inbound-setup.json"),
  keep: 4,
  reconcileLegacy: false,
});

const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

async function saveRaw(id: string, raw: string): Promise<string | undefined> {
  try {
    if (useBlob) {
      const { put } = await import("@vercel/blob");
      // Random suffix: the address can't be guessed.
      const b = await put(`venmo-raw/${id}.eml`, raw, { access: "public", contentType: "message/rfc822", addRandomSuffix: true });
      return b.url;
    }
    const file = path.join(process.cwd(), "data", "venmo-raw", `${id}.eml`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, raw, "utf8");
    return `local:${id}.eml`;
  } catch (err) {
    console.error("[venmo] couldn't store the raw message", err);
    return undefined;
  }
}

/**
 * Take one inbound message. Idempotent: the same Venmo transaction (or the
 * same message, byte for byte) is only ever stored once.
 */
export async function ingest(raw: string): Promise<{ kind: "venmo" | "setup" | "ignored" | "duplicate"; id?: string; verified?: boolean; reason?: string }> {
  const { headers } = splitMessage(raw);
  const from = addressOf(decodeWords(headers.get("from") || ""));
  const subject = decodeWords(headers.get("subject") || "").replace(/\s+/g, " ").trim().slice(0, 200);
  const hash = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 24);

  // Gmail's "please confirm forwarding" message (has the code staff need).
  if (from.endsWith("@google.com")) {
    const row: SetupMessage = { id: `g_${hash}`, receivedAt: Date.now(), from, subject, text: messageText(raw).slice(0, 3000) };
    await setup.mutate((rows) => (rows.some((r) => r.id === row.id) ? { data: null, result: null } : { data: [...rows, row].slice(-10), result: null }));
    return { kind: "setup", id: row.id };
  }

  const parsed = parseVenmo(raw);
  const looksVenmo = /venmo/i.test(from) || / paid you \$/i.test(subject);
  if (!looksVenmo) return { kind: "ignored", reason: "Not a Venmo email." };

  const verdict = await verifyVenmo(raw);
  const verified = verdict.ok && parsed.ok;
  const reason = !verdict.ok ? verdict.reason : !parsed.ok ? parsed.error : undefined;
  // Real Venmo transaction ID when we trust it; otherwise the message hash.
  const id = verified && parsed.ok && parsed.txnId ? `vt_${parsed.txnId}` : `vm_${hash}`;

  const existing = (await payments.read()).data.find((r) => r.id === id);
  if (existing) return { kind: "duplicate", id };
  const rawUrl = await saveRaw(id, raw);
  const row: VenmoPayment = {
    id,
    receivedAt: Date.now(),
    subject,
    verified,
    reason,
    ...(parsed.ok ? { payer: parsed.payer, amount: parsed.amount, note: parsed.note.slice(0, 300), txnId: parsed.txnId, sentAt: parsed.sentAt, text: parsed.text.slice(0, 4000) } : {}),
    rawUrl,
    state: "new",
  };
  const added = await payments.mutate((rows) => {
    if (rows.some((r) => r.id === id)) return { data: null, result: false };
    // Keep the newest 1000 (raw messages stay in storage).
    return { data: [...rows, row].slice(-1000), result: true };
  });
  return added ? { kind: "venmo", id, verified, reason } : { kind: "duplicate", id };
}

export const awaitingPayment = (orders: Order[]) =>
  orders.filter((o) => !o.isInquiry && normalizeStatus(o.status) === "pending" && !o.paidAt);

export type InboxRow = VenmoPayment & { match?: Match };

/** Every payment, newest first, with a fresh match for the ones still to sort out. */
export async function inbox(): Promise<{ rows: InboxRow[]; orders: Order[]; setup: SetupMessage[] }> {
  const [rows, orders, setupRows] = await Promise.all([payments.read().then((s) => s.data), getOrders(), setup.read().then((s) => s.data).catch(() => [])]);
  const open = awaitingPayment(orders);
  const out = rows
    .slice()
    .sort((a, b) => b.receivedAt - a.receivedAt)
    .map((r): InboxRow => {
      if (!r.verified || r.state !== "new" || r.amount === undefined) return r;
      const pool = open.filter((o) => !(r.notOrders || []).includes(o.id));
      return { ...r, match: matchPayment({ payer: r.payer || "", amount: r.amount, note: r.note || "", text: r.text }, pool) };
    });
  return { rows: out, orders: open, setup: setupRows.slice().sort((a, b) => b.receivedAt - a.receivedAt) };
}

/** Suggestions (strong or medium) for the Today list and the Concierge. */
export async function suggestions(): Promise<Array<{ payment: InboxRow; order: Order }>> {
  const { rows, orders } = await inbox();
  const byId = new Map(orders.map((o) => [o.id, o]));
  return rows
    .filter((r) => r.match && (r.match.strength === "strong" || r.match.strength === "medium") && r.match.orderId && byId.has(r.match.orderId))
    .map((r) => ({ payment: r, order: byId.get(r.match!.orderId!)! }));
}

export async function getPayment(id: string): Promise<VenmoPayment | undefined> {
  return (await payments.read()).data.find((r) => r.id === id);
}

/** Record a staff decision. Returns false if it was already decided (or quarantined, for confirm). */
export async function decide(
  id: string,
  change: { state: "confirmed"; orderId: string } | { state: "rejected"; orderId?: string } | { state: "dismissed" },
  by: string
): Promise<{ ok: true; payment: VenmoPayment } | { ok: false; error: string }> {
  type R = { ok: true; payment: VenmoPayment } | { ok: false; error: string };
  return payments.mutate<R>((rows) => {
    const i = rows.findIndex((r) => r.id === id);
    if (i === -1) return { data: null, result: { ok: false as const, error: "That payment isn't in the inbox." } };
    const r = rows[i];
    if (change.state === "confirmed" && !r.verified) return { data: null, result: { ok: false as const, error: "Quarantined payments can't be matched." } };
    if (r.state !== "new") return { data: null, result: { ok: false as const, error: `Already ${r.state}.` } };
    let next: VenmoPayment;
    if (change.state === "rejected") {
      // "Not a match": stays in the inbox for a person to assign, minus that order.
      next = { ...r, notOrders: Array.from(new Set([...(r.notOrders || []), ...(change.orderId ? [change.orderId] : [])])), decidedAt: Date.now(), decidedBy: by };
    } else {
      next = { ...r, state: change.state, ...(change.state === "confirmed" ? { orderId: change.orderId } : {}), decidedAt: Date.now(), decidedBy: by };
    }
    const out = rows.slice();
    out[i] = next;
    return { data: out, result: { ok: true as const, payment: next } };
  });
}
