import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import {
  getDiscounts,
  mutateDiscounts,
  normalizeCode,
  generateCode,
  type Discount,
} from "@/lib/discounts";
import { audited, auditDetail } from "@/lib/audit";

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const discounts = (await getDiscounts()).sort((a, b) => b.createdAt - a.createdAt);
  return NextResponse.json({ discounts });
}

async function POST_handler(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const code = body.code?.trim() ? normalizeCode(body.code) : generateCode();
  const value = Number(body.value);

  if (!Number.isFinite(value) || value <= 0) {
    return NextResponse.json({ error: "Enter a discount value greater than zero." }, { status: 400 });
  }
  if (body.type === "percentage" && value > 100) {
    return NextResponse.json({ error: "A percentage discount can't exceed 100%." }, { status: 400 });
  }

  const discount: Discount = {
    id: `disc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    code,
    type: body.type === "fixed" ? "fixed" : "percentage",
    value,
    label: body.label?.trim() || undefined,
    expiresAt: body.expiresAt ? Number(body.expiresAt) : undefined,
    maxUses: body.maxUses ? Math.max(1, Math.floor(Number(body.maxUses))) : undefined,
    perCustomerLimit: body.perCustomerLimit
      ? Math.max(1, Math.floor(Number(body.perCustomerLimit)))
      : undefined,
    minOrderAmount: body.minOrderAmount ? Number(body.minOrderAmount) : undefined,
    publicShop: body.publicShop ? true : undefined,
    active: body.active !== false,
    uses: 0,
    usedBy: [],
    createdAt: Date.now(),
  };

  // Check and add in one step, so two people can't create the same code at once.
  const added = await mutateDiscounts((all) => {
    if (all.some((d) => d.code === code)) return { data: null, result: false };
    return { data: [discount, ...all], result: true };
  });
  if (!added) return NextResponse.json({ error: `Code ${code} already exists.` }, { status: 400 });
  return NextResponse.json({ ok: true, discount });
}

async function PATCH_handler(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // { id, active } switches a code on/off; { id, publicShop } sets whether it works in the public shop.
  const { id, active, publicShop } = await req.json();
  const discount = await mutateDiscounts((all) => {
    const d = all.find((x) => x.id === id);
    if (!d) return { data: null, result: null };
    if (typeof publicShop === "boolean") d.publicShop = publicShop || undefined;
    else d.active = !!active;
    return { data: all, result: d };
  });
  if (!discount) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, discount });
}

/**
 * Edit a code after it's made: amount, type, label, last day, limits and the
 * public-shop setting. The code text itself stays (orders, use counts and any
 * ambassador link point at it); uses so far are kept.
 */
async function PUT_handler(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const value = Number(body.value);
  if (!Number.isFinite(value) || value <= 0) {
    return NextResponse.json({ error: "Enter a discount value greater than zero." }, { status: 400 });
  }
  const type: Discount["type"] = body.type === "fixed" ? "fixed" : "percentage";
  if (type === "percentage" && value > 100) {
    return NextResponse.json({ error: "A percentage discount can't exceed 100%." }, { status: 400 });
  }
  const whole = (v: unknown) => (v ? Math.max(1, Math.floor(Number(v))) : undefined);
  const expiresAt = body.expiresAt ? Number(body.expiresAt) : undefined;
  if (expiresAt !== undefined && !Number.isFinite(expiresAt)) {
    return NextResponse.json({ error: "That last day doesn't look right." }, { status: 400 });
  }
  const minOrderAmount = body.minOrderAmount ? Number(body.minOrderAmount) : undefined;
  if (minOrderAmount !== undefined && (!Number.isFinite(minOrderAmount) || minOrderAmount < 0)) {
    return NextResponse.json({ error: "The minimum order doesn't look right." }, { status: 400 });
  }
  const pick = (d: Discount) => ({ type: d.type, value: d.value, label: d.label, expiresAt: d.expiresAt, maxUses: d.maxUses, perCustomerLimit: d.perCustomerLimit, minOrderAmount: d.minOrderAmount, publicShop: d.publicShop });
  let before: ReturnType<typeof pick> | null = null;
  const discount = await mutateDiscounts((all) => {
    const d = all.find((x) => x.id === body.id);
    if (!d) return { data: null, result: null };
    before = pick(d);
    d.type = type;
    d.value = value;
    d.label = String(body.label || "").trim() || undefined;
    d.expiresAt = expiresAt;
    d.maxUses = whole(body.maxUses);
    d.perCustomerLimit = whole(body.perCustomerLimit);
    d.minOrderAmount = minOrderAmount;
    d.publicShop = body.publicShop ? true : undefined;
    return { data: all, result: d };
  });
  if (!discount) return NextResponse.json({ error: "not_found" }, { status: 404 });
  auditDetail({ targetId: discount.code, before: before || undefined, after: pick(discount) });
  return NextResponse.json({ ok: true, discount });
}

async function DELETE_handler(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  await mutateDiscounts((all) => ({ data: all.filter((d) => d.id !== id), result: undefined }));
  return NextResponse.json({ ok: true });
}

// One audit-log entry per request (see lib/audit.ts).
export const POST = audited("discount.create", "discount", POST_handler);
export const PATCH = audited("discount.toggle", "discount", PATCH_handler);
export const DELETE = audited("discount.delete", "discount", DELETE_handler);
export const PUT = audited("discount.edit", "discount", PUT_handler);
