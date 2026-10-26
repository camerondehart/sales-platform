// Email subscribers for campaigns. Collected via checkout opt-in, the
// retail shop, or added manually by an admin.

import path from "path";
import crypto from "crypto";
import { VersionedStore } from "./versionedStore";

export type Subscriber = {
  id: string;
  email: string;
  name?: string;
  source: "retail" | "member" | "manual" | "signup" | "event" | "shopify";
  /** Which event they signed up at, when source is "event" (e.g. "Farmers Market"). */
  event?: string;
  unsubscribeToken: string;
  subscribedAt: number;
  unsubscribedAt?: number;
};

const DATA_FILE = path.join(process.cwd(), "data", "subscribers.json");
const BLOB_KEY = "subscribers.json";

const store = new VersionedStore<Subscriber>({
  name: "subscribers",
  legacyKey: BLOB_KEY,
  localFile: DATA_FILE,
  keep: 12,
  // Same safety net as before: a non-delete write that would halve the
  // list can only be a bug.
  guard: (before, after, { allowShrink }) => {
    if (!allowShrink && before.length >= 5 && after.length < Math.ceil(before.length / 2)) {
      return `Refusing to write subscribers: existing ${before.length}, new ${after.length}.`;
    }
    return null;
  },
});

export async function getSubscribers(): Promise<Subscriber[]> {
  return (await store.read()).data;
}

/** Apply a change to the list safely — see lib/versionedStore.ts. */
export async function mutateSubscribers<T>(
  fn: (subs: Subscriber[]) => { subs: Subscriber[] | null; result: T },
  opts?: { allowShrink?: boolean }
): Promise<T> {
  return store.mutate<T>((data) => {
    const out = fn(data);
    return { data: out.subs, result: out.result };
  }, opts);
}

/** Legacy whole-list save. Prefer mutateSubscribers(). Folds the caller's
 *  rows over a fresh read so a row the caller never saw can't be lost. */
export async function saveSubscribers(subs: Subscriber[], opts?: { allowShrink?: boolean }): Promise<void> {
  const ours = new Map(subs.map((s) => [s.id, s]));
  await mutateSubscribers((current) => {
    if (opts?.allowShrink) return { subs, result: undefined };
    const merged = current.map((s) => ours.get(s.id) ?? s);
    const ids = new Set(current.map((s) => s.id));
    for (const s of subs) if (!ids.has(s.id)) merged.push(s);
    return { subs: merged, result: undefined };
  }, opts);
}

// Add a subscriber (idempotent — re-subscribes anyone who had opted out).
/**
 * Add many subscribers in ONE read-modify-write.
 *
 * Calling addSubscriber per row would rewrite the whole list once per person,
 * which is slow and lets later writes overwrite earlier ones. Emails already
 * on the list are left alone, so importing the same file twice is harmless.
 *
 * A "status" column in the file is respected — see the check below — so a
 * members export won't add rejected people, and re-importing a subscribers
 * backup won't undo anyone's opt-out.
 */
