import path from "path";
import { VersionedStore } from "./versionedStore";
import { geocodeAddress, geocodeCached, type Geocoder } from "./geocode";

/**
 * Retail stores that carry the brand (Settings → Store locations; public at
 * /stores). Saved with the same race-proof versioned storage as members.
 * The map pin comes from geocoding the address on save, unless staff placed
 * it by hand (dragged the pin or typed lat/lng) — a manual pin always wins.
 */

export type StoreLocation = {
  id: string;
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  phone?: string;
  website?: string;
  hours?: string;
  /** Shown to customers, e.g. "Ask at the counter". */
  notes?: string;
  /** Products this store carries (optional). */
  productIds?: string[];
  active: boolean;
  sort: number;
  lat?: number;
  lng?: number;
  pinSource?: "geocoded" | "manual";
  /** Why there's no pin, when geocoding failed. */
  geocodeError?: string;
  createdAt: number;
  updatedAt: number;
};

/** What the public page and the Concierge see. */
export type PublicStore = Omit<StoreLocation, "active" | "sort" | "pinSource" | "geocodeError" | "createdAt" | "updatedAt">;

const store = new VersionedStore<StoreLocation>({
  name: "stores",
  legacyKey: "stores.json",
  localFile: path.join(process.cwd(), "data", "stores.json"),
  keep: 8,
  reconcileLegacy: false,
});

const bySort = (a: StoreLocation, b: StoreLocation) => a.sort - b.sort || a.name.localeCompare(b.name);

export async function getStores(): Promise<StoreLocation[]> {
  return (await store.read()).data.slice().sort(bySort);
}

export async function getPublicStores(): Promise<PublicStore[]> {
  return (await getStores()).filter((s) => s.active).map(toPublic);
}

export function toPublic(s: StoreLocation): PublicStore {
  const { active: _a, sort: _s, pinSource: _p, geocodeError: _g, createdAt: _c, updatedAt: _u, ...rest } = s;
  return rest;
}

