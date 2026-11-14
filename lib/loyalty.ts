// Loyalty points — earned on completed orders, redeemable as store credit at
// checkout. Points live on the user record.
//
// The rule (2026-11-10): every $1 a member spends on products (not
// shipping) in a COMPLETED order placed since Nov 1, 2026 is one point.
// Pending or paid orders earn nothing yet; an order that stops being completed
// gives its points back. syncOrderPoints() applies the rule to one order and
// checkPoints() verifies every member against it.

import { mutateUsers, getUsers, type User } from "./users";
import { getSettings } from "./settings";
import { updateOrder, getOrders, type Order } from "./orders";
import { normalizeStatus, isCompleted } from "./orderStatus";
import { pacificToMs } from "./periods";

/** Orders placed from here on follow the completed-orders rule exactly. */
export const POINTS_RULE_SINCE = pacificToMs("2026-11-01");

export type PointsEntry = {
  amount: number; // positive = earned, negative = redeemed
  reason: string;
  date: number;
  orderId?: string;
  /**
   * What an order-linked entry is (entries saved before 2026-11-10 have none;
   * they're recognised by their reason): earn = earned on the order,
   * earn_back = earned points taken back (cancel, negative) or given again
   * (un-cancel, positive), redeem = spent on the order (negative),
   * redeem_back = spent points returned (cancel, positive).
   */
  kind?: "earn" | "earn_back" | "redeem" | "redeem_back";
};

// Which order-linked history entries count as earning / spending, including
// older entries saved without a `kind`.
const isEarn = (h: PointsEntry) => h.kind === "earn" || (!h.kind && h.amount > 0 && /^Earned on order/.test(h.reason));
const isRedeem = (h: PointsEntry) => h.kind === "redeem" || (!h.kind && h.amount < 0 && /^Redeemed on order/.test(h.reason));

/**
 * Points an order has moved, worked out from the member's history:
 * `earned` = first awarded, `earnedNow` = still on their account after any
 * take-backs, `spentNow` = points spent on it and not yet returned.
 */
export function orderPoints(history: PointsEntry[] | undefined, order: Pick<Order, "id" | "loyaltyPointsEarned">) {
  const mine = (history || []).filter((h) => h.orderId === order.id);
  let earned = mine.filter(isEarn).reduce((n, h) => n + h.amount, 0);
  // Older awards whose history line has scrolled off: trust the order's own stamp.
  if (!earned && !mine.some(isEarn)) earned = Math.max(0, order.loyaltyPointsEarned || 0);
  const earnBack = mine.filter((h) => h.kind === "earn_back").reduce((n, h) => n + h.amount, 0);
  const spent = -mine.filter(isRedeem).reduce((n, h) => n + h.amount, 0);
  const spentBack = mine.filter((h) => h.kind === "redeem_back").reduce((n, h) => n + h.amount, 0);
  return { earned, earnedNow: Math.max(0, earned + earnBack), spentNow: Math.max(0, spent - spentBack), spentBack };
}

export function pointsBalance(user: Pick<User, "loyaltyPoints">): number {
  return Math.max(0, Math.floor(user.loyaltyPoints || 0));
}

// Dollar value of a points balance, per current settings.
export async function pointsToDollars(points: number): Promise<number> {
  const s = await getSettings();
  if (!s.loyaltyEnabled || s.pointsPerDollarRedeemed <= 0) return 0;
  return Math.round((points / s.pointsPerDollarRedeemed) * 100) / 100;
}

export async function dollarsToPoints(dollars: number): Promise<number> {
  const s = await getSettings();
  return Math.ceil(dollars * s.pointsPerDollarRedeemed);
}

// Apply a points change to a member and log it. Returns the new balance.
export async function adjustPoints(
  userId: string,
  amount: number,
  reason: string,
  orderId?: string,
  kind?: PointsEntry["kind"]
): Promise<number | null> {
  // Balance is computed inside the conditional write, so two point changes
  // landing at once both count instead of one overwriting the other.
  return mutateUsers<number | null>((users) => {
    const idx = users.findIndex((u) => u.id === userId);
    if (idx === -1) return { users: null, result: null };

    const current = pointsBalance(users[idx]);
    const next = Math.max(0, current + Math.round(amount));
    users[idx].loyaltyPoints = next;
    users[idx].pointsHistory = [
      ...(users[idx].pointsHistory || []),
      { amount: Math.round(amount), reason, date: Date.now(), orderId, ...(kind ? { kind } : {}) },
    ].slice(-200); // keep the last 200 entries
    return { users, result: next };
  });
}

// Points earned for an order total (product value only, excluding shipping).
export async function pointsForOrder(productTotal: number): Promise<number> {
  const s = await getSettings();
  if (!s.loyaltyEnabled) return 0;
  return Math.max(0, Math.floor(productTotal * s.pointsPerDollar));
}

