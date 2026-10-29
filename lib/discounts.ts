// Discount codes — admin-created codes customers enter at checkout.
// Stored as discounts.json in Vercel Blob (data/discounts.json locally),
// following the same dual-backend + safety-guard pattern as other modules.

import { promises as fs } from "fs";
import path from "path";
import { VersionedStore } from "./versionedStore";
import { isEnabled, isEnabledStrict } from "./flags";
import { singleton } from "./assistant/singleton";

export type DiscountType = "percentage" | "fixed";

export type Discount = {
  id: string;
  code: string;              // stored uppercase; matched case-insensitively
  type: DiscountType;
  value: number;             // 15 = 15% or $15 depending on type
  label?: string;            // internal note, e.g. "Spring sale" or a rep's name
  expiresAt?: number;
  maxUses?: number;          // total redemptions allowed
  perCustomerLimit?: number; // redemptions allowed per member
  minOrderAmount?: number;
  /** Also works in the public shop (public products). Ambassadors' linked codes always do. */
  publicShop?: boolean;
  active: boolean;
  uses: number;              // total redemptions so far
  usedBy: Array<{ userId: string; orderId: string; at: number; amount: number }>;
  createdAt: number;
};

const DATA_FILE = path.join(process.cwd(), "data", "discounts.json");
const BLOB_KEY = "discounts.json";
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

// Safe (versioned) storage — behind the shared "versioned_catalog" switch,
// exactly like products (see lib/storage.ts). Off = discounts.json as before.
const discountStore = singleton(
  "discountStore",
  () =>
    new VersionedStore<Discount>({
      name: "discounts",
      legacyKey: BLOB_KEY,
      localFile: DATA_FILE,
      keep: 30,
      reconcileLegacy: false, // discounts.json is our own mirror, not a second source
      guard: (before, after) =>
        before.length >= 3 && after.length < Math.ceil(before.length / 2)
          ? `Refusing to write discounts: existing ${before.length}, new ${after.length}.`
          : null,
    })
);
const versionedReads = () => isEnabled("versioned_catalog");
const versionedWrites = () => isEnabledStrict("versioned_catalog");

async function mirrorDiscounts(list: Discount[]): Promise<void> {
  if (!useBlob) return;
  try {
    await blobPut(list);
  } catch (err) {
    console.error("discounts: copy to discounts.json failed (the versioned copy is saved)", err);
  }
}

/**
 * Read → change → save the codes in one safe step (`fn` returns the new list,
 * or null to save nothing, and a result). Throws if the codes can't be read.
 */
export async function mutateDiscounts<R>(
  fn: (all: Discount[]) => { data: Discount[] | null; result: R } | Promise<{ data: Discount[] | null; result: R }>
): Promise<R> {
  if (await versionedWrites()) {
    let saved: Discount[] | null = null;
    const result = await discountStore.mutate(async (list) => {
      const out = await fn(list);
      saved = out.data;
      return out;
    });
    if (saved) await mirrorDiscounts(saved);
    return result;
  }
  const out = await fn(await getDiscountsForUpdate());
  if (out.data) await saveDiscounts(out.data);
  return out.result;
}

/** Switching the shared switch ON: start the versions from the current discounts.json. */
export async function startVersionedDiscounts(): Promise<number> {
  return discountStore.importLegacy();
}
/** Switching it OFF: make sure discounts.json has the latest versioned codes. */
export async function stopVersionedDiscounts(): Promise<void> {
  if (!useBlob) return;
  const snap = await discountStore.read();
  if (snap.version > 0) await blobPut(snap.data);
}

