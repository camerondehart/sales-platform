import path from "path";
import { pacificDay } from "../periods";
import { VersionedStore } from "../versionedStore";
import type { Audience } from "./shared";
import { singleton } from "./singleton";

/**
 * Usage accounting for the assistant.
 *
 * Each chat turn is added to an in-memory tally and flushed to Blob at most
 * every 30 seconds, not per message. A write per message would cost several
 * Blob operations and add latency to every reply; batching keeps both low.
 * (The site is on Vercel Pro, where Blob operations are billed per use.)
 *
 * The trade-off: if a server instance is recycled between flushes, a few
 * messages' worth of usage can go uncounted. Stats are therefore a close
 * lower bound, and the monthly ceiling is a soft limit. The AI Gateway's own
 * prepaid credit balance remains the hard backstop.
 */

export type UsageBucket = {
  /** `${day}|${audience}|${model}` */
  id: string;
  day: string; // YYYY-MM-DD (UTC)
  audience: Audience;
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  toolCalls: number;
  errors: number;
  /** Total time spent waiting on the model, in ms (average = latencyMs / requests). */
  latencyMs?: number;
};

export type Escalation = {
  id: string;
  at: number;
  audience: Audience;
  name: string;
  email: string;
  topic: string;
  summary: string;
  emailed: boolean;
  /** Missing on records saved before replies existed; treat as "open". */
  status?: "open" | "resolved";
  resolvedAt?: number;
  /** Staff replies sent from the dashboard. */
  replies?: EscalationReply[];
  /** The chat that led to it (last few turns), for context when replying. */
  transcript?: Array<{ role: "user" | "assistant"; content: string }>;
  /** Phone consultation requests (topic "consultation"): the time they asked for, their phone, and their signed acknowledgement. */
  consultation?: { at: number; phone: string; interest: string; signature: string; acknowledgedAt: number };
};

export type EscalationReply = { at: number; body: string; emailed: boolean };

export const escalationStatus = (e: Escalation): "open" | "resolved" => e.status ?? "open";

const KEEP_DAYS = 120;

const usageStore = new VersionedStore<UsageBucket>({
  name: "assistant-usage",
  legacyKey: "assistant-usage.json",
  localFile: path.join(process.cwd(), "data", "assistant-usage.json"),
  keep: 6,
  reconcileLegacy: false, // brand-new store: nothing to reconcile, save a list() per read
});

const escalationStore = new VersionedStore<Escalation>({
  name: "assistant-escalations",
  legacyKey: "assistant-escalations.json",
  localFile: path.join(process.cwd(), "data", "assistant-escalations.json"),
  keep: 6,
  reconcileLegacy: false, // brand-new store: nothing to reconcile, save a list() per read
});

// local days and months (the business's time zone), like every other report.
// The monthly spending limit resets at midnight local on the 1st.
export const dayKey = (t = Date.now()) => pacificDay(t);
export const monthKey = (t = Date.now()) => pacificDay(t).slice(0, 7);

// ------------------------------------------------------------ in-memory tally

const S = singleton("usage", () => ({
  pending: new Map<string, UsageBucket>(),
  lastFlush: Date.now(),
  flushing: null as Promise<void> | null,
  persistedCache: null as { at: number; rows: UsageBucket[] } | null,
}));
const pending = S.pending;
const FLUSH_EVERY_MS = 30_000;
const FLUSH_AT_USD = 0.5;

export function recordUsage(entry: {
  audience: Audience;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  toolCalls: number;
  error?: boolean;
  latencyMs?: number;
}): void {
  const day = dayKey();
  const id = `${day}|${entry.audience}|${entry.model}`;
  const b =
    pending.get(id) ??
    { id, day, audience: entry.audience, model: entry.model, requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, toolCalls: 0, errors: 0 };
  b.requests += 1;
  b.inputTokens += entry.inputTokens;
  b.outputTokens += entry.outputTokens;
  b.costUsd += entry.costUsd;
  b.toolCalls += entry.toolCalls;
  if (entry.error) b.errors += 1;
  b.latencyMs = (b.latencyMs || 0) + Math.max(0, Math.round(entry.latencyMs || 0));
  pending.set(id, b);
}

function pendingCost(): number {
  let n = 0;
  pending.forEach((b) => (n += b.costUsd));
  return n;
}

