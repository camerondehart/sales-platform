/**
 * Mix-and-match bundles — cart pricing shared by the browser (cart preview)
 * and the server (what is actually charged). No server-only imports here.
 *
 * A bundle is a set of products with quantities, e.g. Sacred Immunity +
 * Revive + Thrive + Harmony capsules, one of each, 20% off.
 *
 * Rules:
 *  - Applies once per FULL set in the cart. 2 full sets → applied twice.
 *    A partial set gets nothing.
 *  - Percent bundles take the percent off the prices the customer would
 *    otherwise pay (sale prices are respected). "Set price" bundles charge
 *    that price for the set, and only if it's actually cheaper.
 *  - When bundles overlap, the cart gets whichever combination of full sets
 *    saves the customer the most (the best bundle wins).
 *  - Units in a bundle don't also get BOGO or the cart-wide "buy N, save X%"
 *    rule: that rule counts and discounts only the items outside bundles.
 *  - A bundle OR a discount code, never both (enforced at checkout).
 *    Loyalty points still apply.
 *
 * With no bundles in play, the result is exactly the old calculation.
 */

import { effectivePrice, lineDiscount, parsePrice, type Priced } from "./pricing";

export type BundleItem = { productId: string; qty: number };
export type Bundle = {
  id: string;
  name: string;
  items: BundleItem[];
  /** percent: `value`% off the set. price: the set costs `value` dollars. */
  type: "percent" | "price";
  value: number;
  startsAt?: number;
  endsAt?: number;
  active: boolean;
  createdAt: number;
  updatedAt: number;
};

export type CartLine = { product: Priced & { id: string }; quantity: number };
export type CartRule = { enabled: boolean; minItems: number; percent: number } | null;

export type AppliedBundle = { id: string; name: string; sets: number; savings: number };

