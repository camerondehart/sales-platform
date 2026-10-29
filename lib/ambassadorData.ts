import { getOrders, type Order } from "./orders";
import { readTraffic, recordCounter } from "./traffic";
import { currentRate, termsOf, type Ambassador } from "./ambassadors";
import { ambassadorStats, pDay, type AmbassadorStats } from "./ambassadorStats";

/**
 * Loads what the Ambassadors tab and the progress report need: each
 * ambassador's orders (from the order list) and page visits / QR scans (the
 * site's cookie-free counters, "amb:<id>" and "ambq:<id>").
 */

/** Count a visit to an ambassador's page (and a QR scan). No personal data. */
export function countAmbassadorVisit(id: string, qr: boolean) {
  recordCounter(`amb:${id}`);
  if (qr) recordCounter(`ambq:${id}`);
}

export async function ambassadorStatsFor(list: Ambassador[], range?: { from: number; to: number }, now = Date.now()): Promise<Record<string, AmbassadorStats>> {
  if (!list.length) return {};
  const orders = await getOrders();
  const earliest = Math.min(...list.map((a) => Date.parse(`${termsOf(a).startDate}T12:00:00Z`) || a.createdAt), range?.from ?? now);
  const from = pDay(Math.max(earliest - 86_400_000, now - 760 * 86_400_000));
  const rows = await readTraffic(from, pDay(now)).catch(() => []);
  const out: Record<string, AmbassadorStats> = {};
  for (const a of list) {
    const visits: Record<string, number> = {};
    const qr: Record<string, number> = {};
    for (const r of rows) {
      if (r.c[`amb:${a.id}`]) visits[r.id] = r.c[`amb:${a.id}`];
      if (r.c[`ambq:${a.id}`]) qr[r.id] = r.c[`ambq:${a.id}`];
    }
    const terms = termsOf(a);
    out[a.id] = ambassadorStats({
      terms,
      currentRate: currentRate(terms),
      orders: orders.filter((o: Order) => o.ambassador?.id === a.id),
      visits,
      qr,
      payouts: a.payouts || [],
      now,
      range,
    });
  }
  return out;
}
