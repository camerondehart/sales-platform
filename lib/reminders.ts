import path from "path";
import { Resend } from "resend";
import { VersionedStore } from "./versionedStore";
import { getOrders, updateOrder, type Order } from "./orders";
import { escapeHtml, itemsTable } from "./invoiceEmail";
import { flagOnSince, isEnabled } from "./flags";

/**
 * Automatic payment reminders for unpaid invoices.
 *
 *   24 h → 48 h → 1 week → 2 weeks → (a week later) Expired
 *
 * Rules that keep it safe:
 *  - Invoice orders only: status "pending", not cash-at-pickup, not inquiries,
 *    not switched off for that order, and placed AFTER the feature was turned
 *    on (so switching it on never emails a backlog of old invoices).
 *  - Never twice: before sending, the (order, stage) pair is claimed in a
 *    race-safe ledger; a second run — or two runs at once — sees the claim and
 *    skips. A crash after claiming means a reminder is skipped, never doubled.
 *  - Catch-up sends only the latest due stage (no bursts after downtime).
 *  - Amounts are read from the order and never changed. "Expired" doesn't
 *    cancel anything — the order stays pending and can be revived.
 */

export type Stage = { afterHours: number; subject: string; message: string };
export type ReminderSettings = {
  id: "settings";
  stages: Stage[];
  /** Hours after the order was placed when it moves to Expired. */
  expireAfterHours: number;
  updatedAt: number;
};

export const DEFAULT_REMINDERS: ReminderSettings = {
  id: "settings",
  stages: [
    { afterHours: 24, subject: "A friendly reminder about your order {ref}", message: "Just a friendly reminder that your order {ref} ({total}) is waiting for payment. The button below shows the order and how to pay — once you've paid, tap \"I've sent my payment\" and we'll get it ready." },
    { afterHours: 48, subject: "Your order {ref} is still waiting", message: "We're holding your order {ref} ({total}) for you. Whenever you're ready, the button below has everything you need to pay. Any questions, just reply to this email." },
    { afterHours: 168, subject: "Still interested in your order {ref}?", message: "It's been a week since you placed order {ref} ({total}). If you'd still like it, you can pay using the button below. If plans changed, no problem — just reply and let us know." },
    { afterHours: 336, subject: "Last reminder about order {ref}", message: "This is our last reminder about order {ref} ({total}). If we don't hear from you, we'll release it in a week. You can still pay using the button below, or reply if you have any questions." },
  ],
  expireAfterHours: 504,
  updatedAt: 0,
};

const settingsStore = new VersionedStore<ReminderSettings>({
  name: "reminder-settings",
  legacyKey: "reminder-settings.json",
  localFile: path.join(process.cwd(), "data", "reminder-settings.json"),
  keep: 6,
  reconcileLegacy: false,
});

type Claim = { id: string; orderId: string; stage: number; at: number; ok?: boolean };
const ledger = new VersionedStore<Claim>({
  name: "reminder-ledger",
  legacyKey: "reminder-ledger.json",
  localFile: path.join(process.cwd(), "data", "reminder-ledger.json"),
  keep: 6,
  reconcileLegacy: false,
});

export async function getReminderSettings(): Promise<ReminderSettings> {
  try {
    const row = (await settingsStore.read()).data.find((r) => r.id === "settings");
    return row ? { ...DEFAULT_REMINDERS, ...row } : DEFAULT_REMINDERS;
  } catch {
    return DEFAULT_REMINDERS;
  }
}

export function cleanReminderSettings(input: unknown): { ok: true; value: ReminderSettings } | { ok: false; error: string } {
  const b = (input || {}) as Partial<ReminderSettings>;
  if (!Array.isArray(b.stages) || b.stages.length < 1 || b.stages.length > 6) return { ok: false, error: "Between 1 and 6 reminders." };
  const stages: Stage[] = [];
  let prev = 0;
  for (const s of b.stages) {
    const h = Math.round(Number(s.afterHours));
    if (!Number.isFinite(h) || h < 1 || h > 24 * 90) return { ok: false, error: "Each reminder needs a time between 1 hour and 90 days." };
    if (h <= prev) return { ok: false, error: "Each reminder has to come after the one before." };
    const subject = String(s.subject || "").trim().slice(0, 150);
    const message = String(s.message || "").trim().slice(0, 3000);
    if (!subject || !message) return { ok: false, error: "Every reminder needs a subject and a message." };
    stages.push({ afterHours: h, subject, message });
    prev = h;
  }
  const expire = Math.round(Number(b.expireAfterHours));
  if (!Number.isFinite(expire) || expire <= prev) return { ok: false, error: "Expire has to come after the last reminder." };
  return { ok: true, value: { id: "settings", stages, expireAfterHours: expire, updatedAt: Date.now() } };
}

export async function saveReminderSettings(v: ReminderSettings) {
  await settingsStore.mutate(() => ({ data: [v], result: undefined }), { allowShrink: true });
}

export function eligible(o: Order, since: number): boolean {
  return (
    o.status === "pending" &&
    !o.isInquiry &&
    o.paymentMethod !== "cash" &&
    !o.remindersOff &&
    !o.expiredAt &&
    !!o.paymentToken &&
    o.createdAt >= since
  );
}

const fill = (t: string, o: Order) =>
  t
    .replace(/\{ref\}/g, o.id.slice(-6).toUpperCase())
    .replace(/\{total\}/g, `$${o.total.toFixed(2)}`)
    .replace(/\{name\}/g, o.userName.split(/\s+/)[0] || "there");

