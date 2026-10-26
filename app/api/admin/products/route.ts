import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { getProducts, mutateProducts, reorderProduct, updateProduct, updateProducts, type Product, type Promo, type ProductVisibility } from "@/lib/storage";
import { formatMoney, parsePrice } from "@/lib/pricing";
import { cleanVideoInput } from "@/lib/video";
import { cleanWeightOz } from "@/lib/shippingWeight";
import { audited, auditDetail } from "@/lib/audit";
import { cleanupMedia } from "@/lib/media";

function cleanVisibility(v: any): ProductVisibility {
  return v === "external" || v === "both" ? v : "internal";
}

// Validate a promo payload; returns a clean Promo or undefined.
function cleanPromo(raw: any): Promo | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const type = raw.type;
  const percent = Math.round(Number(raw.percent));
  if ((type !== "percent" && type !== "bogo") || !Number.isFinite(percent)) return undefined;
  if (percent < 1 || percent > 99) return undefined;
  return { type, percent };
}

// Reads must always be fresh: the dashboard confirms a write by re-reading
// the catalog, so a cached response would make every check fail.
export const dynamic = "force-dynamic";

// Current catalog. Used by the dashboard to refresh the list and to confirm
// that a change actually persisted.
export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(
    { products: await getProducts() },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}

async function POST_handler(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json()) as Partial<Product>;
  if (!body.name || !body.description || !body.price || !body.image) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  let video = "";
  try {
    video = cleanVideoInput((body as { video?: unknown }).video);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Bad video link." }, { status: 400 });
  }
  const product: Product = {
    id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: body.name,
    description: body.description,
    price: body.price,
    salePrice: body.salePrice?.trim() || undefined,
    promo: cleanPromo(body.promo),
    visibility: cleanVisibility(body.visibility),
    isBundle: !!body.isBundle,
    bundleProducts: Array.isArray(body.bundleProducts) ? body.bundleProducts : undefined,
    bundleDiscount: body.bundleDiscount ? Number(body.bundleDiscount) : undefined,
    image: body.image,
    video: video || undefined,
    category: body.category,
    weightOz: cleanWeightOz((body as { weightOz?: unknown }).weightOz),
    createdAt: Date.now(),
  };
  try {
    await mutateProducts((products) => ({ data: [product, ...products], result: undefined }));
  } catch (err) {
    console.error("Add product aborted: catalog unreadable", err);
    return NextResponse.json({ error: "Couldn't read the catalog to add safely. Please try again." }, { status: 503 });
  }
  return NextResponse.json({ product });
}

async function DELETE_handler(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }
  const gone = await mutateProducts((products) => {
    const hit = products.find((p) => p.id === id);
    return { data: hit ? products.filter((p) => p.id !== id) : null, result: hit };
  });
  // Delete its uploaded photo/video if nothing else uses them.
  if (gone) await cleanupMedia([gone.image, gone.video]);
  return NextResponse.json({ ok: true });
}

