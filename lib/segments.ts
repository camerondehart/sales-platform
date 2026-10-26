/**
 * Customer groups for campaigns ("send this to members who haven't ordered in
 * 60+ days"). Worked out on the server from live orders, members and the
 * mailing list, so the Concierge never has to collect email addresses itself.
 *
 * A group is just a list of email addresses. Sending still goes through the
 * normal campaign path with audience "custom", which only ever reaches people
 * who are subscribed and haven't unsubscribed.
 */

import { getOrders, normalizeStatus, type Order } from "./orders";
import { getUsers } from "./users";
import { getSubscribers, activeSubscribers } from "./subscribers";
import { getSettings } from "./settings";
import { getProducts } from "./storage";

export const SEGMENTS = {
  lapsed_members: "members who've ordered before but not in the last {days} days (default 60)",
  members_never_ordered: "approved members who have never placed an order",
  new_members: "members approved in the last {days} days (default 30)",
  new_members_no_order: "members approved 1 week to {days} days ago (default 45) who haven't ordered yet",
  subscribers_never_ordered: "mailing-list subscribers who have never ordered",
  repeat_shop_customers: "public-shop customers with 2+ orders who aren't members",
  points_holders: "members with enough loyalty points to redeem",
  top_customers: "the top {limit} customers by spend in the last {days} days (default 20 people, 180 days)",
  refill_due: "regulars past their usual reorder time for a product they rebuy",
  bought_product: "customers who bought {product} in the last {days} days (default 365)",
  all_customers: "everyone who has ever placed an order",
} as const;
export type SegmentKey = keyof typeof SEGMENTS;
export const SEGMENT_KEYS = Object.keys(SEGMENTS) as SegmentKey[];

export type SegmentResult = { key: SegmentKey; label: string; emails: string[]; names: string[] };

const DAY = 86_400_000;
const low = (s: string | undefined) => (s || "").trim().toLowerCase();

