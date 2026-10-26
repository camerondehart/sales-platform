import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import {
  getEvents,
  getEventsForUpdate,
  saveEvents,
  getRegistrations,
  cancelAndPromote,
  promoteRegistration,
  countFor,
  type SiteEvent,
} from "@/lib/events";
import { audited, auditDetail } from "@/lib/audit";
import { cleanupMedia } from "@/lib/media";

export async function GET(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const eventId = new URL(req.url).searchParams.get("eventId");
  const [events, regs] = await Promise.all([getEvents(), getRegistrations()]);

  if (eventId) {
    return NextResponse.json({
      registrations: regs
        .filter((r) => r.eventId === eventId)
        .sort((a, b) => a.createdAt - b.createdAt),
    });
  }

  return NextResponse.json({
    events: events
      .sort((a, b) => b.date - a.date)
      .map((e) => ({
        ...e,
        registeredCount: countFor(regs, e.id, "registered"),
        waitlistedCount: countFor(regs, e.id, "waitlisted"),
      })),
  });
}

async function POST_handler(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const b = await req.json();
  if (!b.title?.trim() || !b.date || !b.location?.trim()) {
    return NextResponse.json({ error: "Title, date, and location are required." }, { status: 400 });
  }

  const event: SiteEvent = {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: b.title.trim(),
    description: b.description?.trim() || "",
    date: Number(b.date),
    endDate: b.endDate ? Number(b.endDate) : undefined,
    location: b.location.trim(),
    price: b.price?.trim() || undefined,
    capacity: Math.max(0, Math.floor(Number(b.capacity) || 0)),
    waitlistCapacity: Math.max(0, Math.floor(Number(b.waitlistCapacity) || 0)),
    type: ["class", "workshop", "vendor", "other"].includes(b.type) ? b.type : "class",
    image: b.image?.trim() || undefined,
    published: b.published !== false,
    createdAt: Date.now(),
  };

  const all = await getEventsForUpdate();
  all.unshift(event);
  await saveEvents(all);
  return NextResponse.json({ ok: true, event });
}

async function PATCH_handler(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const b = await req.json();

  // Registration actions
  if (b.registrationId) {
    auditDetail({ action: `registration.${String(b.action || "unknown").slice(0, 20)}`, targetType: "registration", targetId: String(b.registrationId) });
    if (b.action === "cancel") {
      const { cancelled, promoted } = await cancelAndPromote(b.registrationId);
      if (!cancelled) return NextResponse.json({ error: "not_found" }, { status: 404 });
      return NextResponse.json({ ok: true, cancelled, promoted });
    }
    if (b.action === "promote") {
      const registration = await promoteRegistration(b.registrationId);
      if (!registration) return NextResponse.json({ error: "not_found" }, { status: 404 });
      return NextResponse.json({ ok: true, registration });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  // Event updates
  if (!b.id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  const all = await getEventsForUpdate();
  const idx = all.findIndex((e) => e.id === b.id);
  if (idx === -1) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const oldImage = all[idx].image;
  all[idx] = {
    ...all[idx],
    title: b.title?.trim() ?? all[idx].title,
    description: b.description?.trim() ?? all[idx].description,
    date: b.date ? Number(b.date) : all[idx].date,
    endDate: b.endDate ? Number(b.endDate) : all[idx].endDate,
    location: b.location?.trim() ?? all[idx].location,
    // Optional text: an empty string means "clear it", not "leave it".
    price: b.price === undefined ? all[idx].price : b.price.trim() || undefined,
    capacity: b.capacity !== undefined ? Math.max(0, Math.floor(Number(b.capacity))) : all[idx].capacity,
    waitlistCapacity:
      b.waitlistCapacity !== undefined
        ? Math.max(0, Math.floor(Number(b.waitlistCapacity)))
        : all[idx].waitlistCapacity,
    type: ["class", "workshop", "vendor", "other"].includes(b.type) ? b.type : all[idx].type,
    image: b.image === undefined ? all[idx].image : b.image.trim() || undefined,
    published: b.published !== undefined ? !!b.published : all[idx].published,
  };
  await saveEvents(all);
  if (oldImage && oldImage !== all[idx].image) await cleanupMedia([oldImage]);
  return NextResponse.json({ ok: true, event: all[idx] });
}

async function DELETE_handler(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  const all = await getEventsForUpdate();
  const gone = all.find((e) => e.id === id);
  await saveEvents(all.filter((e) => e.id !== id));
  if (gone?.image) await cleanupMedia([gone.image]);
  return NextResponse.json({ ok: true });
}

// One audit-log entry per request (see lib/audit.ts).
export const POST = audited("event.create", "event", POST_handler);
export const PATCH = audited("event.update", "event", PATCH_handler);
export const DELETE = audited("event.delete", "event", DELETE_handler);
