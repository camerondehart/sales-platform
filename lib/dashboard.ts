import { isRevenue } from "./analytics";
import { getOrders, parsePrice, type Order } from "./orders";
import { getProducts } from "./storage";
import { getUsers } from "./users";
import { getSubscribers } from "./subscribers";
import { getRegistrations, getEvents } from "./events";
import { allUsage, recentEscalations } from "./assistant/usage";
import { readTraffic, flushTraffic, type DayRow } from "./traffic";
import { addDays, pacificDay, pacificMidnight } from "./periods";
import { brand } from "@/lib/brand";

/**
 * Everything the Analytics tab shows, computed in one pass.
 * Sales figures come from real orders (paid/completed only, same rule as the
 * Overview tab); visitor figures from the cookie-free counters.
 */

const TZ = brand.timezone;
const soldAt = (o: Order) => o.paidAt || o.createdAt;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** `days` consecutive local days starting at `firstDay`. */
function dayList(firstDay: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDays(firstDay, i));
}

function weekdayHour(t: number): { w: number; h: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", hour: "2-digit", weekday: "short" })
      .formatToParts(new Date(t))
      .map((p) => [p.type, p.value])
  );
  return { w: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday), h: Number(parts.hour) % 24 };
}

const sumKey = (rows: DayRow[], key: string) => rows.reduce((n, r) => n + (r.c[key] || 0), 0);
function sumPrefix(rows: DayRow[], prefix: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) for (const [k, v] of Object.entries(r.c)) if (k.startsWith(prefix)) m.set(k.slice(prefix.length), (m.get(k.slice(prefix.length)) || 0) + v);
  return m;
}
const top = (m: Map<string, number>, n: number) =>
  Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([key, value]) => ({ key, value }));
/** % change; null when there's nothing to compare against ("new"), 0 when both are zero. */
const pctChange = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : now > 0 ? null : 0);

