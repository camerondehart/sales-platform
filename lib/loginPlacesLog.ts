import path from "path";
import { VersionedStore } from "./versionedStore";
import { isEnabled } from "./flags";
import { findAdminCached } from "./adminsCache";
import { isAdmin } from "./auth";
import { singleton } from "./assistant/singleton";
import { addDays, pacificDay } from "./periods";
import { KEEP_DAYS, addSignIn, placeFromHeaders, type LoginKind, type PlaceRow } from "./loginPlaces";

/**
 * Saving side of Analytics → Where people sign in (lib/loginPlaces.ts).
 * Daily totals per rough town; never the internet address or who it was.
 * Recording never blocks or fails a sign-in: errors are swallowed, it gives
 * up after a few seconds, and nothing is written while `login_map` is off or
 * the request has no location (e.g. running locally).
 */

const store = new VersionedStore<PlaceRow>({
  name: "login-places",
  legacyKey: "login-places.json",
  localFile: path.join(process.cwd(), "data", "login-places.json"),
  keep: 6,
  reconcileLegacy: false,
});

export async function readLoginPlaces(): Promise<PlaceRow[]> {
  return (await store.read()).data;
}

async function save(req: Request, kind: LoginKind, email?: string): Promise<void> {
  try {
    if (!(await isEnabled("login_map"))) return;
    const place = placeFromHeaders((n) => req.headers.get(n));
    if (!place) return;
    // Staff signing in to their own member or store account count as staff
    // too, so they show only under Staff, not Everyone.
    if (kind !== "staff" && email && (await findAdminCached(email.trim()).catch(() => null))) kind = "staff";
    const day = pacificDay();
    const cutoff = addDays(day, -KEEP_DAYS);
    await store.mutate((rows) => ({ data: addSignIn(rows, day, kind, place, cutoff), result: undefined }), { allowShrink: true });
  } catch (err) {
    console.error("[login-places] could not record", kind, err);
  }
}

/** Notes one successful sign-in's rough town. Waits at most 3 seconds. The email is only used to spot staff; it isn't saved. */
export async function recordSignInPlace(req: Request, kind: LoginKind, email?: string): Promise<void> {
  await Promise.race([save(req, kind, email), new Promise<void>((r) => setTimeout(r, 3000))]);
}

// ---------------------------------------------------------------- visits
//
// Visits: the cookie-free visit counter (/api/t, lib/track.ts)
// sends one "visit" per browser tab session, skipping bots, staff pages and
// browsers with Do Not Track / Global Privacy Control. Each one adds 1 to the
// same kind of daily total per rough town (kind "visit"). Visits are far more
// common than sign-ins, so like lib/traffic.ts they're added up in memory and
// saved at most every 30 seconds, into one store per month. Months older than
// KEEP_DAYS are emptied so nothing is kept past about 13 months.

const VISIT_FLUSH_MS = 30_000;
const VISIT_MAX_ROWS = 12000; // per month

const visitStores = singleton("visitPlaceStores", () => new Map<string, VersionedStore<PlaceRow>>());
function visitStore(month: string): VersionedStore<PlaceRow> {
  let s = visitStores.get(month);
  if (!s) {
    s = new VersionedStore<PlaceRow>({
      name: `visit-places-${month}`,
      legacyKey: `visit-places-${month}.json`,
      localFile: path.join(process.cwd(), "data", `visit-places-${month}.json`),
      keep: 4,
      reconcileLegacy: false,
    });
    visitStores.set(month, s);
  }
  return s;
}

const V = singleton("visitPlaces", () => ({
  pending: [] as PlaceRow[],
  lastFlush: Date.now(),
  flushing: null as Promise<void> | null,
  emptied: new Set<string>(), // old months this instance already cleared
}));

const monthOf = (day: string) => day.slice(0, 7);
function monthsBetween(fromDay: string, toDay: string): string[] {
  const out: string[] = [];
  const d = new Date(`${monthOf(fromDay)}-01T12:00:00Z`);
  while (d.toISOString().slice(0, 7) <= monthOf(toDay) && out.length < 16) {
    out.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

/**
 * Notes one visit's rough town. Never throws. Nothing is noted while
 * `login_map` is off, without a location, or from a browser signed in to the
 * staff dashboard (staff browsing the shop aren't visitors).
 */
export async function recordVisitPlace(req: Request): Promise<void> {
  try {
    if (!(await isEnabled("login_map"))) return;
    const place = placeFromHeaders((n) => req.headers.get(n));
    if (!place) return;
    if (await isAdmin().catch(() => false)) return;
    V.pending = addSignIn(V.pending, pacificDay(), "visit", place, "0000-00-00", 1, VISIT_MAX_ROWS);
    void flushVisitPlaces();
  } catch (err) {
    console.error("[visit-places] could not record", err);
  }
}

export async function flushVisitPlaces(force = false): Promise<void> {
  if (V.pending.length === 0) return;
  if (!force && Date.now() - V.lastFlush < VISIT_FLUSH_MS) return;
  if (V.flushing) return V.flushing;
  const batch = V.pending;
  V.pending = [];
  V.flushing = (async () => {
    try {
      const today = pacificDay();
      const cutoff = addDays(today, -KEEP_DAYS);
      const byMonth = new Map<string, PlaceRow[]>();
      for (const r of batch) byMonth.set(monthOf(r.day), [...(byMonth.get(monthOf(r.day)) || []), r]);
      for (const [month, rows] of byMonth) {
        await visitStore(month).mutate(
          (cur) => {
            let next = cur.map((r) => ({ ...r }));
            for (const r of rows) {
              const { day, kind, count, ...place } = r;
              next = addSignIn(next, day, kind, place, cutoff, count, VISIT_MAX_ROWS);
            }
            return { data: next, result: undefined };
          },
          { allowShrink: true }
        );
      }
      // Empty the month that just passed the 13-month mark (once per instance).
      const old = monthOf(addDays(cutoff, -1));
      if (!V.emptied.has(old)) {
        V.emptied.add(old);
        const snap = await visitStore(old).read().catch(() => null);
        if (snap && snap.data.length) await visitStore(old).mutate(() => ({ data: [], result: undefined }), { allowShrink: true });
      }
      V.lastFlush = Date.now();
    } catch (err) {
      console.error("[visit-places] save failed; will retry", err);
      for (const r of batch) {
        const { day, kind, count, ...place } = r;
        V.pending = addSignIn(V.pending, day, kind, place, "0000-00-00", count, VISIT_MAX_ROWS);
      }
    } finally {
      V.flushing = null;
    }
  })();
  return V.flushing;
}

/** Visit rows from `fromDay` on (inclusive), including this instance's unsaved counts. */
export async function readVisitPlaces(fromDay: string): Promise<PlaceRow[]> {
  await flushVisitPlaces(true).catch(() => {});
  const rows: PlaceRow[] = [];
  for (const m of monthsBetween(fromDay, pacificDay())) {
    try {
      rows.push(...(await visitStore(m).read()).data.filter((r) => r.day >= fromDay));
    } catch (err) {
      console.error("[visit-places] read failed", m, err);
    }
  }
  return [...rows, ...V.pending.filter((r) => r.day >= fromDay)];
}

