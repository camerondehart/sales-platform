import type { Product } from "../storage";
import { cashDeal, effectivePrice, onSale, parsePrice, promoLabel } from "../pricing";
import { parseVideo } from "../video";
import { cachedProducts, plainText, productsFor } from "./knowledge";
import type { Audience, ProductCard } from "./shared";

/**
 * Product cards under a customer reply. Built on the server from the live
 * catalog (never from what the model wrote), limited to what this customer
 * can actually buy: the members' gallery for members, the public shop for
 * everyone else. Products the assistant never discusses are excluded.
 */
function card(p: Product, audience: Audience): ProductCard {
  const price = effectivePrice(p);
  return {
    id: p.id,
    name: p.name,
    image: p.image,
    price,
    was: onSale(p) ? p.price : undefined,
    badge: promoLabel(p) || cashDeal(p) || undefined,
    blurb: plainText(p.description, 110) || undefined,
    hasVideo: !!parseVideo(p.video) || undefined,
    shop: audience === "member" ? "members" : "public",
    canAdd: parsePrice(price) > 0,
  };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function productCardsFor(audience: Audience, ids: string[] | undefined, replyText: string): Promise<ProductCard[]> {
  if (audience === "admin") return [];
  const mine = productsFor(audience, await cachedProducts());
  const byId = new Map(mine.map((p) => [p.id, p]));
  let picked = (ids || []).map((id) => byId.get(id)).filter((p): p is Product => !!p);
  // Fallback: the reply names products but the model didn't ask for cards.
  if (picked.length === 0 && replyText) {
    picked = mine
      .filter((p) => p.name.trim().length >= 4)
      .map((p) => ({ p, at: replyText.search(new RegExp(`(^|[^\\w])${escapeRe(p.name.trim())}(?![\\w])`, "i")) }))
      .filter((x) => x.at >= 0)
      .sort((a, b) => a.at - b.at)
      .map((x) => x.p);
  }
  return picked.slice(0, 4).map((p) => card(p, audience));
}
