/**
 * Sending "set your password" links to many members (the people imported from
 * the old store), gently: a job with a queue that the 15-minute cron works
 * through — up to PER_RUN emails a run, only 9am–6pm local, in batches of
 * 50. Staff can test it on themselves, pause, resume or cancel. Anyone who
 * sets a password before their turn is skipped. Only one job runs at a time.
 */

import path from "path";
import { Resend } from "resend";
import { VersionedStore } from "./versionedStore";
import { getUsers, type User } from "./users";
import { inWindow } from "./campaignSchedule";
import { markInvited, setupEmailHtml, setupToken, SETUP_SUBJECT } from "./passwordSetup";

export type InviteMode = "never_invited" | "remind";
export type InviteJob = {
  id: string;
  mode: InviteMode;
  status: "sending" | "paused" | "done" | "cancelled";
  createdAt: number;
  finishedAt?: number;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  queue: string[];
};

const BATCH = 50;
const PER_RUN = 200;
const DAY = 86_400_000;
/** "Remind" only re-sends to people invited at least this long ago. */
export const REMIND_AFTER_DAYS = 5;

const store = new VersionedStore<InviteJob>({
  name: "invite-jobs",
  legacyKey: "invite-jobs.json",
  localFile: path.join(process.cwd(), "data", "invite-jobs.json"),
  keep: 8,
  reconcileLegacy: false,
});

const waiting = (u: User) => u.status === "approved" && !!u.needsPassword;

/** Who each mode would email right now. */
export function pickInvitees(users: User[], mode: InviteMode, now = Date.now()): User[] {
  return users.filter((u) => waiting(u) && (mode === "never_invited" ? !u.inviteSentAt : !!u.inviteSentAt && now - u.inviteSentAt > REMIND_AFTER_DAYS * DAY));
}

export async function currentJob(): Promise<InviteJob | null> {
  const rows = (await store.read()).data.sort((a, b) => b.createdAt - a.createdAt);
  return rows[0] || null;
}

export async function inviteStats(now = Date.now()) {
  const [users, job] = await Promise.all([getUsers(), currentJob()]);
  const imported = users.filter((u) => u.importedFrom);
  return {
    imported: imported.length,
    setPassword: imported.filter((u) => !u.needsPassword).length,
    waiting: users.filter(waiting).length,
    neverInvited: pickInvitees(users, "never_invited", now).length,
    canRemind: pickInvitees(users, "remind", now).length,
    invitedNotSet: users.filter((u) => waiting(u) && u.inviteSentAt).length,
    inWindow: inWindow(now),
    job: job ? { ...job, queue: undefined, remaining: job.queue.length } : null,
  };
}

export async function startInvites(mode: InviteMode): Promise<{ ok: true; total: number } | { ok: false; error: string }> {
  const users = await getUsers();
  const ids = pickInvitees(users, mode).map((u) => u.id);
  if (!ids.length) return { ok: false, error: mode === "remind" ? `Nobody to remind yet (reminders go to people invited ${REMIND_AFTER_DAYS}+ days ago who still haven't set a password).` : "Everyone waiting has already been invited." };
  type R = { ok: true; total: number } | { ok: false; error: string };
  return store.mutate<R>((rows) => {
    if (rows.some((j) => j.status === "sending" || j.status === "paused")) return { data: null, result: { ok: false as const, error: "An invite run is already going — pause or cancel it first." } };
    const job: InviteJob = { id: `inv${Date.now().toString(36)}`, mode, status: "sending", createdAt: Date.now(), total: ids.length, sent: 0, failed: 0, skipped: 0, queue: ids };
    return { data: [job, ...rows].slice(0, 20), result: { ok: true as const, total: ids.length } };
  }, { allowShrink: true });
}

export async function setJobStatus(action: "pause" | "resume" | "cancel"): Promise<{ ok: true } | { ok: false; error: string }> {
  return store.mutate<{ ok: true } | { ok: false; error: string }>((rows) => {
    const i = rows.findIndex((j) => j.status === "sending" || j.status === "paused");
    if (i < 0) return { data: null, result: { ok: false as const, error: "There's no invite run going." } };
    const next = rows.slice();
    const j = rows[i];
    if (action === "pause") next[i] = { ...j, status: "paused" };
    else if (action === "resume") next[i] = { ...j, status: "sending" };
    else next[i] = { ...j, status: "cancelled", finishedAt: Date.now() };
    return { data: next, result: { ok: true as const } };
  });
}

