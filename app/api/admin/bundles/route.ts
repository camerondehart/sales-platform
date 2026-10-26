import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { audited, auditDetail } from "@/lib/audit";
import { cleanBundle, createBundle, deleteBundle, listBundles, updateBundle } from "@/lib/bundleStore";
import { getProducts } from "@/lib/storage";
import { getOrders } from "@/lib/orders";
import { setSavings } from "@/lib/bundles";
import { effectivePrice, parsePrice } from "@/lib/pricing";

export const dynamic = "force-dynamic";

/** Mix-and-match bundles (Marketing → Mix & match bundles). */
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [bundles, products, orders] = await Promise.all([listBundles(), getProducts(), getOrders()]);
  const unit = new Map(products.map((p) => [p.id, parsePrice(effectivePrice(p))]));
  const stats = new Map<string, { orders: number; sets: number; savings: number; sales: number }>();
  for (const o of orders) {
    if (!o.bundles?.length || o.status === "cancelled") continue;
    for (const b of o.bundles) {
      const s = stats.get(b.id) || { orders: 0, sets: 0, savings: 0, sales: 0 };
      s.orders += 1;
      s.sets += b.sets;
      s.savings += b.savings;
      s.sales += o.total;
      stats.set(b.id, s);
    }
  }
  return NextResponse.json(
    {
      bundles: bundles.map((b) => ({
        ...b,
        missing: b.items.filter((i) => !unit.has(i.productId)).map((i) => i.productId),
        preview: setSavings(b, (id) => unit.get(id) ?? 0),
        stats: stats.get(b.id) || { orders: 0, sets: 0, savings: 0, sales: 0 },
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

async function body(req: Request): Promise<Record<string, unknown> | null> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

async function POST_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await body(req);
  if (!b) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const ids = new Set((await getProducts()).map((p) => p.id));
  const c = cleanBundle(b, ids);
  if (!c.ok) return NextResponse.json({ error: c.error }, { status: 400 });
  try {
    const row = await createBundle(c.value);
    auditDetail({ targetId: row.id, after: row });
    return NextResponse.json({ ok: true, bundle: row });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't save." }, { status: 400 });
  }
}

async function PATCH_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await body(req);
  const id = String(b?.id || "");
  if (!b || !id) return NextResponse.json({ error: "Which bundle?" }, { status: 400 });
  let patch: Parameters<typeof updateBundle>[1];
  if (Object.keys(b).every((k) => k === "id" || k === "active")) {
    patch = { active: b.active === true };
  } else {
    const c = cleanBundle(b, new Set((await getProducts()).map((p) => p.id)));
    if (!c.ok) return NextResponse.json({ error: c.error }, { status: 400 });
    patch = { ...c.value, startsAt: c.value.startsAt, endsAt: c.value.endsAt };
  }
  const r = await updateBundle(id, patch);
  if (!r) return NextResponse.json({ error: "That bundle no longer exists." }, { status: 404 });
  auditDetail({ targetId: id, before: r.before, after: r.after });
  return NextResponse.json({ ok: true, bundle: r.after });
}

async function DELETE_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") || "";
  const gone = await deleteBundle(id);
  if (!gone) return NextResponse.json({ error: "That bundle no longer exists." }, { status: 404 });
  auditDetail({ targetId: id, before: gone });
  return NextResponse.json({ ok: true });
}

export const POST = audited("bundle.create", "bundle", POST_handler);
export const PATCH = audited("bundle.update", "bundle", PATCH_handler);
export const DELETE = audited("bundle.delete", "bundle", DELETE_handler);
