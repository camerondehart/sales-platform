import { brand } from "@/lib/brand";
/**
 * One definition of reporting days, shared by the Analytics tab, the Overview
 * tab, the nightly report and the Concierge's sales answers.
 *
 *  - Days run midnight to midnight in the business's time zone (brand.config.ts).
 *  - "Last N days" = today plus the N−1 full days before it.
 *
 * No server-only imports, so the dashboard can use it in the browser.
 */

const TZ = brand.timezone;
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", hour: "2-digit" });

/** "2026-09-25": the local calendar day containing `t`. */
export function pacificDay(t = Date.now()): string {
  return dayFmt.format(new Date(t));
}

/** Shift a "YYYY-MM-DD" by whole days. */
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10);
}

/** Epoch ms of midnight local at the start of `ymd`. */
export function pacificMidnight(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  // local is UTC−7 or UTC−8 and DST switches at 2 am, so midnight is one of these.
  for (const h of [7, 8]) {
    const t = Date.UTC(y, m - 1, d, h);
    if (Number(hourFmt.format(new Date(t))) % 24 === 0 && dayFmt.format(new Date(t)) === ymd) return t;
  }
  return Date.UTC(y, m - 1, d, 8);
}

/** Start of "last N days" (midnight local, N−1 days before today). N=1 → today. */
export function lastNDaysStart(n: number, now = Date.now()): number {
  return pacificMidnight(addDays(pacificDay(now), -(Math.max(1, Math.floor(n)) - 1)));
}

const dtFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "2026-09-22 16:15" in local time (for spreadsheets). "" for no time. */
export function pacificDateTime(t: number | undefined | null): string {
  if (!t) return "";
  const p = Object.fromEntries(dtFmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** "2026-09" — the local month containing `t`. */
export const pacificMonth = (t = Date.now()) => pacificDay(t).slice(0, 7);

// ---------------------------------------------------------------------------
// Date/time boxes in the dashboard are always local, whatever the viewer's
// computer is set to (a datetime-local box has no time zone of its own).

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});
function pacificParts(t: number) {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute };
}

/** "2026-10-31T18:30" (or "2026-10-31" = midnight), read as local wall-clock time → epoch ms. NaN if unreadable. */
export function pacificToMs(local: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/.exec(String(local || "").trim());
  if (!m) return NaN;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
  let t = wall + 8 * 3_600_000; // local is UTC−8 or UTC−7: start from −8, then correct
  for (let i = 0; i < 2; i++) {
    const p = pacificParts(t);
    t += wall - Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
  }
  return t;
}

/** Epoch ms → "YYYY-MM-DDTHH:mm" in local, for prefilling a datetime-local box. */
export function msToPacificInput(t: number): string {
  const p = pacificParts(t);
  const z = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${z(p.mo)}-${z(p.d)}T${z(p.h)}:${z(p.mi)}`;
}

/** Last millisecond of a local day ("2026-10-31" → 11:59:59.999 pm local). For "works until" dates. */
export function endOfPacificDay(ymd: string): number {
  return pacificMidnight(addDays(ymd, 1)) - 1;
}
