/**
 * The Today bulletin's suggestions (site-manager items + campaign ideas),
 * worked out in one place so the Overview card and the Concierge's
 * today_item tool always agree on exactly which people, orders and products
 * an item is about.
 */

import { cachedEvents, cachedOrders, cachedProducts, cachedUsers } from "./assistant/knowledge";
import { monthSpend } from "./assistant/usage";
import { getDiscounts } from "./discounts";
import { getRegistrations } from "./events";
import { getBanner } from "./banner";
import { isEnabled } from "./flags";
import { getSubscribers } from "./subscribers";
import { listCampaigns } from "./campaignSchedule";
import { listBundles } from "./bundleStore";
import { getSettings } from "./settings";
import { managerSuggestions, type Suggestion } from "./siteManager";
import { marketingIdeas } from "./marketingIdeas";
import { suggestions as venmoSuggestions } from "./venmoInbox";
import { refOf } from "./venmoMatch";
import { getStock } from "./stock";
import { restockNeeds } from "./stockMath";
import { normalizeStatus } from "./orderStatus";
import { getAmbassadors, termsOf } from "./ambassadors";
import { ambassadorStatsFor } from "./ambassadorData";
import { pacificDay } from "./periods";

export async function todaySuggestions(monthCap: number): Promise<{ manager: Suggestion[]; marketing: Suggestion[] }> {
  let manager: Suggestion[] = [];
  let marketing: Suggestion[] = [];
  // Each half fails on its own, so one bad read never hides the other.
  try {
    const [orders, users, products, codes, events, registrations, banner, remindersOn, spent, settings] = await Promise.all([
      cachedOrders(),
      cachedUsers(),
      cachedProducts(),
      getDiscounts(),
      cachedEvents(),
      getRegistrations(),
      getBanner().catch(() => null),
      isEnabled("invoice_reminders"),
      monthSpend().catch(() => 0),
      getSettings().catch(() => null),
    ]);
    manager = managerSuggestions({
      now: Date.now(),
      orders,
      users,
      products,
      codes,
      events,
      registrations,
      banner,
      remindersOn,
      spend: { month: spent, cap: monthCap },
      packagingSet: settings ? settings.packagingOz !== undefined && settings.packagingOz !== null : undefined,
    });
  } catch (err) {
    console.error("[today] suggestions skipped", err);
  }
  // Venmo payments that match an unpaid order: staff confirm each one.
  try {
    if (await isEnabled("venmo_matching")) {
      const hits = (await venmoSuggestions()).slice(0, 10);
      if (hits.length) {
        const m = (n?: number) => `$${(n || 0).toFixed(2)}`;
        manager.unshift({
          key: "venmo-matches",
          priority: "now",
          task: `Confirm ${hits.length} Venmo payment${hits.length === 1 ? "" : "s"} that match unpaid orders`,
          why: "Matched from Venmo's emails. Nothing is marked paid until you confirm.",
          items: hits.map(({ payment: p, order: o }) => `Venmo ${m(p.amount)} from ${p.payer}${p.note ? ` (“${p.note.slice(0, 40)}”)` : ""} → #${refOf(o.id)} ${o.userName}${p.match?.strength === "strong" ? "" : " · likely"}${p.match?.amountDiffers ? " · amount differs" : ""}`),
          ask: "Prepare a confirm card for each Venmo payment that matches an unpaid order, so I can mark them paid.",
          targets: hits.map(({ payment: p, order: o }) => ({ kind: "order" as const, id: o.id, name: `#${refOf(o.id)} ${o.userName}`, detail: `venmo payment ${p.id}: ${m(p.amount)} from ${p.payer}; ${p.match?.why}` })),
          guide: "For each target call propose_venmo_payment with payment_id = the venmo payment id in its detail and order_id = the target id (one card each).",
          tab: "orders",
          button: "Prepare confirm cards",
        });
      }
    }
  } catch (err) {
    console.error("[today] venmo matches skipped", err);
  }
  // Restock needs from Stock counts: owed to customers, at 0, or running low.
  try {
    if (await isEnabled("stock_counts")) {
      const [stock, orders, products] = await Promise.all([getStock(), cachedOrders(), cachedProducts()]);
      const needs = restockNeeds(stock, orders.map((o) => ({ ...o, status: normalizeStatus(o.status) })), products, Date.now());
      if (needs.length) {
        const owed = needs.reduce((n, x) => n + x.owed, 0);
        const line = (x: (typeof needs)[number]) =>
          `${x.name}: ${x.onHand} on hand${x.owed ? ` · ${x.owed} on backorder (${x.ordersWaiting} order${x.ordersWaiting === 1 ? "" : "s"})` : ""}${x.sold30 ? ` · sold ${x.sold30} in 30 days` : ""}${x.daysLeft !== null && x.onHand > 0 ? ` · ~${x.daysLeft} days left` : ""} → order ~${x.suggest}`;
        manager.unshift({
          key: "restock-needs",
          priority: owed ? "today" : "this week",
          task: owed
            ? `Restock ${needs.length} product${needs.length === 1 ? "" : "s"} — ${owed} unit${owed === 1 ? "" : "s"} on backorder for customers`
            : `${needs.length} product${needs.length === 1 ? " is" : "s are"} out or running low`,
          why: owed
            ? "Customers have ordered these while at 0 and are waiting. Suggested amounts cover what's owed plus about 30 days of sales."
            : "From Stock counts and the last 30 days of orders. Suggested amounts cover about 30 days of sales.",
          items: needs.slice(0, 8).map(line),
          ask: "Which products need restocking, how many are owed to customers, and how much should I order? When new stock arrives I'll give you the counts — then prepare a stock count card for each.",
          targets: needs.slice(0, 10).map((x) => ({ kind: "product" as const, id: x.id, name: x.name, detail: `${x.onHand} on hand, ${x.owed} on backorder across ${x.ordersWaiting} open orders, sold ${x.sold30} in 30 days, suggested order ${x.suggest}` })),
          guide: "Summarise each target from its detail (on hand, on backorder, 30-day sales, suggested order). Change nothing yet. When staff give the new on-hand numbers, call propose_stock_count once per product with that count.",
          tab: "products",
          button: "Plan the restock",
        });
      }
    }
  } catch (err) {
    console.error("[today] restock needs skipped", err);
  }
  // Ambassadors: payouts due (first week of their payout month) and trial reviews.
  try {
    if (await isEnabled("ambassador_pages")) {
      const list = (await getAmbassadors()).filter((a) => a.active || (a.payouts || []).length);
      const stats = await ambassadorStatsFor(list);
      const today = pacificDay();
      const dom = Number(today.slice(8, 10));
      const month = Number(today.slice(5, 7));
      const due = list.filter((a) => {
        const sched = termsOf(a).payoutSchedule;
        const inWindow = dom <= 7 && (sched === "monthly" || (sched === "quarterly" && [1, 4, 7, 10].includes(month)));
        return inWindow && (stats[a.id]?.owed || 0) >= 1;
      });
      if (due.length) {
        const total = due.reduce((n, a) => n + stats[a.id].owed, 0);
        manager.unshift({
          key: "ambassador-payouts",
          priority: "today",
          task: `Pay ${due.length} ambassador${due.length === 1 ? "" : "s"}: $${total.toFixed(2)} commission owed`,
          why: "Commission earned on paid orders, minus payouts already recorded. Pay them (Zelle/Venmo), then record each payout.",
          items: due.map((a) => `${a.name}: $${stats[a.id].owed.toFixed(2)} owed (${termsOf(a).payoutSchedule})`),
          ask: "Who do we owe ambassador commission to and how much? Once I've paid them, prepare a payout card for each, and offer to send each their progress report.",
          targets: due.map((a) => ({ kind: "ambassador" as const, id: a.id, name: a.name, detail: `owed $${stats[a.id].owed.toFixed(2)}; earned $${stats[a.id].earnedAllTime.toFixed(2)} all time, paid $${stats[a.id].paidOut.toFixed(2)}` })),
          guide: "Summarise what each target is owed (from its detail). Don't record anything until staff say they've paid; then call propose_ambassador_payout with ambassador = the target id and the amount actually paid (one card each). Offer propose_ambassador_report (period last-month) for each.",
          tab: "ambassadors",
          button: "Plan the payouts",
        });
      }
      const reviews = list.filter((a) => a.active && stats[a.id]?.trial.status === "review");
      if (reviews.length) {
        manager.unshift({
          key: "ambassador-trials",
          priority: "this week",
          task: `Trial over: review ${reviews.map((a) => a.name.split(" ")[0]).join(", ")}`,
          why: "Their trial period has ended. Look at how it went together and agree what's next (rate, goals, keep going).",
          items: reviews.map((a) => { const st = stats[a.id]; return `${a.name}: ${st.orders} orders, $${st.sales.toFixed(2)} paid sales, $${st.earnedAllTime.toFixed(2)} earned since ${termsOf(a).startDate}`; }),
          ask: "How did the ambassador trials that just ended go? Give me a summary for each, then help me record the review.",
          targets: reviews.map((a) => ({ kind: "ambassador" as const, id: a.id, name: a.name, detail: `trial ended ${stats[a.id].trial.ends}` })),
          guide: "For each target call ambassadors with ambassador = the target id and period since-start, and summarise visits, orders, sales, earnings and top products. Then offer propose_ambassador with ambassador = the target id and trial_reviewed true (plus any new terms staff decide, e.g. growth_on or commission_pct).",
          tab: "ambassadors",
          button: "Review the trials",
        });
      }
    }
  } catch (err) {
    console.error("[today] ambassadors skipped", err);
  }
  try {
    const [orders, users, products, subscribers, campaigns, bundles, settings] = await Promise.all([
      cachedOrders(),
      cachedUsers(),
      cachedProducts(),
      getSubscribers().catch(() => []),
      listCampaigns().catch(() => []),
      listBundles().catch(() => []),
      getSettings().catch(() => null),
    ]);
    marketing = marketingIdeas({ now: Date.now(), orders, users, products, subscribers, campaigns, bundles, settings });
  } catch (err) {
    console.error("[today] campaign ideas skipped", err);
  }
  return { manager, marketing };
}
