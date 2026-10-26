import { isRevenue } from "../analytics";
import { parsePrice, type Order } from "../orders";
import type { Product } from "../storage";
import type { User } from "../users";
import { brand } from "@/lib/brand";

/**
 * Sales insights for the staff assistant: who buys the most, what's moving,
 * how this period compares with the one before.
 *
 * Same rules as the dashboard's analytics:
 *   - only orders marked paid / completed count as sales
 *   - a sale lands on the day it was paid (or created, for older orders)
 * Customers are matched by email, so a person's guest orders and member
 * orders count together.
 *
 * Pure function over the data passed in — no reads — so it's easy to test
 * and never slows the chat down with extra Blob calls.
 */

export type InsightOptions = {
  from: number;
  to: number;
  label: string;
  top: number;
  /** Only orders that include this product (name fragment). */
  product?: string;
  /** Profile of one customer (email or name fragment). */
  customer?: string;
  /** Start of the comparison period (it ends at `from`). Default: same length just before. */
  prevFrom?: number;
};

const DAY = 86_400_000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const $ = (n: number) => `$${r2(n).toFixed(2)}`;
const pct = (now: number, before: number) => (before > 0 ? `${Math.round(((now - before) / before) * 100)}%` : now > 0 ? "new" : "—");
const soldAt = (o: Order) => o.paidAt || o.createdAt;
const key = (o: Order) => (o.userEmail || o.userId || "").trim().toLowerCase();

function day(t: number, tz: string) {
  return new Date(t).toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric" });
}