export async function computeDashboard(daysRequested: number) {
  const days = [7, 30, 90, 365].includes(daysRequested) ? daysRequested : 30;
  await flushTraffic(true).catch(() => {});
  const now = Date.now();
  // "Last N days" = today plus the N−1 full days before it, local (lib/periods.ts),
  // so the headline totals and the day-by-day chart cover exactly the same orders.
  const dayKeys = dayList(addDays(pacificDay(now), -(days - 1)), days); // oldest → today
  const prevKeys = dayList(addDays(dayKeys[0], -days), days);
  const from = pacificMidnight(dayKeys[0]);
  const prevFrom = pacificMidnight(prevKeys[0]);

  const [orders, products, users, subs, regs, events, usage, escalations, traffic, prevTraffic] = await Promise.all([
    getOrders(),
    getProducts(),
    getUsers().catch(() => []),
    getSubscribers().catch(() => []),
    getRegistrations(),
    getEvents(),
    allUsage().catch(() => []),
    recentEscalations(),
    readTraffic(dayKeys[0], dayKeys[dayKeys.length - 1]),
    readTraffic(prevKeys[0], prevKeys[prevKeys.length - 1]),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const tByDay = new Map(traffic.map((r) => [r.id, r.c]));
  const ptByDay = new Map(prevTraffic.map((r) => [r.id, r.c]));

  // ---------------------------------------------------------------- sales
  const paid = orders.filter(isRevenue);
  const inRange = (o: Order, a: number, b: number) => soldAt(o) >= a && soldAt(o) < b;
  const cur = paid.filter((o) => inRange(o, from, now + 1));
  const prev = paid.filter((o) => inRange(o, prevFrom, from));
  const revenue = cur.reduce((n, o) => n + o.total, 0);
  const prevRevenue = prev.reduce((n, o) => n + o.total, 0);

  const salesByDay = new Map<string, { revenue: number; orders: number }>();
  for (const o of cur) {
    const d = pacificDay(soldAt(o));
    const e = salesByDay.get(d) || { revenue: 0, orders: 0 };
    e.revenue += o.total;
    e.orders += 1;
    salesByDay.set(d, e);
  }
  const prevSalesByDay = new Map<string, number>();
  for (const o of prev) prevSalesByDay.set(pacificDay(soldAt(o)), (prevSalesByDay.get(pacificDay(soldAt(o))) || 0) + o.total);

  // ---------------------------------------------------------------- people
  const approvedAt = (u: { approvedAt?: number; createdAt: number; status: string }) => (u.status === "approved" ? u.approvedAt || u.createdAt : 0);
  const newMembers = users.filter((u) => approvedAt(u) >= from).length;
  const prevNewMembers = users.filter((u) => approvedAt(u) >= prevFrom && approvedAt(u) < from).length;
  const subAt = (s: { subscribedAt?: number }) => s.subscribedAt || 0;
  // Everyone who joined the list in the period, counted the same way in both periods.
  const newSubs = subs.filter((s) => subAt(s) >= from).length;
  const prevNewSubs = subs.filter((s) => subAt(s) >= prevFrom && subAt(s) < from).length;

  const firstOrder = new Map<string, number>();
  for (const o of paid) {
    const k = (o.userEmail || o.userId).toLowerCase();
    firstOrder.set(k, Math.min(firstOrder.get(k) ?? Infinity, soldAt(o)));
  }
  const buyers = new Map<string, { name: string; email: string; spend: number; orders: number }>();
  for (const o of cur) {
    const k = (o.userEmail || o.userId).toLowerCase();
    const b = buyers.get(k) || { name: o.userName, email: o.userEmail, spend: 0, orders: 0 };
    b.spend += o.total;
    b.orders += 1;
    buyers.set(k, b);
  }
  const newBuyers = Array.from(buyers.keys()).filter((k) => (firstOrder.get(k) ?? 0) >= from).length;

  // ---------------------------------------------------------------- traffic
  const visits = sumKey(traffic, "e:visit");
  const prevVisits = sumKey(prevTraffic, "e:visit");
  const pageviews = sumKey(traffic, "e:page");
  const placedSessions = sumKey(traffic, "f:order_placed");
  const conversion = visits > 0 ? r2((placedSessions / visits) * 100) : null;
  const prevConversion = prevVisits > 0 ? r2((sumKey(prevTraffic, "f:order_placed") / prevVisits) * 100) : null;

  const funnel = [
    { step: "visit", label: "Visited", count: visits },
    { step: "product_view", label: "Viewed a product", count: sumKey(traffic, "f:product_view") },
    { step: "add_to_cart", label: "Added to cart", count: sumKey(traffic, "f:add_to_cart") },
    { step: "checkout_open", label: "Started checkout", count: sumKey(traffic, "f:checkout_open") },
    { step: "order_placed", label: "Placed an order", count: placedSessions },
  ];

  // Heatmaps (local time). Visits if we have them; orders always.
  const heatVisits: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const [k, v] of sumPrefix(traffic, "wh:")) {
    const [w, h] = k.split("-").map(Number);
    if (w >= 0 && w < 7 && h >= 0 && h < 24) heatVisits[w][h] += v;
  }
  const heatOrders: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const o of cur) {
    const { w, h } = weekdayHour(o.createdAt);
    if (w >= 0) heatOrders[w][h] += 1;
  }

  // ---------------------------------------------------------------- products
  const views = sumPrefix(traffic, "pv:");
  const adds = sumPrefix(traffic, "pc:");
  const sold = new Map<string, { units: number; revenue: number }>();
  const prevUnits = new Map<string, number>();
  for (const o of cur) for (const i of o.items) {
    const s = sold.get(i.productId) || { units: 0, revenue: 0 };
    s.units += i.quantity;
    s.revenue += parsePrice(i.price) * i.quantity;
    sold.set(i.productId, s);
  }
  for (const o of prev) for (const i of o.items) prevUnits.set(i.productId, (prevUnits.get(i.productId) || 0) + i.quantity);
  const ids = new Set([...views.keys(), ...adds.keys(), ...sold.keys()]);
  const productRows = Array.from(ids)
    .map((id) => {
      const p = productById.get(id);
      const v = views.get(id) || 0;
      const a = adds.get(id) || 0;
      const s = sold.get(id) || { units: 0, revenue: 0 };
      return {
        id,
        name: p?.name || cur.flatMap((o) => o.items).find((i) => i.productId === id)?.productName || "Removed product",
        image: p?.image || "",
        views: v,
        adds: a,
        units: s.units,
        revenue: r2(s.revenue),
        viewToCart: v >= 5 ? Math.round((a / v) * 100) : null,
        trend: pctChange(s.units, prevUnits.get(id) || 0),
      };
    })
    .sort((x, y) => y.revenue - x.revenue || y.views - x.views)
    .slice(0, 12);
  const notSelling = products.filter((p) => !sold.has(p.id)).map((p) => ({ id: p.id, name: p.name, views: views.get(p.id) || 0 }));

  // ---------------------------------------------------------------- assistant
  const chatsByDay = new Map<string, number>();
  let chatCost = 0;
  for (const u of usage) {
    // usage buckets are local days (older rows were UTC days — off by hours at most)
    if (u.day >= dayKeys[0]) {
      chatsByDay.set(u.day, (chatsByDay.get(u.day) || 0) + u.requests);
      chatCost += u.costUsd;
    }
  }
  const assistantChats = Array.from(chatsByDay.values()).reduce((n, v) => n + v, 0);
  const escalated = escalations.filter((e) => e.at >= from).length;

  // ---------------------------------------------------------------- series
  const daily = dayKeys.map((d, i) => {
    const t = tByDay.get(d) || {};
    const pd = prevKeys[i];
    const pt = (pd && ptByDay.get(pd)) || {};
    return {
      day: d,
      revenue: r2(salesByDay.get(d)?.revenue || 0),
      orders: salesByDay.get(d)?.orders || 0,
      visits: t["e:visit"] || 0,
      pageviews: t["e:page"] || 0,
      prevRevenue: r2((pd && prevSalesByDay.get(pd)) || 0),
      prevVisits: pt["e:visit"] || 0,
      chats: chatsByDay.get(d) || 0,
    };
  });

  // Per-day new sign-ups (for the KPI sparklines) and running totals (for the Community card).
  const memberDays = users.map((u) => approvedAt(u)).filter((t) => t > 0).map((t) => pacificDay(t));
  const subDays = subs.map((x) => ({ on: subAt(x) > 0 ? pacificDay(subAt(x)) : "", off: x.unsubscribedAt ? pacificDay(x.unsubscribedAt) : "" }));
  const newMemberSeries = dayKeys.map((d) => memberDays.filter((m) => m === d).length);
  const newSubscriberSeries = dayKeys.map((d) => subDays.filter((x) => x.on === d).length);
  const memberSeries = dayKeys.map((d) => memberDays.filter((m) => m <= d).length);
  const subscriberSeries = dayKeys.map((d) => subDays.filter((x) => x.on && x.on <= d && (!x.off || x.off > d)).length);

  // ---------------------------------------------------------------- sources
  const referrers = top(sumPrefix(traffic, "r:"), 8);
  const devices = sumPrefix(traffic, "d:");
  const countries = top(sumPrefix(traffic, "g:"), 6);
  const landings = top(sumPrefix(traffic, "l:"), 6);
  const pages = top(sumPrefix(traffic, "p:"), 8);
  const qrScans = sumKey(traffic, "e:qr_scan");
  const qrByProduct = top(sumPrefix(traffic, "qr:"), 5).map((x) => ({ ...x, name: productById.get(x.key)?.name || x.key }));
  const campaignVisits = sumPrefix(traffic, "c:");
  const campaignOrders = sumPrefix(traffic, "co:");
  const campaignValue = sumPrefix(traffic, "cv:");
  const campaigns = Array.from(new Set([...campaignVisits.keys(), ...campaignOrders.keys()]))
    .map((c) => ({ id: c, visits: campaignVisits.get(c) || 0, orders: campaignOrders.get(c) || 0, revenue: r2((campaignValue.get(c) || 0) / 100) }))
    .sort((a, b) => b.visits - a.visits || b.revenue - a.revenue)
    .slice(0, 8);
  const askTopics = top(sumPrefix(traffic, "at:"), 9).filter((x) => x.key !== "staff").slice(0, 6);
  const chatFlags = sumKey(traffic, "afl:self_harm") + sumKey(traffic, "afl:health_emergency") + sumKey(traffic, "afl:threat");
  const opens = sumKey(traffic, "e:email_open");
  const clicks = sumKey(traffic, "e:email_click");

  // ---------------------------------------------------------------- events
  const regsInRange = regs.filter((r) => r.createdAt >= from && r.status !== "cancelled").length;
  const upcoming = events
    .filter((e) => e.published && e.date >= now)
    .sort((a, b) => a.date - b.date)
    .slice(0, 4)
    .map((e) => {
      const n = regs.filter((r) => r.eventId === e.id && r.status === "registered").length;
      return { title: e.title, date: e.date, registered: n, capacity: e.capacity };
    });

  // ---------------------------------------------------------------- highlights
  const highlights: Array<{ tone: "good" | "watch" | "info"; text: string }> = [];
  const rc = pctChange(revenue, prevRevenue);
  if (rc !== null) highlights.push({ tone: rc >= 0 ? "good" : "watch", text: `Revenue is ${rc >= 0 ? "up" : "down"} ${Math.abs(rc)}% on the previous ${days} days.` });
  const best = daily.reduce((b, d) => (d.revenue > b.revenue ? d : b), daily[0]);
  if (best && best.revenue > 0) {
    const label = new Date(`${best.day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
    highlights.push({ tone: "info", text: `Best day: ${label} with $${best.revenue.toFixed(0)} in sales.` });
  }
  let peak = { w: -1, h: -1, v: 0 };
  const heat = visits > 20 ? heatVisits : heatOrders;
  heat.forEach((row, w) => row.forEach((v, h) => { if (v > peak.v) peak = { w, h, v }; }));
  if (peak.v > 0) {
    const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][peak.w];
    const hr = peak.h === 0 ? "midnight" : peak.h < 12 ? `${peak.h}am` : peak.h === 12 ? "noon" : `${peak.h - 12}pm`;
    highlights.push({ tone: "info", text: `Busiest time for ${visits > 20 ? "visits" : "orders"}: ${dayName}s around ${hr} (local) — a good slot for campaigns.` });
  }
  if (visits >= 30) {
    const steps = funnel.slice(1);
    let worst = { label: "", loss: 0 };
    let prevCount = funnel[0].count;
    for (const s of steps) {
      if (prevCount > 0) {
        const loss = 1 - s.count / prevCount;
        if (loss > worst.loss) worst = { label: `${funnel[funnel.indexOf(s) - 1].label.toLowerCase()} → ${s.label.toLowerCase()}`, loss };
      }
      prevCount = s.count;
    }
    if (worst.label) highlights.push({ tone: "watch", text: `Biggest drop-off: ${worst.label} (${Math.round(worst.loss * 100)}% don't continue).` });
    const phones = devices.get("phone") || 0;
    const known = (devices.get("phone") || 0) + (devices.get("tablet") || 0) + (devices.get("desktop") || 0);
    if (known > 0) highlights.push({ tone: "info", text: `${Math.round((phones / known) * 100)}% of visitors are on a phone.` });
  }
  const lookers = productRows.filter((p) => p.views >= 20 && p.viewToCart !== null && p.viewToCart < 5);
  if (lookers[0]) highlights.push({ tone: "watch", text: `${lookers[0].name} gets looked at a lot (${lookers[0].views} views) but rarely added to cart (${lookers[0].viewToCart}%). A better photo, a video or a promo could help.` });
  const riser = productRows.filter((p) => p.trend !== null && p.trend >= 50 && p.units >= 3).sort((a, b) => (b.trend || 0) - (a.trend || 0))[0];
  if (riser) highlights.push({ tone: "good", text: `${riser.name} is taking off: ${riser.units} sold, up ${riser.trend}%.` });
  if (newBuyers > 0) highlights.push({ tone: "good", text: `${newBuyers} first-time customer${newBuyers === 1 ? "" : "s"} this period.` });

  return {
    range: { days, from: dayKeys[0], to: dayKeys[dayKeys.length - 1] },
    hasTraffic: visits > 0,
    kpis: {
      revenue: { value: r2(revenue), prev: r2(prevRevenue), change: pctChange(revenue, prevRevenue), series: daily.map((d) => d.revenue) },
      orders: { value: cur.length, prev: prev.length, change: pctChange(cur.length, prev.length), series: daily.map((d) => d.orders) },
      aov: { value: cur.length ? r2(revenue / cur.length) : 0, prev: prev.length ? r2(prevRevenue / prev.length) : 0, change: pctChange(cur.length ? revenue / cur.length : 0, prev.length ? prevRevenue / prev.length : 0), series: daily.map((d) => (d.orders ? r2(d.revenue / d.orders) : 0)) },
      visitors: { value: visits, prev: prevVisits, change: pctChange(visits, prevVisits), series: daily.map((d) => d.visits) },
      conversion: { value: conversion, prev: prevConversion, change: conversion !== null && prevConversion !== null ? r2(conversion - prevConversion) : null },
      newMembers: { value: newMembers, prev: prevNewMembers, change: pctChange(newMembers, prevNewMembers), series: newMemberSeries },
      newSubscribers: { value: newSubs, prev: prevNewSubs, change: pctChange(newSubs, prevNewSubs), series: newSubscriberSeries },
      assistantChats: { value: assistantChats, escalated, cost: r2(chatCost), addsFromChat: sumKey(traffic, "e:assistant_add"), series: daily.map((d) => d.chats), topics: askTopics, seriousFlags: chatFlags },
    },
    daily,
    funnel,
    heat: { visits: heatVisits, orders: heatOrders },
    products: productRows,
    notSelling: notSelling.slice(0, 8),
    customers: {
      newBuyers,
      returningBuyers: buyers.size - newBuyers,
      top: Array.from(buyers.values()).sort((a, b) => b.spend - a.spend).slice(0, 5).map((b) => ({ ...b, spend: r2(b.spend) })),
      members: users.filter((u) => u.status === "approved").length,
      subscribers: subs.filter((s) => !s.unsubscribedAt).length,
      memberTotals: memberSeries,
      subscriberTotals: subscriberSeries,
    },
    sources: {
      referrers,
      devices: { phone: devices.get("phone") || 0, tablet: devices.get("tablet") || 0, desktop: devices.get("desktop") || 0 },
      countries,
      landings,
      pages,
      qr: { scans: qrScans, byProduct: qrByProduct },
      campaigns,
      email: { opens, clicks },
    },
    events: { registrations: regsInRange, upcoming },
    shopSplit: {
      member: cur.filter((o) => o.source !== "retail").reduce((n, o) => n + o.total, 0),
      public: cur.filter((o) => o.source === "retail").reduce((n, o) => n + o.total, 0),
    },
    highlights: highlights.slice(0, 6),
  };
}

export type Dashboard = Awaited<ReturnType<typeof computeDashboard>>;
