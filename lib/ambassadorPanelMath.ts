/**
 * The Ambassador panel's date ranges and chart buckets. Pure (no storage, no
 * imports), so it's unit-tested in tests/unit/ambassador-panel.cjs.
 * All days are Pacific (YYYY-MM-DD).
 */

export type PanelRange = "7" | "30" | "90" | "365" | "all";
export const PANEL_RANGES: Array<{ key: PanelRange; label: string }> = [
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
  { key: "365", label: "1 year" },
  { key: "all", label: "All time" },
];

export const cleanRange = (v: unknown): PanelRange => (["7", "30", "90", "365", "all"].includes(String(v)) ? (String(v) as PanelRange) : "30");

export const shiftDay = (ymd: string, n: number): string => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10);
};
const daysApart = (a: string, b: string) =>
  Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86_400_000);

/** First and last day of the range. "all" starts on the day they started (never after today). */
export function rangeDays(range: PanelRange, today: string, startDay: string): { from: string; to: string } {
  if (range === "all") return { from: startDay < today ? startDay : today, to: today };
  return { from: shiftDay(today, -(Number(range) - 1)), to: today };
}

export type Point = { key: string; label: string; visits: number; orders: number; sales: number };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (d: string) => `${MONTHS[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}`;
const monthLabel = (m: string) => `${MONTHS[+m.slice(5, 7) - 1]} ${m.slice(2, 4)}`;

/**
 * The chart: one bar per day up to 90 days, per week (starting on `from`) up
 * to 1 year and a bit, per month beyond that. Every bucket is there, even empty.
 * `visits` = visits per day; `orders` = each order's day and net sale.
 */
export function panelSeries(from: string, to: string, visits: Record<string, number>, orders: Array<{ day: string; net: number }>): { unit: "day" | "week" | "month"; points: Point[] } {
  const span = daysApart(from, to) + 1;
  const unit: "day" | "week" | "month" = span <= 92 ? "day" : span <= 400 ? "week" : "month";
  const keyOf = (d: string) => (unit === "day" ? d : unit === "week" ? shiftDay(from, Math.floor(daysApart(from, d) / 7) * 7) : d.slice(0, 7));
  const points = new Map<string, Point>();
  if (unit === "month") {
    let m = from.slice(0, 7);
    while (m <= to.slice(0, 7)) {
      points.set(m, { key: m, label: monthLabel(m), visits: 0, orders: 0, sales: 0 });
      const [y, mo] = m.split("-").map(Number);
      m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
    }
  } else {
    for (let d = from; d <= to; d = shiftDay(d, unit === "day" ? 1 : 7)) points.set(d, { key: d, label: dayLabel(d), visits: 0, orders: 0, sales: 0 });
  }
  for (const [d, n] of Object.entries(visits)) {
    if (d < from || d > to) continue;
    const p = points.get(keyOf(d));
    if (p) p.visits += n;
  }
  for (const o of orders) {
    if (o.day < from || o.day > to) continue;
    const p = points.get(keyOf(o.day));
    if (p) { p.orders += 1; p.sales = Math.round((p.sales + o.net) * 100) / 100; }
  }
  return { unit, points: Array.from(points.values()) };
}

/** Add up the counters for days inside the range. */
export function sumDays(byDay: Record<string, number>, from: string, to: string): number {
  let n = 0;
  for (const [d, v] of Object.entries(byDay)) if (d >= from && d <= to) n += v;
  return n;
}

/** The same length of time just before, for "vs the previous 30 days". Null for "all". */
export function previousRange(range: PanelRange, from: string): { from: string; to: string } | null {
  if (range === "all") return null;
  const n = Number(range);
  return { from: shiftDay(from, -n), to: shiftDay(from, -1) };
}
