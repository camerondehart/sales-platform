/**
 * Product pricing — the single source of truth for what something costs.
 *
 * This module is deliberately free of `fs` and any server-only import, so
 * client components can use it directly. Everything that prices a product —
 * the member gallery, the public shop, and both checkout routes — goes
 * through here, which is what stops the displayed price and the charged
 * price from drifting apart.
 */

export type Promo = { type: "percent" | "bogo"; percent: number };

export type Priced = {
  price: string;
  salePrice?: string;
  promo?: Promo;
  /** The sale price / promo only applies to Local pickup paid in cash (see asCash). */
  cashOnly?: boolean;
};

/**
 * A cash-pickup-only product prices at its regular price everywhere, except
 * where the order is Local pickup + Pay cash: those callers price `asCash(p)`.
 * So anything that doesn't know about cash deals can never give one away.
 */
const deal = <T extends Priced>(p: T): Priced => (p.cashOnly ? { price: p.price } : p);

/** The product as priced for a Local pickup + Pay cash order (its cash-only sale applies). */
export function asCash<T extends Priced>(p: T): T {
  return p.cashOnly ? { ...p, cashOnly: false } : p;
}

export function parsePrice(price: string): number {
  return parseFloat(String(price).replace(/[^0-9.-]/g, "")) || 0;
}

export function formatMoney(n: number): string {
  return n % 1 === 0 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`;
}

/**
 * The unit price a customer actually pays:
 * a fixed sale price wins, then a percent-off promo, then the regular price.
 */
export function effectivePrice(product: Priced): string {
  const p = deal(product);
  if (p.salePrice?.trim()) return p.salePrice.trim();
  if (p.promo?.type === "percent" && p.promo.percent > 0) {
    return formatMoney(parsePrice(p.price) * (1 - p.promo.percent / 100));
  }
  return p.price;
}

/**
 * Quantity-based discount for a cart line (currently BOGO):
 * every 2nd item gets promo.percent off the unit price.
 */
export function lineDiscount(product: Priced, quantity: number): number {
  const p = deal(product);
  if (p.promo?.type === "bogo" && p.promo.percent > 0 && quantity >= 2) {
    const unit = parsePrice(effectivePrice(p));
    return Math.round(Math.floor(quantity / 2) * unit * (p.promo.percent / 100) * 100) / 100;
  }
  return 0;
}

/** Is the unit price itself reduced? (BOGO is not — it's a quantity deal.) */
export function onSale(product: Priced): boolean {
  const p = deal(product);
  return !!p.salePrice?.trim() || (p.promo?.type === "percent" && p.promo.percent > 0);
}

/** Whole-number percent off the unit price, or null when there's no saving. */
export function discountPercent(product: Priced): number | null {
  const p = deal(product);
  if (!onSale(p)) return null;
  const was = parsePrice(p.price);
  const now = parsePrice(effectivePrice(p));
  if (was <= 0 || now <= 0 || now >= was) return null;
  const pct = Math.round(((was - now) / was) * 100);
  return pct > 0 ? pct : null;
}

/** Short human label for a promo, e.g. "BOGO 50% off". */
export function promoLabel(product: Priced): string | null {
  const p = deal(product);
  if (p.promo?.type === "bogo" && p.promo.percent > 0) return `BOGO ${p.promo.percent}% off`;
  if (p.promo?.type === "percent" && p.promo.percent > 0) return `${p.promo.percent}% off`;
  return null;
}

/**
 * The cash-pickup deal on a cash-only product, e.g. "$32 cash at pickup" or
 * "BOGO 50% off, cash at pickup". Null when the product has no cash-only deal.
 */
export function cashDeal(p: Priced): string | null {
  if (!p.cashOnly) return null;
  const c = asCash(p);
  if (onSale(c)) return `${effectivePrice(c)} cash at pickup`;
  const label = promoLabel(c);
  return label ? `${label}, cash at pickup` : null;
}
