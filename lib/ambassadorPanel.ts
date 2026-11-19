import { getApprovedVisitor, getVisitor } from "./auth";
import { isEnabled } from "./flags";
import { ambassadorForAccount, currentRate, termsOf, type Ambassador } from "./ambassadors";
import { getOrders, type Order } from "./orders";
import { readTraffic } from "./traffic";
import { ambassadorStats, netOf, pDay, trialOf, type TrialInfo } from "./ambassadorStats";
import { findDiscountByCode } from "./discounts";
import { getProducts, isExternal, isInternal } from "./storage";
import { pacificMidnight, endOfPacificDay } from "./periods";
import { panelSeries, previousRange, rangeDays, sumDays, type PanelRange, type Point } from "./ambassadorPanelMath";
import { emojiFor } from "./ambassadorLooks";

/**
 * The Ambassador panel (/ambassador, switch ambassador_panel). An ambassador
 * is a normal approved member whose email staff linked to their ambassador
 * record (Ambassadors tab → Edit → Panel sign-in). Read-mostly: they see
 * their own numbers and can choose the products on their page; terms,
 * payouts and everything else stay staff-only.
 *
 * Privacy: only their own record, and their orders as order number, date,
 * status, products and amounts. Never a customer's name, email or address.
 */

export type PanelSession = { ambassador: Ambassador; member: { id: string; name: string; email: string }; actingAs?: string };

/** The signed-in member's ambassador record, while the switch is on and their page is live. */
export async function getAmbassadorSession(): Promise<PanelSession | null> {
  if (!(await isEnabled("ambassador_panel").catch(() => false))) return null;
  const user = await getApprovedVisitor().catch(() => null);
  if (!user) return null;
  const ambassador = await ambassadorForAccount(user.email).catch(() => null);
  if (!ambassador) return null;
  const actingAs = (await getVisitor().catch(() => null))?.as;
  return { ambassador, member: { id: user.id, name: user.name, email: user.email }, ...(actingAs ? { actingAs } : {}) };
}

/** For sign-in: where this member lands ("/ambassador" for a linked ambassador, else nothing). Never throws. */
export async function landingFor(email: string): Promise<string | undefined> {
  try {
    if (!(await isEnabled("ambassador_panel"))) return undefined;
    return (await ambassadorForAccount(email)) ? "/ambassador" : undefined;
  } catch {
    return undefined;
  }
}

const STATUS_LABEL: Record<string, string> = { pending: "Awaiting payment", inquiry: "Inquiry", paid: "Paid", completed: "Completed", shipped: "Completed", "picked-up": "Completed" };

export type PanelData = {
  me: { name: string; email: string; actingAs?: string };
  ambassador: { name: string; first: string; slug: string; headline?: string; photo?: string; emoji?: string };
  code: { code: string; off: string; min?: number } | null;
  terms: { rate: number; baseRate: number; growthOn: boolean; growthPct?: number; growthGoal?: string; windowDays: number; repeatPurchases: boolean; payoutSchedule: string; startDate: string; trial: TrialInfo };
  range: { key: PanelRange; from: string; to: string };
  totals: { visits: number; qrScans: number; views: number; joins: number; orders: number; units: number; sales: number; pendingSales: number; earned: number; pending: number; conversion?: number };
  previous: { visits: number; orders: number; sales: number; earned: number } | null;
  allTime: { earned: number; paidOut: number; owed: number; orders: number };
  chart: { unit: "day" | "week" | "month"; points: Point[] };
  topProducts: Array<{ name: string; units: number }>;
  orders: Array<{ ref: string; at: number; status: string; items: Array<{ name: string; qty: number }>; net: number; commission: number; rate: number; earned: boolean; via: "page" | "code" }>;
  payouts: Array<{ at: number; amount: number }>;
  picks: { selected: string[]; products: Array<{ id: string; name: string; image: string; category?: string; membersOnly: boolean }> };
};

/** Their linked code, only while it really works, with its exact amount (as on their page). */
async function liveCode(code: string | undefined): Promise<PanelData["code"]> {
  if (!code) return null;
  const d = await findDiscountByCode(code).catch(() => undefined);
  if (!d || !d.active || !(d.value > 0)) return null;
  if (d.expiresAt && d.expiresAt < Date.now()) return null;
  if (d.maxUses && d.uses >= d.maxUses) return null;
  const n = Number.isInteger(d.value) ? String(d.value) : d.value.toFixed(2);
  return { code: d.code, off: d.type === "percentage" ? `${n}% off` : `$${n} off`, ...(d.minOrderAmount ? { min: d.minOrderAmount } : {}) };
}

