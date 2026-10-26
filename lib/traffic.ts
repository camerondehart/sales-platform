import path from "path";
import { VersionedStore } from "./versionedStore";
import { singleton } from "./assistant/singleton";
import { brand } from "@/lib/brand";

/**
 * Cookie-free visitor counters — the server side.
 *
 * Events are only ever COUNTED: each day has one row of named counters
 * ("e:visit" = 412, "pv:<product id>" = 37, "r:instagram.com" = 18 …).
 * No individual visit, IP address or identifier is stored.
 *
 * Counts are added up in memory and saved at most every 30 seconds (the same
 * batching the assistant's usage stats use), into one race-safe store per
 * month so each save stays small. If a server instance is recycled between
 * saves a handful of events can go uncounted — fine for trends.
 */

export type DayRow = { id: string; c: Record<string, number> };

const TZ = brand.timezone;
const FLUSH_MS = 30_000;
const MAX_KEYS_PER_DAY = 3000;

const dayKey = (t = Date.now()) => new Date(t).toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD, local

function hourAndWeekday(t = Date.now()): { h: number; w: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", hour: "2-digit", weekday: "short" })
      .formatToParts(new Date(t))
      .map((p) => [p.type, p.value])
  );
  const w = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { h: Number(parts.hour) % 24, w };
}

const stores = singleton("trafficStores", () => new Map<string, VersionedStore<DayRow>>());
function monthStore(month: string): VersionedStore<DayRow> {
  let s = stores.get(month);
  if (!s) {
    s = new VersionedStore<DayRow>({
      name: `traffic-${month}`,
      legacyKey: `traffic-${month}.json`,
      localFile: path.join(process.cwd(), "data", `traffic-${month}.json`),
      keep: 4,
      reconcileLegacy: false,
    });
    stores.set(month, s);
  }
  return s;
}

const S = singleton("traffic", () => ({
  pending: new Map<string, Record<string, number>>(), // day -> counters
  lastFlush: Date.now(),
  flushing: null as Promise<void> | null,
}));

function bump(day: string, key: string, by = 1) {
  const c = S.pending.get(day) || {};
  c[key] = (c[key] || 0) + by;
  S.pending.set(day, c);
}

const ALLOWED = new Set([
  "visit", "page", "product_view", "add_to_cart", "cart_open", "checkout_open", "order_placed",
  "assistant_open", "assistant_add", "join_request", "subscribe", "category", "event_signup",
]);

const clip = (v: unknown, max = 60) => String(v ?? "").replace(/[^\w\-./:@ ]/g, "").trim().slice(0, max);
const cleanPath = (v: unknown) => {
  const p = clip(v, 80);
  if (!p.startsWith("/")) return "";
  // Collapse per-item paths so tokens never end up in stats.
  if (p.startsWith("/pay/")) return "/pay/…";
  if (p.startsWith("/p/")) return "/p/…";
  return p.split("?")[0];
};

export function isBot(ua: string): boolean {
  return !ua || /bot|crawl|spider|slurp|preview|headless|lighthouse|facebookexternalhit|pingdom|uptime|monitor|curl|wget|python-requests|node-fetch/i.test(ua);
}

