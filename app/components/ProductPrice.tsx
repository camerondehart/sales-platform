"use client";

import type { Product } from "@/lib/storage";
import { effectivePrice, onSale, discountPercent, promoLabel, cashDeal } from "@/lib/pricing";

/**
 * Sale / BOGO / bundle chips, pinned to the corner of the product image.
 *
 * They used to sit inside the price pill, which made a narrow phone card read
 * as one cramped run of text. On the image they're legible at a glance and
 * cost the layout nothing.
 */
export function ProductFlags({ product }: { product: Product }) {
  const pct = discountPercent(product);
  // A cash-pickup-only BOGO isn't shown as a BOGO: the cash chip below says it.
  const bogo = !product.cashOnly && product.promo?.type === "bogo" && product.promo.percent > 0;
  const cash = !!cashDeal(product);
  if (!pct && !bogo && !cash && !product.isBundle && !product.restocking) return null;
  return (
    <div className="card-flags" aria-hidden="true">
      {pct !== null && <span className="flag flag-sale">−{pct}%</span>}
      {pct === null && onSale(product) && <span className="flag flag-sale">Sale</span>}
      {bogo && <span className="flag flag-bogo">BOGO −{product.promo!.percent}%</span>}
      {cash && <span className="flag flag-cash">💵 Cash pickup deal</span>}
      {product.isBundle && <span className="flag flag-bundle">Bundle</span>}
      {product.restocking && <span className="flag flag-restock">Currently restocking</span>}
    </div>
  );
}

/** Stock counts at 0: it can still be ordered, it just waits for new stock. */
export function RestockNote({ product, compact }: { product: Product; compact?: boolean }) {
  if (!product.restocking) return null;
  return (
    <div className={`restock-note${compact ? " is-compact" : ""}`} role="note">
      <strong>Currently restocking.</strong>
      {compact ? " Ships as soon as it's back in." : " You can still order it: we'll send it as soon as new stock arrives."}
    </div>
  );
}

/** "$24.99", or the old price struck through above the new one when reduced; plus "$32 cash at pickup" for a cash-only sale. */
export function PriceTag({ product }: { product: Product }) {
  const sale = onSale(product);
  const label = promoLabel(product);
  const cash = cashDeal(product);
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
      {cash && <span className="price-cash">💵 {cash}</span>}
    </div>
  );
}
