import path from "path";
import { VersionedStore } from "./versionedStore";
import { isEnabled } from "./flags";
import { findAdminCached } from "./adminsCache";
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
