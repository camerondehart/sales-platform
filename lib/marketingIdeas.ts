/**
 * Campaign ideas for the Overview "Today" bulletin — the marketing half of the
 * stand-in site manager. Plain rules over live sales, members, subscribers and
 * the calendar (no AI call, no cost). There is always at least one idea: the
 * next marketing moment on the calendar.
 *
 * Every idea is only a suggestion. Its button asks the staff Concierge to
 * prepare cards (codes, bundles, campaign drafts, notes) and nothing is created
 * or sent until staff press Confirm on each card.
 */

import { normalizeStatus, type Order } from "./orders";
import type { User } from "./users";
import type { Product } from "./storage";
import { isExternal } from "./storage";
import type { Subscriber } from "./subscribers";
import type { Campaign } from "./campaignSchedule";
import type { Bundle } from "./bundles";
import type { SiteSettings } from "./settings";
import { hiddenFromAssistant } from "./assistant/shared";
import { addDays, pacificDay } from "./periods";
import { todayAsk, type Suggestion } from "./siteManager";
import { brand } from "@/lib/brand";

export type MarketingInput = {
  now: number;
  orders: Order[];
  users: User[];
  products: Product[];
  subscribers: Subscriber[];
  campaigns: Campaign[];
  bundles: Bundle[];
  settings: SiteSettings | null;
};

const DAY = 86_400_000;
const MAX_IDEAS = 5;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const short = (s: string, n = 34) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const money = (n: number) => `$${n.toFixed(2)}`;
const nice = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const weekdayOf = (t: number) =>
  new Intl.DateTimeFormat("en-US", { timeZone: brand.timezone, weekday: "long" }).format(new Date(t));

// ------------------------------------------------------------ the calendar

/** "YYYY-MM-DD" of the nth weekday (0=Sun) of a month; n = -1 for the last one. */
function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
    return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
  }
  const lastDay = new Date(Date.UTC(year, month, 0));
  const back = (lastDay.getUTCDay() - weekday + 7) % 7;
  return new Date(Date.UTC(year, month - 1, lastDay.getUTCDate() - back)).toISOString().slice(0, 10);
}

type Moment = { name: string; date: string; template: string; angle: string };

/** Marketing moments for a year (dates in local calendar terms). */
function momentsFor(y: number): Moment[] {
  const thanksgiving = nthWeekday(y, 11, 4, 4);
  return [
    { name: "New Year", date: `${y}-01-01`, template: "Winter wellness", angle: "a fresh-start routine" },
    { name: "Valentine's Day", date: `${y}-02-14`, template: "Sale / promotion", angle: "self-care and gifts for someone you love" },
    { name: "the first day of spring", date: `${y}-03-20`, template: "Spring renewal", angle: "a spring reset" },
    { name: "Earth Day", date: `${y}-04-22`, template: "Spring renewal", angle: "natural, plant-based wellness" },
    { name: "Mother's Day", date: nthWeekday(y, 5, 0, 2), template: "Holiday gifting", angle: "gifts for mom" },
    { name: "Father's Day", date: nthWeekday(y, 6, 0, 3), template: "Holiday gifting", angle: "gifts for dad" },
    { name: "the first day of summer", date: `${y}-06-21`, template: "Summer energy", angle: "summer energy" },
    { name: "the Fourth of July weekend", date: `${y}-07-04`, template: "Sale / promotion", angle: "a summer weekend sale" },
    { name: "late-summer", date: `${y}-08-10`, template: "Summer energy", angle: "making the most of the last of summer" },
    { name: "back-to-routine season", date: nthWeekday(y, 9, 1, 1), template: "Fall ritual", angle: "getting back into a routine" },
    { name: "the first day of fall", date: `${y}-09-22`, template: "Fall ritual", angle: "a cozy fall ritual" },
    { name: "Halloween", date: `${y}-10-31`, template: "Fall ritual", angle: "a cozy fall treat" },
    { name: "Black Friday", date: addDays(thanksgiving, 1), template: "Sale / promotion", angle: "your biggest deal of the year" },
    { name: "Small Business Saturday", date: addDays(thanksgiving, 2), template: "Sale / promotion", angle: "shopping small and local" },
    { name: "Cyber Monday", date: addDays(thanksgiving, 4), template: "Sale / promotion", angle: "a last-chance online deal" },
    { name: "holiday gifting", date: `${y}-12-12`, template: "Holiday gifting", angle: "gifts that arrive in time" },
  ];
}