export const addressLine = (s: Pick<StoreLocation, "street" | "city" | "state" | "zip">) =>
  [s.street, [s.city, [s.state, s.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(", ");

const t = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Validates staff input. Coordinates are optional; when given they're a manual pin. */
export function cleanStore(input: Record<string, unknown>):
  | { ok: true; value: Omit<StoreLocation, "id" | "createdAt" | "updatedAt" | "sort" | "pinSource" | "geocodeError"> & { sort?: number; manualPin: boolean; suggestedPin: boolean } }
  | { ok: false; error: string } {
  const name = t(input.name, 120);
  const street = t(input.street, 160);
  const city = t(input.city, 80);
  const state = t(input.state, 40);
  const zip = t(input.zip, 12);
  if (!name) return { ok: false, error: "Give the store a name." };
  if (!city) return { ok: false, error: "Add the store's city." };
  const phone = t(input.phone, 30);
  if (phone && !/^[+()0-9 .\-ext]{7,30}$/i.test(phone)) return { ok: false, error: "That phone number has characters it shouldn't." };
  let website = t(input.website, 300);
  if (website) {
    if (!/^https?:\/\//i.test(website)) website = `https://${website}`;
    try {
      const u = new URL(website);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
    } catch {
      return { ok: false, error: "That website address doesn't look right." };
    }
  }
  const hours = String(input.hours ?? "").trim().slice(0, 400);
  const notes = String(input.notes ?? "").trim().slice(0, 400);
  const productIds = Array.isArray(input.productIds) ? Array.from(new Set(input.productIds.map((x) => t(x, 80)).filter(Boolean))).slice(0, 200) : [];

  const hasLat = input.lat !== undefined && input.lat !== null && String(input.lat).trim() !== "";
  const hasLng = input.lng !== undefined && input.lng !== null && String(input.lng).trim() !== "";
  if (hasLat !== hasLng) return { ok: false, error: "Enter both latitude and longitude, or neither." };
  let lat: number | undefined, lng: number | undefined;
  if (hasLat && hasLng) {
    lat = Number(input.lat);
    lng = Number(input.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { ok: false, error: "Latitude must be between -90 and 90." };
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return { ok: false, error: "Longitude must be between -180 and 180." };
    lat = Math.round(lat * 1e6) / 1e6;
    lng = Math.round(lng * 1e6) / 1e6;
  }
  const sortN = Number(input.sort);
  return {
    ok: true,
    value: {
      name, street, city, state, zip,
      phone: phone || undefined,
      website: website || undefined,
      hours: hours || undefined,
      notes: notes || undefined,
      productIds,
      active: input.active === undefined ? true : !!input.active,
      lat, lng,
      sort: Number.isFinite(sortN) ? Math.round(sortN) : undefined,
      // A pin counts as manual only when staff say so (dragged / typed it).
      manualPin: !!input.manualPin && lat !== undefined,
      // Picked from the address suggestions: use that spot, no second lookup.
      suggestedPin: !input.manualPin && !!input.suggestedPin && lat !== undefined,
    },
  };
}

const newId = () => `st_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Create (no id) or update a store. Geocodes the address when there's no
 * manual pin and the address is new or changed. If the lookup fails the
 * store still saves, without a pin, and says why.
 */
export async function saveStore(id: string | undefined, input: Record<string, unknown>, geocoder?: Geocoder): Promise<{ ok: true; store: StoreLocation; before?: StoreLocation } | { ok: false; error: string; status: number }> {
  const c = cleanStore(input);
  if (!c.ok) return { ok: false, error: c.error, status: 400 };
  const { manualPin, suggestedPin, sort, ...v } = c.value;
  const existing = id ? (await getStores()).find((s) => s.id === id) : undefined;
  if (id && !existing) return { ok: false, error: "That store no longer exists.", status: 404 };

  const address = addressLine(v);
  const addressChanged = !existing || addressLine(existing) !== address;
  let lat = v.lat, lng = v.lng;
  let pinSource: StoreLocation["pinSource"];
  let geocodeError: string | undefined;
  if (manualPin) {
    pinSource = "manual";
  } else if (suggestedPin) {
    pinSource = "geocoded";
  } else if (existing?.pinSource === "manual" && !addressChanged && existing.lat !== undefined) {
    // Untouched manual pin stays put.
    lat = existing.lat; lng = existing.lng; pinSource = "manual";
  } else if (!addressChanged && existing?.lat !== undefined) {
    lat = existing.lat; lng = existing.lng; pinSource = existing.pinSource;
  } else {
    const g = await geocodeAddress(address, geocoder);
    if (g.point) { lat = g.point.lat; lng = g.point.lng; pinSource = "geocoded"; }
    else {
      // Street not found (not a lookup outage): pin the town, marked approximate, rather than no pin.
      const town = !/Couldn't reach/.test(g.error || "") && v.street && v.city ? await geocodeCached(addressLine({ street: "", city: v.city, state: v.state, zip: v.zip }), geocoder) : null;
      if (town?.point) {
        lat = town.point.lat; lng = town.point.lng; pinSource = "geocoded";
        geocodeError = `Couldn't find that street on the map, so the pin is in the middle of ${v.city}. Drag it to the exact spot.`;
      } else { lat = undefined; lng = undefined; pinSource = undefined; geocodeError = `${g.error || "Not found."} Drag the pin on the map or type the latitude and longitude.`; }
    }
  }

  const now = Date.now();
  const saved = await store.mutate((rows) => {
    if (existing) {
      const i = rows.findIndex((r) => r.id === existing.id);
      if (i === -1) return { data: null, result: null as StoreLocation | null };
      const next: StoreLocation = { ...rows[i], ...v, lat, lng, pinSource, geocodeError, sort: sort ?? rows[i].sort, updatedAt: now };
      const out = rows.slice(); out[i] = next;
      return { data: out, result: next };
    }
    const next: StoreLocation = { id: newId(), ...v, lat, lng, pinSource, geocodeError, sort: sort ?? (rows.reduce((m, r) => Math.max(m, r.sort), 0) + 10), createdAt: now, updatedAt: now };
    return { data: [...rows, next], result: next };
  });
  if (!saved) return { ok: false, error: "That store no longer exists.", status: 404 };
  return { ok: true, store: saved, before: existing };
}

export async function deleteStore(id: string): Promise<StoreLocation | null> {
  return store.mutate((rows) => {
    const hit = rows.find((r) => r.id === id) || null;
    if (!hit) return { data: null, result: null };
    return { data: rows.filter((r) => r.id !== id), result: hit };
  }, { allowShrink: true });
}

/** Swap a store with its neighbour in the sort order. */
export async function moveStore(id: string, dir: "up" | "down"): Promise<boolean> {
  return store.mutate((rows) => {
    const list = rows.slice().sort(bySort);
    const i = list.findIndex((r) => r.id === id);
    const j = dir === "up" ? i - 1 : i + 1;
    if (i === -1 || j < 0 || j >= list.length) return { data: null, result: false };
    const a = list[i], b = list[j];
    const out = rows.map((r) => (r.id === a.id ? { ...r, sort: b.sort } : r.id === b.id ? { ...r, sort: a.sort } : r));
    // Equal sort values: separate them so the swap sticks.
    if (a.sort === b.sort) return { data: out.map((r) => (r.id === a.id ? { ...r, sort: b.sort + (dir === "up" ? -1 : 1) } : r)), result: true };
    return { data: out, result: true };
  });
}
