import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { audited, auditDetail } from "@/lib/audit";
import { isEnabled } from "@/lib/flags";
import { getEvents, getEventsForUpdate, saveEvents } from "@/lib/events";
import { areaFrom, getNoteSettings, saveNoteSettings, withEventNote } from "@/lib/localEventsNote";
import { DEFAULT_HEADING, MAX_HEADING } from "@/lib/localEvents";

export const dynamic = "force-dynamic";

/**
 * Settings → Events popup (lib/localEvents.ts).
 * GET = the settings, the switch and the upcoming events with their popup controls.
 * PUT { place, miles, heading } = the main area and wording.
 * POST { action: "show-again" } = everyone nearby sees it once more.
 * PATCH { id, notePopup?, notePlace?, noteMiles? } = one event's controls.
 */
async function status() {
  const [settings, switchOn, events] = await Promise.all([
    getNoteSettings(),
    isEnabled("local_events_note").catch(() => false),
    getEvents(),
  ]);
  const now = Date.now();
  return {
    switchOn,
    settings,
    events: events
      .filter((e) => (e.endDate || e.date) >= now)
      .sort((a, b) => a.date - b.date)
      .map((e) => ({ id: e.id, title: e.title, date: e.date, location: e.location, published: e.published, notePopup: e.notePopup !== false, noteArea: e.noteArea || null })),
  };
}

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await status(), { headers: { "Cache-Control": "no-store" } });
}

async function PUT_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { place?: unknown; miles?: unknown; heading?: unknown };
  if (!String(b.place ?? "").trim()) return NextResponse.json({ error: "Type a town, e.g. “Springfield, IL”." }, { status: 400 });
  const current = await getNoteSettings();
  // Same town as saved (and already checked on the map) = no new lookup.
  const samePlace = String(b.place).trim() === current.area.place && !!current.area.found;
  let area = current.area;
  if (!samePlace || Math.round(Number(b.miles)) !== current.area.miles) {
    const r = samePlace ? { area: { ...current.area, miles: Math.round(Number(b.miles)) } } : await areaFrom(b.place, b.miles);
    if ("error" in r && r.error) return NextResponse.json({ error: r.error }, { status: 400 });
    if (!r.area || !(r.area.miles >= 1 && r.area.miles <= 500)) return NextResponse.json({ error: "Miles must be a whole number from 1 to 500." }, { status: 400 });
    area = r.area;
  }
  const heading = String(b.heading ?? "").trim().slice(0, MAX_HEADING) || DEFAULT_HEADING;
  const r = await saveNoteSettings((s) => ({ ...s, area, heading }));
  auditDetail({ targetId: "events-note", before: { area: r.before.area.place, miles: r.before.area.miles, heading: r.before.heading }, after: { area: r.after.area.place, miles: r.after.area.miles, heading: r.after.heading } });
  return NextResponse.json({ ok: true, ...(await status()) });
}

async function POST_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { action?: unknown };
  if (b.action !== "show-again") return NextResponse.json({ error: "unknown action" }, { status: 400 });
  await saveNoteSettings((s) => ({ ...s, resetAt: Date.now() }));
  auditDetail({ targetId: "events-note", after: { showAgain: true } });
  return NextResponse.json({ ok: true, ...(await status()) });
}

async function PATCH_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { id?: unknown; notePopup?: unknown; notePlace?: unknown; noteMiles?: unknown };
  const all = await getEventsForUpdate();
  const i = all.findIndex((e) => e.id === b.id);
  if (i === -1) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const r = await withEventNote(all[i], b);
  if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
  auditDetail({ targetType: "event", targetId: all[i].id, before: { notePopup: all[i].notePopup !== false, area: all[i].noteArea?.place || null }, after: { notePopup: r.event.notePopup !== false, area: r.event.noteArea?.place || null } });
  all[i] = r.event;
  await saveEvents(all);
  return NextResponse.json({ ok: true, ...(await status()) });
}

export const PUT = audited("events_note.settings", "settings", PUT_handler);
export const POST = audited("events_note.show_again", "settings", POST_handler);
export const PATCH = audited("events_note.event", "event", PATCH_handler);
