import { NextResponse } from "next/server";
import { tooMany } from "@/lib/publicLimits";
import { findDiscountByCode, validateDiscount, worksInPublicShop } from "@/lib/discounts";
import { ambassadorCodes } from "@/lib/ambassadors";
import { isEnabled } from "@/lib/flags";

// Public shop: preview a discount code (no account needed). Only codes marked
// "Also works in the public shop", or a live ambassador's code, apply here.
// The real check happens again at /api/retail/checkout.
export async function POST(req: Request) {
  // Stop anyone guessing codes by brute force.
  const limited = tooMany(req, "retail-discount", { max: 20, minutes: 10 });
  if (limited) return limited;
  const body = (await req.json().catch(() => ({}))) as { code?: string; subtotal?: number };
  const code = String(body.code || "").trim();
  if (!code) return NextResponse.json({ ok: false, error: "Enter a code." }, { status: 400 });
  const base = Number(body.subtotal);
  if (!Number.isFinite(base) || base < 0) return NextResponse.json({ ok: false, error: "Invalid cart total." }, { status: 400 });

  const found = await findDiscountByCode(code);
  const ambCodes = (await isEnabled("ambassador_pages").catch(() => false)) ? await ambassadorCodes() : new Set<string>();
  if (!found || !worksInPublicShop(found, ambCodes)) return NextResponse.json({ ok: false, error: "That code isn't valid in the shop." });
  // Per-customer limits are checked at checkout, once we know who's ordering.
  const r = validateDiscount(found, base, "");
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error });
  return NextResponse.json({ ok: true, code: r.discount.code, type: r.discount.type, value: r.discount.value, amount: r.amount });
}
