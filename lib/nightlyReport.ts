import { isRevenue, type Insights } from "./analytics";
import { getOrders, type Order } from "./orders";
import { normalizeStatus } from "./orderStatus";
import { getUsers } from "./users";
import { getSubscribers } from "./subscribers";
import { allGiftCards } from "./giftCards";
import { offsiteSales, paymentsToSort } from "./venmoInbox";
import { recentEscalations, escalationStatus } from "./assistant/usage";
import { getRequests } from "./retail";
import { getEvents, getRegistrations } from "./events";
import { getStock, isRestocking } from "./stock";
import { getProducts } from "./storage";
import { currentSiteSeason } from "./entrance";
import { THEMES, type Theme } from "./campaignThemes";
import { themeArt } from "./emailArt";
import { addDays, pacificDay, pacificMidnight, lastNDaysStart } from "./periods";
import { escapeHtml } from "./invoiceEmail";
import { brand } from "./brand";

/**
 * The nightly report email: everything the old report had,
 * plus comparisons, a 14-day chart, yesterday's orders, money breakdown,
 * members / mailing list, loyalty, gift cards, ambassadors, things waiting in
 * the inboxes and upcoming events. Dressed in the plain season (no holidays), using
 * the campaign email art; classic when the site's seasonal look is off. Staff only, so internal numbers are fine.
 *
 * Every extra is read one after another (never all at once: see
 * lib/fetchAll.ts) and each one is optional: if a read fails that block is
 * left out and the rest of the report still goes.
 */

type Day = { day: string; revenue: number; orders: number };
type YOrder = { id: string; name: string; items: number; total: number; status: string; method: string; ambassador?: string };

