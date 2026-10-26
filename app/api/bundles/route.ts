import { NextResponse } from "next/server";
import { getApprovedVisitor } from "@/lib/auth";
import { liveBundles } from "@/lib/bundleStore";
import { getProducts, isExternal, isInternal } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Bundles the cart can preview. Members see bundles made of member-shop
 * products; everyone else only bundles made entirely of public-shop products
 * (so member-only product names never leak). Checkout recalculates anyway.
 */
export async function GET() {
  try {
    const bundles = await liveBundles();
    if (bundles.length === 0) return NextResponse.json({ bundles: [] });
    const products = await getProducts();
    const member = !!(await getApprovedVisitor());
    const ok = new Set(products.filter((p) => (member ? isInternal(p) : isExternal(p))).map((p) => p.id));
    const visible = bundles
      .filter((b) => b.items.every((i) => ok.has(i.productId)))
      .map(({ id, name, items, type, value, active, startsAt, endsAt, createdAt, updatedAt }) => ({ id, name, items, type, value, active, startsAt, endsAt, createdAt, updatedAt }));
    return NextResponse.json({ bundles: visible }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ bundles: [] });
  }
}
