import path from "path";
import { VersionedStore } from "./versionedStore";
import { getDiscounts, type Discount } from "./discounts";

/**
 * Event offers: "people who sign up at <event> get <discount code> in their
 * welcome email". Set from Marketing → Event sign-up QR code. One normal
 * discount code per event, so its own settings (expiry, once per person,
 * usage cap, minimum order) still apply at checkout. The event name in the
 * QR link only picks which offer to look up — the discount itself is never in
 * the URL, so it can't be edited by a visitor.
 */

export type EventOffer = { id: string; event: string; discountId: string; updatedAt: number };

const store = new VersionedStore<EventOffer>({
  name: "event-offers",
  legacyKey: "event-offers.json",
  localFile: path.join(process.cwd(), "data", "event-offers.json"),
  keep: 8,
  reconcileLegacy: false,
});

/** "Farmers  Market " and "farmers market" are the same event. */
export const eventKey = (event: string) => String(event || "").trim().replace(/\s+/g, " ").toLowerCase().slice(0, 80);

export async function getEventOffers(): Promise<EventOffer[]> {
  return (await store.read()).data;
}

/** Set (or with discountId null, remove) the offer for an event. */
export async function setEventOffer(event: string, discountId: string | null) {
  const id = eventKey(event);
  return store.mutate(
    (rows) => {
      const before = rows.find((r) => r.id === id) || null;
      const rest = rows.filter((r) => r.id !== id);
      const after = discountId ? { id, event: event.trim().replace(/\s+/g, " ").slice(0, 80), discountId, updatedAt: Date.now() } : null;
      return { data: after ? [...rest, after] : rest, result: { before, after, all: after ? [...rest, after] : rest } };
    },
    { allowShrink: true }
  );
}

export const offerText = (d: Pick<Discount, "type" | "value">) => (d.type === "percentage" ? `${d.value}% off` : `$${d.value} off`);

/** True when a code can still be used by someone new right now. */
export function usable(d: Discount | undefined, now = Date.now()): d is Discount {
  return !!d && d.active && !(d.expiresAt && d.expiresAt < now) && !(d.maxUses && d.uses >= d.maxUses);
}

export type LiveOffer = {
  code: string;
  text: string; // "15% off" / "$10 off"
  expiresAt?: number;
  minOrderAmount?: number;
  oncePerPerson: boolean;
};

/** The offer for a sign-up at this event, if one is set and its code still works. Never throws. */
export async function offerForEvent(event: string | undefined): Promise<LiveOffer | null> {
  const id = eventKey(event || "");
  if (!id) return null;
  try {
    const row = (await getEventOffers()).find((r) => r.id === id);
    if (!row) return null;
    const d = (await getDiscounts()).find((x) => x.id === row.discountId);
    if (!usable(d)) return null;
    return {
      code: d.code,
      text: offerText(d),
      expiresAt: d.expiresAt,
      minOrderAmount: d.minOrderAmount,
      oncePerPerson: d.perCustomerLimit === 1,
    };
  } catch (err) {
    console.error("[event offers] lookup failed", err);
    return null;
  }
}
