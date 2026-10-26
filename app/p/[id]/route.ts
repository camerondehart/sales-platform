import { NextResponse } from "next/server";
import { getProducts, isExternal, isInternal } from "@/lib/storage";
import { isBot, recordCounter } from "@/lib/traffic";

export const dynamic = "force-dynamic";

/**
 * Permanent product link used by printed QR codes: /p/<product id>.
 *
 * The id never changes, so a printed code keeps working even if the product
 * is renamed, repriced or moved between shops — this route works out where
 * the product lives *today* and sends the visitor there with it open.
 * (Temporary redirect on purpose: browsers mustn't cache the destination.)
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const id = String(params.id || "").slice(0, 120);
  const base = new URL(req.url);
  let dest = "/retail";
  try {
    const p = (await getProducts()).find((x) => x.id === id);
    if (p && isExternal(p)) dest = `/retail?product=${encodeURIComponent(p.id)}`;
    else if (p && isInternal(p)) dest = `/gallery?product=${encodeURIComponent(p.id)}`;
  } catch (err) {
    console.error("[p] product lookup failed", err);
  }
  if (!isBot(req.headers.get("user-agent") || "")) {
    recordCounter("e:qr_scan");
    recordCounter(`qr:${id}`);
  }
  return NextResponse.redirect(new URL(dest, base.origin), 307);
}
