// Classes, workshops, and vendor events, with registrations and waitlists.
// Stored as events.json + registrations.json in Blob (data/ locally).

import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { VersionedStore } from "./versionedStore";

export type EventType = "class" | "workshop" | "vendor" | "other";

export type SiteEvent = {
  id: string;
  title: string;
  description: string;
  date: number;          // epoch ms of the event start
  endDate?: number;
  location: string;
  price?: string;        // display string, e.g. "$45" or "Free"
  capacity: number;      // 0 = unlimited
  waitlistCapacity: number;
  type: EventType;
  image?: string;
  published: boolean;
  createdAt: number;
};

export type RegistrationStatus = "registered" | "waitlisted" | "cancelled";

export type Registration = {
  id: string;
  eventId: string;
  name: string;
  email: string;
  phone?: string;
  notes?: string;
  status: RegistrationStatus;
  userId?: string;       // set when a signed-in member registers
  manageToken: string;
  createdAt: number;
};

const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

async function readJson<T>(blobKey: string, file: string, fallback: T, strict = false): Promise<T> {
  if (useBlob) {
    try {
      const { list } = await import("@vercel/blob");
      const { blobs } = await list({ prefix: blobKey });
      const match = blobs.find((b) => b.pathname === blobKey);
      if (!match) return fallback;
      const url = `${match.url}${match.url.includes("?") ? "&" : "?"}nocache=${Date.now()}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`${blobKey} read failed with HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      console.error(`${blobKey} read failed:`, err);
      // Pages can show an empty list for a moment; a write must never be
      // based on one, or it would erase everything that's really there.
      if (strict) throw err;
      return fallback;
    }
  }
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(blobKey: string, file: string, value: unknown): Promise<void> {
  if (useBlob) {
    const { put } = await import("@vercel/blob");
    await put(blobKey, JSON.stringify(value, null, 2), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true, // required by @vercel/blob 2.x to update a blob in place
      cacheControlMaxAge: 60,
    });
    return;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

const EVENTS_BLOB = "events.json";
const EVENTS_FILE = path.join(process.cwd(), "data", "events.json");
const REGS_BLOB = "registrations.json";
const REGS_FILE = path.join(process.cwd(), "data", "registrations.json");

export async function getEvents(): Promise<SiteEvent[]> {
  return readJson<SiteEvent[]>(EVENTS_BLOB, EVENTS_FILE, []);
}

/** For changing events: throws instead of returning [] when the read fails. */
export async function getEventsForUpdate(): Promise<SiteEvent[]> {
  return readJson<SiteEvent[]>(EVENTS_BLOB, EVENTS_FILE, [], true);
}

export async function saveEvents(events: SiteEvent[]): Promise<void> {
  // Safety guard: refuse writes that look like accidental data loss, and
  // refuse to write at all if the current list can't be read to check.
  let existing: SiteEvent[];
  try {
    existing = await getEventsForUpdate();
  } catch {
    throw new Error("Couldn't read the current events to save safely. Please try again.");
  }
  if (existing.length >= 3 && events.length < Math.ceil(existing.length / 2)) {
    throw new Error(`Refusing to write events: existing ${existing.length}, new ${events.length}.`);
  }
  await writeJson(EVENTS_BLOB, EVENTS_FILE, events);
}

/*
 * Registrations are written by the public sign-up form, often by several
 * people at once right after a campaign email. They live in a VersionedStore
 * (like members and the mailing list): every save is a new immutable file,
 * so two sign-ups landing together can't erase each other, and a failed read
 * aborts the save instead of writing an empty list over everyone.
 */
const regStore = new VersionedStore<Registration>({
  name: "registrations",
  legacyKey: REGS_BLOB,
  localFile: REGS_FILE,
  keep: 12,
  guard: (before, after, { allowShrink }) =>
    !allowShrink && after.length < before.length
      ? `Refusing to write registrations: would drop ${before.length - after.length} of ${before.length}.`
      : null,
});

/** For display. Returns [] if the store can't be read right now. */
export async function getRegistrations(): Promise<Registration[]> {
  try {
    return (await regStore.read()).data;
  } catch (err) {
    console.error("registrations read failed:", err);
    return [];
  }
}

/** Change registrations safely. `fn` returns null to write nothing. */
export function mutateRegistrations<R>(
  fn: (regs: Registration[]) => { regs: Registration[] | null; result: R }
): Promise<R> {
  return regStore.mutate((data) => {
    const out = fn(data);
    return { data: out.regs, result: out.result };
  });
}

export function countFor(regs: Registration[], eventId: string, status: RegistrationStatus): number {
  return regs.filter((r) => r.eventId === eventId && r.status === status).length;
}

// Decide whether a new signup is registered, waitlisted, or refused.
export function nextRegistrationStatus(
  event: SiteEvent,
  regs: Registration[]
): RegistrationStatus | null {
  const registered = countFor(regs, event.id, "registered");
  if (event.capacity === 0 || registered < event.capacity) return "registered";
  const waitlisted = countFor(regs, event.id, "waitlisted");
  if (event.waitlistCapacity === 0 || waitlisted < event.waitlistCapacity) return "waitlisted";
  return null; // completely full
}

export type RegisterResult =
  | { ok: true; registration: Registration }
  | { ok: false; reason: "duplicate" | "full" };

/**
 * Add a registration. The duplicate check and the capacity check run inside
 * the same save, against the freshest list, so a busy event can't be
 * overbooked and nobody is added twice.
 */
export async function addRegistration(
  event: SiteEvent,
  args: Omit<Registration, "id" | "manageToken" | "createdAt" | "status" | "eventId">
): Promise<RegisterResult> {
  const id = `reg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const manageToken = crypto.randomBytes(16).toString("hex");
  const createdAt = Date.now();
  return mutateRegistrations<RegisterResult>((regs) => {
    const dupe = regs.some((r) => r.eventId === event.id && r.email === args.email && r.status !== "cancelled");
    if (dupe) return { regs: null, result: { ok: false, reason: "duplicate" } };
    const status = nextRegistrationStatus(event, regs);
    if (!status) return { regs: null, result: { ok: false, reason: "full" } };
    const registration: Registration = { ...args, eventId: event.id, status, id, manageToken, createdAt };
    return { regs: [...regs, registration], result: { ok: true, registration } };
  });
}

// When someone cancels, promote the first person off the waitlist.
export async function cancelAndPromote(
  registrationId: string
): Promise<{ cancelled: Registration | null; promoted: Registration | null }> {
  return mutateRegistrations<{ cancelled: Registration | null; promoted: Registration | null }>((all) => {
    const idx = all.findIndex((r) => r.id === registrationId);
    if (idx === -1) return { regs: null, result: { cancelled: null, promoted: null } };

    const wasRegistered = all[idx].status === "registered";
    all[idx] = { ...all[idx], status: "cancelled" };
    let promoted: Registration | null = null;

    if (wasRegistered) {
      const next = all
        .filter((r) => r.eventId === all[idx].eventId && r.status === "waitlisted")
        .sort((a, b) => a.createdAt - b.createdAt)[0];
      if (next) {
        const nIdx = all.findIndex((r) => r.id === next.id);
        all[nIdx] = { ...all[nIdx], status: "registered" };
        promoted = all[nIdx];
      }
    }
    return { regs: all, result: { cancelled: all[idx], promoted } };
  });
}

/** Move one registration off the waitlist. Returns null if it doesn't exist. */
export async function promoteRegistration(registrationId: string): Promise<Registration | null> {
  return mutateRegistrations<Registration | null>((all) => {
    const idx = all.findIndex((r) => r.id === registrationId);
    if (idx === -1) return { regs: null, result: null };
    all[idx] = { ...all[idx], status: "registered" };
    return { regs: all, result: all[idx] };
  });
}