/** Count one event. Returns false if it was ignored. */
export function recordEvent(name: string, props: Record<string, unknown>, ctx: { country?: string; at?: number } = {}): boolean {
  if (!ALLOWED.has(name)) return false;
  const at = ctx.at ?? Date.now();
  const day = dayKey(at);
  const cur = S.pending.get(day);
  if (cur && Object.keys(cur).length > MAX_KEYS_PER_DAY) return false;
  bump(day, `e:${name}`);
  // First time this session reached a funnel step → "sessions that got this far".
  if (props.first === "1" || props.first === 1) bump(day, `f:${name}`);
  switch (name) {
    case "visit": {
      const { h, w } = hourAndWeekday(at);
      bump(day, `h:${h}`);
      bump(day, `wh:${w}-${h}`);
      const land = cleanPath(props.path);
      if (land) bump(day, `l:${land}`);
      const ref = clip(props.ref, 50).toLowerCase();
      bump(day, `r:${ref || "direct"}`);
      const device = ["phone", "tablet", "desktop"].includes(String(props.device)) ? String(props.device) : "unknown";
      bump(day, `d:${device}`);
      const campaign = clip(props.campaign, 60);
      if (campaign) bump(day, `c:${campaign}`);
      const cc = clip(ctx.country, 2).toUpperCase();
      if (/^[A-Z]{2}$/.test(cc)) bump(day, `g:${cc}`);
      break;
    }
    case "page": {
      const p = cleanPath(props.path);
      if (p) bump(day, `p:${p}`);
      break;
    }
    case "product_view": {
      const id = clip(props.id, 80);
      if (id) bump(day, `pv:${id}`);
      break;
    }
    case "add_to_cart": {
      const id = clip(props.id, 80);
      if (id) bump(day, `pc:${id}`);
      break;
    }
    case "order_placed": {
      const cents = Math.round(Math.max(0, Math.min(100_000, Number(props.value) || 0)) * 100);
      bump(day, "ov", cents);
      bump(day, `os:${props.shop === "member" ? "member" : "public"}`);
      const campaign = clip(props.campaign, 60);
      if (campaign) {
        bump(day, `co:${campaign}`);
        bump(day, `cv:${campaign}`, cents);
      }
      break;
    }
    case "category": {
      const c = clip(props.name, 40);
      if (c) bump(day, `cat:${c}`);
      break;
    }
  }
  void flushTraffic();
  return true;
}

/** Server-side counters (QR scans, email opens/clicks) go through the same batching. */
export function recordCounter(key: string, by = 1, at = Date.now()) {
  bump(dayKey(at), clip(key, 100), by);
  void flushTraffic();
}

export async function flushTraffic(force = false): Promise<void> {
  if (S.pending.size === 0) return;
  if (!force && Date.now() - S.lastFlush < FLUSH_MS) return;
  if (S.flushing) return S.flushing;
  const batch = new Map(S.pending);
  S.pending.clear();
  S.flushing = (async () => {
    try {
      const byMonth = new Map<string, Array<[string, Record<string, number>]>>();
      batch.forEach((c, day) => {
        const m = day.slice(0, 7);
        byMonth.set(m, [...(byMonth.get(m) || []), [day, c]]);
      });
      for (const [month, days] of byMonth) {
        await monthStore(month).mutate((rows) => {
          const next = rows.map((r) => ({ id: r.id, c: { ...r.c } }));
          for (const [day, counts] of days) {
            let row = next.find((r) => r.id === day);
            if (!row) {
              row = { id: day, c: {} };
              next.push(row);
            }
            for (const [k, v] of Object.entries(counts)) row.c[k] = (row.c[k] || 0) + v;
          }
          return { data: next, result: undefined };
        });
      }
      S.lastFlush = Date.now();
    } catch (err) {
      console.error("[traffic] save failed; will retry", err);
      batch.forEach((c, day) => {
        const cur = S.pending.get(day) || {};
        for (const [k, v] of Object.entries(c)) cur[k] = (cur[k] || 0) + v;
        S.pending.set(day, cur);
      });
    } finally {
      S.flushing = null;
    }
  })();
  return S.flushing;
}

/** Daily rows between two local dates (inclusive), including this instance's unsaved counts. */
export async function readTraffic(fromDay: string, toDay: string): Promise<DayRow[]> {
  const months: string[] = [];
  const d = new Date(`${fromDay.slice(0, 7)}-01T12:00:00Z`);
  const end = toDay.slice(0, 7);
  while (d.toISOString().slice(0, 7) <= end && months.length < 26) {
    months.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  const rows: DayRow[] = [];
  for (const m of months) {
    try {
      rows.push(...(await monthStore(m).read()).data);
    } catch (err) {
      console.error("[traffic] read failed", m, err);
    }
  }
  const byDay = new Map(rows.map((r) => [r.id, { id: r.id, c: { ...r.c } }]));
  S.pending.forEach((c, day) => {
    const row = byDay.get(day) || { id: day, c: {} };
    for (const [k, v] of Object.entries(c)) row.c[k] = (row.c[k] || 0) + v;
    byDay.set(day, row);
  });
  return Array.from(byDay.values())
    .filter((r) => r.id >= fromDay && r.id <= toDay)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

export { dayKey as pacificDay };