async function blobGet(strict = false): Promise<Discount[]> {
  try {
    const { list } = await import("@vercel/blob");
    const { blobs } = await list({ prefix: BLOB_KEY });
    const match = blobs.find((b) => b.pathname === BLOB_KEY);
    if (!match) return [];
    const url = `${match.url}${match.url.includes("?") ? "&" : "?"}nocache=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`discounts.json read failed with HTTP ${res.status}`);
    return (await res.json()) as Discount[];
  } catch (err) {
    console.error("Discounts read failed:", err);
    // Checkout can treat "can't read" as "no such code"; a save must not,
    // or it would write a near-empty list over every real code.
    if (strict) throw err;
    return [];
  }
}

async function blobPut(list: Discount[]): Promise<void> {
  const { put } = await import("@vercel/blob");
  await put(BLOB_KEY, JSON.stringify(list, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true, // required by @vercel/blob 2.x to update a blob in place
    cacheControlMaxAge: 60,
  });
}

export async function getDiscounts(): Promise<Discount[]> {
  if (await versionedReads()) {
    try {
      return (await discountStore.read()).data;
    } catch (err) {
      console.error("Discounts read failed:", err);
      return []; // checkout treats "can't read" as "no such code"; saves read strictly
    }
  }
  if (useBlob) return blobGet();
  try {
    return JSON.parse(await fs.readFile(DATA_FILE, "utf8")) as Discount[];
  } catch {
    return [];
  }
}

/** For changing codes: throws instead of returning [] when the read fails. */
export async function getDiscountsForUpdate(): Promise<Discount[]> {
  if (await versionedWrites()) return (await discountStore.read()).data;
  if (useBlob) return blobGet(true);
  return getDiscounts();
}

export async function saveDiscounts(discounts: Discount[]): Promise<void> {
  if (await versionedWrites()) {
    // Whole-list save (prefer mutateDiscounts): still exact, via a new version.
    await discountStore.mutate(() => ({ data: discounts, result: undefined }));
    await mirrorDiscounts(discounts);
    return;
  }
  // Safety guard: refuse writes that look like accidental data loss, and
  // refuse to write at all if the current list can't be read to check.
  let existing: Discount[];
  try {
    existing = await getDiscountsForUpdate();
  } catch {
    throw new Error("Couldn't read the current discount codes to save safely. Please try again.");
  }
  if (existing.length >= 3 && discounts.length < Math.ceil(existing.length / 2)) {
    throw new Error(
      `Refusing to write discounts: existing ${existing.length}, new ${discounts.length}.`
    );
  }
  if (useBlob) return blobPut(discounts);
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(discounts, null, 2), "utf8");
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

export function generateCode(prefix = ""): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return normalizeCode(prefix ? `${prefix}${out}` : out);
}

export type DiscountCheck =
  | { ok: true; discount: Discount; amount: number }
  | { ok: false; error: string };

// Validate a code against an order subtotal for a specific member.
// Always run this server-side — never trust a client-supplied amount.
export function validateDiscount(
  discount: Discount | undefined,
  subtotal: number,
  userId: string
): DiscountCheck {
  if (!discount) return { ok: false, error: "That code isn't valid." };
  if (!discount.active) return { ok: false, error: "That code is no longer active." };
  if (discount.expiresAt && discount.expiresAt < Date.now()) {
    return { ok: false, error: "That code has expired." };
  }
  if (discount.maxUses && discount.uses >= discount.maxUses) {
    return { ok: false, error: "That code has reached its usage limit." };
  }
  if (discount.perCustomerLimit) {
    const mine = discount.usedBy.filter((u) => u.userId === userId).length;
    if (mine >= discount.perCustomerLimit) {
      return { ok: false, error: "You've already used that code." };
    }
  }
  if (discount.minOrderAmount && subtotal < discount.minOrderAmount) {
    return {
      ok: false,
      error: `That code requires an order of at least $${discount.minOrderAmount.toFixed(2)}.`,
    };
  }

  const raw =
    discount.type === "percentage"
      ? subtotal * (discount.value / 100)
      : discount.value;
  // Never discount below zero.
  const amount = Math.min(Math.round(raw * 100) / 100, subtotal);
  if (amount <= 0) return { ok: false, error: "That code doesn't apply to this order." };

  return { ok: true, discount, amount };
}

/** Can this code be used in the public shop? (Marked for it, or a live ambassador's code.) */
export function worksInPublicShop(d: Pick<Discount, "code" | "publicShop">, ambassadorCodes: Set<string>): boolean {
  return !!d.publicShop || ambassadorCodes.has(d.code);
}

export async function findDiscountByCode(code: string): Promise<Discount | undefined> {
  const normalized = normalizeCode(code);
  return (await getDiscounts()).find((d) => d.code === normalized);
}

// Record a redemption after an order is successfully created.
export async function recordDiscountUse(
  discountId: string,
  userId: string,
  orderId: string,
  amount: number
): Promise<void> {
  if (await versionedWrites()) {
    // Two checkouts using the same code at once both get counted.
    return mutateDiscounts((all) => {
      const d = all.find((x) => x.id === discountId);
      if (!d) return { data: null, result: undefined };
      d.uses += 1;
      d.usedBy = [...d.usedBy, { userId, orderId, at: Date.now(), amount }];
      return { data: all, result: undefined };
    });
  }
  const all = await getDiscounts();
  const idx = all.findIndex((d) => d.id === discountId);
  if (idx === -1) return;
  all[idx].uses += 1;
  all[idx].usedBy.push({ userId, orderId, at: Date.now(), amount });
  await saveDiscounts(all);
}
