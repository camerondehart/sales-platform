/**
 * "Stand-in site manager": proactive suggestions for the Overview bulletin,
 * on top of the daily to-do list (daily_tasks). Plain rules over live data —
 * no AI call, no cost. Every suggestion is only a suggestion: its button asks
 * the staff Concierge to prepare confirm cards (nothing happens until staff
 * press Confirm) or opens the right tab.
 *
 * Each rule only speaks up when there's something worth doing, so on a quiet
 * day the list is short.
 */

import { normalizeStatus, type Order } from "./orders";
import type { User } from "./users";
import type { Product } from "./storage";
import { isExternal, isInternal } from "./storage";
import type { Discount } from "./discounts";
import type { SiteEvent, Registration } from "./events";
import type { Banner } from "./banner";
import { hiddenFromAssistant } from "./assistant/shared";
import { pacificDateTime } from "./periods";
import { DEFAULT_PACKAGING_OZ } from "./shippingWeight";

export type Priority = "now" | "today" | "this week" | "campaign" | "idea";

export type Suggestion = {
  key: string;
  priority: Priority;
  task: string;
  items: string[];
  /** Short reason shown under the title. */
  why?: string;
  /** Question for the staff Concierge (it answers with confirm cards). */
  ask?: string;
  /** Dashboard tab to open instead (or when the Concierge is off). */
  tab: string;
  orderFilter?: string;
  button: string;
  /**
   * The exact records this item is about, so the Concierge can act on them
   * without searching (it reads them with the today_item tool).
   */
  targets?: Array<{ kind: "order" | "member" | "product" | "code" | "event"; id: string; name: string; detail?: string }>;
  /** Step-by-step for the Concierge: which tools to call with which settings. */
  guide?: string;
};

/** Every bulletin question starts like this, so the Concierge knows to call today_item first. */
export const todayAsk = (key: string, text: string) => `Today item ${key}: ${text}`.slice(0, 295);

export type ManagerInput = {
  now: number;
  orders: Order[];
  users: User[];
  products: Product[];
  codes: Discount[];
  events: SiteEvent[];
  registrations: Registration[];
  banner: Banner | null;
  remindersOn: boolean;
  spend: { month: number; cap: number };
  /** False while labels still use the default box & packing weight. */
  packagingSet?: boolean;
};

