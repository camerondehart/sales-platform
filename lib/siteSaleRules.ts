/**
 * Scheduled sitewide sales: one percentage off every
 * product, a chosen set, or one category, from a start to an end time
 * (brand.timezone in the dashboard), without editing each product.
 *
 * Pure rules, no storage, so the dashboard and unit check can use them.
 * Storage + the overlay on product reads live in lib/siteSales.ts; the price
 * itself is worked out in lib/pricing.ts (`sitePromo`), so the shop, cart,
 * checkout, invoices and Concierge all charge the same:
 *  - the customer gets the better of the sitewide sale and the product's own
 *    sale (never both stacked);
 *  - products with their own BOGO deal keep the BOGO;
 *  - at most PERCENT_OFF_CAP ($100) off a unit, like any percent sale;
 *  - members-only products are included when they're in scope (they still
 *    only show in the members' shop).
 */

import { brand } from "./brand";

export type SiteSaleScope = "all" | "products" | "category";

export type SiteSale = {
  id: string;
  name: string;
  /** Whole percent off the regular price, 1–90. */
  percent: number;
  /** Epoch ms; the sale runs from startsAt up to (not including) endsAt. */
  startsAt: number;
  endsAt: number;
  scope: SiteSaleScope;
  productIds?: string[];
  category?: string;
  /** Ended early or cancelled before it started. Kept for the record. */
  endedAt?: number;
  createdBy?: string;
  createdAt: number;
  updatedAt: number;
};

export type SaleProduct = { id: string; category?: string };

export const SALE_MAX_PERCENT = 90;
/** Longest a single sale can run (keeps a typo from making a year-long sale). */
export const SALE_MAX_DAYS = 62;

/** When the sale actually stops: its end, or earlier if it was ended. */
export const saleStop = (s: SiteSale): number => (s.endedAt && s.endedAt < s.endsAt ? s.endedAt : s.endsAt);

export function saleState(s: SiteSale, now = Date.now()): "scheduled" | "running" | "ended" | "cancelled" {
  if (s.endedAt && s.endedAt <= s.startsAt) return "cancelled";
  if (now >= saleStop(s)) return "ended";
  return now >= s.startsAt ? "running" : "scheduled";
}

export const saleLive = (s: SiteSale, now = Date.now()) => saleState(s, now) === "running";

const catKey = (c?: string) => String(c || "").trim().toLowerCase();

export function saleCovers(s: SiteSale, p: SaleProduct): boolean {
  if (s.scope === "all") return true;
  if (s.scope === "products") return !!s.productIds?.includes(p.id);
  return !!catKey(s.category) && catKey(p.category) === catKey(s.category);
}

/** The biggest running sale percent for this product, or 0. */
export function salePercentFor(p: SaleProduct, sales: SiteSale[], now = Date.now()): number {
  let best = 0;
  for (const s of sales) if (saleLive(s, now) && saleCovers(s, p) && s.percent > best) best = s.percent;
  return best;
}

/** Products with `sitePromo` set where a sale runs now (new objects; the input is untouched). */
export function withSales<T extends SaleProduct & { sitePromo?: number }>(products: T[], sales: SiteSale[], now = Date.now()): T[] {
  if (!sales.some((s) => saleLive(s, now))) return products;
  return products.map((p) => {
    const pct = salePercentFor(p, sales, now);
    return pct > 0 ? { ...p, sitePromo: pct } : p;
  });
}

export type SaleInput = {
  name?: unknown;
  percent?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  scope?: unknown;
  productIds?: unknown;
  category?: unknown;
};

/** Check a sale from the dashboard or a Concierge card. `known` = the catalog. */
export function cleanSale(
  input: SaleInput,
  known: SaleProduct[],
  now = Date.now()
): { ok: true; value: Pick<SiteSale, "name" | "percent" | "startsAt" | "endsAt" | "scope" | "productIds" | "category"> } | { ok: false; error: string } {
  const name = String(input.name ?? "").trim().slice(0, 80);
  if (!name) return { ok: false, error: "Give the sale a name, e.g. Black Friday." };
  const percent = Number(input.percent);
  if (!Number.isInteger(percent) || percent < 1 || percent > SALE_MAX_PERCENT) return { ok: false, error: `The sale needs a whole percent from 1 to ${SALE_MAX_PERCENT}.` };
  const startsAt = Number(input.startsAt);
  const endsAt = Number(input.endsAt);
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || startsAt <= 0) return { ok: false, error: "Set when the sale starts and ends." };
  if (endsAt <= startsAt) return { ok: false, error: "The end has to be after the start." };
  if (endsAt <= now) return { ok: false, error: "That end time has already passed." };
  if (endsAt - startsAt > SALE_MAX_DAYS * 86_400_000) return { ok: false, error: `A sale can run at most ${SALE_MAX_DAYS} days.` };
  const scope: SiteSaleScope = input.scope === "products" ? "products" : input.scope === "category" ? "category" : input.scope === "all" || input.scope === undefined ? "all" : ("" as SiteSaleScope);
  if (!scope) return { ok: false, error: "Choose all products, chosen products or a category." };
  if (scope === "products") {
    const ids = Array.isArray(input.productIds) ? Array.from(new Set(input.productIds.map((x) => String(x)))) : [];
    const ok = ids.filter((id) => known.some((p) => p.id === id));
    if (!ok.length) return { ok: false, error: "Pick at least one product." };
    if (ok.length < ids.length) return { ok: false, error: "One of those products no longer exists." };
    return { ok: true, value: { name, percent, startsAt, endsAt, scope, productIds: ok } };
  }
  if (scope === "category") {
    const category = String(input.category ?? "").trim().slice(0, 60);
    if (!category) return { ok: false, error: "Choose a category." };
    const match = known.find((p) => catKey(p.category) === catKey(category));
    if (!match) return { ok: false, error: `No products are in the category "${category}".` };
    // Saved with the products' own spelling ("tinctures" → "Tinctures").
    return { ok: true, value: { name, percent, startsAt, endsAt, scope, category: String(match.category).trim() } };
  }
  return { ok: true, value: { name, percent, startsAt, endsAt, scope } };
}

/** "All products", "3 products", "Category: Tinctures". */
export function scopeLabel(s: Pick<SiteSale, "scope" | "productIds" | "category">): string {
  if (s.scope === "products") {
    const n = s.productIds?.length || 0;
    return `${n} chosen product${n === 1 ? "" : "s"}`;
  }
  if (s.scope === "category") return `Category: ${s.category}`;
  return "All products";
}

/** How many of these products the sale covers. */
export const coveredCount = (s: SiteSale, products: SaleProduct[]) => products.filter((p) => saleCovers(s, p)).length;

// The dashboard and the Concierge take the LAST minute the sale runs
// ("Nov 27, 11:59 pm"), so it runs through that whole minute.
/** A typed end minute (epoch ms of its start) → the stored end. */
export const endFromMinute = (t: number) => t + 60_000;
/** The stored end → the last minute it runs, for showing and editing. */
export const lastMinute = (endsAt: number) => endsAt - 60_000;

const TZ = brand.timezone;
/** "Nov 27, 12:00 AM" in brand.timezone. */
export const saleTime = (t: number) =>
  new Date(t).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
/** "Nov 27, 12:00 AM – Nov 27, 11:59 PM Pacific" (brand.timezoneLabel). */
export const saleWindow = (s: Pick<SiteSale, "startsAt" | "endsAt">) => `${saleTime(s.startsAt)} – ${saleTime(lastMinute(s.endsAt))} ${brand.timezoneLabel}`;
