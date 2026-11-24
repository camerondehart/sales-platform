import { NextResponse } from "next/server";
import { adminActor, isAdmin } from "@/lib/auth";
import { audited, auditDetail } from "@/lib/audit";
import { getCatalog } from "@/lib/storage";
import { createSale, deleteSale, endSale, listSales, updateSale } from "@/lib/siteSales";
import { coveredCount, saleState, scopeLabel } from "@/lib/siteSaleRules";
import { isEnabled } from "@/lib/flags";

export const dynamic = "force-dynamic";

/**
 * Marketing → Sitewide sales (lib/siteSales.ts). Times are epoch ms; the
 * dashboard and the Concierge convert from Pacific.
 *   POST   { name, percent, startsAt, endsAt, scope, productIds?, category? }  schedule
 *   PUT    { id, ...same }                                                     change (not once it's over)
 *   PATCH  { id, action: "end" }                                               end now / cancel before it starts
 *   DELETE ?id=                                                                remove from the list (not while running)
 */
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [sales, products, on] = await Promise.all([listSales(), getCatalog(), isEnabled("scheduled_sales")]);
  const now = Date.now();
  return NextResponse.json(
    {
      on,
      sales: sales.map((s) => ({ ...s, state: saleState(s, now), covers: coveredCount(s, products), scopeText: scopeLabel(s) })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

async function POST_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const out = await createSale(body, await getCatalog(), await adminActor());
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: 400 });
  auditDetail({ targetId: out.sale.id, after: out.sale });
  return NextResponse.json({ ok: true, sale: out.sale });
}

async function PUT_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const out = await updateSale(String(body.id || ""), body, await getCatalog());
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status || 400 });
  auditDetail({ targetId: out.sale.id, before: out.before, after: out.sale });
  return NextResponse.json({ ok: true, sale: out.sale });
}

async function PATCH_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (body.action !== "end") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const out = await endSale(String(body.id || ""));
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status || 400 });
  auditDetail({ targetId: out.sale.id, before: out.before, after: out.sale, action: saleState(out.sale) === "cancelled" ? "sale.cancel" : "sale.end" });
  return NextResponse.json({ ok: true, sale: out.sale, state: saleState(out.sale) });
}

async function DELETE_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") || "";
  const s = (await listSales()).find((x) => x.id === id);
  if (!s) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (saleState(s) === "running") return NextResponse.json({ error: "That sale is running. End it first." }, { status: 400 });
  await deleteSale(id);
  auditDetail({ targetId: id, before: s });
  return NextResponse.json({ ok: true });
}

// One Activity log entry per request (lib/audit.ts), under Discounts & sales.
export const POST = audited("sale.schedule", "discount", POST_handler);
export const PUT = audited("sale.edit", "discount", PUT_handler);
export const PATCH = audited("sale.end", "discount", PATCH_handler);
export const DELETE = audited("sale.delete", "discount", DELETE_handler);
