/**
 * Parcel weight for a shipping label, worked out from the shipping weight
 * staff enter on each product (Products → Shipping weights) plus the box
 * and packing allowance (Settings: packagingOz). No server-only imports, so
 * the dashboard can show the same sum it will use.
 */

export type WeighProduct = { id: string; name: string; weightOz?: number; isBundle?: boolean; bundleProducts?: string[] };
export type WeighItem = { productId: string; productName: string; quantity: number };

export type OrderWeight = {
  /** Total in ounces (rounded up to 0.1), or null when any item has no weight. */
  oz: number | null;
  /** The sum, item by item, e.g. "2 × Harmony Blend (4 oz)". */
  parts: string[];
  /** Items with no weight set. */
  missing: string[];
  packagingOz: number;
};

/** Box & padding used until someone weighs theirs and saves it (Products → Shipping weights). */
export const DEFAULT_PACKAGING_OZ = 3.5;

/** The box & packing weight to use: what's saved, or the default when it's never been set. */
export function packagingOzOf(saved: unknown): number {
  const n = Number(saved);
  return saved === undefined || saved === null || saved === "" || !Number.isFinite(n) ? DEFAULT_PACKAGING_OZ : Math.max(0, n);
}

const validOz = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/** One unit's weight: its own, or (for a fixed bundle) the sum of its parts. */
function unitOz(p: WeighProduct | undefined, byId: Map<string, WeighProduct>): number | null {
  if (!p) return null;
  if (validOz(p.weightOz)) return p.weightOz;
  if (p.isBundle && p.bundleProducts?.length) {
    let sum = 0;
    for (const id of p.bundleProducts) {
      const w = byId.get(id)?.weightOz;
      if (!validOz(w)) return null;
      sum += w;
    }
    return sum;
  }
  return null;
}

export function orderWeight(items: WeighItem[], products: WeighProduct[], packagingOz = 0): OrderWeight {
  const byId = new Map(products.map((p) => [p.id, p]));
  const pack = validOz(packagingOz) ? packagingOz : 0;
  let total = pack;
  const parts: string[] = [];
  const missing: string[] = [];
  for (const it of items || []) {
    const w = unitOz(byId.get(it.productId), byId);
    if (w === null) {
      missing.push(it.productName);
      continue;
    }
    total += w * it.quantity;
    parts.push(`${it.quantity} × ${it.productName} (${+w.toFixed(2)} oz)`);
  }
  if (pack) parts.push(`box & packing (${+pack.toFixed(2)} oz)`);
  return { oz: missing.length ? null : Math.max(0.1, Math.ceil(total * 10) / 10), parts, missing, packagingOz: pack };
}

/** Clean a weight typed by staff: ounces, 0–1120 (70 lb, the USPS limit). Empty/0 = not set. */
export function cleanWeightOz(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(1120, Math.round(n * 100) / 100) : undefined;
}
