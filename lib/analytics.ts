// Revenue analytics — everything derives from orders that have actually
// been marked paid (or shipped/picked up), so figures reflect real money
// rather than orders that were merely placed.

import { getOrders, parsePrice, type Order } from "./orders";
import { getUsers } from "./users";
import { getProducts } from "./storage";
import { addDays, lastNDaysStart, pacificDay, pacificMidnight } from "./periods";

// Money actually collected. "completed" covers both shipped and collected
// orders; the legacy values are kept so historic orders still count.
export const PAID_STATUSES = ["paid", "completed", "shipped", "picked-up"] as const;

export function isRevenue(o: Order): boolean {
  return (PAID_STATUSES as readonly string[]).includes(o.status);
}

// The moment revenue is recognized: when it was paid, else when created.
function revenueAt(o: Order): number {
  return o.paidAt || o.createdAt;
}

export type PeriodStats = {
  orders: number;
  revenue: number;      // total collected incl. shipping
  productRevenue: number; // excl. shipping
  shipping: number;
  discounts: number;
  avgOrderValue: number;
};

function emptyPeriod(): PeriodStats {
  return { orders: 0, revenue: 0, productRevenue: 0, shipping: 0, discounts: 0, avgOrderValue: 0 };
}

function summarize(orders: Order[]): PeriodStats {
  const s = emptyPeriod();
  for (const o of orders) {
    s.orders++;
    s.revenue += o.total;
    s.shipping += o.shippingCost;
    s.discounts += o.discount || 0;
    s.productRevenue += o.total - o.shippingCost;
  }
  s.avgOrderValue = s.orders ? s.revenue / s.orders : 0;
  return s;
}

export type ProductPerformance = {
  productId: string;
  name: string;
  category: string;
  unitsSold: number;
  revenue: number;
  orderCount: number;
};

export type Insights = {
  generatedAt: number;
  today: PeriodStats;
  /** The previous full local day (the nightly report shows this). */
  yesterday: PeriodStats;
  last7: PeriodStats;
  prev7: PeriodStats;
  last30: PeriodStats;
  allTime: PeriodStats;
  revenueChangePct: number | null; // last 7 vs previous 7

  // Cash flow / follow-up
  pendingCount: number;
  pendingValue: number;
  pendingOver3Days: Array<{ id: string; userName: string; total: number; daysWaiting: number }>;
  awaitingFulfillment: number; // paid but not shipped/picked up

  // Products
  topProducts: ProductPerformance[];
  slowMovers: Array<{ name: string; category: string }>;
  categoryRevenue: Array<{ category: string; revenue: number; units: number }>;

  // Customers
  newCustomers7: number;
  repeatCustomers7: number;
  repeatRatePct: number;
  topCustomers: Array<{ name: string; email: string; orders: number; spend: number }>;
  pendingApprovals: number;

  // Fulfillment mix
  shipCount7: number;
  pickupCount7: number;
};

