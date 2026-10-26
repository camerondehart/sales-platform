// Loyalty points — earned on orders the admin has confirmed as paid,
// redeemable as store credit at checkout. Points live on the user record.

import { mutateUsers, type User } from "./users";
import { getSettings } from "./settings";
import { updateOrder, type Order } from "./orders";

export type PointsEntry = {
  amount: number; // positive = earned, negative = redeemed
  reason: string;
  date: number;
  orderId?: string;
};

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
  orderId?: string
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
      { amount: Math.round(amount), reason, date: Date.now(), orderId },
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

// Award points once, the first time an order is settled (paid or picked up).
//
// The order file can be read up to a minute stale (e.g. marked "paid" then
// "completed" in quick succession, or the customer and an admin confirming at
// the same time), so `order.loyaltyPointsEarned` alone can't prevent a double
// award. The member's own points history is the source of truth: it's checked
// inside the same safe write that adds the points.
export async function awardLoyaltyPoints(order: Order): Promise<void> {
  if (order.loyaltyPointsEarned) return; // already awarded
  try {
    const productTotal = Math.max(0, order.total - order.shippingCost);
    const points = await pointsForOrder(productTotal);
    if (points > 0) {
      const awarded = await mutateUsers<boolean>((users) => {
        const idx = users.findIndex((u) => u.id === order.userId);
        if (idx === -1) return { users: null, result: false };
        const already = (users[idx].pointsHistory || []).some((h) => h.orderId === order.id && h.amount > 0);
        if (already) return { users: null, result: false };
        users[idx].loyaltyPoints = pointsBalance(users[idx]) + points;
        users[idx].pointsHistory = [
          ...(users[idx].pointsHistory || []),
          { amount: points, reason: `Earned on order ${order.id.slice(-6).toUpperCase()}`, date: Date.now(), orderId: order.id },
        ].slice(-200);
        return { users, result: true };
      });
      if (awarded) await updateOrder(order.id, { loyaltyPointsEarned: points });
    }
  } catch (err) {
    console.error("Failed to award loyalty points", err);
  }
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
