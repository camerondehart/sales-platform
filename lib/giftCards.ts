// Gift cards.
//
// A member buys a card for someone: it is saved here as "awaiting" next to a
// normal order (pay link, Venmo/Zelle matching, reminders all work as usual).
// The card goes to the recipient only once payment is CONFIRMED: a verified
// Venmo/Zelle payment confirmed or linked to the order, or staff setting the
// order to Paid or Completed. A customer's own "I've paid" tap doesn't count.
// On delivery the buyer also gets their bonus credit (e.g. $5 per $50).
//
// Balances live here, in one safe store (lib/versionedStore.ts), never on
// the member record. A card belongs to the member who holds it (`ownerId`),
// or until then to whoever signs in with the recipient's email, or claims it
// with its code. Spending writes a negative entry under the order's hold key;
// cancelling that order puts it back.

import { brand } from "./brand";
import path from "path";
import crypto from "crypto";
import { VersionedStore } from "./versionedStore";
import { giftMoney, type GiftOccasion } from "./giftCardRules";

export type GiftCardEntry = {
  at: number;
  /** Negative = spent, positive = put back. */
  amount: number;
  /** The order's hold key (spent / put back), "issue", or "staff" (balance changed in admin). */
  ref: string;
  orderId?: string;
  note: string;
};

export type GiftCard = {
  id: string;
  /** What people type to claim it, e.g. GIFT-7KQM-2XWD. */
  code: string;
  /** Secret for the public card page /gift/<token>. */
  token: string;
  kind: "gift" | "bonus";
  amount: number;
  balance: number;
  occasion: GiftOccasion;
  toName: string;
  toEmail: string;
  fromName: string;
  fromEmail: string;
  fromUserId: string;
  /** The buyer's own account name (the bonus card is made out to them). */
  buyerName?: string;
  note?: string;
  /** The order that pays for it (for a bonus, the gift card order that earned it). */
  orderId: string;
  /** The buyer's bonus, worked out when the card was bought (gift cards only). */
  bonus?: number;
  /** Bonus cards: the gift card that earned it (one bonus per gift card). */
  bonusOf?: string;
  state: "awaiting" | "active" | "void";
  /** The member holding it. Unset until the recipient signs in with that email or claims it. */
  ownerId?: string;
  createdAt: number;
  deliveredAt?: number;
  /** Delivery email sent to the recipient. */
  emailedAt?: number;
  voidedAt?: number;
  voidReason?: "cancelled" | "staff";
  /** What was left when its order was cancelled after part of it was spent (put back if the order is restored). */
  frozen?: number;
  entries: GiftCardEntry[];
};

const store = new VersionedStore<GiftCard>({
  name: "gift-cards",
  legacyKey: "gift-cards.json",
  localFile: path.join(process.cwd(), "data", "gift-cards.json"),
  keep: 12,
  reconcileLegacy: false,
  // A save must never lose a card.
  guard: (before, after) => {
    const ids = new Set(after.map((c) => c.id));
    const lost = before.filter((c) => !ids.has(c.id));
    return lost.length ? `Refusing to drop ${lost.length} gift card(s).` : null;
  },
});

const CODE_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
function newCode(taken: Set<string>): string {
  for (;;) {
    const bytes = crypto.randomBytes(8);
    const chars = Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
    const code = `GIFT-${chars.slice(0, 4)}-${chars.slice(4)}`;
    if (!taken.has(code)) return code;
  }
}

export function normCode(s: string): string {
  const raw = String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = raw.startsWith("GIFT") ? raw.slice(4) : raw;
  return body.length === 8 ? `GIFT-${body.slice(0, 4)}-${body.slice(4)}` : "";
}

const lower = (s: string) => String(s || "").trim().toLowerCase();
const cents = (n: number) => Math.round(n * 100) / 100;

export async function allGiftCards(): Promise<GiftCard[]> {
  return (await store.read()).data;
}

export async function giftCardByToken(token: string): Promise<GiftCard | null> {
  if (!token || token.length < 20) return null;
  return (await allGiftCards()).find((c) => c.token === token) || null;
}

export async function giftCardsForOrder(orderId: string): Promise<GiftCard[]> {
  return (await allGiftCards()).filter((c) => c.orderId === orderId);
}

/** Does this card belong to this member (held, or waiting for their email)? */
export function belongsTo(c: GiftCard, user: { id: string; email: string }): boolean {
  return c.ownerId ? c.ownerId === user.id : lower(c.toEmail) === lower(user.email);
}