export async function resolveSegment(
  key: string,
  opts: { days?: number; limit?: number; product?: string; now?: number } = {}
): Promise<SegmentResult | { error: string }> {
  if (!(SEGMENT_KEYS as string[]).includes(key)) return { error: `Unknown group "${key}". Use one of: ${SEGMENT_KEYS.join(", ")}.` };
  const k = key as SegmentKey;
  const now = opts.now ?? Date.now();
  const [orders, users] = await Promise.all([getOrders(), getUsers()]);
  const real = orders.filter((o) => !o.isInquiry && o.status !== "inquiry");
  const sold = real.filter((o) => ["paid", "completed"].includes(normalizeStatus(o.status)));
  const when = (o: Order) => o.paidAt || o.createdAt;
  const members = users.filter((u) => u.status === "approved");
  const memberByEmail = new Map(members.map((u) => [low(u.email), u]));
  const nameOf = new Map<string, string>();
  for (const o of real) if (o.userEmail) nameOf.set(low(o.userEmail), o.userName);
  for (const u of members) nameOf.set(low(u.email), u.name);
  const days = (d: number) => (Number(opts.days) > 0 ? Math.min(3650, Math.floor(Number(opts.days))) : d);

  let emails: string[] = [];
  let label = "";
  switch (k) {
    case "lapsed_members": {
      const n = days(60);
      const last = new Map<string, number>();
      for (const o of sold) {
        const e = low(o.userEmail);
        if (memberByEmail.has(e)) last.set(e, Math.max(last.get(e) || 0, when(o)));
      }
      emails = [...last.entries()].filter(([, t]) => now - t > n * DAY).map(([e]) => e);
      label = `members who haven't ordered in ${n}+ days`;
      break;
    }
    case "members_never_ordered": {
      const buyers = new Set(real.map((o) => low(o.userEmail)));
      emails = members.map((u) => low(u.email)).filter((e) => !buyers.has(e));
      label = "members who have never ordered";
      break;
    }
    case "new_members": {
      const n = days(30);
      // Imported customers aren't new — they joined on the old store.
      emails = members.filter((u) => !u.importedFrom && (u.approvedAt || u.createdAt) > now - n * DAY).map((u) => low(u.email));
      label = `members who joined in the last ${n} days`;
      break;
    }
    case "new_members_no_order": {
      const n = days(45);
      const ordered = new Set(real.flatMap((o) => [o.userId, low(o.userEmail)]));
      emails = members
        .filter((u) => !u.importedFrom && u.approvedAt && now - u.approvedAt > 7 * DAY && now - u.approvedAt < n * DAY && !ordered.has(u.id) && !ordered.has(low(u.email)))
        .map((u) => low(u.email));
      label = `new members (approved 1 week–${n} days ago) who haven't ordered yet`;
      break;
    }
    case "subscribers_never_ordered": {
      const buyers = new Set(real.map((o) => low(o.userEmail)));
      emails = activeSubscribers(await getSubscribers()).map((s) => low(s.email)).filter((e) => !buyers.has(e));
      label = "subscribers who have never ordered";
      break;
    }
    case "repeat_shop_customers": {
      const count = new Map<string, number>();
      for (const o of sold) if (o.source === "retail" || o.userId === "retail") count.set(low(o.userEmail), (count.get(low(o.userEmail)) || 0) + 1);
      emails = [...count.entries()].filter(([e, c]) => e && c >= 2 && !memberByEmail.has(e)).map(([e]) => e);
      label = "repeat shop customers who aren't members";
      break;
    }
    case "points_holders": {
      const st = await getSettings();
      const min = Math.max(1, st.minPointsToRedeem || 1);
      emails = members.filter((u) => (u.loyaltyPoints || 0) >= min).map((u) => low(u.email));
      label = `members with ${min}+ loyalty points`;
      break;
    }
    case "top_customers": {
      const n = days(180);
      const limit = Number(opts.limit) > 0 ? Math.min(500, Math.floor(Number(opts.limit))) : 20;
      const spend = new Map<string, number>();
      for (const o of sold.filter((o) => now - when(o) < n * DAY)) spend.set(low(o.userEmail), (spend.get(low(o.userEmail)) || 0) + o.total);
      emails = [...spend.entries()].filter(([e]) => e).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([e]) => e);
      label = `top ${limit} customers of the last ${n} days`;
      break;
    }
    case "refill_due": {
      const times = new Map<string, number[]>(); // email|product → purchase times
      for (const o of sold)
        for (const it of o.items || []) {
          const key2 = `${low(o.userEmail)}|${it.productId}`;
          times.set(key2, [...(times.get(key2) || []), when(o)]);
        }
      const due = new Set<string>();
      for (const [key2, t] of times) {
        if (t.length < 2) continue;
        t.sort((a, b) => a - b);
        const every = (t[t.length - 1] - t[0]) / (t.length - 1) / DAY;
        const since = (now - t[t.length - 1]) / DAY;
        if (every >= 14 && since > every * 1.1 && since < every * 3) due.add(key2.split("|")[0]);
      }
      emails = [...due];
      label = "regulars due for a refill";
      break;
    }
    case "bought_product": {
      const want = low(opts.product);
      if (!want) return { error: "Say which product (id or name) for bought_product." };
      const products = await getProducts();
      const match = products.filter((p) => low(p.id) === want || low(p.name) === want || low(p.name).includes(want));
      if (match.length === 0) return { error: `No product matches "${opts.product}". Use list_products.` };
      const ids = new Set(match.map((p) => p.id));
      const n = days(365);
      emails = Array.from(new Set(sold.filter((o) => now - when(o) < n * DAY && (o.items || []).some((i) => ids.has(i.productId))).map((o) => low(o.userEmail))));
      label = `customers who bought ${match.length === 1 ? match[0].name : `“${opts.product}”`} in the last ${n} days`;
      break;
    }
    case "all_customers": {
      emails = Array.from(new Set(real.map((o) => low(o.userEmail))));
      label = "everyone who has ordered";
      break;
    }
  }
  emails = emails.filter((e) => e.includes("@")).slice(0, 5000);
  return { key: k, label, emails, names: emails.slice(0, 8).map((e) => nameOf.get(e) || e) };
}
