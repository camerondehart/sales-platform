/**
 * Where people sign in (Analytics → Where people sign in, switch `login_map`).
 *
 * Pure helpers (unit check tests/unit/login-places.cjs); the saving side is
 * lib/loginPlacesLog.ts.
 *
 * Only the rough town Vercel works out from the internet address is used
 * (x-vercel-ip-city / -country-region / -country / -latitude / -longitude).
 * Rows are daily totals per town and kind of sign-in: no internet address,
 * no email, no account id, so nothing here can be traced back to a person.
 */

export type LoginKind = "member" | "staff" | "store";
export const LOGIN_KINDS: LoginKind[] = ["member", "staff", "store"];

/** One row = how many sign-ins of one kind came from one town on one local day (brand.timezone). */
export type PlaceRow = {
  day: string; // YYYY-MM-DD, local (brand.timezone)
  kind: LoginKind;
  city: string;
  region?: string;
  country?: string;
  lat: number; // rounded to 2 decimals (about 1 km), already city-level from Vercel
  lon: number;
  count: number;
};

export type Place = { city: string; region?: string; country?: string; lat: number; lon: number };

/** Keep a little over a year so Analytics' "1 year" view is full. */
export const KEEP_DAYS = 400;
export const MAX_ROWS = 20000;

const round2 = (n: number) => Math.round(n * 100) / 100;

function clean(v: string | null | undefined, max: number): string {
  let s = (v || "").trim();
  // Vercel URL-encodes the city (e.g. "S%C3%A3o%20Paulo").
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep as sent */
  }
  return s.replace(/[\u0000-\u001f<>]/g, "").slice(0, max).trim();
}

/** The rough town Vercel attaches to a request, or null without a usable location. */
export function placeFromHeaders(get: (name: string) => string | null | undefined): Place | null {
  const rawLat = (get("x-vercel-ip-latitude") || "").trim();
  const rawLon = (get("x-vercel-ip-longitude") || "").trim();
  const lat = Number(rawLat);
  const lon = Number(rawLon);
  if (!rawLat || !rawLon || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const country = clean(get("x-vercel-ip-country"), 2).toUpperCase() || undefined;
  const region = clean(get("x-vercel-ip-country-region"), 6).toUpperCase() || undefined;
  const city = clean(get("x-vercel-ip-city"), 60) || "Unknown town";
  return { city, region, country, lat: round2(lat), lon: round2(lon) };
}

const keyOf = (r: { day: string; kind: string; city: string; region?: string; country?: string }) =>
  `${r.day}|${r.kind}|${r.city.toLowerCase()}|${r.region || ""}|${r.country || ""}`;

/** Adds one sign-in to the daily totals and drops rows past KEEP_DAYS (cutoffDay is YYYY-MM-DD). */
export function addSignIn(rows: PlaceRow[], day: string, kind: LoginKind, place: Place, cutoffDay: string): PlaceRow[] {
  const kept = rows.filter((r) => r.day >= cutoffDay);
  const k = keyOf({ day, kind, ...place });
  const hit = kept.find((r) => keyOf(r) === k);
  if (hit) {
    hit.count += 1;
    return kept;
  }
  return [...kept, { day, kind, ...place, count: 1 }].slice(-MAX_ROWS);
}

export type PlaceSummary = Place & { key: string; count: number; byKind: Record<LoginKind, number> };

/**
 * Totals per town from `fromDay` (inclusive) on, biggest first. With a kind,
 * only that kind; without one ("Everyone") members and stores only: staff
 * sign-ins show only under Staff.
 */
export function summarize(rows: PlaceRow[], fromDay: string, kind?: LoginKind): { places: PlaceSummary[]; total: number } {
  const map = new Map<string, PlaceSummary>();
  let total = 0;
  for (const r of rows) {
    if (r.day < fromDay) continue;
    if (kind ? r.kind !== kind : r.kind === "staff") continue;
    const key = `${r.city.toLowerCase()}|${r.region || ""}|${r.country || ""}`;
    let p = map.get(key);
    if (!p) {
      p = { key, city: r.city, region: r.region, country: r.country, lat: r.lat, lon: r.lon, count: 0, byKind: { member: 0, staff: 0, store: 0 } };
      map.set(key, p);
    }
    p.count += r.count;
    p.byKind[r.kind] = (p.byKind[r.kind] || 0) + r.count;
    total += r.count;
  }
  const places = Array.from(map.values()).sort((a, b) => b.count - a.count || a.city.localeCompare(b.city));
  return { places, total };
}

/** "Springfield, IL" in the US, "Toronto, ON, CA" elsewhere. */
export function placeLabel(p: { city: string; region?: string; country?: string }): string {
  if (!p.country || p.country === "US") return p.region ? `${p.city}, ${p.region}` : p.city;
  return [p.city, p.region, p.country].filter(Boolean).join(", ");
}
