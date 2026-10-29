/**
 * Address suggestions while staff type a store's street (Settings → Store
 * locations). Photon (photon.komoot.io): OpenStreetMap data, free, no key,
 * built for search-as-you-type (Nominatim's policy forbids that). Called from
 * our server only, US results only, cached, and the form waits for a pause in
 * typing before asking.
 */

export type AddressSuggestion = { label: string; street: string; city: string; state: string; zip: string; lat: number; lng: number; /** Business name, when the match is a shop or other place. */ place?: string };
import { brand } from "@/lib/brand";

const BASE = (process.env.PHOTON_URL || "https://photon.komoot.io").replace(/\/$/, "");
const USER_AGENT = `StorefrontStoreLocator/1.0 (+${brand.siteUrl}; ${brand.supportEmail})`;
// Lower 48 + Alaska + Hawaii, roughly; results are also filtered to countrycode US.
const US_BBOX = "-179.2,18.9,-66.9,71.4";

type Feature = {
  geometry?: { coordinates?: [number, number] };
  properties?: { osm_key?: string; housenumber?: string; street?: string; name?: string; city?: string; town?: string; village?: string; district?: string; state?: string; postcode?: string; countrycode?: string; type?: string };
};

const memo = new Map<string, { at: number; rows: AddressSuggestion[] }>();
const TTL = 10 * 60 * 1000;

/** Suggestions for what they typed; if none, the same retries as store lookups (no suite, "Eighth" → "8th"). */
export async function suggestAddresses(q: string): Promise<AddressSuggestion[]> {
  const { addressVariants } = await import("./geocode");
  for (const v of addressVariants(q)) {
    const rows = await suggestOnce(v);
    if (rows.length) return rows;
  }
  return [];
}

/** Businesses matching a name ("Main Street Market"), with their address. */
export async function suggestPlaces(q: string): Promise<AddressSuggestion[]> {
  return (await suggestOnce(q, true)).filter((r) => r.place);
}

async function suggestOnce(q: string, places = false): Promise<AddressSuggestion[]> {
  const query = q.replace(/\s+/g, " ").trim().slice(0, 120);
  if (query.length < 4) return [];
  const key = `${places ? "p" : "a"}:${query.toLowerCase()}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.rows;

  const url = `${BASE}/api/?q=${encodeURIComponent(query)}&limit=${places ? 10 : 8}&lang=en&bbox=${US_BBOX}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  let feats: Feature[] = [];
  try {
    const r = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: ctrl.signal, cache: "no-store" });
    if (!r.ok) throw new Error(`suggestions HTTP ${r.status}`);
    feats = ((await r.json()) as { features?: Feature[] }).features || [];
  } finally {
    clearTimeout(timer);
  }
  const seen = new Set<string>();
  const rows: AddressSuggestion[] = [];
  for (const f of feats) {
    const p = f.properties || {};
    const [lng, lat] = (f.geometry?.coordinates || []) as number[];
    if ((p.countrycode || "").toUpperCase() !== "US" || typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const road = p.street || (p.type === "street" ? p.name : "") || "";
    const street = [p.housenumber, road].filter(Boolean).join(" ") || (p.name && p.name !== (p.city || p.town) ? p.name : "");
    const city = p.city || p.town || p.village || p.district || "";
    if (!street || !city) continue;
    // A named shop/amenity (not a road or town): the name is the business.
    const isPlace = !!p.name && !!p.street && !["highway", "place", "boundary", "landuse"].includes(p.osm_key || "") && p.name !== road;
    const row: AddressSuggestion = { street, city, state: p.state || "", zip: (p.postcode || "").slice(0, 10), lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, label: "", ...(isPlace ? { place: p.name } : {}) };
    row.label = [row.place, row.street, row.city, [row.state, row.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    if (seen.has(row.label)) continue;
    seen.add(row.label);
    rows.push(row);
    if (rows.length >= 5) break;
  }
  if (memo.size > 300) memo.clear();
  memo.set(key, { at: Date.now(), rows });
  return rows;
}
