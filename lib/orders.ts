// Order persistence — one blob file PER ORDER (orders/<id>.json).
//
// Why: the previous design kept every order in a single orders.json that
// was fully rewritten on each change. Vercel Blob overwrites propagate
// slowly (up to ~60s) and concurrent read-modify-write cycles could drop
// recently created orders. Per-order files make creation an append-only
// operation: no races, no overwrite lag for new orders.
//
// A legacy orders.json (if present) is still read and merged for backward
// compatibility; any update to a legacy order migrates it to its own file.

import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

export type { OrderStatus, DisplayStatus } from "./orderStatus";
export { normalizeStatus, isCompleted } from "./orderStatus";
import type { OrderStatus } from "./orderStatus";

export type PaymentMethod = "invoice" | "cash";

export type OrderItem = {
  productId: string;
  productName: string;
  price: string; // as displayed, e.g. "$68"
  quantity: number;
  /** Ordered while the product was at 0 in Stock counts: ships when new stock arrives. */
  restocking?: boolean;
};

export type OrderAddress = {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  postalCode: string;
};

export type Order = {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  items: OrderItem[];
  shippingAddress?: OrderAddress;
  shippingMethod: "ship" | "pickup";
  shippingCost: number; // 10 for ship, 0 for pickup
  subtotal: number;
  discount?: number; // promo savings (e.g. BOGO), subtracted from the total
  total: number;
  note?: string;
  isInquiry: boolean;
  status: OrderStatus;
  // "cash" means paying in person at pickup: no invoice email is sent.
  paymentMethod?: PaymentMethod;
  // Discounts (codes/promos applied at checkout)
  discountCode?: string;
  discountAmount?: number;
  discountType?: "percentage" | "fixed";
  /** Mix-and-match bundle savings (part of `discount`) and which bundles applied. */
  bundleSavings?: number;
  bundles?: Array<{ id: string; name: string; sets: number; savings: number }>;
  // Where the order came from
  source?: "member" | "retail";
  // Loyalty
  loyaltyPointsRedeemed?: number;
  loyaltyPointsEarned?: number;
  paymentToken: string; // random token for the public mark-paid link
  paidAt?: number;
  shippedAt?: number;
  pickedUpAt?: number;
  createdAt: number;
  /** Automatic payment reminders already sent (stage index 0-based). */
  reminders?: Array<{ stage: number; at: number; ok: boolean }>;
  /** Moved to the Expired list after the last reminder (status stays "pending"). */
  expiredAt?: number;
  /** Staff switched reminders off for this order. */
  remindersOff?: boolean;
  /** Placed by a staff member using "Log in as" (their email, or "admin"). */
  placedBy?: string;
  /** Credited to an ambassador (their page, or their linked discount code). Never affects the price. */
  ambassador?: { id: string; slug: string; name: string; via: "page" | "code"; /** Their commission % when the order was placed. */ rate?: number };
  trackingNumber?: string;
  labelUrl?: string;
  shippoTransactionId?: string;
  shippedService?: string;
  /** Units this order took from Stock counts (put back if it's cancelled). */
  stockTaken?: Array<{ productId: string; qty: number }>;
  /** When a cancel put stockTaken back (cleared if the order is un-cancelled and takes it again). */
  stockReturnedAt?: number;
};

const DATA_FILE = path.join(process.cwd(), "data", "orders.json");
const LEGACY_BLOB_KEY = "orders.json";
const ORDERS_PREFIX = "orders/";
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