const DAY = 86_400_000;
const money = (n: number) => `$${n.toFixed(2)}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ref = (o: Order) => o.id.slice(-6).toUpperCase();
const day = (t: number) => pacificDateTime(t).slice(0, 10);

export function managerSuggestions(d: ManagerInput): Suggestion[] {
  const { now } = d;
  const out: Suggestion[] = [];
  const real = d.orders.filter((o) => !o.isInquiry && o.status !== "inquiry");
  const sold = real.filter((o) => ["paid", "completed"].includes(normalizeStatus(o.status)));

  // 1. Banner countdown is over but the banner is still switched on.
  if (d.banner?.enabled && d.banner.countdownTo && d.banner.countdownTo < now) {
    out.push({
      key: "banner-ended",
      priority: "today",
      task: "The announcement banner's countdown has ended",
      why: "It's hidden from shoppers already, but still switched on. Turn it off or set the next one.",
      items: [],
      ask: "The announcement banner's countdown has ended. Prepare a card to switch the banner off.",
      guide: "Call propose_banner with enabled=false.",
      tab: "marketing",
      button: "Prepare banner card",
    });
  }

  // 2. Concierge spend close to the monthly limit.
  if (d.spend.cap > 0 && d.spend.month >= d.spend.cap * 0.8) {
    const pct = Math.round((d.spend.month / d.spend.cap) * 100);
    out.push({
      key: "spend",
      priority: pct >= 100 ? "now" : "today",
      task: `The Concierge has used ${pct}% of its ${money(d.spend.cap)} monthly limit`,
      why: pct >= 100 ? "It's paused for customers until the limit is raised or the month ends." : "At this pace it may pause for customers before the month ends.",
      items: [],
      tab: "assistant",
      button: "Open Assistant",
    });
  }

  // 3. Unpaid orders keep piling up while automatic reminders are off.
  const overdue = real.filter((o) => normalizeStatus(o.status) === "pending" && o.paymentMethod !== "cash" && now - o.createdAt > 2 * DAY);
  if (!d.remindersOn && overdue.length >= 3) {
    out.push({
      key: "reminders-off",
      priority: "this week",
      task: "Switch on automatic payment reminders",
      why: `${plural(overdue.length, "invoice")} older than 2 days are unpaid. Reminders would chase new ones for you (24 h, 48 h, 1 week, 2 weeks).`,
      items: [],
      ask: "Prepare a card to switch on automatic payment reminders, and remind me what they send and when.",
      guide: "Call propose_feature_switch with key invoice_reminders, on=true. get_admin_settings shows the reminder timing and wording to summarise.",
      tab: "settings",
      button: "Prepare switch card",
    });
  }

  // 4. Very old unpaid orders — close them out so "outstanding" is real.
  const stale = real.filter((o) => normalizeStatus(o.status) === "pending" && now - o.createdAt > 30 * DAY).sort((a, b) => a.createdAt - b.createdAt);
  if (stale.length) {
    out.push({
      key: "stale-unpaid",
      priority: "this week",
      task: `Close out ${plural(stale.length, "unpaid order")} older than 30 days (${money(stale.reduce((n, o) => n + o.total, 0))})`,
      why: "They inflate “Awaiting payment”. Cancel the ones that won't be paid; a quick last nudge first is fine.",
      items: stale.slice(0, 8).map((o) => `${ref(o)} ${o.userName} ${money(o.total)} — ${Math.floor((now - o.createdAt) / DAY)}d`),
      ask: "List the unpaid orders older than 30 days and prepare a 'cancelled' card for each one (one per order), so I can cancel the ones that won't be paid.",
      targets: stale.slice(0, 10).map((o) => ({ kind: "order" as const, id: o.id, name: `${ref(o)} ${o.userName}`, detail: `${money(o.total)}, ${Math.floor((now - o.createdAt) / DAY)} days old` })),
      guide: "For each target order call propose_order_status with status cancelled (one card each).",
      tab: "orders",
      orderFilter: "pending",
      button: "Prepare cancel cards",
    });
  }

  // 5. Discount codes that are finished but still switched on.
  const finished = d.codes.filter((c) => c.active && ((c.expiresAt && c.expiresAt < now) || (c.maxUses && c.uses >= c.maxUses)));
  if (finished.length) {
    out.push({
      key: "codes-finished",
      priority: "this week",
      task: `Tidy up ${plural(finished.length, "finished discount code")}`,
      why: "Expired or used up, but still switched on — customers get an error if they try them.",
      items: finished.slice(0, 8).map((c) => `${c.code} — ${c.expiresAt && c.expiresAt < now ? `expired ${day(c.expiresAt)}` : `used ${c.uses}/${c.maxUses}`}`),
      ask: "Prepare cards to switch off the discount codes that have expired or are used up (one card per code).",
      targets: finished.slice(0, 10).map((c) => ({ kind: "code" as const, id: c.id, name: c.code })),
      guide: "For each target code call propose_discount_toggle with code=<the code> and active=false.",
      tab: "marketing",
      button: "Prepare tidy-up cards",
    });
  }

  // 6. Events coming up that are filling slowly.
  for (const e of d.events
    .filter((e) => e.published && e.capacity > 0 && e.date > now + 2 * DAY && e.date < now + 21 * DAY)
    .sort((a, b) => a.date - b.date)
    .slice(0, 2)) {
    const taken = d.registrations.filter((r) => r.eventId === e.id && r.status === "registered").length;
    if (taken / e.capacity >= 0.5) continue;
    out.push({
      key: `event-${e.id}`,
      priority: "this week",
      task: `Promote “${e.title}” — ${taken} of ${e.capacity} spots taken`,
      why: `It's on ${day(e.date)}. A short email to the mailing list usually fills seats.`,
      items: [],
      ask: `Draft an email campaign to the mailing list promoting our event “${e.title.slice(0, 60)}” on ${day(e.date)}. Prepare it as a card; nothing sends until I confirm.`,
      targets: [{ kind: "event", id: e.id, name: e.title, detail: `${day(e.date)} at ${e.location}; ${e.capacity - taken} spots left${e.price ? `; ${e.price}` : ""}` }],
      guide: "Call prepare_campaign_draft with audience subscribers: a warm invitation with the date, place and spots left, and a [Save your spot](/events) button.",
      tab: "events",
      button: "Draft a promo email",
    });
  }

  // 6a. The box & packing weight is still the built-in default.
  if (d.packagingSet === false) {
    out.push({
      key: "box-weight",
      priority: "this week",
      task: `Check the box & packing weight (labels use ${DEFAULT_PACKAGING_OZ} oz for now)`,
      why: `Every shipping label adds ${DEFAULT_PACKAGING_OZ} oz for the box and padding — a starting guess. Weigh an empty box with its padding and enter it under Products → Shipping weights (or press Confirm if ${DEFAULT_PACKAGING_OZ} oz is right).`,
      items: [],
      tab: "products",
      button: "Open shipping weights",
    });
  }

  // 6b. Products that ship but have no shipping weight (labels can't weigh themselves).
  const shippedIds = new Set(real.filter((o) => o.shippingMethod === "ship" && now - o.createdAt < 180 * DAY).flatMap((o) => (o.items || []).map((i) => i.productId)));
  const unweighed = d.products.filter((p) => !p.isBundle && !(p.weightOz && p.weightOz > 0) && shippedIds.has(p.id));
  if (unweighed.length) {
    out.push({
      key: "weights",
      priority: "this week",
      task: `Weigh ${plural(unweighed.length, "product")} so shipping labels weigh themselves`,
      why: "These have shipped recently but have no shipping weight, so their labels still need the parcel weighed by hand. Products → Shipping weights.",
      items: unweighed.slice(0, 6).map((p) => p.name),
      tab: "products",
      button: "Open shipping weights",
    });
  }

  // 7. Members who used to buy but have gone quiet.
  const lastOrder = new Map<string, number>();
  for (const o of sold) if (o.userId && o.userId !== "retail") lastOrder.set(o.userId, Math.max(lastOrder.get(o.userId) || 0, o.paidAt || o.createdAt));
  const lapsed = d.users
    .filter((u) => u.status === "approved" && lastOrder.has(u.id) && now - (lastOrder.get(u.id) as number) > 60 * DAY)
    .sort((a, b) => (lastOrder.get(b.id) as number) - (lastOrder.get(a.id) as number));
  if (lapsed.length >= 3) {
    out.push({
      key: "lapsed",
      priority: "idea",
      task: `Win back ${plural(lapsed.length, "member")} who haven't ordered in 60+ days`,
      why: "They've bought before, so a friendly note with a small code is the cheapest sale you'll make.",
      items: lapsed.slice(0, 6).map((u) => `${u.name} — last order ${Math.floor((now - (lastOrder.get(u.id) as number)) / DAY)}d ago`),
      ask: "Prepare a win-back for members who haven't ordered in 60+ days: a 10% discount code good for 14 days, and a campaign draft to the lapsed_members group (60 days). Cards only — nothing sends until I confirm.",
      guide: "1) propose_discount_code: a friendly code like WELCOMEBACK10, percentage 10, expires_in_days 14. 2) prepare_campaign_draft with segment lapsed_members (segment_days 60): a warm 'we miss you' note that mentions the code. Never ask for names or emails — the segment finds them.",
      tab: "marketing",
      button: "Prepare win-back",
    });
  }

  // Popular right now (for notes that mention a product).
  const unitsSold = new Map<string, number>();
  for (const o of sold.filter((o) => now - (o.paidAt || o.createdAt) < 60 * DAY)) for (const it of o.items || []) unitsSold.set(it.productId, (unitsSold.get(it.productId) || 0) + it.quantity);
  const popular = [...unitsSold.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => d.products.find((p) => p.id === id))
    .filter((p): p is Product => !!p && !p.isBundle && !hiddenFromAssistant(p))
    .slice(0, 2)
    .map((p) => p.name);

  // 8. New members who haven't placed a first order yet.
  const fresh = d.users.filter(
    (u) => u.status === "approved" && !u.importedFrom && u.approvedAt && now - u.approvedAt > 7 * DAY && now - u.approvedAt < 45 * DAY && !real.some((o) => o.userId === u.id)
  );
  if (fresh.length >= 2) {
    out.push({
      key: "first-order",
      priority: "idea",
      task: `Nudge ${plural(fresh.length, "new member")} toward a first order`,
      why: "Approved over a week ago and haven't ordered yet.",
      items: fresh.slice(0, 6).map((u) => `${u.name} — approved ${Math.floor((now - (u.approvedAt as number)) / DAY)}d ago`),
      ask: `Draft a warm welcome email to all ${fresh.length} new members who haven't ordered yet (the new_members_no_order group), mentioning our popular products, plus a 10% first-order code. Cards only — nothing sends until I confirm.`,
      guide: `1) propose_discount_code: percentage 10, expires_in_days 14, a welcome code like FIRSTORDER10. 2) prepare_campaign_draft with segment new_members_no_order: a short, warm welcome that mentions ${popular.length ? popular.join(" and ") : "one or two of our popular products"}, the code, and a [Visit the members' gallery](/gallery) button. One draft for the whole group — no individual notes, and never ask for names or emails.`,
      tab: "marketing",
      button: "Draft welcome email",
    });
  }

  // 9. Products that have stopped selling.
  const lastSold = new Map<string, number>();
  for (const o of sold) for (const it of o.items || []) lastSold.set(it.productId, Math.max(lastSold.get(it.productId) || 0, o.paidAt || o.createdAt));
  const slow = d.products.filter(
    (p) =>
      (isInternal(p) || isExternal(p)) &&
      !p.isBundle &&
      !p.salePrice &&
      !p.promo &&
      /\d/.test(p.price) &&
      now - p.createdAt > 45 * DAY &&
      now - (lastSold.get(p.id) || 0) > 60 * DAY &&
      !hiddenFromAssistant(p)
  );
  if (slow.length) {
    out.push({
      key: "slow-products",
      priority: "idea",
      task: `${plural(slow.length, "product")} haven't sold in 60 days`,
      why: "A short sale, a spot in a bundle or a better photo usually gets them moving.",
      items: slow.slice(0, 6).map((p) => `${p.name} — ${p.price}${lastSold.has(p.id) ? `, last sold ${day(lastSold.get(p.id) as number)}` : ", no sales yet"}`),
      ask: `Suggest how to move these slow sellers and prepare sale cards (about 15% off for 2 weeks): ${slow
        .slice(0, 4)
        .map((p) => p.name.slice(0, 30))
        .join(", ")}.`.slice(0, 290),
      targets: slow.slice(0, 6).map((p) => ({ kind: "product" as const, id: p.id, name: p.name, detail: p.price })),
      guide: "Call propose_sale with mode percent_off, percent 15 and product_ids = the target ids (one card). Suggest ending it in 2 weeks with a banner countdown if they like.",
      tab: "products",
      button: "Prepare sale cards",
    });
  }

  // 10. Best seller this month → put it in the banner (only when the banner is free).
  if (!d.banner?.enabled) {
    const units = new Map<string, number>();
    for (const o of sold.filter((o) => now - (o.paidAt || o.createdAt) < 30 * DAY))
      for (const it of o.items || []) units.set(it.productId, (units.get(it.productId) || 0) + it.quantity);
    const top = [...units.entries()].sort((a, b) => b[1] - a[1])[0];
    const p = top && d.products.find((x) => x.id === top[0] && isExternal(x) && !hiddenFromAssistant(x));
    if (p && top[1] >= 3) {
      out.push({
        key: "feature-best",
        priority: "idea",
        task: `Feature your best seller: ${p.name} (${top[1]} sold in 30 days)`,
        why: "The announcement banner is free. A short line with a link to it is an easy win.",
        items: [],
        ask: `Prepare an announcement banner card featuring our best seller “${p.name.slice(0, 60)}”, with a link to it in the shop. Keep it short and friendly.`,
        targets: [{ kind: "product", id: p.id, name: p.name }],
        guide: `Call propose_banner with a short, friendly message about ${p.name}, link_url /p/${p.id} and link_label "Take a look".`,
        tab: "marketing",
        button: "Prepare banner card",
      });
    }
  }

  return out.map((x) => (x.ask ? { ...x, ask: todayAsk(x.key, x.ask) } : x));
}
