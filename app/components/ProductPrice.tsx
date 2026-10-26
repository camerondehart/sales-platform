"use client";

import type { Product } from "@/lib/storage";
import { effectivePrice, onSale, discountPercent, promoLabel } from "@/lib/pricing";

/**
 * Sale / BOGO / bundle chips, pinned to the corner of the product image.
 *
 * They used to sit inside the price pill, which made a narrow phone card read
 * as one cramped run of text. On the image they're legible at a glance and
 * cost the layout nothing.
 */
export function ProductFlags({ product }: { product: Product }) {
  const pct = discountPercent(product);
  const bogo = product.promo?.type === "bogo" && product.promo.percent > 0;
  if (!pct && !bogo && !product.isBundle) return null;
  return (
    <div className="card-flags" aria-hidden="true">
      {pct !== null && <span className="flag flag-sale">−{pct}%</span>}
      {pct === null && onSale(product) && <span className="flag flag-sale">Sale</span>}
      {bogo && <span className="flag flag-bogo">BOGO −{product.promo!.percent}%</span>}
      {product.isBundle && <span className="flag flag-bundle">Bundle</span>}
    </div>
  );
}

/** "$24.99", or the old price struck through above the new one when reduced. */
export function PriceTag({ product }: { product: Product }) {
  const sale = onSale(product);
  const label = promoLabel(product);
  return (
    <div className={`card-price${sale ? " is-sale" : ""}`}>
      {sale && (
        <span className="price-was">
          <span className="sr-only">Was </span>
          {product.price}
        </span>
      )}
      <span className="price-now">{effectivePrice(product)}</span>
      {label && <span className="sr-only">{label}</span>}
    </div>
  );
}
