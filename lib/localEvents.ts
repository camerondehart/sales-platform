/**
 * Events note for locals (switch `local_events_note`).
 *
 * A member whose approximate location at sign-in (from their internet address,
 * which Vercel adds to every request as x-vercel-ip-latitude / -longitude) is
 * within RADIUS_MILES of the town in Settings → Events popup (starting value:
 * `eventsArea` in brand.config.ts) gets one small note about upcoming events,
 * once ever. The location is used for that one decision and never stored; only
 * the member's `eventsNoteSeenAt` is saved. No location, or any error = no note.
 *
 * Pure helpers here (unit check tests/unit/local-events.cjs); the server side
 * is lib/localEventsNote.ts.
 */
import brandConfig from "../brand.config";

/** The starting center town (brand.config.ts `eventsArea`). */
export const CENTER = { lat: brandConfig.eventsArea.lat, lon: brandConfig.eventsArea.lon };
export const RADIUS_MILES = brandConfig.eventsArea.miles;

/** Great-circle distance in miles. */
export function milesBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The approximate location Vercel attaches to a request, or null if absent or unreadable. */
export function geoFromHeaders(get: (name: string) => string | null | undefined): { lat: number; lon: number } | null {
  const rawLat = (get("x-vercel-ip-latitude") || "").trim();
  const rawLon = (get("x-vercel-ip-longitude") || "").trim();
  if (!rawLat || !rawLon) return null;
  const lat = Number(rawLat);
  const lon = Number(rawLon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export function nearCenter(geo: { lat: number; lon: number } | null): boolean {
  return !!geo && milesBetween(geo, CENTER) <= RADIUS_MILES;
}

/** What the members' page needs to show the one-time events note. */
export type LocalEventNote = { title: string; date: number; location?: string; more: number; kicker: string; heading: string };

/** A circle on the map: a town and how many miles around it. */
export type NoteArea = { place: string; lat: number; lon: number; miles: number; /** The place the map found, e.g. "San Jose, Santa Clara County, California, United States". */ found?: string };

/** Settings → Events popup. `resetAt` = "Show it again to everyone" (members who saw it before then see it once more). */
export type NoteSettings = { area: NoteArea; heading: string; resetAt?: number };

export const DEFAULT_HEADING = "Gather with us, close to home";
export const DEFAULT_NOTE_SETTINGS: NoteSettings = {
  area: { place: brandConfig.eventsArea.place, lat: CENTER.lat, lon: CENTER.lon, miles: RADIUS_MILES, found: brandConfig.eventsArea.found },
  heading: DEFAULT_HEADING,
};
export const MAX_MILES = 500;
export const MAX_HEADING = 80;

/** "Springfield, IL" → "Springfield" (the card's small heading says "Near Springfield"). */
export const shortPlace = (place: string) => (place.split(",")[0] || "").trim() || place.trim();

/** Per-event control, saved on the event: in the popup or not, and its own area (blank = the main one). */
export type EventNoteFields = { notePopup?: boolean; noteArea?: NoteArea };

/** Has this member already had the note (since the last "Show it again")? */
export function noteSeen(seenAt: number | undefined, resetAt: number | undefined): boolean {
  return !!seenAt && !(resetAt && seenAt < resetAt);
}

/**
 * The event the note is about for someone at `geo`: the soonest published,
 * upcoming event that is in the popup and whose area (its own, or the main
 * one) reaches them. `more` = how many others also reach them.
 */
export function pickNoteEvent<E extends EventLike & EventNoteFields>(
  events: E[],
  settings: NoteSettings,
  geo: { lat: number; lon: number } | null,
  now: number
): { event: E; area: NoteArea; more: number } | null {
  if (!geo) return null;
  const hits = events
    .filter((e) => e.published && typeof e.date === "number" && e.date >= now && e.notePopup !== false)
    .map((e) => ({ event: e, area: e.noteArea || settings.area }))
    .filter(({ area }) => milesBetween(geo, area) <= area.miles)
    .sort((a, b) => a.event.date - b.event.date);
  return hits[0] ? { ...hits[0], more: hits.length - 1 } : null;
}

/** Tidy a miles value from a form: whole miles, 1 to MAX_MILES, or null if unusable. */
export function cleanMiles(v: unknown): number | null {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= MAX_MILES ? n : null;
}

type EventLike = { id: string; title: string; date: number; location?: string; published?: boolean };

/** The soonest published event that hasn't started yet, or null. */
export function nextUpcomingEvent<E extends EventLike>(events: E[], now: number): E | null {
  const up = events.filter((e) => e.published && typeof e.date === "number" && e.date >= now).sort((a, b) => a.date - b.date);
  return up[0] || null;
}
