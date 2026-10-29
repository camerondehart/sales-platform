import { NextResponse } from "next/server";
import { isEnabled } from "@/lib/flags";
import { cachedPublicStores } from "@/lib/storesCache";

export const dynamic = "force-dynamic";

// Public list of active stores (for /stores, product pop-ups and the
// Concierge). Empty while the "Store locator" switch is off.
export async function GET() {
  if (!(await isEnabled("store_locator").catch(() => false))) return NextResponse.json({ stores: [] });
  return NextResponse.json({ stores: await cachedPublicStores() }, { headers: { "Cache-Control": "no-store" } });
}