/** Merge the in-memory tally into Blob if it's due (or `force`). Never throws. */
export async function flushUsage(force = false): Promise<void> {
  if (pending.size === 0) return;
  if (!force && Date.now() - S.lastFlush < FLUSH_EVERY_MS && pendingCost() < FLUSH_AT_USD) return;
  if (S.flushing) return S.flushing;

  const batch = new Map(pending);
  pending.clear();
  S.flushing = (async () => {
    try {
      const cutoff = dayKey(Date.now() - KEEP_DAYS * 86_400_000);
      await usageStore.mutate(
        (rows) => {
          const byId = new Map(rows.filter((r) => r.day >= cutoff).map((r) => [r.id, r]));
          batch.forEach((b, id) => {
            const cur = byId.get(id);
            if (!cur) byId.set(id, { ...b });
            else {
              cur.requests += b.requests;
              cur.inputTokens += b.inputTokens;
              cur.outputTokens += b.outputTokens;
              cur.costUsd += b.costUsd;
              cur.toolCalls += b.toolCalls;
              cur.errors += b.errors;
              cur.latencyMs = (cur.latencyMs || 0) + (b.latencyMs || 0);
            }
          });
          return { data: Array.from(byId.values()), result: undefined };
        },
        { allowShrink: true } // old days are pruned on purpose
      );
      S.lastFlush = Date.now();
      S.persistedCache = null;
    } catch (err) {
      console.error("[assistant] usage flush failed; will retry next time", err);
      // Put the batch back so nothing is lost.
      batch.forEach((b, id) => {
        const cur = pending.get(id);
        if (!cur) pending.set(id, b);
        else {
          cur.requests += b.requests;
          cur.inputTokens += b.inputTokens;
          cur.outputTokens += b.outputTokens;
          cur.costUsd += b.costUsd;
          cur.toolCalls += b.toolCalls;
          cur.errors += b.errors;
          cur.latencyMs = (cur.latencyMs || 0) + (b.latencyMs || 0);
        }
      });
    } finally {
      S.flushing = null;
    }
  })();
  return S.flushing;
}

// ------------------------------------------------------------ reading

const READ_TTL = 30_000;

async function persisted(fresh = false): Promise<UsageBucket[]> {
  if (!fresh && S.persistedCache && Date.now() - S.persistedCache.at < READ_TTL) return S.persistedCache.rows;
  try {
    const rows = (await usageStore.read()).data;
    S.persistedCache = { at: Date.now(), rows };
    return rows;
  } catch (err) {
    console.error("[assistant] usage read failed", err);
    return S.persistedCache?.rows ?? [];
  }
}

/** Everything known: persisted buckets plus this instance's unflushed tally. */
export async function allUsage(fresh = false): Promise<UsageBucket[]> {
  const rows = (await persisted(fresh)).map((r) => ({ ...r }));
  const byId = new Map(rows.map((r) => [r.id, r]));
  pending.forEach((b, id) => {
    const cur = byId.get(id);
    if (!cur) byId.set(id, { ...b });
    else {
      cur.requests += b.requests;
      cur.inputTokens += b.inputTokens;
      cur.outputTokens += b.outputTokens;
      cur.costUsd += b.costUsd;
      cur.toolCalls += b.toolCalls;
      cur.errors += b.errors;
      cur.latencyMs = (cur.latencyMs || 0) + (b.latencyMs || 0);
    }
  });
  return Array.from(byId.values());
}

export async function monthSpend(): Promise<number> {
  const month = monthKey();
  const rows = await allUsage();
  return rows.filter((r) => r.day.startsWith(month)).reduce((n, r) => n + r.costUsd, 0);
}

// ------------------------------------------------------------ escalations

const KEEP_ESCALATIONS = 300;

export async function addEscalation(e: Omit<Escalation, "id" | "at">): Promise<Escalation> {
  const rec: Escalation = { status: "open", ...e, id: `esc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, at: Date.now() };
  await escalationStore.mutate(
    (rows) => {
      const all = [rec, ...rows];
      // Trim resolved ones first; never drop an open request to make room.
      if (all.length > KEEP_ESCALATIONS) {
        const open = all.filter((x) => escalationStatus(x) === "open");
        const done = all.filter((x) => escalationStatus(x) !== "open");
        const keepDone = new Set(done.slice(0, Math.max(0, KEEP_ESCALATIONS - open.length)).map((x) => x.id));
        return { data: all.filter((x) => escalationStatus(x) === "open" || keepDone.has(x.id)), result: undefined };
      }
      return { data: all, result: undefined };
    },
    { allowShrink: true }
  );
  return rec;
}

/**
 * Change one escalation. `fn` gets a copy and returns the new record, or
 * throws to abort. Returns the saved record, or null if the id is unknown.
 */
export async function updateEscalation(id: string, fn: (e: Escalation) => Escalation): Promise<Escalation | null> {
  return escalationStore.mutate((rows) => {
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0) return { data: null, result: null };
    const next = fn({ ...rows[i], replies: [...(rows[i].replies || [])] });
    const data = rows.slice();
    data[i] = next;
    return { data, result: next };
  });
}

export async function recentEscalations(): Promise<Escalation[]> {
  try {
    return (await escalationStore.read()).data;
  } catch (err) {
    console.error("[assistant] escalation read failed", err);
    return [];
  }
}
