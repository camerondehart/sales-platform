import path from "path";
import { VersionedStore } from "./versionedStore";
import { isEnabled } from "./flags";
import { bundleLive, type Bundle } from "./bundles";

/** Mix-and-match bundles: storage + validation (server only). Pricing lives in lib/bundles.ts. */

const store = new VersionedStore<Bundle>({
  name: "bundles",
  legacyKey: "bundles.json",
  localFile: path.join(process.cwd(), "data", "bundles.json"),
  keep: 10,
  reconcileLegacy: false,
});

export async function listBundles(): Promise<Bundle[]> {
  return (await store.read()).data.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Bundles that price carts right now. Empty when the feature switch is off.
 * Throws if they can't be read while the switch is on — checkout then asks the
 * customer to retry rather than silently charging without the bundle.
 */
export async function liveBundles(now = Date.now()): Promise<Bundle[]> {
  if (!(await isEnabled("bundles_specific_products"))) return [];
  return (await listBundles()).filter((b) => bundleLive(b, now));
}

export function cleanBundle(input: unknown, productIds: Set<string>): { ok: true; value: Omit<Bundle, "id" | "createdAt" | "updatedAt"> } | { ok: false; error: string } {
  const b = (input || {}) as Partial<Bundle> & { items?: Array<{ productId?: string; qty?: number }> };
  const name = String(b.name || "").trim().slice(0, 80);
  if (!name) return { ok: false, error: "Give the bundle a name." };
  const merged = new Map<string, number>();
  for (const i of b.items || []) {
    const id = String(i?.productId || "");
    if (!productIds.has(id)) return { ok: false, error: "One of the products in this bundle no longer exists." };
    const q = Math.floor(Number(i?.qty ?? 1));
    if (!(q >= 1 && q <= 20)) return { ok: false, error: "Each product needs a quantity between 1 and 20." };
    merged.set(id, (merged.get(id) || 0) + q);
  }
  const items = Array.from(merged.entries()).map(([productId, qty]) => ({ productId, qty }));
  if (items.reduce((n, i) => n + i.qty, 0) < 2) return { ok: false, error: "A bundle needs at least 2 items." };
  if (items.length > 12) return { ok: false, error: "Up to 12 different products per bundle." };
  const type = b.type === "price" ? "price" : b.type === "percent" ? "percent" : null;
  if (!type) return { ok: false, error: "Choose percent off or a set price." };
  const value = Math.round(Number(b.value) * 100) / 100;
  if (type === "percent" && !(value >= 1 && value <= 90)) return { ok: false, error: "Percent off must be between 1 and 90." };
  if (type === "price" && !(value > 0 && value < 100000)) return { ok: false, error: "The set price must be above $0." };
  const startsAt = b.startsAt ? Number(b.startsAt) : undefined;
  const endsAt = b.endsAt ? Number(b.endsAt) : undefined;
  if ((startsAt !== undefined && !Number.isFinite(startsAt)) || (endsAt !== undefined && !Number.isFinite(endsAt))) return { ok: false, error: "Check the dates." };
  if (startsAt && endsAt && endsAt <= startsAt) return { ok: false, error: "The end date has to be after the start." };
  return { ok: true, value: { name, items, type, value, startsAt, endsAt, active: b.active !== false } };
}

export async function createBundle(v: Omit<Bundle, "id" | "createdAt" | "updatedAt">): Promise<Bundle> {
  const now = Date.now();
  const row: Bundle = { ...v, id: `bd${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, createdAt: now, updatedAt: now };
  await store.mutate((rows) => {
    if (rows.length >= 60) throw new Error("That's a lot of bundles — delete some old ones first (up to 60).");
    return { data: [...rows, row], result: undefined };
  });
  return row;
}

export async function updateBundle(id: string, v: Partial<Omit<Bundle, "id" | "createdAt">>): Promise<{ before: Bundle; after: Bundle } | null> {
  return store.mutate((rows) => {
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0) return { data: null, result: null };
    const next = rows.slice();
    next[i] = { ...rows[i], ...v, id, updatedAt: Date.now() };
    return { data: next, result: { before: rows[i], after: next[i] } };
  });
}

export async function deleteBundle(id: string): Promise<Bundle | null> {
  return store.mutate((rows) => {
    const hit = rows.find((r) => r.id === id);
    if (!hit) return { data: null, result: null };
    return { data: rows.filter((r) => r.id !== id), result: hit };
  }, { allowShrink: true });
}