export type ReportExtras = {
  theme: Theme;
  seasonLabel: string;
  art: { header: string; divider: string } | null;
  daily: Day[]; // 14 Pacific days ending yesterday, oldest first
  yesterdayOrders: YOrder[] | null;
  prev30: { revenue: number; orders: number } | null;
  money7: { product: number; shipping: number; discounts: number; giftCards: number; pointsRedeemed: number; offsite: number; offsiteCount: number; ship: number; pickup: number } | null;
  codes: Array<{ code: string; uses: number; saved: number }>;
  members: { approved: number; signups1: number; signups7: number; approved7: number; pending: number } | null;
  subscribers: { active: number; new7: number; unsub7: number } | null;
  loyalty: { earned7: number; redeemed7: number; outstanding: number; holders: number } | null;
  giftCards: { sold7: number; sold7Value: number; outstanding: number; active: number; awaiting: number } | null;
  ambassadors: { orders7: number; sales7: number; commission7: number; top: Array<{ name: string; orders: number; sales: number }> } | null;
  todo: { paymentsToSort: number | null; openHandoffs: number | null; retailWaiting: number | null; restocking: string[] | null };
  events: Array<{ title: string; date: number; going: number; capacity: number; waitlist: number }> | null;
  /** Today's site manager review (lib/assistant/managerReview.ts), when it ran in the last 18 hours. */
  managerTake?: { headline: string; wins: string[]; concerns: string[]; missed: string[]; insights: string[]; actions: string[] } | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const soldAt = (o: Order) => o.paidAt || o.createdAt;

async function attempt<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[nightly-report] ${label} left out:`, err);
    return null;
  }
}

/**
 * Plain seasons only, never holidays: spring Mar–May,
 * summer Jun–Aug, fall Sep–Nov, winter Dec–Feb, by the Pacific date.
 * Classic when the site's seasonal look is off or set to Classic.
 */
export function plainSeason(ymd: string): "spring" | "summer" | "fall" | "winter" {
  const m = Number(ymd.slice(5, 7));
  if (m >= 3 && m <= 5) return "spring";
  if (m >= 6 && m <= 8) return "summer";
  if (m >= 9 && m <= 11) return "fall";
  return "winter";
}

export async function reportExtras(siteUrl: string, now = Date.now()): Promise<ReportExtras> {
  const season = await attempt("season", () => currentSiteSeason(now));
  const theme = THEMES[season ? plainSeason(pacificDay(now)) : "classic"];
  const seasonLabel = theme.label;
  const art = siteUrl ? await attempt("art", () => themeArt(theme.key, siteUrl)) : null;

  const today = pacificDay(now);
  const yStart = pacificMidnight(addDays(today, -1));
  const tStart = pacificMidnight(today);
  const d7 = lastNDaysStart(7, now);

  const orders = (await attempt("orders", () => getOrders())) || [];
  const offsite = (await attempt("off-site sales", () => offsiteSales())) || [];
  const paid = [...orders.filter(isRevenue), ...offsite];

  // 14 days ending yesterday
  const daily: Day[] = [];
  const byDay = new Map<string, Day>();
  for (let i = 14; i >= 1; i--) {
    const d = { day: addDays(today, -i), revenue: 0, orders: 0 };
    daily.push(d);
    byDay.set(d.day, d);
  }
  for (const o of paid) {
    const d = byDay.get(pacificDay(soldAt(o)));
    if (d) {
      d.revenue += o.total;
      d.orders++;
    }
  }
  for (const d of daily) d.revenue = r2(d.revenue);

  let yesterdayOrders: YOrder[] | null = null;
  let prev30: ReportExtras["prev30"] = null;
  let money7: ReportExtras["money7"] = null;
  const codeMap = new Map<string, { uses: number; saved: number }>();
  let ambassadors: ReportExtras["ambassadors"] = null;
  if (orders.length || offsite.length) {
    yesterdayOrders = orders
      .filter((o) => !o.isInquiry && o.createdAt >= yStart && o.createdAt < tStart)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((o) => ({
        id: o.id,
        name: o.userName,
        items: o.items.reduce((n, i) => n + i.quantity, 0),
        total: o.total,
        status: normalizeStatus(o.status),
        method: o.giftCardOrder ? "gift card" : o.source === "retail" ? "retail" : o.shippingMethod === "ship" ? "ship" : "pickup",
        ambassador: o.ambassador?.name,
      }));

    const d30 = lastNDaysStart(30, now);
    const d60 = lastNDaysStart(60, now);
    const p30 = paid.filter((o) => soldAt(o) >= d60 && soldAt(o) < d30);
    prev30 = { revenue: r2(p30.reduce((n, o) => n + o.total, 0)), orders: p30.length };

    const last7 = paid.filter((o) => soldAt(o) >= d7);
    const real7 = last7.filter((o) => !o.offSite);
    money7 = {
      product: r2(real7.reduce((n, o) => n + o.total - o.shippingCost, 0)),
      shipping: r2(real7.reduce((n, o) => n + o.shippingCost, 0)),
      discounts: r2(real7.reduce((n, o) => n + (o.discount || 0), 0)),
      giftCards: r2(real7.reduce((n, o) => n + (o.giftCardApplied || 0), 0)),
      pointsRedeemed: real7.reduce((n, o) => n + (o.loyaltyPointsRedeemed || 0), 0),
      offsite: r2(last7.filter((o) => o.offSite).reduce((n, o) => n + o.total, 0)),
      offsiteCount: last7.filter((o) => o.offSite).length,
      ship: real7.filter((o) => o.shippingMethod === "ship").length,
      pickup: real7.filter((o) => o.shippingMethod === "pickup").length,
    };
    for (const o of real7) {
      if (!o.discountCode) continue;
      const k = o.discountCode.toUpperCase();
      const c = codeMap.get(k) || { uses: 0, saved: 0 };
      c.uses++;
      c.saved += o.discountAmount || 0;
      codeMap.set(k, c);
    }

    const amb = real7.filter((o) => o.ambassador);
    if (amb.length) {
      const per = new Map<string, { name: string; orders: number; sales: number }>();
      let commission = 0;
      let sales = 0;
      for (const o of amb) {
        const net = Math.max(0, o.total - o.shippingCost);
        sales += net;
        commission += (net * (o.ambassador!.rate ?? 0)) / 100;
        const p = per.get(o.ambassador!.id) || { name: o.ambassador!.name, orders: 0, sales: 0 };
        p.orders++;
        p.sales += net;
        per.set(o.ambassador!.id, p);
      }
      ambassadors = {
        orders7: amb.length,
        sales7: r2(sales),
        commission7: r2(commission),
        top: Array.from(per.values()).sort((a, b) => b.sales - a.sales).slice(0, 3).map((p) => ({ ...p, sales: r2(p.sales) })),
      };
    }
  }
  const codes = Array.from(codeMap.entries())
    .map(([code, v]) => ({ code, uses: v.uses, saved: r2(v.saved) }))
    .sort((a, b) => b.uses - a.uses || b.saved - a.saved)
    .slice(0, 5);

  const users = await attempt("members", () => getUsers());
  let members: ReportExtras["members"] = null;
  let loyalty: ReportExtras["loyalty"] = null;
  if (users) {
    members = {
      approved: users.filter((u) => u.status === "approved").length,
      signups1: users.filter((u) => u.createdAt >= yStart && u.createdAt < tStart).length,
      signups7: users.filter((u) => u.createdAt >= d7).length,
      approved7: users.filter((u) => u.status === "approved" && (u.approvedAt || 0) >= d7).length,
      pending: users.filter((u) => u.status === "pending").length,
    };
    let earned7 = 0;
    let redeemed7 = 0;
    let outstanding = 0;
    let holders = 0;
    for (const u of users) {
      const bal = Math.max(0, u.loyaltyPoints || 0);
      outstanding += bal;
      if (bal > 0) holders++;
      for (const h of u.pointsHistory || []) {
        if (h.date < d7) continue;
        if (h.kind === "earn" || (!h.kind && h.amount > 0)) earned7 += Math.max(0, h.amount);
        if (h.kind === "redeem" || (!h.kind && h.amount < 0)) redeemed7 += Math.abs(Math.min(0, h.amount));
      }
    }
    loyalty = { earned7, redeemed7, outstanding, holders };
  }

  const subs = await attempt("subscribers", () => getSubscribers());
  const subscribers = subs
    ? {
        active: subs.filter((s) => !s.unsubscribedAt).length,
        new7: subs.filter((s) => s.subscribedAt >= d7 && !s.unsubscribedAt).length,
        unsub7: subs.filter((s) => (s.unsubscribedAt || 0) >= d7).length,
      }
    : null;

  const cards = await attempt("gift cards", () => allGiftCards());
  const giftCards =
    cards && cards.length
      ? {
          sold7: cards.filter((c) => c.kind === "gift" && c.state !== "void" && c.createdAt >= d7).length,
          sold7Value: r2(cards.filter((c) => c.kind === "gift" && c.state !== "void" && c.createdAt >= d7).reduce((n, c) => n + c.amount, 0)),
          outstanding: r2(cards.filter((c) => c.state === "active").reduce((n, c) => n + c.balance, 0)),
          active: cards.filter((c) => c.state === "active" && c.balance > 0).length,
          awaiting: cards.filter((c) => c.state === "awaiting").length,
        }
      : null;

  const toSort = await attempt("payments to sort", () => paymentsToSort());
  const handoffs = await attempt("handed to the team", async () => (await recentEscalations()).filter((e) => escalationStatus(e) === "open").length);
  const retailWaiting = await attempt("retail requests", async () => (await getRequests()).filter((r) => r.status === "pending").length);
  const restocking = await attempt("stock", async () => {
    const [stock, products] = [await getStock(), await getProducts()];
    return products.filter((p) => isRestocking(p, stock)).map((p) => p.name);
  });

  const events = await attempt("events", async () => {
    const [evs, regs] = [await getEvents(), await getRegistrations()];
    const until = now + 14 * 864e5;
    return evs
      .filter((e) => e.published && e.date >= now && e.date <= until)
      .sort((a, b) => a.date - b.date)
      .slice(0, 4)
      .map((e) => {
        const mine = regs.filter((r) => r.eventId === e.id);
        return {
          title: e.title,
          date: e.date,
          going: mine.filter((r) => r.status === "registered").length,
          capacity: e.capacity,
          waitlist: mine.filter((r) => r.status === "waitlisted").length,
        };
      });
  });

  const managerTake = await attempt("manager's take", async () => {
    const { isEnabled } = await import("./flags");
    if (!(await isEnabled("manager_review"))) return null;
    const { latestReview } = await import("./assistant/managerReview");
    const r = await latestReview();
    if (!r?.ok || now - r.at > 18 * 3_600_000) return null;
    return { headline: r.headline || "", wins: r.wins || [], concerns: r.concerns || [], missed: r.missed || [], insights: r.insights || [], actions: (r.actions || []).map((a) => a.title) };
  });

  return {
    managerTake,
    theme,
    seasonLabel,
    art,
    daily,
    yesterdayOrders,
    prev30,
    money7,
    codes,
    members,
    subscribers,
    loyalty,
    giftCards,
    ambassadors,
    todo: { paymentsToSort: toSort, openHandoffs: handoffs, retailWaiting, restocking },
    events,
  };
}

// ==================== HTML ====================

/** $1,234.56 for the body (the subject keeps the old $1234.56 form). */
export function usd(n: number): string {
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
const num = (n: number) => n.toLocaleString("en-US");
const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;

const INK = "#2e3236";
const MUTED = "#81858b";
const LINE = "#ebe8e3";
const UP = "#4f8a2a";
const DOWN = "#c0504d";

/** ▲ 12% / ▼ 8% versus a previous figure. */
function delta(now: number, before: number, label: string): string {
  if (before <= 0 && now <= 0) return `<span class="muted" style="color:${MUTED};">same as ${label}</span>`;
  if (before <= 0) return `<span style="color:${UP};font-weight:700;">new</span> <span class="muted" style="color:${MUTED};">vs ${label}</span>`;
  const p = ((now - before) / before) * 100;
  if (Math.abs(p) < 0.5) return `<span class="muted" style="color:${MUTED};">level with ${label}</span>`;
  const up = p > 0;
  return `<span style="color:${up ? UP : DOWN};font-weight:700;white-space:nowrap;">${up ? "▲" : "▼"} ${Math.abs(p).toFixed(0)}%</span> <span class="muted" style="color:${MUTED};">vs ${label}</span>`;
}

function dateLong(t: number): string {
  return new Date(t).toLocaleDateString("en-US", { timeZone: brand.timezone, weekday: "long", month: "long", day: "numeric", year: "numeric" });
}
function dayLabel(ymd: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });
}

export function buildReportHtml(i: Insights, x: ReportExtras, attachments: string[], phrase: string | null = null): string {
  const t = x.theme;
  const accent = t.key === "blackfriday" ? "#1f1f28" : t.accent;
  const kicker = t.kicker;
  const soft = t.soft;

  const heading = (text: string, top = 30) =>
    `<div class="kicker" style="margin:${top}px 0 12px;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${kicker};font-weight:700;">${text}</div>`;
  const divider = x.art
    ? `<div style="margin:26px 0 4px;text-align:center;"><img src="${x.art.divider}" width="560" alt="" style="display:block;width:100%;max-width:560px;height:auto;border:0;margin:0 auto;" /></div>`
    : `<div class="line" style="margin:28px 0 4px;border-top:1px solid ${LINE};"></div>`;

  const tile = (label: string, value: string, sub = "") => `
    <td class="tile-cell" width="33%" style="padding:5px;vertical-align:top;">
      <div class="tile" style="background:${soft};border-radius:12px;padding:14px 10px;text-align:center;">
        <div class="tile-v" style="font-size:21px;font-weight:700;color:${accent};line-height:1.2;white-space:nowrap;">${value}</div>
        <div class="muted" style="font-size:10.5px;text-transform:uppercase;letter-spacing:0.1em;color:${MUTED};margin-top:5px;">${label}</div>
        ${sub ? `<div class="muted" style="font-size:12px;color:${MUTED};margin-top:3px;line-height:1.4;">${sub}</div>` : ""}
      </div>
    </td>`;

  const row = (cells: string[], opts: { head?: boolean } = {}) =>
    `<tr>${cells
      .map((c, idx) => {
        const align = idx === 0 ? "left" : idx === cells.length - 1 ? "right" : "center";
        return opts.head
          ? `<th class="muted line" style="text-align:${align};padding:0 0 6px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};font-weight:600;border-bottom:1px solid ${LINE};">${c}</th>`
          : `<td class="line" style="text-align:${align};padding:9px 0;border-bottom:1px solid ${LINE};${idx === cells.length - 1 ? "font-weight:700;" : ""}">${c}</td>`;
      })
      .join("")}</tr>`;
  const table = (head: string[], rows: string[][]) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;">${row(head, { head: true })}${rows.map((r) => row(r)).join("")}</table>`;

  // ---------- Needs your attention (the old list, plus the inboxes) ----------
  const actions: string[] = [];
  if (i.pendingOver3Days.length > 0) {
    actions.push(
      `<strong>${i.pendingOver3Days.length} order${i.pendingOver3Days.length !== 1 ? "s" : ""} waiting on payment for 3+ days</strong> (${usd(i.pendingOver3Days.reduce((n, o) => n + o.total, 0))} total). Longest: ${escapeHtml(i.pendingOver3Days[0].userName)}, ${i.pendingOver3Days[0].daysWaiting} days.`
    );
  }
  if (i.awaitingFulfillment > 0) actions.push(`<strong>${i.awaitingFulfillment} paid order${i.awaitingFulfillment !== 1 ? "s" : ""}</strong> ready to ship or hand off.`);
  if (i.pendingApprovals > 0) actions.push(`<strong>${i.pendingApprovals} member request${i.pendingApprovals !== 1 ? "s" : ""}</strong> waiting for review.`);
  if (x.todo.paymentsToSort) actions.push(`<strong>${plural(x.todo.paymentsToSort, "Venmo / Zelle payment")}</strong> to sort in Orders &rarr; Venmo / Zelle payments.`);
  if (x.todo.openHandoffs) actions.push(`<strong>${plural(x.todo.openHandoffs, "conversation")}</strong> handed to the team and still open.`);
  if (x.todo.retailWaiting) actions.push(`<strong>${plural(x.todo.retailWaiting, "store stock request")}</strong> waiting in the Retail tab.`);
  if (x.todo.restocking?.length) {
    const s = x.todo.restocking.slice(0, 3).map(escapeHtml).join(", ");
    actions.push(`${plural(x.todo.restocking.length, "product")} at 0 in Stock (showing as restocking): ${s}${x.todo.restocking.length > 3 ? "…" : ""}.`);
  }
  if (i.revenueChangePct !== null && i.revenueChangePct <= -25) {
    actions.push(`Revenue is down ${Math.abs(i.revenueChangePct).toFixed(0)}% versus the previous week. Might be a good week for a promo or a countdown sale.`);
  }
  if (i.slowMovers.length > 0) {
    const sample = i.slowMovers.slice(0, 3).map((p) => escapeHtml(p.name)).join(", ");
    actions.push(`${i.slowMovers.length} product${i.slowMovers.length !== 1 ? "s haven't" : " hasn't"} sold in 30 days: ${sample}${i.slowMovers.length > 3 ? "…" : ""}.`);
  }
  const allClear = actions.length === 0;
  if (allClear) actions.push("Nothing needs attention. Everything is paid, shipped, and moving.");

  // ---------- 14-day chart ----------
  const max = Math.max(1, ...x.daily.map((d) => d.revenue));
  const BAR_H = 92;
  const bars = x.daily
    .map((d, idx) => {
      const h = d.revenue > 0 ? Math.max(4, Math.round((d.revenue / max) * BAR_H)) : 2;
      const last = idx === x.daily.length - 1;
      const color = last ? accent : d.revenue > 0 ? kicker : LINE;
      return `<td valign="bottom" align="center" style="padding:0 2px;height:${BAR_H}px;vertical-align:bottom;" title="${dayLabel(d.day, { month: "short", day: "numeric" })}: ${usd(d.revenue)}">
        <div class="${last ? "" : "bar"}" style="height:${h}px;line-height:${h}px;font-size:1px;background:${color};border-radius:4px 4px 1px 1px;${last || !d.revenue ? "" : "opacity:0.55;"}">&nbsp;</div>
      </td>`;
    })
    .join("");
  const barLabels = x.daily
    .map((d, idx) => {
      const last = idx === x.daily.length - 1;
      return `<td align="center" class="muted" style="padding:5px 0 0;font-size:10px;color:${last ? accent : MUTED};${last ? "font-weight:700;" : ""}">${dayLabel(d.day, { weekday: "narrow" })}</td>`;
    })
    .join("");
  const best = x.daily.reduce((a, b) => (b.revenue > a.revenue ? b : a), x.daily[0]);
  const yDay = x.daily[x.daily.length - 1];
  const dayBefore = x.daily[x.daily.length - 2];
  const weekAgo = x.daily[x.daily.length - 8];
  const avg14 = x.daily.reduce((n, d) => n + d.revenue, 0) / x.daily.length;

  // ---------- Yesterday's orders ----------
  const STATUS: Record<string, string> = { pending: "Awaiting payment", paid: "Paid", completed: "Completed", cancelled: "Cancelled", inquiry: "Inquiry" };
  const yRows = (x.yesterdayOrders || []).slice(0, 12).map((o) => [
    `<span style="font-weight:600;">${escapeHtml(o.name)}</span><br/><span class="muted" style="font-size:12px;color:${MUTED};">#${escapeHtml(o.id.slice(-6).toUpperCase())} &middot; ${plural(o.items, "item")} &middot; ${o.method}${o.ambassador ? ` &middot; via ${escapeHtml(o.ambassador)}` : ""}</span>`,
    `<span class="muted" style="font-size:12px;color:${o.status === "pending" ? "#b07a12" : o.status === "cancelled" ? DOWN : MUTED};">${STATUS[o.status] || o.status}</span>`,
    usd(o.total),
  ]);

  const statLine = (label: string, value: string) =>
    `<tr><td class="line" style="padding:8px 0;border-bottom:1px solid ${LINE};">${label}</td><td class="line" style="padding:8px 0;border-bottom:1px solid ${LINE};text-align:right;font-weight:700;white-space:nowrap;">${value}</td></tr>`;
  const statTable = (lines: string[]) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;">${lines.join("")}</table>`;

  const half = (a: string, b: string) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>
      <td class="half" width="50%" valign="top" style="vertical-align:top;padding-right:12px;">${a}</td>
      <td class="half" width="50%" valign="top" style="vertical-align:top;padding-left:12px;">${b}</td>
    </tr></table>`;

  const m7 = x.money7;
  const moneyBlock = m7
    ? heading("Where the money came from &middot; 7 days") +
      statTable([
        statLine("Product sales", usd(m7.product)),
        statLine("Shipping collected", usd(m7.shipping)),
        statLine("Discounts given", m7.discounts ? `&minus;${usd(m7.discounts)}` : usd(0)),
        ...(m7.giftCards ? [statLine("Paid with gift card balance", usd(m7.giftCards))] : []),
        ...(m7.pointsRedeemed ? [statLine("Loyalty points redeemed", `${num(m7.pointsRedeemed)} pts`)] : []),
        ...(m7.offsiteCount ? [statLine(`Off-site Venmo / Zelle (${m7.offsiteCount})`, usd(m7.offsite))] : []),
      ])
    : "";
  const codesBlock = x.codes.length
    ? heading("Codes used &middot; 7 days") +
      table(
        ["Code", "Uses", "Saved"],
        x.codes.map((c) => [`<span style="font-family:Menlo,Consolas,monospace;font-size:13px;">${escapeHtml(c.code)}</span>`, String(c.uses), usd(c.saved)])
      )
    : heading("Codes used &middot; 7 days") + `<p class="muted" style="margin:0;color:${MUTED};font-size:14px;">No discount codes used this week.</p>`;

  const people: string[] = [];
  if (x.members)
    people.push(
      heading("Members", 30) +
        statTable([
          statLine("Approved members", num(x.members.approved)),
          statLine("New sign-ups yesterday", num(x.members.signups1)),
          statLine("New sign-ups, 7 days", num(x.members.signups7)),
          statLine("Approved, 7 days", num(x.members.approved7)),
        ])
    );
  if (x.subscribers)
    people.push(
      heading("Mailing list", 30) +
        statTable([
          statLine("Active subscribers", num(x.subscribers.active)),
          statLine("Joined, 7 days", `+${num(x.subscribers.new7)}`),
          statLine("Unsubscribed, 7 days", x.subscribers.unsub7 ? `&minus;${num(x.subscribers.unsub7)}` : "0"),
        ])
    );

  const perks: string[] = [];
  if (x.loyalty)
    perks.push(
      heading("Loyalty points", 30) +
        statTable([
          statLine("Earned, 7 days", `${num(x.loyalty.earned7)} pts`),
          statLine("Redeemed, 7 days", `${num(x.loyalty.redeemed7)} pts`),
          statLine(`Unspent (${plural(x.loyalty.holders, "member")})`, `${num(x.loyalty.outstanding)} pts`),
        ])
    );
  if (x.giftCards)
    perks.push(
      heading("Gift cards", 30) +
        statTable([
          statLine("Sold, 7 days", `${num(x.giftCards.sold7)} &middot; ${usd(x.giftCards.sold7Value)}`),
          statLine(`Unspent balance (${plural(x.giftCards.active, "card")})`, usd(x.giftCards.outstanding)),
          ...(x.giftCards.awaiting ? [statLine("Waiting on payment", num(x.giftCards.awaiting))] : []),
        ])
    );
  if (x.ambassadors)
    perks.push(
      heading("Ambassadors &middot; 7 days", 30) +
        statTable([
          statLine("Orders credited", num(x.ambassadors.orders7)),
          statLine("Their sales (before shipping)", usd(x.ambassadors.sales7)),
          statLine("Commission earned", usd(x.ambassadors.commission7)),
          ...x.ambassadors.top.map((a) => statLine(`&nbsp;&nbsp;${escapeHtml(a.name)} <span class="muted" style="color:${MUTED};">(${plural(a.orders, "order")})</span>`, usd(a.sales))),
        ])
    );
  const pairs = (blocks: string[]) => {
    let out = "";
    for (let k = 0; k < blocks.length; k += 2) out += blocks[k + 1] ? half(blocks[k], blocks[k + 1]) : blocks[k];
    return out;
  };

  const eventsBlock = x.events?.length
    ? heading("Coming up &middot; next 14 days") +
      table(
        ["Event", "When", "Going"],
        x.events.map((e) => [
          escapeHtml(e.title),
          `<span class="muted" style="font-size:13px;color:${MUTED};white-space:nowrap;">${new Date(e.date).toLocaleString("en-US", { timeZone: brand.timezone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>`,
          `${e.going}${e.capacity ? ` / ${e.capacity}` : ""}${e.waitlist ? ` <span class="muted" style="font-weight:400;color:${MUTED};font-size:12px;">+${e.waitlist} waitlist</span>` : ""}`,
        ])
      )
    : "";

  const preheader = `${usd(i.yesterday.revenue)} yesterday from ${plural(i.yesterday.orders, "order")} · ${usd(i.last7.revenue)} last 7 days${allClear ? " · all clear" : ` · ${plural(actions.length, "thing")} to look at`}`;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>Nightly report</title>
<style>
  @media (max-width: 520px) {
    .pad { padding: 20px 16px !important; }
    .tile-v { font-size: 17px !important; }
    .tile-cell { padding: 3px !important; }
    .hero-v { font-size: 34px !important; }
    .half { display: block !important; width: 100% !important; padding: 0 !important; }
    .outer { padding: 0 !important; }
    .card { border-radius: 0 !important; }
  }
  @media (prefers-color-scheme: dark) {
    .bg { background: #15181b !important; }
    .card { background: #1f2327 !important; box-shadow: none !important; }
    .ink, .ink td, .ink th { color: #e6e7e4 !important; }
    .muted { color: #9ea3a8 !important; }
    .tile, .soft { background: #2a2f34 !important; }
    .tile-v, .hero-v { color: #f2f2ee !important; }
    .line { border-color: #363b40 !important; }
    .note { background: #2d2a1f !important; }
    .bar { opacity: 0.5 !important; }
    .foot { background: #191c1f !important; }
  }
</style>
</head>
<body class="bg" style="margin:0;padding:0;background:${soft};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg" style="background:${soft};">
<tr><td class="outer" align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="card ink" style="max-width:640px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 10px rgba(40,40,30,0.07);font-family:'Optima','Avenir Next','Helvetica Neue',Helvetica,Arial,sans-serif;color:${INK};font-size:15px;line-height:1.5;">
  ${x.art ? `<tr><td style="padding:0;line-height:0;"><img src="${x.art.header}" width="640" alt="" style="display:block;width:100%;max-width:640px;height:auto;border:0;" /></td></tr>` : ""}
  <tr><td class="pad" style="padding:26px 30px 30px;">

    <div class="kicker" style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:${kicker};font-weight:700;">${escapeHtml(t.emoji)}&nbsp; Nightly report &middot; ${escapeHtml(x.seasonLabel)}</div>
    <h1 style="margin:6px 0 2px;font-family:'Libre Baskerville',Georgia,'Times New Roman',serif;font-style:italic;font-weight:400;font-size:26px;line-height:1.25;">${escapeHtml(brand.name)}</h1>
    <div class="muted" style="color:${MUTED};font-size:13px;">${dateLong(i.generatedAt)} &middot; covering ${dayLabel(yDay.day, { weekday: "long", month: "short", day: "numeric" })} &middot; ${brand.timezoneLabel} time</div>

    ${phrase ? `
    <div class="soft line" style="margin:22px 0 0;padding:14px 16px;border:1px dashed ${kicker};border-radius:12px;background:#fcfcfa;">
      <div class="kicker" style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${kicker};font-weight:700;margin-bottom:6px;">Today&rsquo;s staff password</div>
      <div class="tile-v" style="font-size:21px;font-weight:700;color:${INK};font-family:Menlo,Consolas,monospace;letter-spacing:0.02em;">${escapeHtml(phrase)}</div>
      <p class="muted" style="margin:6px 0 0;font-size:12.5px;color:${MUTED};">For the admin sign-in until midnight ${brand.timezoneLabel} (yesterday&rsquo;s works until noon). Signed-in staff can always see it in Settings &rarr; Steward password. Don&rsquo;t forward this email.</p>
    </div>` : ""}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr><td class="soft" style="background:${soft};border-radius:14px;padding:20px 20px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td valign="top" style="vertical-align:top;">
          <div class="muted" style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:${MUTED};font-weight:600;">Yesterday</div>
          <div class="hero-v" style="font-size:40px;font-weight:700;color:${accent};line-height:1.1;margin-top:4px;white-space:nowrap;">${usd(i.yesterday.revenue)}</div>
          <div style="margin-top:4px;font-size:14px;">${plural(i.yesterday.orders, "order")}${i.yesterday.orders ? ` &middot; avg ${usd(i.yesterday.avgOrderValue)}` : ""}</div>
          <div style="margin-top:8px;font-size:13px;line-height:1.7;">
            ${dayBefore ? delta(yDay.revenue, dayBefore.revenue, dayLabel(dayBefore.day, { weekday: "long" })) : ""}<br/>
            ${weekAgo ? delta(yDay.revenue, weekAgo.revenue, `last ${dayLabel(weekAgo.day, { weekday: "long" })}`) : ""}
          </div>
        </td>
      </tr></table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;table-layout:fixed;">
        <tr>${bars}</tr>
        <tr>${barLabels}</tr>
      </table>
      <div class="muted" style="margin-top:8px;font-size:12px;color:${MUTED};">Last 14 days &middot; daily average ${usd(avg14)}${best && best.revenue > 0 ? ` &middot; best ${dayLabel(best.day, { weekday: "short", month: "short", day: "numeric" })} (${usd(best.revenue)})` : ""}</div>
    </td></tr></table>

    ${heading("Revenue", 28)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed;"><tr>
      ${tile("Last 7 days", usd(i.last7.revenue), `${plural(i.last7.orders, "order")}<br/>${i.revenueChangePct === null ? `<span class="muted" style="color:${MUTED};">no prior week</span>` : delta(i.last7.revenue, i.prev7.revenue, "prior 7")}`)}
      ${tile("Last 30 days", usd(i.last30.revenue), `${plural(i.last30.orders, "order")}<br/>${x.prev30 ? delta(i.last30.revenue, x.prev30.revenue, "prior 30") : ""}`)}
      ${tile("All time", usd(i.allTime.revenue), plural(i.allTime.orders, "order"))}
    </tr><tr>
      ${tile("Avg order", usd(i.last7.avgOrderValue), "last 7 days")}
      ${tile("Awaiting payment", usd(i.pendingValue), plural(i.pendingCount, "order"))}
      ${tile("To ship / hand off", num(i.awaitingFulfillment), "paid orders")}
    </tr></table>

    ${heading(allClear ? "All clear" : "Needs your attention", 28)}
    <div class="note" style="background:${allClear ? soft : "#fdf6e3"};border-left:4px solid ${allClear ? accent : "#d2a12a"};padding:14px 16px 14px 14px;border-radius:0 10px 10px 0;">
      <ul style="margin:0;padding-left:18px;line-height:1.65;font-size:14px;">
        ${actions.map((a) => `<li style="margin:2px 0;">${a}</li>`).join("")}
      </ul>
    </div>

    ${x.managerTake ? heading("Manager&rsquo;s take", 28) + `<div class="note" style="background:${soft};border-left:4px solid ${accent};padding:14px 16px 14px 14px;border-radius:0 10px 10px 0;font-size:14px;line-height:1.6;">${x.managerTake.headline ? `<p style="margin:0 0 8px;"><strong>${escapeHtml(x.managerTake.headline)}</strong></p>` : ""}${([["Going well", x.managerTake.wins], ["Needs attention", x.managerTake.concerns], ["May have been missed", x.managerTake.missed], ["Insights", x.managerTake.insights], ["Suggested (in the Today panel)", x.managerTake.actions]] as Array<[string, string[]]>).filter(([, l]) => l.length).map(([label, l]) => `<div style="margin:8px 0 2px;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${kicker};font-weight:700;">${label}</div><ul style="margin:0;padding-left:18px;">${l.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`).join("")}</div>` : ""}

    ${x.yesterdayOrders ? heading(`Orders placed yesterday &middot; ${x.yesterdayOrders.length}`) + (yRows.length ? table(["Customer", "Status", "Total"], yRows) + (x.yesterdayOrders.length > 12 ? `<p class="muted" style="margin:8px 0 0;font-size:12px;color:${MUTED};">…and ${x.yesterdayOrders.length - 12} more in the orders.csv attached.</p>` : "") : `<p class="muted" style="margin:0;color:${MUTED};font-size:14px;">No new orders yesterday.</p>`) : ""}

    ${divider}

    ${heading("Top sellers (30 days)", 22)}
    ${i.topProducts.length ? table(["Product", "Units", "Revenue"], i.topProducts.map((p, idx) => [`<span class="muted" style="color:${MUTED};">${idx + 1}.</span> ${escapeHtml(p.name)}`, String(p.unitsSold), usd(p.revenue)])) : `<p class="muted" style="color:${MUTED};margin:0;">No sales in the last 30 days.</p>`}

    ${i.categoryRevenue.length ? heading("By category (30 days)") + table(["Category", "Units", "Revenue"], i.categoryRevenue.slice(0, 5).map((c) => [escapeHtml(c.category), String(c.units), usd(c.revenue)])) : ""}

    ${moneyBlock || codesBlock ? half(moneyBlock, codesBlock) : ""}

    ${divider}

    ${heading("Customers", 22)}
    <p style="margin:0 0 12px;line-height:1.65;font-size:14px;">
      Last 7 days: <strong>${i.newCustomers7}</strong> new customer${i.newCustomers7 !== 1 ? "s" : ""},
      <strong>${i.repeatCustomers7}</strong> returning (<strong>${i.repeatRatePct.toFixed(0)}%</strong> repeat rate).<br/>
      Fulfillment: <strong>${i.shipCount7}</strong> shipped &middot; <strong>${i.pickupCount7}</strong> pickup.
    </p>
    ${i.topCustomers.length ? table(["Top customers (all time)", "Orders", "Spend"], i.topCustomers.map((c) => [escapeHtml(c.name), String(c.orders), usd(c.spend)])) : ""}

    ${pairs(people)}
    ${pairs(perks)}
    ${eventsBlock}

  </td></tr>
  <tr><td class="foot pad" style="background:${soft};padding:22px 30px 26px;">
    <div style="font-weight:700;font-size:14px;margin-bottom:6px;">Attached backups</div>
    <ul style="margin:0 0 10px 18px;padding:0;line-height:1.6;font-size:13px;">${attachments.map((a) => `<li>${a}</li>`).join("")}</ul>
    <p class="muted" style="font-size:12px;color:${MUTED};margin:0;line-height:1.55;">Keep the latest email and you can always restore the catalog or reconstruct orders. Revenue figures count orders marked paid or shipped, plus off-site Venmo / Zelle sales. Days run midnight to midnight ${brand.timezoneLabel} time.</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}
