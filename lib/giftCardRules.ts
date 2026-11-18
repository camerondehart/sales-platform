// Gift card rules shared by the shop page, checkout and the server
//. No Node imports, so client components can use it.

export type GiftOccasion = "birthday" | "holidays" | "just-because" | "thank-you";

export const GIFT_OCCASIONS: Array<{ key: GiftOccasion; label: string; line: string }> = [
  { key: "birthday", label: "Birthday", line: "Happy birthday" },
  { key: "holidays", label: "Holidays", line: "Happy holidays" },
  { key: "just-because", label: "Just because", line: "Just because" },
  { key: "thank-you", label: "Thank you", line: "With thanks" },
];

export function occasionOf(key: unknown): GiftOccasion {
  return GIFT_OCCASIONS.some((o) => o.key === key) ? (key as GiftOccasion) : "just-because";
}

/** Preset amounts on the gift card page. */
export const GIFT_AMOUNTS = [25, 50, 100, 150, 200];
/** Custom amounts are whole dollars in this range. */
export const GIFT_MIN = 10;
export const GIFT_MAX = 500;
export const GIFT_NOTE_MAX = 240;

/** Buyer bonus: `per` dollars of credit for every full `step` dollars of gift card (default $5 per $50), at most `max` per card. */
export type GiftBonusRule = { enabled: boolean; per: number; step: number; max?: number };
export const DEFAULT_GIFT_BONUS: GiftBonusRule = { enabled: true, per: 5, step: 50, max: 20 };

export function giftBonusFor(amount: number, rule: GiftBonusRule | null | undefined): number {
  if (!rule || !rule.enabled) return 0;
  const step = Math.floor(Number(rule.step) || 0);
  const per = Math.round((Number(rule.per) || 0) * 100) / 100;
  if (step <= 0 || per <= 0 || !(amount > 0)) return 0;
  const bonus = Math.floor(amount / step) * per;
  const max = Number(rule.max);
  return Number.isFinite(max) && max > 0 ? Math.min(bonus, max) : bonus;
}

/** A gift card amount the shop accepts: whole dollars, GIFT_MIN–GIFT_MAX. */
export function validGiftAmount(n: unknown): number | null {
  const v = Number(n);
  if (!Number.isFinite(v) || Math.floor(v) !== v) return null;
  return v >= GIFT_MIN && v <= GIFT_MAX ? v : null;
}

/** Money as "$50" or "$12.50". */
export function giftMoney(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

/** How much of a balance an order uses: never more than the order. */
export function giftApplies(balance: number, orderTotal: number): number {
  const v = Math.min(Math.max(0, balance), Math.max(0, orderTotal));
  return Math.round(v * 100) / 100;
}

export const occasionLabel = (k: string) => GIFT_OCCASIONS.find((o) => o.key === occasionOf(k))?.label || "Gift";
