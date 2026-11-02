import { addDays, pacificDay, pacificToMs, msToPacificInput } from "./periods";
import { brand } from "./brand";

/**
 * Free phone consultations: the choices on the request form (same questions
 * outside consultation forms usually ask). Times are requests in the brand's time zone, weekdays only;
 * the team confirms by phone or email. Client-safe (the form uses it too).
 */

export const CONSULT_INTERESTS = [
  "Finding the right product for me",
  "How to use a product I have",
  "Membership, ordering or pickup",
  "Something else",
] as const;

/** Shown and agreed to (typed signature) before every request. */
export const CONSULT_ACK =
  brand.consultationAcknowledgement ||
  `I understand that all information given by the ${brand.shortName} team is general, based on their own research and experience, and that they are not doctors or healthcare professionals.`;

/** Half-hour slots, local time: 9:00 AM to 4:30 PM. */
export const SLOT_TIMES: string[] = Array.from({ length: 16 }, (_, i) => {
  const m = 9 * 60 + i * 30;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
});

/** How far ahead people can ask for a time. */
export const DAYS_AHEAD = 60;
/** Earliest request: this long from now, so the team has time to see it. */
const MIN_LEAD_MS = 2 * 3600_000;

export function slotLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD date. */
export const weekdayOf = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay();
export const isWeekday = (ymd: string) => weekdayOf(ymd) >= 1 && weekdayOf(ymd) <= 5;

export function slotMs(ymd: string, hhmm: string): number {
  return pacificToMs(`${ymd}T${hhmm}`);
}

/** "Monday, November 2 at 4:30 PM" (local time). */
export function slotText(ms: number): string {
  const d = new Date(ms).toLocaleDateString("en-US", { timeZone: brand.timezone, weekday: "long", month: "long", day: "numeric" });
  return `${d} at ${slotLabel(msToPacificInput(ms).slice(11, 16))} (${brand.timezoneLabel})`;
}

/** Weekdays someone can pick, starting today. */
export function bookableDates(now = Date.now()): string[] {
  const out: string[] = [];
  const today = pacificDay(now);
  for (let i = 0; i <= DAYS_AHEAD; i++) {
    const d = addDays(today, i);
    if (isWeekday(d) && SLOT_TIMES.some((t) => slotMs(d, t) >= now + MIN_LEAD_MS)) out.push(d);
  }
  return out;
}

/** Why a requested time can't be used, or null when it's fine. */
export function checkSlot(ms: number, now = Date.now()): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return "Please pick a day and time.";
  const local = msToPacificInput(ms);
  const ymd = local.slice(0, 10);
  if (!isWeekday(ymd)) return "Consultations are Monday to Friday. Please pick a weekday.";
  if (!SLOT_TIMES.includes(local.slice(11, 16))) return `Please pick one of the listed times (9 AM to 4:30 PM ${brand.timezoneLabel}, on the half hour).`;
  if (ms < now + MIN_LEAD_MS) return "That time is too soon. Please pick a time at least two hours from now.";
  if (ms > now + (DAYS_AHEAD + 1) * 86_400_000) return `Please pick a time within the next ${DAYS_AHEAD} days.`;
  return null;
}
