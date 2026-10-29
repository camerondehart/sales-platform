import type { AmbassadorTerms, Payout } from "./ambassadors";

/**
 * The numbers for one ambassador: visits, orders, sales, commission earned,
 * paid out and still owed, month by month, top products and their trial.
 * Pure (no storage), so it's unit-tested in tests/unit/ambassador-stats.cjs.
 *
 * Money rules (their agreement): commission is on eligible net product
 * sales, after discounts, excluding shipping (no tax is charged) and leaving
 * out cancelled/refunded orders. It's EARNED once the order is paid (paid or
 * completed); unpaid orders show as pending. Each order keeps the rate that
 * applied when it was placed.
 */

export type StatOrder = {
  id: string;
  createdAt: number;
  status: string;
  total: number;
  shippingCost?: number;
  items: Array<{ productName: string; quantity: number }>;
  ambassador?: { id: string; via: "page" | "code"; rate?: number };
};

export type MonthRow = { month: string; orders: number; sales: number; earned: number; pending: number; visits: number };
export type SaleRow = { orderId: string; ref: string; at: number; status: string; net: number; commission: number; rate: number; earned: boolean; via: "page" | "code"; items: Array<{ name: string; qty: number }> };
/** ends = the trial's last day; daysLeft = days after today. */
export type TrialInfo = { status: "none" | "trial" | "review" | "done"; start: string; ends?: string; day?: number; daysLeft?: number; length: number };

export type AmbassadorStats = {
  visits: number;
  qrScans: number;
  orders: number;
  units: number;
  /** Net product sales on paid orders. */
  sales: number;
  /** Net product sales on unpaid orders. */
  pendingSales: number;
  earned: number;
  pending: number;
  /** Commission earned since they started (for owed). */
  earnedAllTime: number;
  paidOut: number;
  owed: number;
  /** Orders per 100 page visits. */
  conversion?: number;
  lastOrderAt?: number;
  months: MonthRow[];
  topProducts: Array<{ name: string; units: number }>;
  list: SaleRow[];
  trial: TrialInfo;
};

const TZ = "America/Los_Angeles";
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
export const pDay = (t: number) => dayFmt.format(new Date(t));
const shift = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86_400_000);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Net product sales of an order: what the customer paid minus shipping. */
export const netOf = (o: Pick<StatOrder, "total" | "shippingCost">) => r2(Math.max(0, (o.total || 0) - (o.shippingCost || 0)));

const EARNED = new Set(["paid", "completed", "shipped", "picked-up"]);
const LEFT_OUT = new Set(["cancelled", "inquiry"]);

/** Their trial: day N of M, ending on …, or review due. */
export function trialOf(terms: Pick<AmbassadorTerms, "trialDays" | "startDate" | "trialReviewed">, now: number): TrialInfo {
  const start = terms.startDate;
  const length = terms.trialDays || 0;
  if (!length) return { status: "none", start, length: 0 };
  const today = pDay(now);
  const ends = shift(start, length - 1); // the trial's last day
  const day = Math.max(1, daysBetween(start, today) + 1);
  if (today <= ends) return { status: "trial", start, ends, day: Math.min(day, length), daysLeft: daysBetween(today, ends), length };
  return { status: terms.trialReviewed ? "done" : "review", start, ends, length };
}

/**
 * @param orders  orders credited to this ambassador
 * @param visits  page visits per Pacific day ({ "2026-10-29": 12 })
 * @param range   only count orders/visits in [from, to] (ms); payouts and owed are always all-time
 */
export function ambassadorStats(input: {
  terms: AmbassadorTerms;
  currentRate: number;
  orders: StatOrder[];
  visits: Record<string, number>;
  qr: Record<string, number>;
  payouts: Payout[];
  now: number;
  range?: { from: number; to: number };
}): AmbassadorStats {
  const { terms, now, range } = input;
  const inRange = (t: number) => !range || (t >= range.from && t <= range.to);
  const dayIn = (d: string) => !range || (d >= pDay(range.from) && d <= pDay(range.to));

  let orders = 0, units = 0, sales = 0, pendingSales = 0, earned = 0, pending = 0, lastOrderAt: number | undefined;
  let allEarned = 0;
  const months = new Map<string, MonthRow>();
  const month = (m: string) => {
    let row = months.get(m);
    if (!row) months.set(m, (row = { month: m, orders: 0, sales: 0, earned: 0, pending: 0, visits: 0 }));
    return row;
  };
  const products = new Map<string, number>();
  const rows: SaleRow[] = [];

  for (const o of input.orders) {
    if (LEFT_OUT.has(o.status)) continue;
    const net = netOf(o);
    const rate = typeof o.ambassador?.rate === "number" ? o.ambassador.rate : input.currentRate;
    const commission = r2((net * rate) / 100);
    const isEarned = EARNED.has(o.status);
    if (isEarned) allEarned += commission;
    if (!inRange(o.createdAt)) continue;
    orders += 1;
    const u = o.items.reduce((n, i) => n + (i.quantity || 0), 0);
    units += u;
    for (const i of o.items) products.set(i.productName, (products.get(i.productName) || 0) + (i.quantity || 0));
    const m = month(pDay(o.createdAt).slice(0, 7));
    m.orders += 1;
    if (isEarned) {
      sales += net; earned += commission;
      m.sales += net; m.earned += commission;
    } else {
      pendingSales += net; pending += commission;
      m.pending += commission;
    }
    if (!lastOrderAt || o.createdAt > lastOrderAt) lastOrderAt = o.createdAt;
    rows.push({
      orderId: o.id, ref: o.id.slice(-6).toUpperCase(), at: o.createdAt, status: o.status, net, commission, rate, earned: isEarned,
      via: o.ambassador?.via || "page", items: o.items.map((i) => ({ name: i.productName, qty: i.quantity })),
    });
  }

  let visits = 0, qrScans = 0;
  for (const [d, n] of Object.entries(input.visits)) if (dayIn(d)) { visits += n; month(d.slice(0, 7)).visits += n; }
  for (const [d, n] of Object.entries(input.qr)) if (dayIn(d)) qrScans += n;

  const paidOut = r2(input.payouts.reduce((n, p) => n + p.amount, 0));
  const monthsSorted = Array.from(months.values())
    .map((m) => ({ ...m, sales: r2(m.sales), earned: r2(m.earned), pending: r2(m.pending) }))
    .sort((a, b) => (a.month < b.month ? 1 : -1));

  return {
    visits, qrScans, orders, units,
    sales: r2(sales), pendingSales: r2(pendingSales), earned: r2(earned), pending: r2(pending),
    earnedAllTime: r2(allEarned),
    paidOut,
    owed: r2(Math.max(0, allEarned - paidOut)),
    conversion: visits > 0 ? Math.round((orders / visits) * 1000) / 10 : undefined,
    lastOrderAt,
    months: monthsSorted,
    topProducts: Array.from(products.entries()).map(([name, u]) => ({ name, units: u })).sort((a, b) => b.units - a.units).slice(0, 5),
    list: rows.sort((a, b) => b.at - a.at).slice(0, 100),
    trial: trialOf(terms, now),
  };
}