/** A member's cards (active, plus void ones they already held) and spendable balance. */
export async function giftWallet(user: { id: string; email: string }): Promise<{ cards: GiftCard[]; balance: number }> {
  const cards = (await allGiftCards())
    .filter((c) => c.state !== "awaiting" && belongsTo(c, user) && (c.state === "active" || c.ownerId === user.id))
    .sort((a, b) => (b.deliveredAt || b.createdAt) - (a.deliveredAt || a.createdAt));
  const balance = cents(cards.filter((c) => c.state === "active").reduce((n, c) => n + c.balance, 0));
  return { cards, balance };
}

/** Cards bought by this member (any state), for "Cards you've sent". */
export async function giftCardsSentBy(userId: string): Promise<GiftCard[]> {
  return (await allGiftCards()).filter((c) => c.kind === "gift" && c.fromUserId === userId).sort((a, b) => b.createdAt - a.createdAt);
}

/** Save a newly bought card, waiting for payment. */
export async function addAwaitingCard(args: Omit<GiftCard, "id" | "code" | "token" | "state" | "balance" | "createdAt" | "entries" | "kind">): Promise<GiftCard> {
  return store.mutate((cards) => {
    const card: GiftCard = {
      ...args,
      id: `gc_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
      code: newCode(new Set(cards.map((c) => c.code))),
      token: crypto.randomBytes(24).toString("hex"),
      kind: "gift",
      state: "awaiting",
      balance: args.amount,
      createdAt: Date.now(),
      entries: [],
    };
    return { data: [...cards, card], result: card };
  });
}

/**
 * Payment confirmed: activate the order's cards and give the buyer their
 * bonus. Safe to call more than once (only "awaiting" cards, or cards voided
 * by a cancel, change). Returns the cards that were just activated.
 */
export async function activateForOrder(orderId: string, findMember: (email: string) => Promise<{ id: string } | undefined>): Promise<GiftCard[]> {
  const pending = (await allGiftCards()).filter((c) => c.orderId === orderId && (c.state === "awaiting" || (c.state === "void" && c.voidReason === "cancelled")));
  if (!pending.length) return [];
  // Look members up outside the write (it reads another store).
  const owners = new Map<string, string | undefined>();
  for (const c of pending) if (c.kind === "gift" && !c.ownerId) owners.set(c.id, (await findMember(lower(c.toEmail)))?.id);
  return store.mutate((cards) => {
    const now = Date.now();
    const done: GiftCard[] = [];
    const out = cards.slice();
    const taken = new Set(cards.map((c) => c.code));
    for (let i = 0; i < out.length; i++) {
      const c = out[i];
      if (c.orderId !== orderId) continue;
      if (!(c.state === "awaiting" || (c.state === "void" && c.voidReason === "cancelled"))) continue;
      const wasAwaiting = c.state === "awaiting";
      const unfreeze = !wasAwaiting && (c.frozen || 0) > 0 ? cents(c.frozen!) : 0;
      out[i] = {
        ...c,
        state: "active",
        balance: unfreeze ? cents(c.balance + unfreeze) : c.balance,
        frozen: undefined,
        deliveredAt: c.deliveredAt || now,
        ownerId: c.ownerId || owners.get(c.id),
        voidedAt: undefined,
        voidReason: undefined,
        entries: wasAwaiting ? [...c.entries, { at: now, amount: c.amount, ref: "issue", orderId, note: c.kind === "bonus" ? "Bonus credit" : `Paid gift card` }] : [...c.entries, { at: now, amount: unfreeze, ref: "restore", orderId, note: "Order set back from cancelled" }],
      };
      done.push(out[i]);
      // The buyer's bonus, once per gift card.
      if (c.kind === "gift" && (c.bonus || 0) > 0 && !out.some((b) => b.kind === "bonus" && b.bonusOf === c.id)) {
        const bonus: GiftCard = {
          id: `gc_${now}_${crypto.randomBytes(4).toString("hex")}`,
          code: newCode(taken),
          token: crypto.randomBytes(24).toString("hex"),
          kind: "bonus",
          amount: c.bonus!,
          balance: c.bonus!,
          occasion: c.occasion,
          toName: c.buyerName || c.fromName,
          toEmail: c.fromEmail,
          fromName: brand.shortName,
          fromEmail: "",
          fromUserId: "",
          bonusOf: c.id,
          orderId,
          state: "active",
          ownerId: c.fromUserId || undefined,
          createdAt: now,
          deliveredAt: now,
          entries: [{ at: now, amount: c.bonus!, ref: "issue", orderId, note: `Bonus for buying a ${giftMoney(c.amount)} gift card` }],
        };
        taken.add(bonus.code);
        out.push(bonus);
        done.push(bonus);
      }
    }
    return { data: done.length ? out : null, result: done };
  });
}

/** Remember the delivery email went out. */
export async function markEmailed(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await store.mutate((cards) => {
    const out = cards.map((c) => (ids.includes(c.id) ? { ...c, emailedAt: Date.now() } : c));
    return { data: out, result: undefined };
  });
}

/** What's been spent from a card at checkout so far (net of anything put back). Staff edits don't count. */
export function spentFrom(c: GiftCard): number {
  return cents(-c.entries.filter((e) => !["issue", "staff", "restore", "cancel"].includes(e.ref)).reduce((n, e) => n + e.amount, 0));
}

/**
 * The gift card order was cancelled: void its cards (and the bonus).
 * A card that was already partly spent is voided too, and what's left on it
 * is frozen (Cam, 2026-11-18): it can't be spent, it's kept on the card, and
 * it comes back if the order is restored. Those cards are reported back with
 * how much was spent, so staff know what to refund.
 */
export async function voidForOrder(orderId: string): Promise<{ voided: number; spent: Array<{ card: GiftCard; spent: number; frozen: number }> }> {
  return store.mutate((cards) => {
    let voided = 0;
    const now = Date.now();
    const spent: Array<{ card: GiftCard; spent: number; frozen: number }> = [];
    const out = cards.map((c) => {
      if (c.orderId !== orderId || c.state === "void") return c;
      voided++;
      const used = c.state === "active" ? spentFrom(c) : 0;
      if (used > 0) {
        const left = cents(c.balance);
        const frozenCard: GiftCard = {
          ...c,
          state: "void",
          voidedAt: now,
          voidReason: "cancelled",
          balance: 0,
          frozen: left,
          entries: [...c.entries, { at: now, amount: -left, ref: "cancel", orderId, note: "Frozen: order cancelled" }],
        };
        spent.push({ card: frozenCard, spent: used, frozen: left });
        return frozenCard;
      }
      return { ...c, state: "void" as const, voidedAt: now, voidReason: "cancelled" as const };
    });
    return { data: voided ? out : null, result: { voided, spent } };
  });
}

/** Staff: void one card (what's left can't be spent). */
export async function voidCard(id: string): Promise<GiftCard | null> {
  return store.mutate((cards) => {
    const i = cards.findIndex((c) => c.id === id);
    if (i === -1 || cards[i].state === "void") return { data: null, result: null };
    const out = cards.slice();
    out[i] = { ...cards[i], state: "void", voidedAt: Date.now(), voidReason: "staff" };
    return { data: out, result: out[i] };
  });
}

/** Most a staff edit can set one card's balance to. */
export const GIFT_ADJUST_MAX = 5000;

/**
 * Staff: set an active card's balance (Settings → Gift cards → Edit balance).
 * Never below $0. The change is kept on the card as a "staff" entry with the reason.
 */
export async function adjustBalance(id: string, newBalance: number, reason: string): Promise<{ ok: true; before: number; card: GiftCard } | { ok: false; error: string }> {
  const target = cents(Number(newBalance));
  if (!Number.isFinite(target) || target < 0) return { ok: false, error: "The balance can't go below $0." };
  if (target > GIFT_ADJUST_MAX) return { ok: false, error: `The balance can be at most ${giftMoney(GIFT_ADJUST_MAX)}.` };
  const why = String(reason || "").trim().slice(0, 200);
  type R = { ok: true; before: number; card: GiftCard } | { ok: false; error: string };
  return store.mutate<R>((cards) => {
    const i = cards.findIndex((c) => c.id === id);
    const c = cards[i];
    if (!c || c.state !== "active") return { data: null, result: { ok: false, error: "Only an active card's balance can be changed." } };
    const delta = cents(target - c.balance);
    if (delta === 0) return { data: null, result: { ok: false, error: `It's already ${giftMoney(target)}.` } };
    const out = cards.slice();
    out[i] = { ...c, balance: target, entries: [...c.entries, { at: Date.now(), amount: delta, ref: "staff", note: why ? `Changed by staff: ${why}` : "Changed by staff" }] };
    return { data: out, result: { ok: true, before: c.balance, card: out[i] } };
  });
}

/** Add a card to a member's account by its code. */
export async function claimByCode(user: { id: string; email: string }, rawCode: string): Promise<{ ok: true; card: GiftCard } | { ok: false; error: string }> {
  const code = normCode(rawCode);
  if (!code) return { ok: false, error: "That doesn't look like a gift card code (it's like GIFT-7KQM-2XWD)." };
  type R = { ok: true; card: GiftCard } | { ok: false; error: string };
  return store.mutate<R>((cards) => {
    const i = cards.findIndex((c) => c.code === code);
    const c = cards[i];
    if (!c || c.state === "awaiting") return { data: null, result: { ok: false, error: "We couldn't find a gift card with that code. Check it and try again." } };
    if (c.state === "void") return { data: null, result: { ok: false, error: "That gift card is no longer active." } };
    if (c.ownerId === user.id) return { data: null, result: { ok: true, card: c } };
    if (c.ownerId) return { data: null, result: { ok: false, error: "That gift card is already in someone's account." } };
    const out = cards.slice();
    out[i] = { ...c, ownerId: user.id };
    return { data: out, result: { ok: true, card: out[i] } };
  });
}

/**
 * Spend `amount` of a member's balance under `hold` (bonus credit first, then
 * the oldest cards). All or nothing: if the balance has changed, nothing is taken.
 */
export async function spendBalance(user: { id: string; email: string }, amount: number, hold: string, label: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const want = cents(amount);
  if (!(want > 0)) return { ok: true };
  type R = { ok: true } | { ok: false; error: string };
  return store.mutate<R>((cards) => {
    const mine = cards
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.state === "active" && c.balance > 0 && belongsTo(c, user))
      .sort((a, b) => (a.c.kind === b.c.kind ? (a.c.deliveredAt || 0) - (b.c.deliveredAt || 0) : a.c.kind === "bonus" ? -1 : 1));
    const have = cents(mine.reduce((n, x) => n + x.c.balance, 0));
    if (have + 0.001 < want) return { data: null, result: { ok: false, error: `Your gift card balance is now ${giftMoney(have)}. Please check your order and try again.` } };
    const out = cards.slice();
    let left = want;
    for (const { c, i } of mine) {
      if (left <= 0) break;
      const take = cents(Math.min(c.balance, left));
      left = cents(left - take);
      out[i] = { ...c, ownerId: c.ownerId || user.id, balance: cents(c.balance - take), entries: [...c.entries, { at: Date.now(), amount: -take, ref: hold, note: label }] };
    }
    return { data: out, result: { ok: true } };
  });
}