/** Does this order earn points under the rule (completed, member, not an inquiry)? */
export function orderEarns(o: Pick<Order, "userId" | "isInquiry" | "status">): boolean {
  return !!o.userId && !o.isInquiry && isCompleted(o.status);
}

/** Points the rule gives an order: $1 of products (total minus shipping) = pointsPerDollar. */
function rulePoints(o: Pick<Order, "total" | "shippingCost">, pointsPerDollar: number): number {
  return Math.max(0, Math.floor(Math.max(0, (o.total || 0) - (o.shippingCost || 0)) * pointsPerDollar));
}

export type SyncResult = { earned: number; takenBack: number; returned: number; respent: number };

/**
 * Bring one order's points in line with the rule, inside one safe write on the
 * member's record (their points history is the source of truth, so running it
 * twice, or on a stale order, never double-counts):
 * - completed (placed since Nov 1): it holds exactly its product dollars in points;
 * - any other status (placed since Nov 1): it holds none;
 * - cancelled (any date): it holds none, and points spent on it are returned;
 * - set back from cancelled: those spent points are spent again.
 * Orders placed before Nov 1 keep what they earned unless cancelled.
 * When a take-back is bigger than the balance, the balance stops at 0.
 */
export async function syncOrderPoints(order: Order): Promise<SyncResult> {
  const none: SyncResult = { earned: 0, takenBack: 0, returned: 0, respent: 0 };
  if (!order.userId) return none;
  const s = await getSettings();
  const ref = order.id.slice(-6).toUpperCase();
  const cancelled = normalizeStatus(order.status) === "cancelled";
  const inRule = (order.createdAt || 0) >= POINTS_RULE_SINCE;
  const res = await mutateUsers<SyncResult & { earnedFirst: number; earnedNow: number; changed: boolean }>((users) => {
    const idx = users.findIndex((u) => u.id === order.userId);
    if (idx === -1) return { users: null, result: { ...none, earnedFirst: 0, earnedNow: 0, changed: false } };
    const p = orderPoints(users[idx].pointsHistory, order);
    let target = p.earnedNow;
    if (cancelled) target = 0;
    else if (inRule && s.loyaltyEnabled) target = orderEarns(order) ? rulePoints(order, s.pointsPerDollar) : 0;
    else if (orderEarns(order) && p.earned > 0) target = p.earned; // older order set back from cancelled

    let balance = pointsBalance(users[idx]);
    const add: PointsEntry[] = [];
    const out: SyncResult = { ...none };
    const now = Date.now();
    // Spent points: returned on cancel, spent again if it's set back.
    if (cancelled && p.spentNow > 0) {
      balance += p.spentNow;
      out.returned = p.spentNow;
      add.push({ amount: p.spentNow, reason: `Order ${ref} cancelled: points spent on it returned`, date: now, orderId: order.id, kind: "redeem_back" });
    } else if (!cancelled && p.spentNow === 0 && p.spentBack > 0) {
      const take = Math.min(p.spentBack, balance);
      if (take > 0) {
        balance -= take;
        out.respent = take;
        add.push({ amount: -take, reason: `Redeemed on order ${ref} (order back on)`, date: now, orderId: order.id, kind: "redeem" });
      }
    }
    // Earned points: move the order to its target.
    const delta = target - p.earnedNow;
    if (delta > 0) {
      balance += delta;
      out.earned = delta;
      add.push(
        p.earned > 0 || p.earnedNow !== 0
          ? { amount: delta, reason: `Order ${ref} completed: points added`, date: now, orderId: order.id, kind: "earn_back" }
          : { amount: delta, reason: `Earned on order ${ref}`, date: now, orderId: order.id, kind: "earn" }
      );
    } else if (delta < 0) {
      const take = Math.min(-delta, balance);
      if (take > 0) {
        balance -= take;
        out.takenBack = take;
        add.push({
          amount: -take,
          reason: cancelled ? `Order ${ref} cancelled: points earned on it taken back` : `Order ${ref} isn't completed: points taken back until it is`,
          date: now,
          orderId: order.id,
          kind: "earn_back",
        });
      }
    }
    if (!add.length) return { users: null, result: { ...out, earnedFirst: p.earned, earnedNow: p.earnedNow, changed: false } };
    users[idx].loyaltyPoints = balance;
    users[idx].pointsHistory = [...(users[idx].pointsHistory || []), ...add].slice(-200);
    const earnedNow = p.earnedNow + out.earned - out.takenBack;
    return { users, result: { ...out, earnedFirst: p.earned || out.earned, earnedNow, changed: true } };
  });
  if (res.changed) {
    const stamp = res.earnedNow > 0 ? res.earnedNow : res.earnedFirst || undefined;
    await updateOrder(order.id, {
      loyaltyPointsEarned: stamp,
      loyaltyPointsTakenBack: res.earnedFirst > res.earnedNow ? res.earnedFirst - res.earnedNow : undefined,
    }).catch((err) => console.error("Couldn't stamp the order's points", err));
  }
  return { earned: res.earned, takenBack: res.takenBack, returned: res.returned, respent: res.respent };
}