export function computeInsights(
  orders: Order[],
  users: User[],
  products: Product[],
  opt: InsightOptions,
  tz = brand.timezone
) {
  const top = Math.max(3, Math.min(25, Math.floor(opt.top) || 10));
  const span = Math.max(DAY, opt.to - opt.from);
  const prevFrom = opt.prevFrom ?? opt.from - span;

  const paid = orders.filter(isRevenue);
  const memberEmails = new Set(users.filter((u) => u.status === "approved").map((u) => u.email.toLowerCase()));
  const productById = new Map(products.map((p) => [p.id, p]));

  // Optional product focus: keep orders that contain it.
  let focus: Product[] = [];
  if (opt.product) {
    const q = opt.product.toLowerCase();
    focus = products.filter((p) => p.name.toLowerCase().includes(q));
    if (focus.length === 0) return { error: `No product matches "${opt.product}". Use list_products for exact names.` };
  }
  const focusIds = new Set(focus.map((p) => p.id));
  const hasFocus = (o: Order) => focusIds.size === 0 || o.items.some((i) => focusIds.has(i.productId));

  const inRange = (o: Order, a: number, b: number) => soldAt(o) >= a && soldAt(o) < b;
  const cur = paid.filter((o) => inRange(o, opt.from, opt.to) && hasFocus(o));
  const prev = paid.filter((o) => inRange(o, prevFrom, opt.from) && hasFocus(o));

  // ---------------------------------------------------------- one customer
  if (opt.customer) {
    const q = opt.customer.toLowerCase();
    const mine = paid.filter((o) => key(o).includes(q) || o.userName.toLowerCase().includes(q));
    const emails = Array.from(new Set(mine.map(key)));
    if (emails.length === 0) return { error: `No paid orders from anyone matching "${opt.customer}".` };
    if (emails.length > 1) {
      return { note: "Several customers match — ask which one.", matches: emails.slice(0, 10).map((e) => ({ email: e, name: mine.find((o) => key(o) === e)!.userName })) };
    }
    const favs = new Map<string, number>();
    for (const o of mine) for (const i of o.items) favs.set(i.productName, (favs.get(i.productName) || 0) + i.quantity);
    const sorted = mine.slice().sort((a, b) => soldAt(a) - soldAt(b));
    const spend = mine.reduce((n, o) => n + o.total, 0);
    return {
      customer: {
        name: sorted[sorted.length - 1].userName,
        email: emails[0],
        member: memberEmails.has(emails[0]),
        lifetime_orders: mine.length,
        lifetime_spend: $(spend),
        avg_order: $(spend / mine.length),
        first_order: day(soldAt(sorted[0]), tz),
        last_order: day(soldAt(sorted[sorted.length - 1]), tz),
        days_since_last_order: Math.floor((Date.now() - soldAt(sorted[sorted.length - 1])) / DAY),
        favourite_products: Array.from(favs.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, u]) => `${n} ×${u}`),
      },
    };
  }

  // ---------------------------------------------------------- totals
  const sum = (list: Order[]) => {
    const revenue = list.reduce((n, o) => n + o.total, 0);
    return {
      orders: list.length,
      revenue,
      product_revenue: list.reduce((n, o) => n + o.total - (o.shippingCost || 0), 0),
      discounts: list.reduce((n, o) => n + (o.discount || 0), 0),
      customers: new Set(list.map(key)).size,
      avg: list.length ? revenue / list.length : 0,
    };
  };
  const a = sum(cur);
  const b = sum(prev);

  // ---------------------------------------------------------- customers
  type Cust = { name: string; email: string; orders: number; spend: number; last: number };
  const group = (list: Order[]) => {
    const m = new Map<string, Cust>();
    for (const o of list) {
      const k = key(o);
      const c = m.get(k) || { name: o.userName, email: k, orders: 0, spend: 0, last: 0 };
      c.orders += 1;
      c.spend += o.total;
      if (soldAt(o) >= c.last) {
        c.last = soldAt(o);
        c.name = o.userName || c.name;
      }
      m.set(k, c);
    }
    return Array.from(m.values());
  };
  const custRow = (c: Cust) => ({
    name: c.name,
    email: c.email,
    member: memberEmails.has(c.email),
    orders: c.orders,
    spend: $(c.spend),
    last_order: day(c.last, tz),
  });
  const periodCust = group(cur);
  const firstEver = new Map<string, number>();
  for (const o of paid) {
    const k = key(o);
    firstEver.set(k, Math.min(firstEver.get(k) ?? Infinity, soldAt(o)));
  }
  const newCount = periodCust.filter((c) => (firstEver.get(c.email) ?? 0) >= opt.from).length;

  // Lapsed: bought 2+ times ever, nothing in the last 60 days — worth a nudge.
  const lifetime = group(paid.filter(hasFocus));
  const lapsed = lifetime
    .filter((c) => c.orders >= 2 && Date.now() - c.last > 60 * DAY)
    .sort((x, y) => y.spend - x.spend)
    .slice(0, Math.min(top, 10))
    .map((c) => ({ ...custRow(c), days_since: Math.floor((Date.now() - c.last) / DAY) }));

  // ---------------------------------------------------------- products
  type Line = { name: string; category: string; units: number; revenue: number; orders: number };
  const byProduct = (list: Order[]) => {
    const m = new Map<string, Line>();
    for (const o of list) {
      for (const i of o.items) {
        const p = productById.get(i.productId);
        const l = m.get(i.productId) || { name: p?.name || i.productName, category: p?.category || "Uncategorized", units: 0, revenue: 0, orders: 0 };
        l.units += i.quantity;
        l.revenue += parsePrice(i.price) * i.quantity;
        l.orders += 1;
        m.set(i.productId, l);
      }
    }
    return m;
  };
  const pNow = byProduct(cur);
  const pBefore = byProduct(prev);
  const prodRow = ([id, l]: [string, Line]) => ({
    name: l.name,
    units: l.units,
    revenue: $(l.revenue),
    orders: l.orders,
    units_vs_prev: pct(l.units, pBefore.get(id)?.units || 0),
  });
  const lines = Array.from(pNow.entries());
  const movers = Array.from(new Set([...pNow.keys(), ...pBefore.keys()]))
    .map((id) => ({ id, name: (pNow.get(id) || pBefore.get(id))!.name, delta: (pNow.get(id)?.units || 0) - (pBefore.get(id)?.units || 0) }))
    .filter((x) => x.delta !== 0);

  const cats = new Map<string, { units: number; revenue: number }>();
  for (const l of pNow.values()) {
    const c = cats.get(l.category) || { units: 0, revenue: 0 };
    c.units += l.units;
    c.revenue += l.revenue;
    cats.set(l.category, c);
  }

  // Bought together (pairs within the same order).
  const pairs = new Map<string, number>();
  for (const o of cur) {
    const names = Array.from(new Set(o.items.map((i) => productById.get(i.productId)?.name || i.productName))).sort();
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      const k = `${names[i]} + ${names[j]}`;
      pairs.set(k, (pairs.get(k) || 0) + 1);
    }
  }

  // ---------------------------------------------------------- channels & codes
  const share = (pred: (o: Order) => boolean) => {
    const l = cur.filter(pred);
    return { orders: l.length, revenue: $(l.reduce((n, o) => n + o.total, 0)) };
  };
  const codes = new Map<string, { uses: number; saved: number; revenue: number }>();
  for (const o of cur) {
    if (!o.discountCode) continue;
    const c = codes.get(o.discountCode) || { uses: 0, saved: 0, revenue: 0 };
    c.uses += 1;
    c.saved += o.discountAmount || 0;
    c.revenue += o.total;
    codes.set(o.discountCode, c);
  }
  const unpaid = orders.filter((o) => o.status === "pending" && o.createdAt >= opt.from && o.createdAt < opt.to && hasFocus(o));

  return {
    period: `${opt.label} (${day(opt.from, tz)} – ${day(Math.min(opt.to, Date.now()), tz)})`,
    compared_with: `the ${Math.round((opt.from - prevFrom) / DAY)} days before (${day(prevFrom, tz)} – ${day(opt.from - 1, tz)})`,
    counts: "Paid and completed orders only. Product revenue is before cart-level discounts.",
    ...(focus.length ? { only_orders_containing: focus.map((p) => p.name) } : {}),
    totals: {
      orders: a.orders,
      revenue: $(a.revenue),
      revenue_vs_prev: pct(a.revenue, b.revenue),
      orders_vs_prev: pct(a.orders, b.orders),
      avg_order: $(a.avg),
      discounts_given: $(a.discounts),
      customers: a.customers,
      new_customers: newCount,
      returning_customers: a.customers - newCount,
    },
    top_customers_by_spend: periodCust.slice().sort((x, y) => y.spend - x.spend).slice(0, top).map(custRow),
    top_customers_by_orders: periodCust.slice().sort((x, y) => y.orders - x.orders || y.spend - x.spend).slice(0, top).map(custRow),
    lifetime_top_spenders: lifetime.slice().sort((x, y) => y.spend - x.spend).slice(0, Math.min(top, 10)).map(custRow),
    lapsed_regulars: lapsed,
    top_products_by_units: lines.slice().sort((x, y) => y[1].units - x[1].units).slice(0, top).map(prodRow),
    top_products_by_revenue: lines.slice().sort((x, y) => y[1].revenue - x[1].revenue).slice(0, top).map(prodRow),
    rising: movers.filter((m) => m.delta > 0).sort((x, y) => y.delta - x.delta).slice(0, 5).map((m) => `${m.name} +${m.delta} units`),
    falling: movers.filter((m) => m.delta < 0).sort((x, y) => x.delta - y.delta).slice(0, 5).map((m) => `${m.name} ${m.delta} units`),
    not_sold_this_period: focus.length
      ? undefined
      : products.filter((p) => !pNow.has(p.id)).slice(0, 15).map((p) => p.name),
    categories: Array.from(cats.entries())
      .sort((x, y) => y[1].revenue - x[1].revenue)
      .map(([c, v]) => `${c}: ${v.units} units, ${$(v.revenue)}`),
    often_bought_together: Array.from(pairs.entries()).filter(([, n]) => n >= 2).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([k, n]) => `${k} (${n} orders)`),
    channels: {
      member_shop: share((o) => o.source !== "retail"),
      public_shop: share((o) => o.source === "retail"),
      shipped: share((o) => o.shippingMethod === "ship"),
      pickup: share((o) => o.shippingMethod === "pickup"),
      paid_cash_at_pickup: share((o) => o.paymentMethod === "cash"),
    },
    discount_codes_used: Array.from(codes.entries())
      .sort((x, y) => y[1].uses - x[1].uses)
      .map(([c, v]) => `${c}: ${v.uses} orders, ${$(v.saved)} off, ${$(v.revenue)} in sales`),
    not_yet_paid: { orders: unpaid.length, value: $(unpaid.reduce((n, o) => n + o.total, 0)) },
  };
}