async function PATCH_handler(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json()) as {
    id?: string;
    direction?: "up" | "down";
    ids?: string[];
    visibility?: string;
    pricing?: { mode?: string; percent?: number; salePrice?: string | number };
    /** Shipping weights: product id → ounces (0 or null clears it). */
    weights?: Record<string, unknown>;
  };

  // Shipping weights for many products at once (Products → Shipping weights).
  // Touches only weightOz, in one write.
  if (body.weights && typeof body.weights === "object" && !Array.isArray(body.weights)) {
    const w = body.weights;
    const ids = Object.keys(w).filter(Boolean).slice(0, 500);
    if (ids.length === 0) return NextResponse.json({ error: "no_products" }, { status: 400 });
    const was: Array<{ id: string; name: string; weightOz?: number }> = [];
    const updated = await updateProducts(ids, (p) => {
      was.push({ id: p.id, name: p.name, weightOz: p.weightOz });
      return { weightOz: cleanWeightOz(w[p.id]) };
    });
    if (updated.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
    auditDetail({ action: "product.weights", before: was, after: updated.map((p) => ({ id: p.id, name: p.name, weightOz: p.weightOz })) });
    return NextResponse.json({ ok: true, products: updated });
  }

  // Bulk sale change — touches ONLY the pricing fields, in one write, so it
  // can never undo an unrelated edit (name, description, image…) made since.
  //   percent    → X% off (clears any fixed sale price, which would win)
  //   bogo       → buy one, get one X% off (keeps a fixed sale price)
  //   sale_price → fixed sale price (clears a %-off promo; keeps BOGO)
  //   clear      → back to the regular price, no promotion
  if (Array.isArray(body.ids) && body.pricing) {
    const ids = body.ids.filter((x): x is string => typeof x === "string" && !!x);
    if (ids.length === 0) return NextResponse.json({ error: "no_products" }, { status: 400 });
    const { mode } = body.pricing;
    const percent = Math.round(Number(body.pricing.percent));
    let changesFor: (p: Product) => Partial<Product>;
    if (mode === "percent" || mode === "bogo") {
      if (!Number.isFinite(percent) || percent < 1 || percent > 99) {
        return NextResponse.json({ error: "The percentage must be between 1 and 99." }, { status: 400 });
      }
      changesFor =
        mode === "percent"
          ? () => ({ promo: { type: "percent", percent }, salePrice: undefined })
          : () => ({ promo: { type: "bogo", percent } });
    } else if (mode === "sale_price") {
      const amount = parsePrice(String(body.pricing.salePrice ?? ""));
      if (!(amount > 0)) return NextResponse.json({ error: "Enter a sale price above $0." }, { status: 400 });
      const salePrice = formatMoney(Math.round(amount * 100) / 100);
      changesFor = (p) => ({ salePrice, promo: p.promo?.type === "bogo" ? p.promo : undefined });
    } else if (mode === "clear") {
      changesFor = () => ({ salePrice: undefined, promo: undefined });
    } else {
      return NextResponse.json({ error: "Unknown pricing mode." }, { status: 400 });
    }
    const was: Array<{ id: string; name: string; salePrice?: string; promo?: Promo }> = [];
    const updated = await updateProducts(ids, (p) => {
      was.push({ id: p.id, name: p.name, salePrice: p.salePrice, promo: p.promo });
      return changesFor(p);
    });
    if (updated.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
    auditDetail({
      action: `product.pricing_${mode}`,
      before: was,
      after: updated.map((p) => ({ id: p.id, name: p.name, salePrice: p.salePrice, promo: p.promo })),
    });
    return NextResponse.json({ ok: true, products: updated });
  }

  // Bulk visibility change — one request, one write, no matter how many
  // products. Sending these one at a time raced and silently lost changes.
  if (Array.isArray(body.ids)) {
    const ids = body.ids.filter((x): x is string => typeof x === "string" && !!x);
    if (ids.length === 0) {
      return NextResponse.json({ error: "no_products" }, { status: 400 });
    }
    const visibility = cleanVisibility(body.visibility);
    const updated = await updateProducts(ids, () => ({ visibility, retail: undefined }));
    if (updated.length === 0) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, products: updated });
  }

  const { id, direction } = body;
  if (!id || (direction !== "up" && direction !== "down")) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  await reorderProduct(id, direction);
  return NextResponse.json({ ok: true });
}

async function PUT_handler(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json()) as Partial<Product> & { id?: string };
  if (!body.id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }
  if (!body.name || !body.description || !body.price || !body.image) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  let videoChange: string | null = null;
  if ((body as { video?: unknown }).video !== undefined) {
    try {
      videoChange = cleanVideoInput((body as { video?: unknown }).video);
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Bad video link." }, { status: 400 });
    }
  }
  let prev: Product | undefined;
  try {
    prev = (await getProducts()).find((p) => p.id === body.id);
    if (prev) auditDetail({ before: prev });
  } catch {
    /* best effort */
  }
  const updated = await updateProduct(body.id, {
    name: body.name,
    description: body.description,
    price: body.price,
    salePrice: body.salePrice?.trim() || undefined,
    promo: cleanPromo(body.promo),
    visibility: cleanVisibility(body.visibility),
    isBundle: !!body.isBundle,
    // Only change these when the request includes them: the dashboard's edit
    // form doesn't send them, and a normal edit must not wipe what's there.
    ...(body.bundleProducts !== undefined
      ? { bundleProducts: Array.isArray(body.bundleProducts) ? body.bundleProducts : undefined }
      : {}),
    ...(body.bundleDiscount !== undefined ? { bundleDiscount: body.bundleDiscount ? Number(body.bundleDiscount) : undefined } : {}),
    ...(videoChange !== null ? { video: videoChange || undefined } : {}),
    // Only when sent (older callers don't know about weights).
    ...((body as { weightOz?: unknown }).weightOz !== undefined ? { weightOz: cleanWeightOz((body as { weightOz?: unknown }).weightOz) } : {}),
    image: body.image,
    category: body.category,
  });
  if (!updated) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  // A replaced or cleared upload is deleted if nothing else uses it.
  if (prev) await cleanupMedia([prev.image !== updated.image ? prev.image : null, prev.video !== updated.video ? prev.video : null]);
  return NextResponse.json({ product: updated });
}

// One audit-log entry per request (see lib/audit.ts).
export const POST = audited("product.create", "product", POST_handler);
export const DELETE = audited("product.delete", "product", DELETE_handler);
export const PATCH = audited("product.bulk_update", "product", PATCH_handler);
export const PUT = audited("product.update", "product", PUT_handler);
