import { readAuditSince } from "./audit";
import { singleton } from "./assistant/singleton";
import type { Order } from "./orders";

/**
 * Unpaid orders someone already chased recently — so the Today list doesn't
 * ask to chase them again the next morning. Read-only: worked out from the
 * Activity log (a staff message or invoice resend to the order) and the
 * order's own automatic payment reminders. Nothing is written to orders.
 */

export const CHASE_QUIET_DAYS = 3;
const DAY = 86_400_000;
const CHASE_ACTIONS = ["order.email_sent", "invoice.resend"];

const CACHE = singleton("chasedOrders", () => ({ at: 0, map: new Map<string, number>() }));

/** order id → when it was last chased by staff (within the quiet window). */
async function staffChases(now: number): Promise<Map<string, number>> {
  if (now - CACHE.at < 60_000) return CACHE.map;
  const map = new Map<string, number>();
  try {
    const entries = await readAuditSince(now - CHASE_QUIET_DAYS * DAY, CHASE_ACTIONS);
    for (const e of entries) {
      if (!e.ok || !e.targetId) continue;
      for (const id of e.targetId.split(",")) map.set(id, Math.max(map.get(id) || 0, e.at));
    }
  } catch (err) {
    console.error("[chased] couldn't read the activity log", err);
  }
  Object.assign(CACHE, { at: now, map });
  return map;
}

/** Splits overdue orders into those to chase now and those chased in the last few days. */
export async function splitChased(orders: Order[], now = Date.now()) {
  const staff = await staffChases(now);
  const since = now - CHASE_QUIET_DAYS * DAY;
  const last = (o: Order) =>
    Math.max(staff.get(o.id) || 0, ...(o.reminders || []).filter((r) => r.ok).map((r) => r.at));
  const toChase: Order[] = [];
  const quiet: Array<{ order: Order; chasedAt: number }> = [];
  for (const o of orders) {
    const t = last(o);
    if (t >= since) quiet.push({ order: o, chasedAt: t });
    else toChase.push(o);
  }
  return { toChase, quiet };
}
