import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { audited, auditDetail } from "@/lib/audit";
import { deleteStore, getStores, moveStore, saveStore } from "@/lib/stores";
import { forgetPublicStores } from "@/lib/storesCache";

export const dynamic = "force-dynamic";

// Settings → Store locations. Staff only; every write is in the Activity log.

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ stores: await getStores() }, { headers: { "Cache-Control": "no-store" } });
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? b : null;
  } catch {
    return null;
  }
}

/** Create a store. */
async function POST_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await readBody(req);
  if (!body) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const r = await saveStore(undefined, body);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  forgetPublicStores();
  auditDetail({ targetId: r.store.id, after: { name: r.store.name, city: r.store.city, pin: r.store.pinSource || "none" } });
  return NextResponse.json({ ok: true, store: r.store });
}

/** Update a store ({ id, ...fields }) or move it ({ id, move: "up" | "down" }). */
async function PUT_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await readBody(req);
  const id = String(body?.id || "");
  if (!body || !id) return NextResponse.json({ error: "Which store?" }, { status: 400 });
  if (body.move === "up" || body.move === "down") {
    const moved = await moveStore(id, body.move);
    forgetPublicStores();
    auditDetail({ targetId: id, action: "store.move", after: { move: body.move } });
    return NextResponse.json({ ok: moved, stores: await getStores() });
  }
  const r = await saveStore(id, body);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  forgetPublicStores();
  auditDetail({
    targetId: id,
    before: r.before ? { name: r.before.name, active: r.before.active, lat: r.before.lat, lng: r.before.lng } : undefined,
    after: { name: r.store.name, active: r.store.active, lat: r.store.lat, lng: r.store.lng, pin: r.store.pinSource || "none" },
  });
  return NextResponse.json({ ok: true, store: r.store });
}

async function DELETE_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") || "";
  const gone = id ? await deleteStore(id) : null;
  if (!gone) return NextResponse.json({ error: "That store no longer exists." }, { status: 404 });
  forgetPublicStores();
  auditDetail({ targetId: id, before: { name: gone.name, city: gone.city } });
  return NextResponse.json({ ok: true });
}

export const POST = audited("store.create", "store", POST_handler);
export const PUT = audited("store.update", "store", PUT_handler);
export const DELETE = audited("store.delete", "store", DELETE_handler);