function reminderHtml(o: Order, message: string, payLink: string): string {
  const ref = o.id.slice(-6).toUpperCase();
  return `
  <div style="font-family:'Optima',Candara,'Helvetica Neue',sans-serif;max-width:560px;margin:0 auto;padding:2rem;color:#61676d;background:#f9f9f8;">
    <div style="font-size:0.7rem;letter-spacing:0.18em;text-transform:uppercase;color:#85ba45;font-weight:700;margin-bottom:1rem;">Order ${ref}</div>
    <h1 style="font-family:'Libre Baskerville',Georgia,serif;font-size:1.4rem;font-weight:400;font-style:italic;margin:0 0 1.2rem;">Hello, ${escapeHtml(o.userName.split(/\s+/)[0] || "there")}</h1>
    <div style="white-space:pre-wrap;line-height:1.6;background:white;padding:1.1rem 1.25rem;border-radius:6px;border-left:3px solid #85ba45;">${escapeHtml(fill(message, o))}</div>
    <div style="margin:1.4rem 0;">${itemsTable(o)}</div>
    <div style="text-align:center;margin-top:1.2rem;">
      <a href="${payLink}" style="display:inline-block;background:#85ba45;color:white;padding:0.85rem 1.6rem;border-radius:6px;text-decoration:none;font-weight:700;">View &amp; pay — $${o.total.toFixed(2)}</a>
    </div>
    <div style="margin-top:1.5rem;font-size:0.8rem;color:#81858b;">Already paid? Thank you — tap the button and choose "I've sent my payment" so we know. Questions? Just reply to this email.</div>
  </div>`;
}

/** Claim (order, stage) in the ledger. True if we got it (nobody sent it before). */
async function claim(orderId: string, stage: number): Promise<boolean> {
  const id = `${orderId}:${stage}`;
  return ledger.mutate((rows) => {
    if (rows.some((r) => r.id === id)) return { data: null, result: false };
    const cutoff = Date.now() - 120 * 86_400_000;
    return { data: [...rows.filter((r) => r.at >= cutoff), { id, orderId, stage, at: Date.now() }], result: true };
  }, { allowShrink: true });
}

export type RunResult = { checked: number; sent: number; failed: number; expired: number; skipped: string[] };

/** One pass over unpaid orders. Safe to run as often as you like. */
export async function runReminders(siteUrl: string, opts: { now?: number; force?: boolean } = {}): Promise<RunResult> {
  const out: RunResult = { checked: 0, sent: 0, failed: 0, expired: 0, skipped: [] };
  if (!opts.force && !(await isEnabled("invoice_reminders"))) return out;
  const since = (await flagOnSince("invoice_reminders")) ?? (opts.force ? 0 : Infinity);
  if (since === Infinity) return out;
  const now = opts.now ?? Date.now();
  const cfg = await getReminderSettings();
  const apiKey = process.env.RESEND_API_KEY;
  const orders = (await getOrders()).filter((o) => eligible(o, since));
  out.checked = orders.length;

  for (const o of orders) {
    const ageH = (now - o.createdAt) / 3_600_000;
    const done = new Set((o.reminders || []).map((r) => r.stage));

    // Expire once the window has passed and the final reminder went out (or was due).
    if (ageH >= cfg.expireAfterHours) {
      await updateOrder(o.id, { expiredAt: now });
      out.expired += 1;
      continue;
    }

    let due = -1;
    cfg.stages.forEach((s, i) => {
      if (ageH >= s.afterHours) due = i;
    });
    if (due < 0 || done.has(due)) continue;

    if (!(await claim(o.id, due))) {
      out.skipped.push(`${o.id}:${due} already claimed`);
      continue;
    }
    let ok = false;
    if (apiKey) {
      try {
        const stage = cfg.stages[due];
        const r = await new Resend(apiKey).emails.send({
          from: process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev",
          to: o.userEmail,
          reply_to: process.env.INQUIRY_TO_EMAIL || undefined,
          subject: fill(stage.subject, o),
          html: reminderHtml(o, stage.message, `${siteUrl}/pay/${o.paymentToken}`),
        });
        ok = !r.error;
        if (r.error) console.error("[reminders] rejected", o.id, r.error);
      } catch (err) {
        console.error("[reminders] send failed", o.id, err);
      }
    }
    // Record every stage up to this one (earlier missed stages are skipped on purpose).
    const reminders = [...(o.reminders || [])];
    for (let i = 0; i <= due; i++) if (!done.has(i)) reminders.push({ stage: i, at: now, ok: i === due ? ok : false });
    await updateOrder(o.id, { reminders });
    if (ok) out.sent += 1;
    else out.failed += 1;
  }
  return out;
}

/**
 * Bring an expired order back to the normal unpaid list. Automatic reminders
 * stay off for it from then on (otherwise it would simply expire again).
 */
export async function reviveOrder(orderId: string): Promise<Order | null> {
  return updateOrder(orderId, { expiredAt: undefined, remindersOff: true });
}

/**
 * Staff move an unpaid order to Expired by hand (e.g. "they've gone quiet").
 * Same as the automatic move: still Pending payment, nothing cancelled, the
 * pay link keeps working, and no more automatic reminders go to it.
 */
export async function expireOrder(orderId: string): Promise<Order | null> {
  return updateOrder(orderId, { expiredAt: Date.now() });
}