export type PointsCheckRow = {
  userId: string;
  name: string;
  email: string;
  balance: number;
  /** Product dollars on completed orders since Nov 1, as points (the rule). */
  completedPoints: number;
  /** Points the member's history holds for orders placed since Nov 1. */
  orderPoints: number;
  /** Everything else: points spent, staff credits, orders before Nov 1. */
  otherPoints: number;
  /** Orders since Nov 1 whose points don't match the rule. */
  wrong: Array<{ orderId: string; ref: string; status: string; total: number; should: number; has: number }>;
};

/**
 * The sanity check: for every member, the points their orders since Nov 1
 * hold must equal the product dollars of their completed orders since Nov 1.
 * Returns only members with something to look at.
 */
export async function checkPoints(): Promise<{ members: number; ok: number; rows: PointsCheckRow[]; rate: number; enabled: boolean }> {
  const [orders, users, s] = await Promise.all([getOrders(), getUsers(), getSettings()]);
  const byUser = new Map<string, Order[]>();
  for (const o of orders) {
    if (!o.userId || (o.createdAt || 0) < POINTS_RULE_SINCE) continue;
    (byUser.get(o.userId) || byUser.set(o.userId, []).get(o.userId)!).push(o);
  }
  const rows: PointsCheckRow[] = [];
  let members = 0;
  for (const u of users) {
    const mine = byUser.get(u.id) || [];
    const linked = (u.pointsHistory || []).some((h) => h.orderId && mine.some((o) => o.id === h.orderId));
    if (!mine.length && !linked) continue;
    members++;
    let completedPoints = 0, held = 0;
    const wrong: PointsCheckRow["wrong"] = [];
    for (const o of mine) {
      const should = s.loyaltyEnabled && orderEarns(o) ? rulePoints(o, s.pointsPerDollar) : 0;
      if (orderEarns(o)) completedPoints += rulePoints(o, s.pointsPerDollar);
      const has = orderPoints(u.pointsHistory, o).earnedNow;
      held += has;
      if (has !== should) wrong.push({ orderId: o.id, ref: o.id.slice(-6).toUpperCase(), status: normalizeStatus(o.status), total: o.total, should, has });
    }
    if (wrong.length) {
      const balance = pointsBalance(u);
      rows.push({ userId: u.id, name: u.name, email: u.email, balance, completedPoints, orderPoints: held, otherPoints: balance - held, wrong });
    }
  }
  return { members, ok: members - rows.length, rows, rate: s.pointsPerDollar, enabled: s.loyaltyEnabled };
}

/** Fix every order the check flags. Returns what moved, per member. */
export async function fixPoints(): Promise<Array<{ name: string; ref: string; earned: number; takenBack: number }>> {
  const { rows } = await checkPoints();
  const orders = new Map((await getOrders()).map((o) => [o.id, o]));
  const done = [];
  for (const r of rows) {
    for (const w of r.wrong) {
      const o = orders.get(w.orderId);
      if (!o) continue;
      const m = await syncOrderPoints(o);
      if (m.earned || m.takenBack) done.push({ name: r.name, ref: w.ref, earned: m.earned, takenBack: m.takenBack });
    }
  }
  return done;
}

// Validate a redemption request server-side.
export async function validateRedemption(
  user: User,
  pointsRequested: number,
  subtotal: number
): Promise<{ ok: true; points: number; credit: number } | { ok: false; error: string }> {
  const s = await getSettings();
  if (!s.loyaltyEnabled) return { ok: false, error: "Points aren't available right now." };

  const points = Math.floor(pointsRequested);
  if (!Number.isFinite(points) || points <= 0) {
    return { ok: false, error: "Enter a valid number of points." };
  }
  const balance = pointsBalance(user);
  if (points > balance) {
    return { ok: false, error: `You only have ${balance} points.` };
  }
  if (points < s.minPointsToRedeem) {
    return { ok: false, error: `You need at least ${s.minPointsToRedeem} points to redeem.` };
  }

  let credit = Math.round((points / s.pointsPerDollarRedeemed) * 100) / 100;
  // Never let credit exceed the order value
  if (credit > subtotal) credit = subtotal;
  if (credit <= 0) return { ok: false, error: "Those points don't cover anything on this order." };

  return { ok: true, points, credit };
}