export async function addSubscribersBulk(
  incoming: Array<{ email: string; name?: string; status?: string }>,
  source: Subscriber["source"] = "manual"
): Promise<{
  added: number;
  resubscribed: number;
  alreadyThere: number;
  invalid: number;
  skippedStatus: number;
}> {
  return mutateSubscribers((all) => {
  const byEmail = new Map(all.map((s) => [s.email, s]));

  let added = 0;
  let resubscribed = 0;
  let alreadyThere = 0;
  let invalid = 0;
  let skippedStatus = 0;

  for (const row of incoming) {
    const clean = (row.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      invalid++;
      continue;
    }

    // Respect a status column if the file has one.
    //
    // This matters for two real cases. A members export carries statuses like
    // "rejected" and "pending" — those people should not be added to a
    // mailing list. And re-importing a subscribers backup must not undo
    // someone's opt-out: a row marked "unsubscribed" is left alone.
    const status = (row.status || "").trim().toLowerCase();
    if (status && !["active", "approved", "subscribed", "yes", "true"].includes(status)) {
      skippedStatus++;
      continue;
    }

    const existing = byEmail.get(clean);
    if (existing) {
      if (existing.unsubscribedAt) {
        existing.unsubscribedAt = undefined;
        existing.subscribedAt = Date.now();
        resubscribed++;
      } else {
        alreadyThere++;
      }
      // Fill in a missing name if the file has one
      if (!existing.name && row.name?.trim()) existing.name = row.name.trim();
      continue;
    }

    const sub: Subscriber = {
      id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      email: clean,
      name: row.name?.trim() || undefined,
      source,
      unsubscribeToken: crypto.randomBytes(20).toString("hex"),
      subscribedAt: Date.now(),
    };
    all.push(sub);
    byEmail.set(clean, sub);
    added++;
  }

  const changed = added > 0 || resubscribed > 0;
  return { subs: changed ? all : null, result: { added, resubscribed, alreadyThere, invalid, skippedStatus } };
  });
}

/**
 * Like addSubscriber, but also says whether this was a genuinely new sign-up
 * (or a lapsed one coming back) versus someone already on the list. Callers
 * use that to decide whether a welcome email is appropriate — without a
 * second read-modify-write to stamp the record, which on Blob storage can
 * re-read a stale list and drop the row it just added.
 */
export async function addSubscriberDetailed(
  email: string,
  name: string | undefined,
  source: Subscriber["source"],
  event?: string
): Promise<{ sub: Subscriber; isNew: boolean } | null> {
  const clean = email.trim().toLowerCase();
  if (!clean || !clean.includes("@")) return null;
  const eventName = event?.trim().slice(0, 80) || undefined;

  return mutateSubscribers<{ sub: Subscriber; isNew: boolean }>((all) => {
  const existing = all.find((s) => s.email === clean);
  if (existing) {
    let dirty = false;
    let cameBack = false;
    if (existing.unsubscribedAt) {
      existing.unsubscribedAt = undefined;
      existing.subscribedAt = Date.now();
      dirty = true;
      cameBack = true;
    }
    // Someone already on the list who scans at a booth: fill in a missing
    // name, and remember the event if we didn't have one for them.
    if (!existing.name && name?.trim()) { existing.name = name.trim(); dirty = true; }
    if (!existing.event && eventName) { existing.event = eventName; dirty = true; }
    return { subs: dirty ? all : null, result: { sub: existing, isNew: cameBack } };
  }

  const sub: Subscriber = {
    id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    email: clean,
    name: name?.trim() || undefined,
    source,
    event: eventName,
    unsubscribeToken: crypto.randomBytes(20).toString("hex"),
    subscribedAt: Date.now(),
  };
  return { subs: [...all, sub], result: { sub, isNew: true } };
  });
}

export async function addSubscriber(
  email: string,
  name: string | undefined,
  source: Subscriber["source"],
  event?: string
): Promise<Subscriber | null> {
  const r = await addSubscriberDetailed(email, name, source, event);
  return r ? r.sub : null;
}

/**
 * A member changed their email address (admin correction). Keep the mailing
 * list in step so campaigns go to the right inbox. Returns true if a row
 * was updated.
 */
export async function renameSubscriberEmail(oldEmail: string, newEmail: string): Promise<boolean> {
  const from = (oldEmail || "").trim().toLowerCase();
  const to = (newEmail || "").trim().toLowerCase();
  if (!from || !to || from === to) return false;
  return mutateSubscribers<boolean>((all) => {
    const row = all.find((s) => s.email === from);
    if (!row) return { subs: null, result: false };
    // If the new address is already on the list, drop the old row rather than
    // creating a duplicate; the existing row's opt-out choice wins.
    const clash = all.find((s) => s.email === to);
    const next = clash ? all.filter((s) => s !== row) : all.map((s) => (s === row ? { ...s, email: to } : s));
    return { subs: next, result: true };
  }, { allowShrink: true });
}

