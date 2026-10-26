import { NextResponse } from "next/server";
import { getApprovedVisitor } from "@/lib/auth";
import { findDiscountByCode, validateDiscount } from "@/lib/discounts";

// Preview a discount code at checkout. The authoritative check happens
// again during /api/checkout — this is purely for instant feedback.
export async function POST(req: Request) {
  const user = await getApprovedVisitor();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { code, subtotal } = await req.json();
  if (!code?.trim()) {
    return NextResponse.json({ ok: false, error: "Enter a code." }, { status: 400 });
  }

  const amountBase = Number(subtotal);
  if (!Number.isFinite(amountBase) || amountBase < 0) {
    return NextResponse.json({ ok: false, error: "Invalid cart total." }, { status: 400 });
  }

  const discount = await findDiscountByCode(code);
  const result = validateDiscount(discount, amountBase, user.id);

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 200 });
  }

  return NextResponse.json({
    ok: true,
    code: result.discount.code,
    type: result.discount.type,
    value: result.discount.value,
    amount: result.amount,
  });
}