/** Put back what an order spent (cancelled, or the order didn't save). Runs once per hold. */
export async function returnHold(hold: string, orderId?: string): Promise<number> {
  return store.mutate((cards) => {
    let back = 0;
    const out = cards.map((c) => {
      const spent = c.entries.filter((e) => e.ref === hold).reduce((n, e) => n + e.amount, 0);
      if (spent >= 0) return c;
      const amt = cents(-spent);
      back = cents(back + amt);
      return { ...c, balance: cents(c.balance + amt), entries: [...c.entries, { at: Date.now(), amount: amt, ref: hold, orderId, note: "Put back: order cancelled" }] };
    });
    return { data: back > 0 ? out : null, result: back };
  });
}

/** Order set back from cancelled: take the same amounts again, as far as the cards still allow. */
export async function retakeHold(hold: string, orderId?: string): Promise<{ taken: number; wanted: number }> {
  return store.mutate((cards) => {
    let taken = 0, wanted = 0;
    const out = cards.map((c) => {
      const mine = c.entries.filter((e) => e.ref === hold);
      const firstSpend = -mine.filter((e) => e.amount < 0).slice(0, 1).reduce((n, e) => n + e.amount, 0);
      const net = mine.reduce((n, e) => n + e.amount, 0);
      if (!(firstSpend > 0) || net < 0) return c; // never spent, or still spent
      wanted = cents(wanted + firstSpend);
      const take = cents(Math.min(firstSpend, c.state === "active" ? c.balance : 0));
      if (take <= 0) return c;
      taken = cents(taken + take);
      return { ...c, balance: cents(c.balance - take), entries: [...c.entries, { at: Date.now(), amount: -take, ref: hold, orderId, note: "Order set back from cancelled" }] };
    });
    return { data: taken > 0 ? out : null, result: { taken, wanted } };
  });
}

/** What a member sees for a card (never another person's email, and no token). */
export type WalletCard = {
  id: string;
  code: string;
  kind: "gift" | "bonus";
  amount: number;
  balance: number;
  occasion: GiftOccasion;
  toName: string;
  fromName: string;
  note?: string;
  state: GiftCard["state"];
  deliveredAt?: number;
  link: string;
};
export function toWalletCard(c: GiftCard): WalletCard {
  return {
    id: c.id,
    code: c.code,
    kind: c.kind,
    amount: c.amount,
    balance: c.balance,
    occasion: c.occasion,
    toName: c.toName,
    fromName: c.fromName,
    note: c.kind === "gift" ? c.note : undefined,
    state: c.state,
    deliveredAt: c.deliveredAt,
    link: `/gift/${c.token}`,
  };
}

export { occasionLabel } from "./giftCardRules";
