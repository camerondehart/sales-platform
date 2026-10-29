import path from "path";
import { VersionedStore } from "./versionedStore";
import { brand } from "@/lib/brand";

/**
 * Address → map position, server-side only. Behind a small interface so the
 * provider can be swapped later. Today: Nominatim (OpenStreetMap), following
 * its usage policy — a real User-Agent, at most one request a second, and
 * every result cached (hits for good, misses for a day).
 */

export type GeoPoint = { lat: number; lng: number; label?: string };

export interface Geocoder {
  readonly name: string;
  /** null = not found (or the provider failed — callers treat both the same). */
  geocode(query: string): Promise<GeoPoint | null>;
}

const BASE = (process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org").replace(/\/$/, "");
const USER_AGENT = `StorefrontStoreLocator/1.0 (+${brand.siteUrl}; ${brand.supportEmail})`;
const MIN_GAP_MS = 1100;
const MISS_TTL_MS = 24 * 60 * 60 * 1000;

// One request at a time, at least ~1 s apart (per server instance).
let queue: Promise<unknown> = Promise.resolve();
let lastAt = 0;
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    return fn();
  });
  queue = run.catch(() => undefined);
  return run;
}

export const nominatim: Geocoder = {
  name: "nominatim",
  async geocode(query) {
    return throttled(async () => {
      const url = `${BASE}/search?format=jsonv2&limit=1&addressdetails=0&q=${encodeURIComponent(query)}`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" }, signal: ctrl.signal, cache: "no-store" });
        if (!res.ok) throw new Error(`geocoder HTTP ${res.status}`);
        const rows = (await res.json()) as Array<{ lat?: string; lon?: string; display_name?: string }>;
        const hit = Array.isArray(rows) ? rows[0] : undefined;
        const lat = Number(hit?.lat), lng = Number(hit?.lon);
        if (!hit || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return { lat, lng, label: hit.display_name };
      } finally {
        clearTimeout(timer);
      }
    });
  },
};

type CacheRow = { id: string; lat?: number; lng?: number; label?: string; at: number; miss?: boolean };

const cache = new VersionedStore<CacheRow>({
  name: "geocode-cache",
  legacyKey: "geocode-cache.json",
  localFile: path.join(process.cwd(), "data", "geocode-cache.json"),
  keep: 4,
  reconcileLegacy: false,
});

const keyOf = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 200);

/**
 * Cached lookup. Never throws: a provider error comes back as
 * { point: null, error } so a store still saves without a pin.
 */
export async function geocodeCached(query: string, geocoder: Geocoder = nominatim): Promise<{ point: GeoPoint | null; cached: boolean; error?: string }> {
  const key = keyOf(query);
  if (!key) return { point: null, cached: false, error: "No address to look up." };
  try {
    const hit = (await cache.read()).data.find((r) => r.id === key);
    if (hit && !hit.miss && typeof hit.lat === "number" && typeof hit.lng === "number") return { point: { lat: hit.lat, lng: hit.lng, label: hit.label }, cached: true };
    if (hit?.miss && Date.now() - hit.at < MISS_TTL_MS) return { point: null, cached: true, error: "That address wasn't found on the map." };
  } catch {
    /* cache unreadable — fall through to a live lookup */
  }
  let point: GeoPoint | null = null;
  try {
    point = await geocoder.geocode(query);
  } catch (err) {
    // Provider down: don't cache, so the next save tries again.
    return { point: null, cached: false, error: `Couldn't reach the map lookup (${err instanceof Error ? err.message : "error"}).` };
  }
  const row: CacheRow = point ? { id: key, lat: point.lat, lng: point.lng, label: point.label, at: Date.now() } : { id: key, at: Date.now(), miss: true };
  await cache
    .mutate((rows) => ({ data: [...rows.filter((r) => r.id !== key), row].slice(-2000), result: null }))
    .catch(() => {});
  return point ? { point, cached: false } : { point: null, cached: false, error: "That address wasn't found on the map." };
}

const ORDINALS: Record<string, string> = {
  first: "1st", second: "2nd", third: "3rd", fourth: "4th", fifth: "5th", sixth: "6th", seventh: "7th", eighth: "8th", ninth: "9th", tenth: "10th",
  eleventh: "11th", twelfth: "12th", thirteenth: "13th", fourteenth: "14th", fifteenth: "15th", sixteenth: "16th", seventeenth: "17th", eighteenth: "18th", nineteenth: "19th", twentieth: "20th",
};

/**
 * Other ways to write the same address, for when the map lookup misses:
 * without the suite/unit ("Ste 120", "Suite 150", "#3"), and with spelled-out
 * street numbers as digits ("E Eighth St" → "E 8th St").
 */
export function addressVariants(q: string): string[] {
  const noUnit = q
    .replace(/,?\s*(?:\b(?:ste|suite|unit|apt|bldg|building|spc|space)\b\.?|#)\s*[a-z0-9-]+\b/gi, "")
    .replace(/\s+,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();
  const digits = (x: string) => x.replace(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth)\b/gi, (w) => ORDINALS[w.toLowerCase()]);
  return Array.from(new Set([q, noUnit, digits(q), digits(noUnit)].map((x) => x.trim()).filter(Boolean)));
}

/**
 * A store address → pin. Tries the address as written, then the variants
 * above. Never throws; a provider error stops early (and isn't cached).
 */
export async function geocodeAddress(query: string, geocoder: Geocoder = nominatim): Promise<{ point: GeoPoint | null; cached: boolean; error?: string }> {
  let last: { point: GeoPoint | null; cached: boolean; error?: string } = { point: null, cached: false, error: "No address to look up." };
  for (const q of addressVariants(query)) {
    last = await geocodeCached(q, geocoder);
    if (last.point || /Couldn't reach/.test(last.error || "")) return last;
  }
  return last;
}

/** Great-circle distance in miles. */
export function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