async function claim(): Promise<{ jobId: string; ids: string[] } | null> {
  return store.mutate<{ jobId: string; ids: string[] } | null>((rows) => {
    const i = rows.findIndex((j) => j.status === "sending");
    if (i < 0) return { data: null, result: null };
    const j = rows[i];
    const next = rows.slice();
    if (!j.queue.length) {
      next[i] = { ...j, status: "done", finishedAt: Date.now() };
      return { data: next, result: null };
    }
    next[i] = { ...j, queue: j.queue.slice(BATCH) };
    return { data: next, result: { jobId: j.id, ids: j.queue.slice(0, BATCH) } };
  });
}

async function record(jobId: string, sent: number, failed: number, skipped: number) {
  await store.mutate((rows) => {
    const i = rows.findIndex((j) => j.id === jobId);
    if (i < 0) return { data: null, result: undefined };
    const j = rows[i];
    const next = rows.slice();
    next[i] = {
      ...j,
      sent: j.sent + sent,
      failed: j.failed + failed,
      skipped: j.skipped + skipped,
      ...(j.queue.length === 0 && j.status === "sending" ? { status: "done" as const, finishedAt: Date.now() } : {}),
    };
    return { data: next, result: undefined };
  });
}

/** Cron (and "Start"): send the next few batches, if a run is going and it's 9–6 local. */
export async function runInvites(siteUrl: string, opts: { deadlineMs?: number; now?: number; ignoreWindow?: boolean } = {}) {
  const out = { sent: 0, failed: 0, skipped: 0 };
  if (!opts.ignoreWindow && !inWindow(opts.now ?? Date.now())) return out;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return out;
  const job = await currentJob();
  if (!job || job.status !== "sending") return out;
  const deadline = Date.now() + (opts.deadlineMs ?? 30_000);
  const resend = new Resend(apiKey);
  const from = process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev";
  const replyTo = process.env.INQUIRY_TO_EMAIL || undefined;
  while (out.sent + out.failed + out.skipped < PER_RUN && Date.now() < deadline) {
    const got = await claim();
    if (!got) break;
    const byId = new Map((await getUsers()).map((u) => [u.id, u]));
    // Someone may have set a password (or been removed) since the run started.
    const people = got.ids.map((id) => byId.get(id)).filter((u): u is User => !!u && waiting(u));
    const skipped = got.ids.length - people.length;
    let ok = 0;
    let bad = 0;
    if (people.length) {
      try {
        const res = await resend.batch.send(
          people.map((u) => ({
            from,
            to: u.email,
            reply_to: replyTo,
            subject: SETUP_SUBJECT,
            html: setupEmailHtml(u.name.split(" ")[0] || u.name, `${siteUrl}/welcome?t=${setupToken(u)}`, siteUrl),
            tags: [{ name: "kind", value: "set_password" }],
          }))
        );
        if (res.error) {
          bad = people.length;
          console.error("[invites] batch rejected", res.error);
        } else ok = people.length;
      } catch (err) {
        bad = people.length;
        console.error("[invites] batch failed", err);
      }
      if (ok) await markInvited(people.map((u) => u.id)).catch((err) => console.error("[invites] mark failed", err));
    }
    out.sent += ok;
    out.failed += bad;
    out.skipped += skipped;
    await record(got.jobId, ok, bad, skipped);
  }
  return out;
}

/** A sample to the team inbox, so staff can see exactly what members get. */
export async function sendInviteTest(siteUrl: string): Promise<{ ok: true; to: string } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.INQUIRY_TO_EMAIL;
  if (!apiKey || !to) return { ok: false, error: "Email isn't fully set up (RESEND_API_KEY / INQUIRY_TO_EMAIL)." };
  const r = await new Resend(apiKey).emails.send({
    from: process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev",
    to,
    subject: `[Test] ${SETUP_SUBJECT}`,
    html: setupEmailHtml("there", `${siteUrl}/welcome?t=preview`, siteUrl),
  });
  return r.error ? { ok: false, error: r.error.message || "Refused." } : { ok: true, to };
}