/** Products an ambassador can feature: the public shop plus members-only ones (shown locked to non-members). */
export async function pickableProducts() {
  const all = await getProducts();
  return all
    .filter((p) => isExternal(p) || isInternal(p))
    .map((p) => ({ id: p.id, name: p.name, image: p.image, ...(p.category ? { category: p.category } : {}), membersOnly: !isExternal(p) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function panelData(s: PanelSession, range: PanelRange, now = Date.now()): Promise<PanelData> {
  const a = s.ambassador;
  const terms = termsOf(a);
  const today = pDay(now);
  const { from, to } = rangeDays(range, today, terms.startDate);
  const prev = previousRange(range, from);
  const earliest = prev ? prev.from : from;

  const [orders, rows, code, products] = await Promise.all([
    getOrders().then((l) => l.filter((o: Order) => o.ambassador?.id === a.id)),
    readTraffic(earliest, today).catch(() => []),
    liveCode(a.discountCode),
    pickableProducts().catch(() => []),
  ]);

  const visits: Record<string, number> = {}, qr: Record<string, number> = {}, views: Record<string, number> = {}, joins: Record<string, number> = {};
  for (const r of rows) {
    const c = r.c;
    if (c[`amb:${a.id}`]) visits[r.id] = c[`amb:${a.id}`];
    if (c[`ambq:${a.id}`]) qr[r.id] = c[`ambq:${a.id}`];
    if (c[`ambc:${a.id}`]) views[r.id] = c[`ambc:${a.id}`];
    if (c[`ambj:${a.id}`]) joins[r.id] = c[`ambj:${a.id}`];
  }
  const rate = currentRate(terms);
  const statOrders = orders.map((o) => ({ id: o.id, createdAt: o.createdAt, status: o.status, total: o.total, shippingCost: o.shippingCost, items: o.items.map((i) => ({ productName: i.productName, quantity: i.quantity })), ambassador: o.ambassador }));
  const st = ambassadorStats({ terms, currentRate: rate, orders: statOrders, visits, qr, payouts: a.payouts || [], now, range: { from: pacificMidnight(from), to: endOfPacificDay(to) } });
  let previous: PanelData["previous"] = null;
  if (prev) {
    const ps = ambassadorStats({ terms, currentRate: rate, orders: statOrders, visits, qr, payouts: [], now, range: { from: pacificMidnight(prev.from), to: endOfPacificDay(prev.to) } });
    previous = { visits: ps.visits, orders: ps.orders, sales: ps.sales, earned: ps.earned };
  }
  const allTime = ambassadorStats({ terms, currentRate: rate, orders: statOrders, visits: {}, qr: {}, payouts: a.payouts || [], now });
  const chartOrders = statOrders.filter((o) => o.status !== "cancelled" && o.status !== "inquiry").map((o) => ({ day: pDay(o.createdAt), net: netOf(o) }));

  const first = a.name.split(" ")[0];
  return {
    me: { name: s.member.name, email: s.member.email, ...(s.actingAs ? { actingAs: s.actingAs } : {}) },
    ambassador: { name: a.name, first, slug: a.slug, ...(a.headline ? { headline: a.headline } : {}), ...(a.photo ? { photo: a.photo } : {}), ...(emojiFor(a) ? { emoji: emojiFor(a)! } : {}) },
    code,
    terms: {
      rate, baseRate: terms.commissionPct, growthOn: terms.growthOn,
      ...(typeof terms.growthPct === "number" ? { growthPct: terms.growthPct } : {}),
      ...(terms.growthGoal ? { growthGoal: terms.growthGoal } : {}),
      windowDays: terms.windowDays, repeatPurchases: terms.repeatPurchases, payoutSchedule: terms.payoutSchedule, startDate: terms.startDate,
      trial: trialOf(terms, now),
    },
    range: { key: range, from, to },
    totals: {
      visits: st.visits, qrScans: st.qrScans, views: sumDays(views, from, to), joins: sumDays(joins, from, to),
      orders: st.orders, units: st.units, sales: st.sales, pendingSales: st.pendingSales, earned: st.earned, pending: st.pending,
      ...(st.conversion !== undefined ? { conversion: st.conversion } : {}),
    },
    previous,
    allTime: { earned: allTime.earnedAllTime, paidOut: allTime.paidOut, owed: allTime.owed, orders: allTime.orders },
    chart: panelSeries(from, to, visits, chartOrders),
    topProducts: st.topProducts,
    orders: st.list.slice(0, 50).map((r) => ({ ref: r.ref, at: r.at, status: STATUS_LABEL[r.status] || r.status, items: r.items, net: r.net, commission: r.commission, rate: r.rate, earned: r.earned, via: r.via })),
    payouts: (a.payouts || []).slice().sort((x, y) => y.at - x.at).slice(0, 24).map((p) => ({ at: p.at, amount: p.amount })),
    picks: { selected: a.productIds.filter((id) => products.some((p) => p.id === id)), products },
  };
}
