import path from "path";
import { VersionedStore } from "./versionedStore";
import { isEnabled } from "./flags";
import { getEvents } from "./events";
import { mutateUsers, type User } from "./users";
import { geocodeAddress, nominatimUS } from "./geocode";
import {
  DEFAULT_HEADING,
  DEFAULT_NOTE_SETTINGS,
  MAX_HEADING,
  cleanMiles,
  geoFromHeaders,
  noteSeen,
  pickNoteEvent,
  shortPlace,
  type LocalEventNote,
  type NoteArea,
  type NoteSettings,
} from "./localEvents";

/**
 * Server side of the events popup for locals (lib/localEvents.ts).
 * Settings → Events popup is one saved row: the main area, the heading and
 * when staff last pressed "Show it again to everyone". Per-event control
 * (in the popup or not, own area) is saved on the event itself.
 */

type Row = NoteSettings & { id: "settings"; updatedAt: number };

const store = new VersionedStore<Row>({
  name: "events-note",
  legacyKey: "events-note.json",
  localFile: path.join(process.cwd(), "data", "events-note.json"),
  keep: 10,
  reconcileLegacy: false,
});

function tidy(r: Partial<NoteSettings> | undefined): NoteSettings {
  const a = r?.area;
  const area: NoteArea =
    a && a.place && Number.isFinite(a.lat) && Number.isFinite(a.lon) && cleanMiles(a.miles)
      ? { place: String(a.place), lat: Number(a.lat), lon: Number(a.lon), miles: cleanMiles(a.miles)!, found: a.found ? String(a.found) : undefined }
      : DEFAULT_NOTE_SETTINGS.area;
  const heading = String(r?.heading || "").trim().slice(0, MAX_HEADING) || DEFAULT_HEADING;
  return { area, heading, resetAt: Number(r?.resetAt) || undefined };
}

export async function getNoteSettings(): Promise<NoteSettings> {
  const rows = (await store.read().catch(() => ({ data: [] as Row[] }))).data;
  return tidy(rows.find((r) => r.id === "settings"));
}

export async function saveNoteSettings(change: (s: NoteSettings) => NoteSettings): Promise<{ before: NoteSettings; after: NoteSettings }> {
  return store.mutate(
    (rows) => {
      const before = tidy(rows.find((r) => r.id === "settings"));
      const after = tidy(change(before));
      return { data: [{ id: "settings", ...after, updatedAt: Date.now() }], result: { before, after } };
    },
    { allowShrink: true }
  );
}

/**
 * A town and miles from a form → an area, looking the town up on the map.
 * `{ area: null }` with no error = blank (use the main area).
 */
export async function areaFrom(place: unknown, miles: unknown): Promise<{ area: NoteArea | null; error?: string }> {
  const p = String(place ?? "").trim().slice(0, 120);
  if (!p) return { area: null };
  const m = cleanMiles(miles);
  if (!m) return { area: null, error: "Miles must be a whole number from 1 to 500." };
  const r = await geocodeAddress(p, nominatimUS);
  if (!r.point) return { area: null, error: r.error && /Couldn't reach/.test(r.error) ? r.error : `Couldn't find “${p}” on the map of the US. Try “Town, State”.` };
  return { area: { place: p, lat: r.point.lat, lon: r.point.lng, miles: m, found: r.point.label ? String(r.point.label).slice(0, 200) : undefined } };
}

/**
 * Should this member see the events note on this visit? Never throws: any
 * problem means no note.
 */
export async function localEventNoteFor(
  user: Pick<User, "id" | "eventsNoteSeenAt">,
  get: (name: string) => string | null | undefined,
  actingAs?: string
): Promise<LocalEventNote | null> {
  try {
    if (actingAs) return null;
    const geo = geoFromHeaders(get);
    if (!geo) return null;
    if (!(await isEnabled("local_events_note"))) return null;
    const settings = await getNoteSettings();
    if (noteSeen(user.eventsNoteSeenAt, settings.resetAt)) return null;
    const hit = pickNoteEvent(await getEvents(), settings, geo, Date.now());
    if (!hit) return null;
    const { event, area, more } = hit;
    return { title: event.title, date: event.date, location: event.location || undefined, more, kicker: `Near ${shortPlace(area.place)}`, heading: settings.heading };
  } catch (err) {
    console.error("[local-events] skipped", err);
    return null;
  }
}

/** Remember that this member has had the note (until staff press "Show it again"). */
export async function markEventsNoteSeen(userId: string): Promise<boolean> {
  return mutateUsers<boolean>((users) => {
    const i = users.findIndex((u) => u.id === userId);
    if (i === -1) return { users: null, result: false };
    users[i] = { ...users[i], eventsNoteSeenAt: Date.now() };
    return { users, result: true };
  });
}

/**
 * The popup fields from an event form (create, edit, or Settings → Events
 * popup) applied to an event: `notePopup` true/false, `notePlace` + `noteMiles`
 * (blank place = the main area). Fields left out are left alone.
 */
export async function withEventNote<E extends { notePopup?: boolean; noteArea?: NoteArea }>(
  event: E,
  b: { notePopup?: unknown; notePlace?: unknown; noteMiles?: unknown }
): Promise<{ event: E; error?: string }> {
  const out = { ...event };
  if (b.notePopup !== undefined) {
    if (b.notePopup === false) out.notePopup = false;
    else delete out.notePopup;
  }
  if (b.notePlace !== undefined) {
    // Miles left blank = the main area's miles.
    const miles = String(b.noteMiles ?? "").trim() === "" ? (await getNoteSettings()).area.miles : b.noteMiles;
    const same = out.noteArea && out.noteArea.found && String(b.notePlace).trim() === out.noteArea.place && cleanMiles(miles) === out.noteArea.miles;
    if (!same) {
      const r = await areaFrom(b.notePlace, miles);
      if (r.error) return { event, error: r.error };
      if (r.area) out.noteArea = r.area;
      else delete out.noteArea;
    }
  }
  return { event: out };
}
