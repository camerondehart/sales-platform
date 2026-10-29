import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { getProducts } from "@/lib/storage";
import { cleanQty, getStock, setStock } from "@/lib/stock";
import { audited, auditDetail } from "@/lib/audit";

// Products → Stock counts. GET the counts; PUT { counts: { productId: qty | null } }
// sets several at once (null = stop counting that product).
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ stock: Object.fromEntries(await getStock()) }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

async function PUT_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { counts?: Record<string, unknown> };
  const raw = body.counts && typeof body.counts === "object" && !Array.isArray(body.counts) ? body.counts : null;
  const ids = raw ? Object.keys(raw).filter(Boolean).slice(0, 500) : [];
  if (!raw || ids.length === 0) return NextResponse.json({ error: "No counts to save." }, { status: 400 });
  const known = new Map((await getProducts()).map((p) => [p.id, p]));
  const changes: Record<string, number | null> = {};
  for (const id of ids) {
    const p = known.get(id);
    if (!p) return NextResponse.json({ error: "One of those products no longer exists." }, { status: 404 });
    if (p.isBundle) return NextResponse.json({ error: `${p.name} is a bundle: it uses the counts of the products in it.` }, { status: 400 });
    const q = cleanQty(raw[id]);
    if (q === "bad") return NextResponse.json({ error: `The count for ${p.name} must be a whole number from 0 up.` }, { status: 400 });
    changes[id] = q;
  }
  const { before, after } = await setStock(changes);
  const named = (m: Record<string, number | null>) => Object.entries(m).map(([id, qty]) => ({ id, name: known.get(id)?.name, qty }));
  auditDetail({ before: named(before), after: named(after) });
  return NextResponse.json({ ok: true, stock: Object.fromEntries(await getStock()) });
}

export const PUT = audited("product.stock", "product", PUT_handler);