export async function getInsights(): Promise<Insights> {
  const [orders, users, products] = await Promise.all([getOrders(), getUsers(), getProducts()]);
  const now = Date.now();
  // local calendar days, same as the Analytics tab (lib/periods.ts):
  // "last 7 days" = today plus the 6 full days before it.
  const dayStart = lastNDaysStart(1, now);
  const yesterdayStart = pacificMidnight(addDays(pacificDay(now), -1));
  const d7 = lastNDaysStart(7, now);
  const d14 = lastNDaysStart(14, now);
  const d30 = lastNDaysStart(30, now);

  const revenueOrders = orders.filter(isRevenue);
  const inWindow = (from: number, to = Infinity) =>
    revenueOrders.filter((o) => revenueAt(o) >= from && revenueAt(o) < to);

  const last7Orders = inWindow(d7);
  const prev7Orders = inWindow(d14, d7);

  const last7 = summarize(last7Orders);
  const prev7 = summarize(prev7Orders);
  const revenueChangePct =
    prev7.revenue > 0 ? ((last7.revenue - prev7.revenue) / prev7.revenue) * 100 : null;

  // Outstanding payments
  const pending = orders.filter((o) => o.status === "pending");
  const pendingOver3Days = pending
    .filter((o) => now - o.createdAt > 3 * 864e5)
    .map((o) => ({
      id: o.id,
      userName: o.userName,
      total: o.total,
      daysWaiting: Math.floor((now - o.createdAt) / 864e5),
    }))
    .sort((a, b) => b.daysWaiting - a.daysWaiting);

  // Product performance over the last 30 days
  const perf = new Map<string, ProductPerformance>();
  const productMeta = new Map(products.map((p) => [p.id, p]));
  for (const o of inWindow(d30)) {
    for (const item of o.items) {
      const key = item.productId;
      const meta = productMeta.get(key);
      const entry =
        perf.get(key) ||
        {
          productId: key,
          name: item.productName,
          category: meta?.category || "Uncategorized",
          unitsSold: 0,
          revenue: 0,
          orderCount: 0,
        };
      entry.unitsSold += item.quantity;
      entry.revenue += parsePrice(item.price) * item.quantity;
      entry.orderCount += 1;
      perf.set(key, entry);
    }
  }
  const topProducts = Array.from(perf.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  const slowMovers = products
    .filter((p) => !perf.has(p.id))
    .map((p) => ({ name: p.name, category: p.category || "Uncategorized" }));

  const categoryMap = new Map<string, { revenue: number; units: number }>();
  for (const p of perf.values()) {
    const c = categoryMap.get(p.category) || { revenue: 0, units: 0 };
    c.revenue += p.revenue;
    c.units += p.unitsSold;
    categoryMap.set(p.category, c);
  }
  const categoryRevenue = Array.from(categoryMap.entries())
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.revenue - a.revenue);

  // Customers
  // One customer = one email address (a member who also bought as a guest
  // counts once), the same rule as the Analytics tab and the Concierge.
  const who = (o: Order) => (o.userEmail || o.userId || "").trim().toLowerCase();
  const ordersByUser = new Map<string, Order[]>();
  for (const o of revenueOrders) {
    const list = ordersByUser.get(who(o)) || [];
    list.push(o);
    ordersByUser.set(who(o), list);
  }
  const buyers7 = new Set(last7Orders.map(who));
  let newCustomers7 = 0;
  let repeatCustomers7 = 0;
  for (const userId of buyers7) {
    const all = ordersByUser.get(userId) || [];
    const firstEver = Math.min(...all.map(revenueAt));
    if (firstEver >= d7) newCustomers7++;
    else repeatCustomers7++;
  }
  const repeatRatePct = buyers7.size ? (repeatCustomers7 / buyers7.size) * 100 : 0;

  const topCustomers = Array.from(ordersByUser.entries())
    .map(([key, list]) => {
      const u = users.find((x) => x.email.toLowerCase() === key || x.id === key);
      const latest = list.reduce((a, b) => (revenueAt(b) > revenueAt(a) ? b : a), list[0]);
      return {
        name: latest?.userName || u?.name || "Unknown",
        email: latest?.userEmail || u?.email || "",
        orders: list.length,
        spend: list.reduce((n, o) => n + o.total, 0),
      };
    })
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 5);

  return {
    generatedAt: now,
    today: summarize(inWindow(dayStart)),
    yesterday: summarize(inWindow(yesterdayStart, dayStart)),
    last7,
    prev7,
    last30: summarize(inWindow(d30)),
    allTime: summarize(revenueOrders),
    revenueChangePct,
    pendingCount: pending.length,
    pendingValue: pending.reduce((n, o) => n + o.total, 0),
    pendingOver3Days,
    awaitingFulfillment: orders.filter((o) => o.status === "paid").length,
    topProducts,
    slowMovers,
    categoryRevenue,
    newCustomers7,
    repeatCustomers7,
    repeatRatePct,
    topCustomers,
    pendingApprovals: users.filter((u) => u.status === "pending").length,
    shipCount7: last7Orders.filter((o) => o.shippingMethod === "ship").length,
    pickupCount7: last7Orders.filter((o) => o.shippingMethod === "pickup").length,
  };
}

export function money(n: number): string {
  return `$${n.toFixed(2)}`;
}
