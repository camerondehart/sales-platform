import path from "path";
import { VersionedStore } from "./versionedStore";
import type { Product } from "./storage";
import type { OrderItem } from "./orders";

/**
 * Stock counts (Products → Stock counts). Kept in their own race-proof store,
 * not in products.json, so checkout never rewrites the catalog.
 *
 * - A product with no row isn't tracked: it sells as always.
 * - At 0 a product shows "Currently restocking" and can STILL be ordered —
 *   the count never goes below 0 and the order line is marked `restocking`.
 * - A bundle product is made of other products: it uses their counts.
 * - Only counts when the "stock_counts" switch is on (checkout + shop).
 */

export type StockRow = { id: string; qty: number; updatedAt: number };
/** What an order took, so cancelling can put it back exactly. */
export type StockTaken = Array<{ productId: string; qty: number }>;

const store = new VersionedStore<StockRow>({
  name: "stock",
  legacyKey: "stock.json",
  localFile: path.join(process.cwd(), "data", "stock.json"),
  keep: 8,
  reconcileLegacy: false,
});

export async function getStock(): Promise<Map<string, number>> {
  return new Map((await store.read()).data.map((r) => [r.id, r.qty]));
}

// Shop pages read the counts on every view; 30 s here saves a Blob lookup
// per page. Checkout and staff always read fresh.
let shopCache: { at: number; stock: Map<string, number> } | null = null;
async function shopStock(): Promise<Map<string, number>> {
  if (shopCache && Date.now() - shopCache.at < 30_000) return shopCache.stock;
  const stock = await getStock();
  shopCache = { at: Date.now(), stock };
  return stock;
}

/** 0–99999 whole number, or null for "not tracked". Anything else is an error. */
export function cleanQty(v: unknown): number | null | "bad" {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 99999 || Math.floor(n) !== n) return "bad";
  return n;
}

/** Set (or clear, with null) several counts in one write. Returns the before/after for the log. */
export async function setStock(changes: Record<string, number | null>): Promise<{ before: Record<string, number | null>; after: Record<string, number | null> }> {
  return store.mutate((rows) => {
    const before: Record<string, number | null> = {};
    const after: Record<string, number | null> = {};
    const byId = new Map(rows.map((r) => [r.id, r]));
    const now = Date.now();
    for (const [id, qty] of Object.entries(changes)) {
      before[id] = byId.has(id) ? byId.get(id)!.qty : null;
      after[id] = qty;
      if (qty === null) byId.delete(id);
      else byId.set(id, { id, qty, updatedAt: now });
    }
    return { data: Array.from(byId.values()), result: { before, after } };
  }, { allowShrink: true }).finally(() => { shopCache = null; });
}

/** The real items an order line uses: a bundle product counts as its parts. */
function unitsOf(items: Array<Pick<OrderItem, "productId" | "quantity">>, products: Map<string, Product>): Map<string, number> {
  const out = new Map<string, number>();
  const add = (id: string, n: number) => out.set(id, (out.get(id) || 0) + n);
  for (const it of items) {
    const p = products.get(it.productId);
    if (p?.isBundle && p.bundleProducts?.length) p.bundleProducts.forEach((c) => add(c, it.quantity));
    else add(it.productId, it.quantity);
  }
  return out;
}

/** Is this product restocking? (tracked and at 0; a bundle when any part is.) */
export function isRestocking(p: Pick<Product, "id" | "isBundle" | "bundleProducts">, stock: Map<string, number>): boolean {
  const ids = p.isBundle && p.bundleProducts?.length ? p.bundleProducts : [p.id];
  return ids.some((id) => stock.has(id) && stock.get(id)! <= 0);
}

/**
 * Checkout: take the units this order uses from the tracked counts (never
 * below 0). Returns what was actually taken, plus which order lines were
 * short — those are marked "restocking" on the order.
 */
export async function takeStock(
  items: Array<Pick<OrderItem, "productId" | "quantity">>,
  products: Map<string, Product>
): Promise<{ taken: StockTaken; shortLines: Set<string> }> {
  const need = unitsOf(items, products);
  return store.mutate((rows) => {
    const taken: StockTaken = [];
    const short = new Set<string>();
    const now = Date.now();
    const out = rows.map((r) => {
      const n = need.get(r.id);
      if (!n) return r;
      const got = Math.min(n, Math.max(0, r.qty));
      if (got < n) short.add(r.id);
      if (got > 0) taken.push({ productId: r.id, qty: got });
      return got > 0 ? { ...r, qty: r.qty - got, updatedAt: now } : r;
    });
    // Which order lines touch a short product (a bundle line when any part is short).
    const shortLines = new Set<string>();
    for (const it of items) {
      const p = products.get(it.productId);
      const ids = p?.isBundle && p.bundleProducts?.length ? p.bundleProducts : [it.productId];
      if (ids.some((id) => short.has(id))) shortLines.add(it.productId);
    }
    return { data: taken.length ? out : null, result: { taken, shortLines } };
  }).finally(() => { shopCache = null; });
}

/** Put units back (a cancelled order). Only products still tracked get them. */
export async function returnStock(taken: StockTaken): Promise<void> {
  if (!taken.length) return;
  const back = new Map<string, number>();
  taken.forEach((t) => back.set(t.productId, (back.get(t.productId) || 0) + t.qty));
  await store.mutate((rows) => {
    let changed = false;
    const now = Date.now();
    const out = rows.map((r) => {
      const n = back.get(r.id);
      if (!n) return r;
      changed = true;
      return { ...r, qty: Math.min(99999, r.qty + n), updatedAt: now };
    });
    return { data: changed ? out : null, result: undefined };
  }).finally(() => { shopCache = null; });
}

/**
 * Checkout helper: when the switch is on, take stock for these lines and mark
 * the short ones "restocking". Never throws — a stock hiccup must not stop
 * an order (it just isn't counted, and the log says so).
 */
export async function reserveForOrder<T extends Pick<OrderItem, "productId" | "quantity"> & { restocking?: boolean }>(
  items: T[],
  products: Map<string, Product>
): Promise<{ items: T[]; stockTaken?: StockTaken }> {
  try {
    const { isEnabled } = await import("./flags");
    if (!(await isEnabled("stock_counts"))) return { items };
    const { taken, shortLines } = await takeStock(items, products);
    return {
      items: items.map((it) => (shortLines.has(it.productId) ? { ...it, restocking: true } : it)),
      stockTaken: taken.length ? taken : undefined,
    };
  } catch (err) {
    console.error("[stock] couldn't count this order against stock", err);
    return { items };
  }
}

/** Shop pages: add `restocking: true` to products at 0 (switch on only). Counts stay private. */
export async function applyStockFlag<T extends Pick<Product, "id" | "isBundle" | "bundleProducts">>(products: T[]): Promise<Array<T & { restocking?: boolean }>> {
  try {
    const { isEnabled } = await import("./flags");
    if (!(await isEnabled("stock_counts"))) return products;
    const stock = await shopStock();
    if (stock.size === 0) return products;
    return products.map((p) => (isRestocking(p, stock) ? { ...p, restocking: true } : p));
  } catch {
    return products;
  }
}