/** The next moment at least 3 days away (time to plan and send ahead). Always one within ~2 months. */
function nextMoment(now: number): Moment | null {
  const today = pacificDay(now);
  const y = Number(today.slice(0, 4));
  const soon = addDays(today, 3);
  return [...momentsFor(y), ...momentsFor(y + 1)].filter((m) => m.date >= soon).sort((a, b) => (a.date < b.date ? -1 : 1))[0] || null;
}

// ------------------------------------------------------------- the ideas

export function marketingIdeas(d: MarketingInput): Suggestion[] {
  const { now } = d;
  const out: Array<Suggestion & { score: number }> = [];
  const sold = d.orders.filter((o) => !o.isInquiry && o.status !== "inquiry" && ["paid", "completed"].includes(normalizeStatus(o.status)));
  const when = (o: Order) => o.paidAt || o.createdAt;
  const byId = new Map(d.products.map((p) => [p.id, p]));
  const sellable = (id: string) => {
    const p = byId.get(id);
    return p && !p.isBundle && !hiddenFromAssistant(p) ? p : undefined;
  };
  const email = (s: string) => (s || "").trim().toLowerCase();
  // Who to write to: the member account if they have one, otherwise their latest order.
  const memberOf = new Map(d.users.filter((u) => u.status === "approved").map((u) => [email(u.email), u]));
  const lastOrderOf = new Map<string, Order>();
  for (const o of sold) {
    const cur = lastOrderOf.get(email(o.userEmail));
    if (!cur || when(o) > when(cur)) lastOrderOf.set(email(o.userEmail), o);
  }
  type Target = NonNullable<Suggestion["targets"]>[number];
  const personTarget = (e: string, detail?: string): Target | null => {
    const u = memberOf.get(e);
    if (u) return { kind: "member", id: u.id, name: u.name, detail };
    const o = lastOrderOf.get(e);
    return o ? { kind: "order", id: o.id, name: o.userName, detail } : null;
  };
  const PERSON_GUIDE = "For each target: if kind is member call propose_member_message (member_id = id); if kind is order call propose_order_message (order_id = id, include_pay_link false). One card per person.";

  // Best day to send: the weekday with the most orders in the last 90 days.
  const recent = sold.filter((o) => now - when(o) < 90 * DAY);
  const perDay = new Map<string, number>();
  for (const o of recent) perDay.set(weekdayOf(when(o)), (perDay.get(weekdayOf(when(o))) || 0) + 1);
  const peak = recent.length >= 10 ? [...perDay.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] : undefined;
  const sendTip = peak && WEEKDAYS.includes(peak) ? ` Orders peak on ${peak}s, so send then.` : "";

  // Best sellers, last 60 days (for "feature" lines in drafts).
  const units = new Map<string, number>();
  for (const o of sold.filter((o) => now - when(o) < 60 * DAY)) for (const it of o.items || []) if (sellable(it.productId)) units.set(it.productId, (units.get(it.productId) || 0) + it.quantity);
  const top = [...units.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([id]) => byId.get(id)!.name);

  const sentCampaigns = d.campaigns.filter((c) => c.status === "sent" || c.status === "sending" || c.status === "scheduled");
  const lastCampaignAt = Math.max(0, ...sentCampaigns.map((c) => c.finishedAt || c.startedAt || c.scheduledFor || c.createdAt));
  const scheduledAhead = d.campaigns.some((c) => c.status === "scheduled" && c.scheduledFor > now);

  // 1. The next moment on the calendar — always something to plan.
  const m = nextMoment(now);
  if (m) {
    const sendBy = addDays(m.date, m.name === "holiday gifting" ? -9 : -5);
    out.push({
      key: `moment-${m.date}`,
      priority: "campaign",
      task: `Plan a ${m.name} campaign (${nice(m.date)})`,
      why: `Angle: ${m.angle}. Send around ${nice(sendBy < pacificDay(now) ? pacificDay(now) : sendBy)}.${sendTip}${scheduledAhead ? " You already have a campaign scheduled — check it doesn't clash." : ""}`,
      items: top.length ? [`Feature: ${top.join(" and ")}`, `Start from the “${m.template}” template`] : [`Start from the “${m.template}” template`],
      ask: `Draft a ${m.name} email campaign (${m.angle}) from the “${m.template}” template${top.length ? `, featuring ${short(top[0], 30)}` : ""}, plus a 10% code that ends ${m.date}. Cards only — nothing sends until I confirm.`,
      guide: `1) list_templates with template_id "${m.template}" and use it as the starting point. 2) propose_discount_code: percentage 10, expires_in_days ${Math.max(1, Math.round((Date.parse(`${m.date}T23:59:00-08:00`) - now) / DAY))}, a short seasonal code. 3) prepare_campaign_draft with audience subscribers${top.length ? `, featuring ${top.join(" and ")}` : ""}, mentioning the code. Never ask who it's for.`,
      tab: "marketing",
      button: "Draft campaign",
      score: 90,
    });
  }

  // 2. It's been a while since the last email to the list.
  const daysSince = lastCampaignAt ? Math.floor((now - lastCampaignAt) / DAY) : null;
  const subs = d.subscribers.filter((s) => !s.unsubscribedAt);
  if (subs.length >= 5 && (daysSince === null || daysSince >= 21) && !scheduledAhead) {
    const fresh = d.products.filter((p) => isExternal(p) && !p.isBundle && !hiddenFromAssistant(p) && p.createdAt > (lastCampaignAt || now - 45 * DAY)).slice(0, 3);
    out.push({
      key: "cadence",
      priority: "campaign",
      task: daysSince === null ? `Send your first email to ${plural(subs.length, "subscriber")}` : `It's been ${daysSince} days since your last email`,
      why: `${plural(subs.length, "person", "people")} on the list. A short “what's new” note every 2–3 weeks keeps you in mind without being pushy.${sendTip}`,
      items: fresh.length ? fresh.map((p) => `New: ${p.name}`) : top.map((n) => `Best seller: ${n}`),
      ask: `Draft a short “what's new” email to the whole mailing list featuring ${
        fresh.length ? fresh.map((p) => short(p.name, 28)).join(", ") : top.length ? short(top.join(" and "), 60) : "our best sellers"
      }. Use the “New arrivals / news” template. Cards only — nothing sends until I confirm.`,
      guide: `prepare_campaign_draft with audience subscribers, starting from the "New arrivals / news" template (list_templates with template_id "New arrivals / news").`,
      tab: "marketing",
      button: "Draft email",
      score: daysSince === null ? 80 : Math.min(85, 40 + daysSince),
    });
  }

  // 3. Products customers keep buying together → a mix & match bundle.
  const pairCount = new Map<string, number>();
  for (const o of sold.filter((o) => now - when(o) < 180 * DAY)) {
    const ids = Array.from(new Set((o.items || []).map((i) => i.productId).filter((id) => sellable(id)))).sort();
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pairCount.set(`${ids[i]}|${ids[j]}`, (pairCount.get(`${ids[i]}|${ids[j]}`) || 0) + 1);
  }
  const bundled = (a: string, b: string) => d.bundles.some((x) => x.items.some((i) => i.productId === a) && x.items.some((i) => i.productId === b));
  const pair = [...pairCount.entries()].filter(([k, n]) => n >= 3 && !bundled(...(k.split("|") as [string, string]))).sort((a, b) => b[1] - a[1])[0];
  if (pair) {
    const [a, b] = pair[0].split("|").map((id) => byId.get(id)!);
    out.push({
      key: `pair-${pair[0]}`,
      priority: "campaign",
      task: `Customers often buy ${a.name} + ${b.name} together`,
      why: `${pair[1]} orders in the last 6 months had both. A small bundle discount nudges more people to add the second one.`,
      items: [],
      ask: `Customers often buy “${short(a.name, 40)}” and “${short(b.name, 40)}” together. Prepare a mix & match bundle card for the pair at 10% off, and a short email draft announcing it. Cards only.`,
      targets: [
        { kind: "product", id: a.id, name: a.name },
        { kind: "product", id: b.id, name: b.name },
      ],
      guide: `1) propose_mix_bundle with products [${a.id}, ${b.id}] (qty 1 each), type percent, value 10, and a friendly name. 2) prepare_campaign_draft with audience subscribers announcing the pair.`,
      tab: "marketing",
      button: "Prepare bundle",
      score: 70 + pair[1],
    });
  }

  // 4. Regulars who are due for a refill (they rebuy a product on a rhythm).
  type Hist = { name: string; times: number[] };
  const hist = new Map<string, Hist>(); // email|product → purchase times
  const nameOf = new Map<string, string>();
  for (const o of sold) {
    const e = email(o.userEmail);
    if (!e) continue;
    nameOf.set(e, o.userName);
    for (const it of o.items || []) {
      const p = sellable(it.productId);
      if (!p) continue;
      const k = `${e}|${p.id}`;
      const h = hist.get(k) || { name: p.name, times: [] };
      h.times.push(when(o));
      hist.set(k, h);
    }
  }
  const due: Array<{ e: string; who: string; product: string; every: number; since: number }> = [];
  const seen = new Set<string>();
  for (const [k, h] of hist) {
    if (h.times.length < 2) continue;
    const t = h.times.sort((a, b) => a - b);
    const every = (t[t.length - 1] - t[0]) / (t.length - 1) / DAY;
    const since = (now - t[t.length - 1]) / DAY;
    const e = k.split("|")[0];
    if (every >= 14 && since > every * 1.1 && since < every * 3 && !seen.has(e)) {
      seen.add(e);
      due.push({ e, who: nameOf.get(e) || e, product: h.name, every: Math.round(every), since: Math.round(since) });
    }
  }
  if (due.length >= 2) {
    out.push({
      key: "refill",
      priority: "campaign",
      task: `${plural(due.length, "regular")} ${due.length === 1 ? "is" : "are"} due for a refill`,
      why: "They rebuy the same product on a rhythm and are now past their usual time. A friendly “running low?” note is the easiest sale there is.",
      items: due.slice(0, 6).map((x) => `${x.who} — ${x.product} (every ~${x.every}d, last ${x.since}d ago)`),
      ...(due.length > 6
        ? {
            // Too many for one-by-one notes: one email to the whole group.
            ask: `Draft a friendly “running low?” email to all ${due.length} regulars who are past their usual reorder time (the refill_due group). Cards only — nothing sends until I confirm.`,
            guide: "prepare_campaign_draft with segment refill_due: a short, friendly \"running low? time for a refill\" note with [Reorder](/gallery) and [Shop](/retail) buttons. One draft for the whole group — no individual notes, never ask for emails.",
          }
        : {
            ask: "Prepare a friendly “running low?” note for each regular who's past their usual reorder time, naming the product they usually buy. One card per person; nothing sends until I confirm.",
            targets: due.map((x) => personTarget(x.e, `usually buys ${x.product} every ~${x.every} days; last ${x.since} days ago`)).filter((t): t is Target => !!t),
            guide: `${PERSON_GUIDE} A friendly "running low on <product>?" note naming the product in the target's detail, with a link to reorder (/gallery for members, /retail otherwise).`,
          }),
      tab: "orders",
      button: "Prepare refill notes",
      score: 75 + due.length,
    });
  }

  // 5. Shop customers who keep coming back but aren't members yet.
  const memberEmails = new Set(d.users.map((u) => email(u.email)));
  const retailCount = new Map<string, number>();
  for (const o of sold) if (o.source === "retail" || o.userId === "retail") retailCount.set(email(o.userEmail), (retailCount.get(email(o.userEmail)) || 0) + 1);
  const loyalGuests = [...retailCount.entries()].filter(([e, n]) => e && n >= 2 && !memberEmails.has(e));
  if (loyalGuests.length >= 2) {
    out.push({
      key: "invite-members",
      priority: "campaign",
      task: `Invite ${plural(loyalGuests.length, "repeat shop customer")} to join ${brand.members}`,
      why: "They've ordered from the public shop 2+ times but aren't members — they'd see the members' gallery and earn points. They aren't on the mailing list, so these go as personal notes (up to 10 at a time).",
      items: loyalGuests.slice(0, 6).map(([e, n]) => `${nameOf.get(e) || e} — ${n} orders`),
      ask: `Prepare a warm personal invitation to join ${brand.members} (link /join) for each repeat shop customer who isn't a member yet (up to 10 at a time). One card per person; nothing sends until I confirm.`,
      targets: loyalGuests.slice(0, 10).map(([e, n]) => personTarget(e, `${n} shop orders`)).filter((t): t is Target => !!t),
      guide: `${PERSON_GUIDE} Thank them for coming back and invite them to join ${brand.members}: members see the members' gallery and earn points. Link: [Join ${brand.members}](/join).`,
      tab: "marketing",
      button: "Draft invitation",
      score: 60 + loyalGuests.length,
    });
  }

  // 6. Subscribers who've never bought → a first-order offer.
  const buyers = new Set(d.orders.filter((o) => !o.isInquiry).map((o) => email(o.userEmail)));
  const neverBought = subs.filter((s) => !buyers.has(email(s.email)));
  if (neverBought.length >= 10) {
    out.push({
      key: "first-purchase",
      priority: "campaign",
      task: `${plural(neverBought.length, "subscriber")} ${neverBought.length === 1 ? "has" : "have"} never ordered`,
      why: "They signed up because they're interested. A one-time welcome code is often all it takes for a first order.",
      items: [],
      ask: "Prepare a first-order offer for mailing-list subscribers who've never ordered: a 10% welcome code (one use per customer, 14 days) and a campaign draft to the subscribers_never_ordered group. Cards only — nothing sends until I confirm.",
      guide: "1) propose_discount_code: percentage 10, expires_in_days 14, a welcome code (one use per customer is set in the dashboard if needed). 2) prepare_campaign_draft with segment subscribers_never_ordered mentioning the code. Never ask for emails.",
      tab: "marketing",
      button: "Prepare offer",
      score: 55 + Math.min(20, neverBought.length / 5),
    });
  }

  // 7. Members sitting on loyalty points they could spend.
  const s = d.settings;
  if (s?.loyaltyEnabled && s.pointsPerDollarRedeemed > 0) {
    const holders = d.users.filter((u) => u.status === "approved" && (u.loyaltyPoints || 0) >= Math.max(1, s.minPointsToRedeem));
    if (holders.length >= 3) {
      const worth = holders.reduce((n, u) => n + (u.loyaltyPoints || 0) / s.pointsPerDollarRedeemed, 0);
      out.push({
        key: "points",
        priority: "campaign",
        task: `${plural(holders.length, "member")} could spend ${money(worth)} in points`,
        why: "A “you've got credit waiting” reminder brings people back — the points are already earned.",
        items: holders
          .sort((a, b) => (b.loyaltyPoints || 0) - (a.loyaltyPoints || 0))
          .slice(0, 5)
          .map((u) => `${u.name} — ${u.loyaltyPoints} points (${money((u.loyaltyPoints || 0) / s.pointsPerDollarRedeemed)})`),
        ask: `Draft an email to members who have at least ${s.minPointsToRedeem} loyalty points, reminding them they have credit to spend at checkout — a draft to the points_holders group; nothing sends until I confirm.`,
        guide: "prepare_campaign_draft with segment points_holders: a cheerful reminder that their points are credit at checkout, with a [Shop the gallery](/gallery) button. Never ask for emails.",
        tab: "marketing",
        button: "Draft reminder",
        score: 58 + holders.length,
      });
    }
  }

  // 8. Top customers → a thank-you (VIPs buy again when they feel noticed).
  const spend = new Map<string, { name: string; total: number; orders: number }>();
  for (const o of sold.filter((o) => now - when(o) < 180 * DAY)) {
    const e = email(o.userEmail);
    const cur = spend.get(e) || { name: o.userName, total: 0, orders: 0 };
    cur.total += o.total;
    cur.orders += 1;
    spend.set(e, cur);
  }
  const vipRows = [...spend.entries()].filter(([, v]) => v.orders >= 3).sort((a, b) => b[1].total - a[1].total).slice(0, 5);
  const vips = vipRows.map(([, v]) => v);
  if (vips.length >= 3) {
    out.push({
      key: "vip",
      priority: "campaign",
      task: `Thank your top ${vips.length} customers`,
      why: "Your best customers from the last 6 months. A personal thank-you (and maybe early access or bonus points) keeps them loyal.",
      items: vips.map((v) => `${v.name} — ${money(v.total)} over ${v.orders} orders`),
      ask: `Prepare a short personal thank-you card for each of our top ${vips.length} customers of the last 6 months${s?.loyaltyEnabled ? ", with 100 bonus loyalty points for the members" : ""}. Nothing sends until I confirm.`,
      targets: vipRows.map(([e, v]) => personTarget(e, `${money(v.total)} over ${v.orders} orders`)).filter((t): t is Target => !!t),
      guide: `${PERSON_GUIDE} A short, genuine thank-you.${s?.loyaltyEnabled ? " For member targets also call propose_points_credit with 100 points, reason \"Thank you for being one of our favourite customers\"." : ""}`,
      tab: "members",
      button: "Prepare thank-yous",
      score: 50 + vips.length,
    });
  }

  return out
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_IDEAS)
    .map(({ score: _s, ...rest }) => (rest.ask ? { ...rest, ask: todayAsk(rest.key, rest.ask) } : rest));
}
