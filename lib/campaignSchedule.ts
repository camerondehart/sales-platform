import path from "path";
import { Resend } from "resend";
import { VersionedStore } from "./versionedStore";
import { activeSubscribers, getSubscribers, memberUnsubToken } from "./subscribers";
import { getUsers } from "./users";
import { CAMPAIGN_SUPPORT_EMAIL, tagCampaignLinks } from "./campaignEmail";
import { renderCampaign } from "./campaignRender";
import type { ThemeChoice } from "./campaignThemes";
import { brand } from "@/lib/brand";

/**
 * Campaign sending — "Send now" and scheduled — through one queue.
 *
 *  - A campaign is only sent after a signed-in admin approves it (pressing
 *    Send, or confirming a schedule). Scheduling IS the approval; it can be
 *    cancelled any time before sending starts.
 *  - Scheduled campaigns send only between 9am and 6pm local.
 *  - Recipients are snapshotted when sending STARTS (so anyone who
 *    unsubscribed after it was scheduled is skipped).
 *  - Emails go out in batches of up to 50 via Resend's batch API. Each batch
 *    is removed from the queue (claimed) BEFORE it's sent, in a race-safe
 *    write: two runs can't send the same batch, and nobody gets it twice.
 *    If a run dies mid-batch those people are skipped rather than doubled.
 *  - Whatever doesn't fit in one run continues on the next 15-minute run.
 */

export type Audience = "subscribers" | "all" | "members" | "nonmembers" | "custom" | "groups";
/**
 * The composer's three groups (pick any combination):
 *  ms = members subscribed · mn = non-subscribed members (never opted out) · ls = mailing list, not a member.
 */
export type AudienceGroup = "ms" | "mn" | "ls";
export const AUDIENCE_GROUPS: AudienceGroup[] = ["ms", "mn", "ls"];
type Recipient = { e: string; n?: string; t: string };

export type Campaign = {
  id: string;
  subject: string;
  body: string;
  audience: Audience;
  customEmails?: string[];
  /** For audience "groups". */
  groups?: AudienceGroup[];
  status: "scheduled" | "sending" | "sent" | "cancelled";
  /** Seasonal look (lib/campaignThemes.ts). Missing on older campaigns = plain. */
  theme?: ThemeChoice;
  /** Inbox preview line written by staff (empty = the first sentence of the message). */
  preheader?: string;
  /** Last edited while still scheduled. */
  editedAt?: number;
  createdAt: number;
  scheduledFor: number;
  approvedAt: number;
  startedAt?: number;
  finishedAt?: number;
  total?: number;
  sent: number;
  failed: number;
  queue?: Recipient[];
};

const store = new VersionedStore<Campaign>({
  name: "campaigns",
  legacyKey: "campaigns.json",
  localFile: path.join(process.cwd(), "data", "campaigns.json"),
  keep: 8,
  reconcileLegacy: false,
});

const TZ = brand.timezone;
export const SEND_WINDOW = { startHour: 9, endHour: 18 };
const BATCH = 50;

export function pacificHour(t = Date.now()): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", hour: "2-digit" }).format(new Date(t))) % 24;
}
export const inWindow = (t = Date.now()) => {
  const h = pacificHour(t);
  return h >= SEND_WINDOW.startHour && h < SEND_WINDOW.endHour;
};