/**
 * Take an email address off the mailing list entirely.
 *
 * Used when a member is deleted: removing the account but leaving them on the
 * list would mean they keep receiving campaigns from a business that no longer
 * has a record of them. Returns true if someone was actually removed.
 */
export async function removeSubscriberByEmail(email: string): Promise<boolean> {
  const clean = (email || "").trim().toLowerCase();
  if (!clean) return false;

  return mutateSubscribers<boolean>((all) => {
    const remaining = all.filter((s) => s.email !== clean);
    if (remaining.length === all.length) return { subs: null, result: false };
    return { subs: remaining, result: true };
  }, { allowShrink: true });
}

/** Admin removal of one row by id. */
export async function removeSubscriberById(id: string): Promise<boolean> {
  return mutateSubscribers<boolean>((all) => {
    const remaining = all.filter((s) => s.id !== id);
    if (remaining.length === all.length) return { subs: null, result: false };
    return { subs: remaining, result: true };
  }, { allowShrink: true });
}

// ---------------------------------------------------------------------------
// Members who aren't on the mailing list still get campaigns (Terms §9: being
// a member includes occasional emails unless you unsubscribe). Their
// unsubscribe link carries a signed token instead of a subscriber record;
// using it saves an opt-out record so they're never emailed again.
// ---------------------------------------------------------------------------

const unsubSig = (email: string) =>
  crypto.createHmac("sha256", process.env.AUTH_SECRET || "dev-unsubscribe-secret").update(`unsub:${email}`).digest("base64url").slice(0, 22);

/** Unsubscribe token for a member who has no subscriber record. */
export function memberUnsubToken(email: string): string {
  const e = email.trim().toLowerCase();
  return `m.${Buffer.from(e).toString("base64url")}.${unsubSig(e)}`;
}

function emailFromMemberToken(token: string): string | null {
  const m = /^m\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{22})$/.exec(token);
  if (!m) return null;
  const email = Buffer.from(m[1], "base64url").toString("utf8");
  const want = Buffer.from(unsubSig(email));
  const got = Buffer.from(m[2]);
  return want.length === got.length && crypto.timingSafeEqual(want, got) && email.includes("@") ? email : null;
}

/** Remember that someone doesn't want marketing emails (subscribed or not). */
export async function recordOptOut(email: string, name: string | undefined, source: Subscriber["source"]): Promise<Subscriber> {
  const e = email.trim().toLowerCase();
  return mutateSubscribers<Subscriber>((all) => {
    const hit = all.find((s) => s.email.toLowerCase() === e);
    if (hit) {
      if (!hit.unsubscribedAt) hit.unsubscribedAt = Date.now();
      return { subs: all, result: hit };
    }
    const now = Date.now();
    const rec: Subscriber = {
      id: `sub_${now}_${Math.random().toString(36).slice(2, 8)}`,
      email: e,
      name: name || undefined,
      source,
      unsubscribeToken: crypto.randomBytes(16).toString("hex"),
      subscribedAt: now,
      unsubscribedAt: now,
    };
    return { subs: [...all, rec], result: rec };
  });
}

export async function unsubscribeByToken(token: string): Promise<Subscriber | null> {
  if (!token) return null;
  const memberEmail = emailFromMemberToken(token);
  if (memberEmail) return recordOptOut(memberEmail, undefined, "member");
  return mutateSubscribers<Subscriber | null>((all) => {
    const idx = all.findIndex((s) => s.unsubscribeToken === token);
    if (idx === -1) return { subs: null, result: null };
    all[idx].unsubscribedAt = Date.now();
    return { subs: all, result: all[idx] };
  });
}

export function activeSubscribers(subs: Subscriber[]): Subscriber[] {
  return subs.filter((s) => !s.unsubscribedAt);
}
