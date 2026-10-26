import { getProducts } from "@/lib/storage";
import { qrPng } from "@/lib/qrPng";

export const dynamic = "force-dynamic";

/**
 * PNG QR code for a product's permanent link (/p/<id>), for emails, social
 * posts and printing: /api/qr/product/<id>  (?size=s|m|l). Only real product
 * ids — it can't be used to make codes for any other address.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const id = String(params.id || "").replace(/\.png$/i, "").slice(0, 120);
  const p = (await getProducts().catch(() => [])).find((x) => x.id === id);
  if (!p) return new Response("Not found", { status: 404 });
  const site = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || new URL(req.url).origin;
  const size = new URL(req.url).searchParams.get("size");
  const png = qrPng(`${site}/p/${encodeURIComponent(p.id)}`, { scale: size === "l" ? 16 : size === "s" ? 5 : 8 });
  return new Response(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400", "Content-Disposition": `inline; filename="qr-${p.id}.png"` },
  });
}