export async function listCampaigns(): Promise<Campaign[]> {
  const rows = (await store.read()).data;
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function recipientsFor(audience: Audience, customEmails?: string[], groups?: AudienceGroup[]): Promise<Recipient[]> {
  const everyone = await getSubscribers();
  const subs = activeSubscribers(everyone);
  // Who can be emailed: active subscribers, plus approved members who aren't on
  // the list — membership includes occasional emails unless they've opted out
  // (Terms §13). Anyone who has ever unsubscribed is skipped.
  const optedOut = new Set(everyone.filter((s) => s.unsubscribedAt).map((s) => s.email.toLowerCase()));
  const onList = new Set(subs.map((s) => s.email.toLowerCase()));
  const approved = (await getUsers()).filter((u) => u.status === "approved");
  const members = new Set(approved.map((u) => u.email.toLowerCase()));
  const pool: Recipient[] = [
    ...subs.map((s) => ({ e: s.email, n: s.name || undefined, t: s.unsubscribeToken })),
    ...approved
      .filter((u) => !onList.has(u.email.toLowerCase()) && !optedOut.has(u.email.toLowerCase()))
      .map((u) => ({ e: u.email, n: u.name || undefined, t: memberUnsubToken(u.email) })),
  ];
  if (audience === "groups") {
    const g = new Set(groups || []);
    return pool.filter((r) => {
      const e = r.e.toLowerCase();
      const member = members.has(e);
      return onList.has(e) ? (member ? g.has("ms") : g.has("ls")) : member && g.has("mn");
    });
  }
  // "subscribers" = the mailing list only (the default for now; members off the list aren't included).
  if (audience === "subscribers") return subs.map((s) => ({ e: s.email, n: s.name || undefined, t: s.unsubscribeToken }));
  if (audience === "members") return pool.filter((r) => members.has(r.e.toLowerCase()));
  if (audience === "nonmembers") return pool.filter((r) => !members.has(r.e.toLowerCase()));
  if (audience === "custom") {
    // A list or customer group: only people above (subscribers and members), never anyone who unsubscribed.
    const wanted = new Set((customEmails || []).map((e) => e.trim().toLowerCase()).filter(Boolean));
    return pool.filter((r) => wanted.has(r.e.toLowerCase()));
  }
  return pool;
}

export async function createCampaign(input: {
  subject: string;
  body: string;
  audience: Audience;
  customEmails?: string[];
  groups?: AudienceGroup[];
  scheduledFor?: number;
  theme?: ThemeChoice;
  preheader?: string;
}): Promise<Campaign> {
  const now = Date.now();
  const c: Campaign = {
    id: `c${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    subject: input.subject.trim().slice(0, 200),
    body: input.body.slice(0, 50_000),
    audience: input.audience,
    customEmails: input.audience === "custom" ? (input.customEmails || []).slice(0, 5000) : undefined,
    groups: input.audience === "groups" ? input.groups : undefined,
    theme: input.theme || "auto",
    ...(input.preheader?.trim() ? { preheader: input.preheader.trim().slice(0, 200) } : {}),
    status: "scheduled",
    createdAt: now,
    scheduledFor: input.scheduledFor && input.scheduledFor > now ? input.scheduledFor : now,
    approvedAt: now,
    sent: 0,
    failed: 0,
  };
  await store.mutate((rows) => {
    // Keep the history tidy: last 100 campaigns.
    const keep = rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, 99);
    return { data: [c, ...keep], result: undefined };
  }, { allowShrink: true });
  return c;
}

/**
 * Edit a scheduled campaign that hasn't started sending: subject, text, theme,
 * who it goes to and when. Recipients are worked out when sending starts, so
 * the new audience is the one used.
 */
export async function updateCampaign(
  id: string,
  input: { subject: string; body: string; audience: Audience; customEmails?: string[]; groups?: AudienceGroup[]; scheduledFor?: number; theme?: ThemeChoice; preheader?: string }
): Promise<{ before: Campaign; after: Campaign } | null> {
  return store.mutate<{ before: Campaign; after: Campaign } | null>((rows) => {
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0 || rows[i].status !== "scheduled" || rows[i].startedAt) return { data: null, result: null };
    const now = Date.now();
    const before = rows[i];
    const after: Campaign = {
      ...before,
      subject: input.subject.trim().slice(0, 200),
      body: input.body.slice(0, 50_000),
      audience: input.audience,
      customEmails: input.audience === "custom" ? (input.customEmails || []).slice(0, 5000) : undefined,
      groups: input.audience === "groups" ? input.groups : undefined,
      theme: input.theme || before.theme || "auto",
      preheader: input.preheader?.trim() ? input.preheader.trim().slice(0, 200) : undefined,
      scheduledFor: input.scheduledFor && input.scheduledFor > now ? input.scheduledFor : before.scheduledFor,
      editedAt: now,
    };
    const next = rows.slice();
    next[i] = after;
    return { data: next, result: { before, after } };
  });
}

export async function cancelCampaign(id: string): Promise<Campaign | null> {
  return store.mutate((rows) => {
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0 || rows[i].status !== "scheduled") return { data: null, result: null };
    const next = rows.slice();
    next[i] = { ...rows[i], status: "cancelled", finishedAt: Date.now() };
    return { data: next, result: next[i] };
  });
}

/** Snapshot recipients when sending starts. Returns false if someone else already started it. */
async function start(id: string): Promise<boolean> {
  const c = (await store.read()).data.find((r) => r.id === id);
  if (!c || c.status !== "scheduled") return false;
  const recipients = await recipientsFor(c.audience, c.customEmails, c.groups);
  return store.mutate((rows) => {
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0 || rows[i].status !== "scheduled") return { data: null, result: false };
    const next = rows.slice();
    next[i] = { ...rows[i], status: recipients.length ? "sending" : "sent", startedAt: Date.now(), total: recipients.length, queue: recipients, finishedAt: recipients.length ? undefined : Date.now() };
    return { data: next, result: true };
  });
}

/** Take the next batch off the queue (race-safe). */
async function claimBatch(id: string): Promise<{ c: Campaign; batch: Recipient[] } | null> {
  return store.mutate((rows) => {
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0 || rows[i].status !== "sending") return { data: null, result: null };
    const q = rows[i].queue || [];
    if (q.length === 0) {
      const next = rows.slice();
      next[i] = { ...rows[i], status: "sent", queue: undefined, finishedAt: Date.now() };
      return { data: next, result: null };
    }
    const batch = q.slice(0, BATCH);
    const next = rows.slice();
    next[i] = { ...rows[i], queue: q.slice(BATCH) };
    return { data: next, result: { c: next[i], batch } };
  });
}

async function record(id: string, sent: number, failed: number) {
  await store.mutate((rows) => {
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0) return { data: null, result: undefined };
    const next = rows.slice();
    const done = (rows[i].queue || []).length === 0;
    next[i] = {
      ...rows[i],
      sent: rows[i].sent + sent,
      failed: rows[i].failed + failed,
      ...(done ? { status: "sent" as const, queue: undefined, finishedAt: Date.now() } : {}),
    };
    return { data: next, result: undefined };
  });
}

/** Send as much of one campaign as fits before `deadline`. */
export async function processCampaign(id: string, siteUrl: string, deadline: number): Promise<{ sent: number; failed: number }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Resend API key missing");
  const resend = new Resend(apiKey);
  const from = process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev";
  const replyTo = process.env.INQUIRY_TO_EMAIL || CAMPAIGN_SUPPORT_EMAIL;
  let sent = 0;
  let failed = 0;
  await start(id);
  while (Date.now() < deadline) {
    const got = await claimBatch(id);
    if (!got) break;
    const { c, batch } = got;
    const payload = await Promise.all(batch.map(async (r) => ({
      from,
      to: r.e,
      reply_to: replyTo,
      subject: c.subject,
      html: tagCampaignLinks(await renderCampaign({ subject: c.subject, body: c.body, theme: c.theme, unsubUrl: `${siteUrl}/unsubscribe?token=${r.t}`, name: r.n, siteUrl, when: c.scheduledFor, preheader: c.preheader }), c.id, siteUrl),
      headers: { "List-Unsubscribe": `<${siteUrl}/unsubscribe?token=${r.t}>` },
      tags: [{ name: "campaign", value: c.id }],
    })));
    let ok = 0;
    let bad = 0;
    try {
      const res = await resend.batch.send(payload);
      if (res.error) bad = batch.length;
      else ok = batch.length;
      if (res.error) console.error("[campaigns] batch rejected", c.id, res.error);
    } catch (err) {
      bad = batch.length;
      console.error("[campaigns] batch failed", c.id, err);
    }
    sent += ok;
    failed += bad;
    await record(id, ok, bad);
  }
  return { sent, failed };
}

/** Cron: send whatever is due (and in the 9–6 local window), plus anything mid-send. */
export async function runScheduledCampaigns(siteUrl: string, opts: { now?: number; deadlineMs?: number } = {}) {
  const now = opts.now ?? Date.now();
  const deadline = Date.now() + (opts.deadlineMs ?? 40_000);
  const rows = await listCampaigns();
  const due = rows.filter((c) => c.status === "sending" || (c.status === "scheduled" && c.scheduledFor <= now && inWindow(now)));
  let sent = 0;
  let failed = 0;
  for (const c of due.sort((a, b) => a.scheduledFor - b.scheduledFor)) {
    if (Date.now() >= deadline) break;
    const r = await processCampaign(c.id, siteUrl, deadline);
    sent += r.sent;
    failed += r.failed;
  }
  return { due: due.length, sent, failed };
}

/** For the history list: no recipient emails leave the server. */
export function publicCampaign(c: Campaign) {
  const { queue, customEmails, ...rest } = c;
  return { ...rest, remaining: queue?.length || 0, customCount: customEmails?.length || 0 };
}