function bust(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}nocache=${Date.now()}`;
}

async function blobPutOrder(order: Order): Promise<void> {
  const { put } = await import("@vercel/blob");
  await put(`${ORDERS_PREFIX}${order.id}.json`, JSON.stringify(order, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true, // required by @vercel/blob 2.x to update a blob in place
    cacheControlMaxAge: 60,
  });
}

async function blobReadLegacy(): Promise<Order[]> {
  try {
    const { list } = await import("@vercel/blob");
    const { blobs } = await list({ prefix: LEGACY_BLOB_KEY });
    const match = blobs.find((b) => b.pathname === LEGACY_BLOB_KEY);
    if (!match) return [];
    const res = await fetch(bust(match.url), { cache: "no-store" });
    if (!res.ok) return [];
    return (await res.json()) as Order[];
  } catch (err) {
    console.error("Legacy orders.json read failed:", err);
    return [];
  }
}

async function blobReadAll(): Promise<Order[]> {
  const { list } = await import("@vercel/blob");

  // Collect all per-order files (paginate defensively)
  const files: { pathname: string; url: string }[] = [];
  let cursor: string | undefined = undefined;
  do {
    const page: Awaited<ReturnType<typeof list>> = await list({ prefix: ORDERS_PREFIX, limit: 1000, cursor });
    files.push(...page.blobs.filter((b: { pathname: string }) => b.pathname.endsWith(".json")));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  const results = await Promise.all(
    files.map(async (f) => {
      try {
        const res = await fetch(bust(f.url), { cache: "no-store" });
        if (!res.ok) return null;
        return (await res.json()) as Order;
      } catch {
        return null;
      }
    })
  );
  const orders = results.filter((o): o is Order => !!o && !!o.id);

  // Merge legacy single-file orders that haven't been migrated yet.
  // Per-order files always win over their legacy copy.
  const ids = new Set(orders.map((o) => o.id));
  for (const legacy of await blobReadLegacy()) {
    if (!ids.has(legacy.id)) orders.push(legacy);
  }
  return orders;
}

async function fsRead(): Promise<Order[]> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    return JSON.parse(raw) as Order[];
  } catch {
    return [];
  }
}

async function fsWrite(orders: Order[]): Promise<void> {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(orders, null, 2), "utf8");
}

export async function getOrders(): Promise<Order[]> {
  if (useBlob) return blobReadAll();
  return fsRead();
}

export async function addOrder(
  args: Omit<Order, "id" | "createdAt" | "paymentToken">
): Promise<Order> {
  const order: Order = {
    ...args,
    id: `ord_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    paymentToken: crypto.randomBytes(24).toString("hex"),
    createdAt: Date.now(),
  };
  if (useBlob) {
    // Append-only: a brand-new file can't race with or overwrite anything.
    await blobPutOrder(order);
  } else {
    const all = await fsRead();
    all.push(order);
    await fsWrite(all);
  }
  return order;
}

// Fetch ONE order by reading its own file directly — one list call scoped to
// the exact path plus one fetch, instead of listing and downloading every
// order in the store. This is what makes admin actions fast.
async function blobReadOne(id: string): Promise<Order | null> {
  try {
    const { list } = await import("@vercel/blob");
    const key = `${ORDERS_PREFIX}${id}.json`;
    const { blobs } = await list({ prefix: key });
    const match = blobs.find((b) => b.pathname === key);
    if (match) {
      const res = await fetch(bust(match.url), { cache: "no-store" });
      if (res.ok) return (await res.json()) as Order;
    }
  } catch (err) {
    console.error(`Failed targeted read for order ${id}:`, err);
  }
  // Not migrated yet (or the read failed) — it may still live in legacy
  // orders.json, so fall back to the merged view.
  const all = await blobReadAll();
  return all.find((o) => o.id === id) || null;
}

export async function updateOrder(
  id: string,
  changes: Partial<Omit<Order, "id" | "createdAt" | "paymentToken" | "userId">>
): Promise<Order | null> {
  if (useBlob) {
    const existing = await blobReadOne(id);
    if (!existing) return null;
    const updated: Order = { ...existing, ...changes };
    // Writes (or migrates) this order's own file; other orders untouched.
    await blobPutOrder(updated);
    return updated;
  }
  const all = await fsRead();
  const idx = all.findIndex((o) => o.id === id);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], ...changes };
  await fsWrite(all);
  return all[idx];
}

// Public targeted read — one order without downloading the whole store.
export async function getOrderById(id: string): Promise<Order | null> {
  if (!id) return null;
  if (useBlob) return blobReadOne(id);
  const all = await fsRead();
  return all.find((o) => o.id === id) || null;
}

export async function getOrderByToken(token: string): Promise<Order | null> {
  if (!token) return null;
  const all = await getOrders();
  return all.find((o) => o.paymentToken === token) || null;
}

export async function getOrdersByUser(userId: string): Promise<Order[]> {
  const all = await getOrders();
  return all.filter((o) => o.userId === userId).sort((a, b) => b.createdAt - a.createdAt);
}

// Parse a display price like "$68" or "$1,200" into a number. Non-numeric
// prices (e.g. "Inquire") count as 0.
export function parsePrice(price: string): number {
  return parseFloat(String(price).replace(/[^0-9.-]/g, "")) || 0;
}
