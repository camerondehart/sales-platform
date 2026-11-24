/**
 * Scheduled sitewide sales: storage and the overlay on product reads.
 * Rules (who's covered, validation) are in lib/siteSaleRules.ts; the price is
 * worked out in lib/pricing.ts from `sitePromo`.
 *
 * getProducts() (lib/storage.ts) runs every product through applySiteSales,
 * so every shop page, the cart, both checkouts, invoices and the Concierge see
 * the same sale price at the same moment. Saves use the raw catalog, and
 * `sitePromo` is stripped before any save, so a sale never sticks to a product.
 */

import path from "path";
import { VersionedStore } from "./versionedStore";
import { isEnabled } from "./flags";
import { singleton } from "./assistant/singleton";
import { cleanSale, saleState, withSales, type SaleInput, type SaleProduct, type SiteSale } from "./siteSaleRules";

export type { SiteSale };

const store = singleton(
  "siteSaleStore",
  () =>
    new VersionedStore<SiteSale>({
      name: "site-sales",
      legacyKey: "site-sales.json",
      localFile: path.join(process.cwd(), "data", "site-sales.json"),
      keep: 10,
      reconcileLegacy: false,
    })
);

// Product reads happen on every shop page, so the list is kept for a few
// seconds per server. Whether a sale is running is still worked out from the
// clock on every read, so a sale starts and ends on the minute.
const CACHE_MS = 15_000;
const cache = singleton("siteSaleCache", () => ({ at: 0, data: null as SiteSale[] | null }));

export async function listSales(): Promise<SiteSale[]> {
  const data = (await store.read()).data;
  cache.at = Date.now();
  cache.data = data;
  return data.slice().sort((a, b) => b.startsAt - a.startsAt);
}

async function cachedSales(): Promise<SiteSale[]> {
  if (cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;
  return listSales();
}

/** Products with any running sale applied. Never throws: on a failed read the products come back unchanged. */
export async function applySiteSales<T extends SaleProduct & { sitePromo?: number }>(products: T[], now = Date.now()): Promise<T[]> {
  try {
    if (!products.length || !(await isEnabled("scheduled_sales"))) return products;
    return withSales(products, await cachedSales(), now);
  } catch (err) {
    console.error("[site-sales] read failed; showing regular prices", err);
    return products;
  }
}

type Changed = { before: SiteSale; sale: SiteSale } | "done" | null;

const newId = () => `ss${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export async function createSale(input: SaleInput, known: SaleProduct[], by: string): Promise<{ ok: true; sale: SiteSale } | { ok: false; error: string }> {
  const c = cleanSale(input, known);
  if (!c.ok) return c;
  const now = Date.now();
  const sale: SiteSale = { ...c.value, id: newId(), createdBy: by, createdAt: now, updatedAt: now };
  await store.mutate((rows) => {
    if (rows.length >= 200) throw new Error("Too many sales saved — delete some old ones first.");
    return { data: [...rows, sale], result: undefined };
  });
  cache.data = null;
  return { ok: true, sale };
}

export async function updateSale(id: string, input: SaleInput, known: SaleProduct[]): Promise<{ ok: true; before: SiteSale; sale: SiteSale } | { ok: false; error: string; status?: number }> {
  const c = cleanSale(input, known);
  if (!c.ok) return c;
  const out = await store.mutate<Changed>((rows) => {
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0) return { data: null, result: null };
    const st = saleState(rows[i]);
    if (st === "ended" || st === "cancelled") return { data: null, result: "done" as const };
    const next = rows.slice();
    next[i] = { ...rows[i], ...c.value, productIds: c.value.productIds, category: c.value.category, updatedAt: Date.now() };
    return { data: next, result: { before: rows[i], sale: next[i] } };
  });
  cache.data = null;
  if (!out) return { ok: false, error: "That sale no longer exists.", status: 404 };
  if (out === "done") return { ok: false, error: "That sale is already over, so it can't be changed. Schedule a new one instead." };
  return { ok: true, ...out };
}

/** End a running sale now, or cancel one that hasn't started. */
export async function endSale(id: string): Promise<{ ok: true; before: SiteSale; sale: SiteSale } | { ok: false; error: string; status?: number }> {
  const out = await store.mutate<Changed>((rows) => {
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0) return { data: null, result: null };
    const st = saleState(rows[i]);
    if (st === "ended" || st === "cancelled") return { data: null, result: "done" as const };
    const next = rows.slice();
    const now = Date.now();
    next[i] = { ...rows[i], endedAt: st === "scheduled" ? rows[i].startsAt : now, updatedAt: now };
    return { data: next, result: { before: rows[i], sale: next[i] } };
  });
  cache.data = null;
  if (!out) return { ok: false, error: "That sale no longer exists.", status: 404 };
  if (out === "done") return { ok: false, error: "That sale has already ended." };
  return { ok: true, ...out };
}

export async function deleteSale(id: string): Promise<SiteSale | null> {
  const hit = await store.mutate((rows) => {
    const s = rows.find((r) => r.id === id);
    if (!s) return { data: null, result: null };
    return { data: rows.filter((r) => r.id !== id), result: s };
  });
  cache.data = null;
  return hit;
}
