/**
 * Backorders and restock needs, worked out from orders + stock counts.
 * No imports, so the dashboard, the Today list and the unit test share it.
 *
 * Backorder = units on open orders (pending or paid, not yet completed or
 * cancelled) that the stock couldn't cover when they were placed: what each
 * line needed minus what that order actually took (order.stockTaken).
 */

type Item = { productId: string; quantity: number; restocking?: boolean };
type Ord = { id?: string; userName?: string; status: string; isInquiry?: boolean; createdAt: number; items: Item[]; stockTaken?: Array<{ productId: string; qty: number }>; stockReturnedAt?: number };
type Prod = { id: string; name: string; isBundle?: boolean; bundleProducts?: string[] };

const open = (s: string) => s === "pending" || s === "paid";
const sold = (s: string) => s !== "cancelled" && s !== "inquiry";

/** Real products a line uses (a bundle counts as its parts). */
function units(items: Item[], byId: Map<string, Prod>, onlyShort: boolean): Map<string, number> {
  const out = new Map<string, number>();
  for (const it of items) {
    if (onlyShort && !it.restocking) continue;
    const p = byId.get(it.productId);
    const ids = p?.isBundle && p.bundleProducts?.length ? p.bundleProducts : [it.productId];
    for (const id of ids) out.set(id, (out.get(id) || 0) + it.quantity);
  }
  return out;
}

export type Owed = { units: number; orders: number; /** Each waiting order (newest last). */ list: Array<{ orderId?: string; name?: string; units: number }> };

/** productId → { units owed, open orders waiting, which orders }. */
export function backorders(orders: Ord[], products: Prod[]): Map<string, Owed> {
  const byId = new Map(products.map((p) => [p.id, p]));
  const out = new Map<string, Owed>();
  for (const o of orders) {
    if (o.isInquiry || !open(o.status) || !o.items.some((i) => i.restocking)) continue;
    const need = units(o.items, byId, true);
    const taken = new Map((o.stockReturnedAt ? [] : o.stockTaken || []).map((t) => [t.productId, t.qty]));
    for (const [id, n] of need) {
      const owed = n - (taken.get(id) || 0);
      if (owed <= 0) continue;
      const cur = out.get(id) || { units: 0, orders: 0, list: [] };
      out.set(id, { units: cur.units + owed, orders: cur.orders + 1, list: [...cur.list, { orderId: o.id, name: o.userName, units: owed }] });
    }
  }
  return out;
}

export type RestockNeed = {
  id: string;
  name: string;
  onHand: number;
  owed: number;
  ordersWaiting: number;
  sold30: number;
  /** Days the shelf lasts at the last 30 days' pace (null = no recent sales). */
  daysLeft: number | null;
  /** Units to order: cover what's owed plus about 30 days of sales. */
  suggest: number;
  why: "backorder" | "out" | "low";
};

/**
 * Products that need restocking, most urgent first: anything owed on orders,
 * then counted products at 0, then ones running low (≤ 3 left, or under two
 * weeks at the recent pace). Only products with a stock count are considered.
 */
export function restockNeeds(stock: Map<string, number>, orders: Ord[], products: Prod[], now: number): RestockNeed[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const owed = backorders(orders, products);
  const recent = new Map<string, number>();
  for (const o of orders) {
    if (o.isInquiry || !sold(o.status) || now - o.createdAt > 30 * 86400000) continue;
    for (const [id, n] of units(o.items, byId, false)) recent.set(id, (recent.get(id) || 0) + n);
  }
  const out: RestockNeed[] = [];
  for (const [id, qty] of stock) {
    const p = byId.get(id);
    if (!p || p.isBundle) continue;
    const b = owed.get(id) || { units: 0, orders: 0, list: [] };
    const s30 = recent.get(id) || 0;
    const daysLeft = s30 > 0 ? Math.floor(qty / (s30 / 30)) : null;
    const why = b.units > 0 ? "backorder" : qty <= 0 ? "out" : qty <= 3 || (daysLeft !== null && daysLeft < 14) ? "low" : null;
    if (!why) continue;
    out.push({ id, name: p.name, onHand: Math.max(0, qty), owed: b.units, ordersWaiting: b.orders, sold30: s30, daysLeft, suggest: Math.max(1, b.units + s30 - Math.max(0, qty)), why });
  }
  const rank = { backorder: 0, out: 1, low: 2 } as const;
  return out.sort((a, b) => rank[a.why] - rank[b.why] || b.owed - a.owed || (a.daysLeft ?? 999) - (b.daysLeft ?? 999) || a.name.localeCompare(b.name));
}