export type CartPricing = {
  /** Sum of unit price × quantity (sale prices included). */
  subtotal: number;
  /** BOGO savings (on units outside bundles). */
  promoSavings: number;
  bundles: AppliedBundle[];
  bundleSavings: number;
  /** Items the cart-wide rule looked at (outside bundles). */
  ruleItems: number;
  ruleSavings: number;
  /** promo + bundle + rule savings. */
  discount: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function bundleLive(b: Bundle, now = Date.now()): boolean {
  return b.active && (!b.startsAt || b.startsAt <= now) && (!b.endsAt || b.endsAt > now) && b.items.length >= 2;
}

/** Savings for ONE full set, given unit prices. */
export function setSavings(b: Bundle, unit: (productId: string) => number): { cost: number; savings: number } {
  const cost = r2(b.items.reduce((n, i) => n + unit(i.productId) * i.qty, 0));
  const savings = b.type === "percent" ? r2(cost * (Math.min(90, Math.max(0, b.value)) / 100)) : r2(Math.max(0, cost - Math.max(0, b.value)));
  return { cost, savings };
}

export function priceCart(lines: CartLine[], bundles: Bundle[], rule: CartRule, now = Date.now()): CartPricing {
  const unitOf = new Map<string, number>();
  const have = new Map<string, number>();
  let subtotal = 0;
  for (const l of lines) {
    const unit = parsePrice(effectivePrice(l.product));
    unitOf.set(l.product.id, unit);
    have.set(l.product.id, (have.get(l.product.id) || 0) + l.quantity);
    subtotal += unit * l.quantity;
  }
  const unit = (id: string) => unitOf.get(id) ?? 0;

  // Pick the combination of full sets that saves the customer the most.
  // Carts are small, so this tries the combinations (bounded); if a cart is
  // ever huge it falls back to "best bundle first, then the next best".
  const live = bundles
    .filter((b) => bundleLive(b, now) && b.items.every((i) => unitOf.has(i.productId) && i.qty >= 1))
    .map((b) => ({ b, per: setSavings(b, unit).savings }))
    .filter((x) => x.per > 0)
    .sort((a, b) => b.per - a.per || a.b.createdAt - b.b.createdAt || (a.b.id < b.b.id ? -1 : 1));
  const maxSets = (b: Bundle, left: Map<string, number>) => Math.min(...b.items.map((i) => Math.floor((left.get(i.productId) || 0) / i.qty)));
  const take = (b: Bundle, n: number, left: Map<string, number>) => {
    const next = new Map(left);
    for (const i of b.items) next.set(i.productId, (next.get(i.productId) || 0) - i.qty * n);
    return next;
  };
  let bestTotal = -1;
  let bestPlan: number[] = [];
  let budget = 20_000;
  const search = (k: number, left: Map<string, number>, plan: number[], total: number) => {
    if (budget-- <= 0) return;
    if (k === live.length) {
      if (total > bestTotal + 0.001) {
        bestTotal = total;
        bestPlan = plan.slice();
      }
      return;
    }
    for (let n = maxSets(live[k].b, left); n >= 0; n--) {
      plan.push(n);
      search(k + 1, n ? take(live[k].b, n, left) : left, plan, r2(total + live[k].per * n));
      plan.pop();
    }
  };
  search(0, have, [], 0);
  if (budget <= 0) {
    // Search cut short: also try greedy (best per-set saving first) and keep the better.
    let left = new Map(have);
    const greedy = live.map(({ b }) => {
      const n = Math.max(0, maxSets(b, left));
      if (n) left = take(b, n, left);
      return n;
    });
    const greedyTotal = r2(greedy.reduce((t, n, k) => t + live[k].per * n, 0));
    if (greedyTotal > bestTotal) bestPlan = greedy;
  }
  const remaining = new Map(have);
  const applied: AppliedBundle[] = [];
  live.forEach(({ b, per }, k) => {
    const n = bestPlan[k] || 0;
    if (n <= 0) return;
    for (const i of b.items) remaining.set(i.productId, (remaining.get(i.productId) || 0) - i.qty * n);
    applied.push({ id: b.id, name: b.name, sets: n, savings: r2(per * n) });
  });
  const bundleSavings = r2(applied.reduce((n, a) => n + a.savings, 0));

  // BOGO and the cart rule on the units outside bundles (line by line, as before).
  const covered = new Map<string, number>();
  for (const [id, q] of Array.from(have.entries())) covered.set(id, q - (remaining.get(id) || 0));
  let promo = 0;
  let outsideItems = 0;
  let outsideValue = 0;
  for (const l of lines) {
    const take = Math.min(l.quantity, covered.get(l.product.id) || 0);
    covered.set(l.product.id, (covered.get(l.product.id) || 0) - take);
    const q = l.quantity - take;
    if (q <= 0) continue;
    promo += lineDiscount(l.product, q);
    outsideItems += q;
    outsideValue += unit(l.product.id) * q;
  }
  promo = r2(promo);
  const ruleSavings =
    rule && rule.enabled && outsideItems >= rule.minItems ? r2(Math.max(0, outsideValue - promo) * (rule.percent / 100)) : 0;

  return {
    subtotal,
    promoSavings: promo,
    bundles: applied,
    bundleSavings,
    ruleItems: outsideItems,
    ruleSavings,
    discount: r2(promo + bundleSavings + ruleSavings),
  };
}

/** "Add Revive and Thrive to get 20% off the set" — closest bundle the cart is working towards. */
export function nextBundleHint(lines: CartLine[], bundles: Bundle[], names: Map<string, string>, now = Date.now()): string | null {
  const have = new Map<string, number>();
  for (const l of lines) have.set(l.product.id, (have.get(l.product.id) || 0) + l.quantity);
  let best: { b: Bundle; missing: string[] } | null = null;
  for (const b of bundles) {
    if (!bundleLive(b, now)) continue;
    const inCart = b.items.filter((i) => (have.get(i.productId) || 0) > 0).length;
    if (inCart === 0) continue;
    const missing = b.items.filter((i) => (have.get(i.productId) || 0) < i.qty).map((i) => names.get(i.productId) || "");
    if (missing.length === 0 || missing.some((m) => !m)) continue;
    if (!best || missing.length < best.missing.length) best = { b, missing };
  }
  if (!best) return null;
  const list = best.missing.length === 1 ? best.missing[0] : `${best.missing.slice(0, -1).join(", ")} and ${best.missing[best.missing.length - 1]}`;
  return `Add ${list} to complete the ${best.b.name} bundle (${bundleOfferLabel(best.b)}).`;
}

export function bundleOfferLabel(b: Pick<Bundle, "type" | "value">): string {
  return b.type === "percent" ? `${b.value}% off the set` : `set price $${b.value % 1 === 0 ? b.value.toFixed(0) : b.value.toFixed(2)}`;
}
