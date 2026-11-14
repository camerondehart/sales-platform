import path from "path";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { VersionedStore } from "./versionedStore";

/**
 * Retail stores (Retail tab, switch `retail_portal`): accounts staff create
 * for shops that carry our products, and the stock requests those shops send
 * from the store portal (/store-portal).
 *
 * Kept apart from members on purpose: a store login can never open the
 * members' gallery or the dashboard, and a member can never open the portal.
 * Each account can have a few logins (one per person at the shop), each with
 * its own password. An account can be linked to a pin on the public store map
 * (lib/stores.ts) so its address and hours show in the portal.
 *
 * No money here (2026-11-10): requests carry products and quantities only.
 */

export type RetailLogin = {
  id: string;
  email: string;
  name: string;
  /** bcrypt. A random unknown password until they choose one from their link. */
  passwordHash: string;
  /** True until they set a password themselves. */
  needsPassword?: boolean;
  active: boolean;
  createdAt: number;
  invitedAt?: number;
  lastSignInAt?: number;
};

export type RetailAccount = {
  id: string;
  name: string;
  /** The store map location this account belongs to (optional). */
  storeId?: string;
  contactName?: string;
  phone?: string;
  /** Staff only — never shown in the portal. */
  staffNotes?: string;
  active: boolean;
  logins: RetailLogin[];
  createdAt: number;
  updatedAt: number;
};

export type RequestStatus = "pending" | "approved" | "shipped" | "received" | "declined" | "cancelled";
export const REQUEST_STATUSES: RequestStatus[] = ["pending", "approved", "shipped", "received", "declined", "cancelled"];
export const STATUS_LABEL: Record<RequestStatus, string> = {
  pending: "Waiting for review",
  approved: "Approved, being packed",
  shipped: "Shipped",
  received: "Received",
  declined: "Declined",
  cancelled: "Cancelled",
};
/** Statuses that are done (nothing more happens). */
export const CLOSED: RequestStatus[] = ["received", "declined", "cancelled"];

export type RequestItem = { productId: string; name: string; qty: number; shippedQty?: number };

export type StockRequest = {
  id: string;
  /** Short reference shown to stores and staff, e.g. R7K2QD. */
  ref: string;
  accountId: string;
  storeName: string;
  items: RequestItem[];
  /** From the store. */
  note?: string;
  /** From staff, shown to the store. */
  staffNote?: string;
  status: RequestStatus;
  /** Login email that sent it. */
  requestedBy: string;
  createdAt: number;
  updatedAt: number;
  shippedAt?: number;
  receivedAt?: number;
  /** Units taken off the website's stock counts when shipped (only when staff chose to). */
  stockTaken?: Array<{ productId: string; qty: number }>;
  history: Array<{ at: number; status: RequestStatus; by: string; note?: string }>;
};

const accounts = new VersionedStore<RetailAccount>({
  name: "retail-accounts",
  legacyKey: "retail-accounts.json",
  localFile: path.join(process.cwd(), "data", "retail-accounts.json"),
  keep: 8,
  reconcileLegacy: false,
});

const requests = new VersionedStore<StockRequest>({
  name: "retail-requests",
  legacyKey: "retail-requests.json",
  localFile: path.join(process.cwd(), "data", "retail-requests.json"),
  keep: 8,
  reconcileLegacy: false,
});

type Fail = { ok: false; error: string; status: number };
const fail = (error: string, status: number) => ({ data: null, result: { ok: false as const, error, status } });

const norm = (e: unknown) => String(e ?? "").trim().toLowerCase().slice(0, 200);
const t = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const newId = (p: string) => `${p}_${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
const REF_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newRef = () => `R${Array.from(crypto.randomBytes(5)).map((b) => REF_CHARS[b % REF_CHARS.length]).join("")}`;

export const MAX_LOGINS = 10;
export const MAX_ITEMS = 40;
export const MAX_QTY = 10_000;

// ------------------------------------------------------------------ accounts

export async function getAccounts(): Promise<RetailAccount[]> {
  return (await accounts.read()).data.slice().sort((a, b) => a.name.localeCompare(b.name));
}

export async function getAccount(id: string): Promise<RetailAccount | undefined> {
  return (await accounts.read()).data.find((a) => a.id === id);
}

/** The login with this email (any account), with its account. */
export async function findLogin(emailRaw: string): Promise<{ account: RetailAccount; login: RetailLogin } | null> {
  const email = norm(emailRaw);
  if (!email) return null;
  for (const account of (await accounts.read()).data) {
    const login = account.logins.find((l) => l.email === email);
    if (login) return { account, login };
  }
  return null;
}

export async function findLoginById(loginId: string): Promise<{ account: RetailAccount; login: RetailLogin } | null> {
  for (const account of (await accounts.read()).data) {
    const login = account.logins.find((l) => l.id === loginId);
    if (login) return { account, login };
  }
  return null;
}

/** Both the account and the login are switched on. */
export const canSignIn = (x: { account: RetailAccount; login: RetailLogin } | null) => !!x && x.account.active && x.login.active;

let dummyHash: Promise<string> | null = null;

export async function verifyRetailPassword(email: string, password: string): Promise<{ account: RetailAccount; login: RetailLogin } | null> {
  const hit = await findLogin(email);
  if (!hit || hit.login.needsPassword) {
    // Same time either way, so the answer never shows whether an email has a login.
    dummyHash ||= bcrypt.hash("not-a-password", 10);
    await bcrypt.compare(password || "x", await dummyHash).catch(() => false);
    return null;
  }
  return (await bcrypt.compare(password || "", hit.login.passwordHash)) ? hit : null;
}

export type AccountInput = { name?: unknown; storeId?: unknown; contactName?: unknown; phone?: unknown; staffNotes?: unknown; active?: unknown };

function cleanAccount(input: AccountInput, partial: boolean): { ok: true; value: Partial<RetailAccount> } | { ok: false; error: string } {
  const out: Partial<RetailAccount> = {};
  if (!partial || input.name !== undefined) {
    const name = t(input.name, 120);
    if (!name) return { ok: false, error: "Give the store a name." };
    out.name = name;
  }
  if (input.storeId !== undefined) out.storeId = t(input.storeId, 80) || undefined;
  if (input.contactName !== undefined) out.contactName = t(input.contactName, 120) || undefined;
  if (input.phone !== undefined) {
    const phone = t(input.phone, 30);
    if (phone && !/^[+()0-9 .\-ext]{7,30}$/i.test(phone)) return { ok: false, error: "That phone number has characters it shouldn't." };
    out.phone = phone || undefined;
  }
  if (input.staffNotes !== undefined) out.staffNotes = String(input.staffNotes ?? "").trim().slice(0, 1000) || undefined;
  if (input.active !== undefined) out.active = !!input.active;
  return { ok: true, value: out };
}

const unusedHash = () => bcrypt.hash(crypto.randomBytes(24).toString("hex"), 10);

function cleanLogin(input: { email?: unknown; name?: unknown }): { ok: true; email: string; name: string } | { ok: false; error: string } {
  const email = norm(input.email);
  if (!EMAIL.test(email)) return { ok: false, error: "That email address doesn't look right." };
  const name = t(input.name, 120) || email.split("@")[0];
  return { ok: true, email, name };
}

type CreateResult = { ok: true; account: RetailAccount } | Fail;

/** Create a store account, optionally with its first logins. */
export async function createAccount(input: AccountInput & { logins?: Array<{ email?: unknown; name?: unknown }> }): Promise<CreateResult> {
  const c = cleanAccount(input, false);
  if (!c.ok) return { ok: false, error: c.error, status: 400 };
  const logins: RetailLogin[] = [];
  for (const raw of (input.logins || []).slice(0, MAX_LOGINS)) {
    if (!raw || (!raw.email && !raw.name)) continue;
    const l = cleanLogin(raw);
    if (!l.ok) return { ok: false, error: l.error, status: 400 };
    if (logins.some((x) => x.email === l.email)) continue;
    logins.push({ id: newId("rl"), email: l.email, name: l.name, passwordHash: await unusedHash(), needsPassword: true, active: true, createdAt: Date.now() });
  }
  const now = Date.now();
  const account: RetailAccount = { ...(c.value as RetailAccount), id: newId("ra"), active: input.active === undefined ? true : !!input.active, logins, createdAt: now, updatedAt: now };
  return accounts.mutate<CreateResult>((rows) => {
    const taken = new Set(rows.flatMap((a) => a.logins.map((l) => l.email)));
    const dupe = logins.find((l) => taken.has(l.email));
    if (dupe) return fail(`${dupe.email} already signs in for another store.`, 409);
    return { data: [...rows, account], result: { ok: true as const, account } };
  });
}

type UpdateResult = { ok: true; account: RetailAccount; before: RetailAccount } | Fail;

export async function updateAccount(id: string, input: AccountInput): Promise<UpdateResult> {
  const c = cleanAccount(input, true);
  if (!c.ok) return { ok: false, error: c.error, status: 400 };
  return accounts.mutate<UpdateResult>((rows) => {
    const i = rows.findIndex((a) => a.id === id);
    if (i < 0) return fail("That store account no longer exists.", 404);
    const next = rows.slice();
    next[i] = { ...rows[i], ...c.value, updatedAt: Date.now() };
    return { data: next, result: { ok: true as const, account: next[i], before: rows[i] } };
  });
}

export async function deleteAccount(id: string): Promise<RetailAccount | null> {
  return accounts.mutate<RetailAccount | null>((rows) => {
    const hit = rows.find((a) => a.id === id) || null;
    if (!hit) return { data: null, result: null };
    return { data: rows.filter((a) => a !== hit), result: hit };
  }, { allowShrink: true });
}

type AddLoginResult = { ok: true; account: RetailAccount; login: RetailLogin } | Fail;

export async function addLogin(accountId: string, input: { email?: unknown; name?: unknown }): Promise<AddLoginResult> {
  const l = cleanLogin(input);
  if (!l.ok) return { ok: false, error: l.error, status: 400 };
  const login: RetailLogin = { id: newId("rl"), email: l.email, name: l.name, passwordHash: await unusedHash(), needsPassword: true, active: true, createdAt: Date.now() };
  return accounts.mutate<AddLoginResult>((rows) => {
    const i = rows.findIndex((a) => a.id === accountId);
    if (i < 0) return fail("That store account no longer exists.", 404);
    if (rows.some((a) => a.logins.some((x) => x.email === l.email))) return fail(`${l.email} already has a store login.`, 409);
    if (rows[i].logins.length >= MAX_LOGINS) return fail(`A store can have up to ${MAX_LOGINS} logins.`, 400);
    const next = rows.slice();
    next[i] = { ...rows[i], logins: [...rows[i].logins, login], updatedAt: Date.now() };
    return { data: next, result: { ok: true as const, account: next[i], login } };
  });
}

type ChangeLoginResult = { ok: true; login: RetailLogin } | Fail;

/** Change one login: switch on/off, rename, or remove it. */
export async function changeLogin(accountId: string, loginId: string, change: { active?: boolean; name?: string; remove?: boolean }): Promise<ChangeLoginResult> {
  return accounts.mutate<ChangeLoginResult>((rows) => {
    const i = rows.findIndex((a) => a.id === accountId);
    const login = i >= 0 ? rows[i].logins.find((l) => l.id === loginId) : undefined;
    if (!login) return fail("That login no longer exists.", 404);
    const updated: RetailLogin = { ...login, ...(change.active !== undefined ? { active: !!change.active } : {}), ...(change.name ? { name: t(change.name, 120) } : {}) };
    const next = rows.slice();
    next[i] = {
      ...rows[i],
      logins: change.remove ? rows[i].logins.filter((l) => l.id !== loginId) : rows[i].logins.map((l) => (l.id === loginId ? updated : l)),
      updatedAt: Date.now(),
    };
    return { data: next, result: { ok: true as const, login: updated } };
  }, { allowShrink: !!change.remove });
}

type SetPwResult = { ok: true } | { ok: false; error: string };

export async function setLoginPassword(loginId: string, password: string): Promise<SetPwResult> {
  if (password.length < 8) return { ok: false, error: "Please use at least 8 characters." };
  if (password.length > 200) return { ok: false, error: "That password is too long." };
  const passwordHash = await bcrypt.hash(password, 10);
  return accounts.mutate<SetPwResult>((rows) => {
    const i = rows.findIndex((a) => a.logins.some((l) => l.id === loginId));
    if (i < 0) return { data: null, result: { ok: false as const, error: "That login no longer exists." } };
    const next = rows.slice();
    next[i] = { ...rows[i], logins: rows[i].logins.map((l) => (l.id === loginId ? { ...l, passwordHash, needsPassword: false } : l)), updatedAt: Date.now() };
    return { data: next, result: { ok: true as const } };
  });
}

export async function touchLogin(loginId: string, field: "lastSignInAt" | "invitedAt"): Promise<void> {
  await accounts
    .mutate<null>((rows) => {
      const i = rows.findIndex((a) => a.logins.some((l) => l.id === loginId));
      if (i < 0) return { data: null, result: null };
      const next = rows.slice();
      next[i] = { ...rows[i], logins: rows[i].logins.map((l) => (l.id === loginId ? { ...l, [field]: Date.now() } : l)) };
      return { data: next, result: null };
    })
    .catch((err) => console.error("[retail] touch login failed", err));
}

/** What staff see: no password hashes. */
export function staffView(a: RetailAccount) {
  return { ...a, logins: a.logins.map(({ passwordHash: _h, ...l }) => l) };
}

/** What the store itself sees: no staff notes, no hashes. */
export function storeView(a: RetailAccount) {
  return {
    id: a.id,
    name: a.name,
    contactName: a.contactName,
    phone: a.phone,
    logins: a.logins.map((l) => ({ id: l.id, name: l.name, email: l.email, active: l.active })),
  };
}

// ------------------------------------------------------------------ stock requests

export async function getRequests(): Promise<StockRequest[]> {
  return (await requests.read()).data.slice().sort((a, b) => b.createdAt - a.createdAt);
}

export async function requestsFor(accountId: string): Promise<StockRequest[]> {
  return (await getRequests()).filter((r) => r.accountId === accountId);
}

/** Validate requested lines against the products a store may ask for. */
export function cleanItems(raw: unknown, products: Array<{ id: string; name: string }>): { ok: true; items: RequestItem[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "Add at least one product." };
  const byId = new Map(products.map((p) => [p.id, p]));
  const merged = new Map<string, RequestItem>();
  for (const r of raw.slice(0, MAX_ITEMS)) {
    const id = t((r as { productId?: unknown })?.productId, 80);
    const qty = Math.floor(Number((r as { qty?: unknown })?.qty));
    const p = byId.get(id);
    if (!p) return { ok: false, error: "One of those products can't be requested." };
    if (!Number.isFinite(qty) || qty < 1 || qty > MAX_QTY) return { ok: false, error: `Quantities must be between 1 and ${MAX_QTY.toLocaleString("en-US")}.` };
    const prev = merged.get(id);
    merged.set(id, { productId: id, name: p.name, qty: Math.min(MAX_QTY, (prev?.qty || 0) + qty) });
  }
  return { ok: true, items: Array.from(merged.values()) };
}

export async function createRequest(account: RetailAccount, items: RequestItem[], note: string, by: string): Promise<StockRequest> {
  const now = Date.now();
  const req: StockRequest = {
    id: newId("rq"),
    ref: newRef(),
    accountId: account.id,
    storeName: account.name,
    items,
    note: note.trim().slice(0, 1000) || undefined,
    status: "pending",
    requestedBy: by,
    createdAt: now,
    updatedAt: now,
    history: [{ at: now, status: "pending", by }],
  };
  await requests.mutate<null>((rows) => ({ data: [...rows, req].slice(-5000), result: null }));
  return req;
}

/** Which moves staff may make from each status. */
export const STAFF_MOVES: Record<RequestStatus, RequestStatus[]> = {
  pending: ["approved", "shipped", "declined"],
  approved: ["shipped", "declined", "pending"],
  shipped: ["received", "approved"],
  received: ["shipped"],
  declined: ["pending"],
  cancelled: ["pending"],
};
/** Which moves the store may make. */
export const STORE_MOVES: Partial<Record<RequestStatus, RequestStatus[]>> = {
  pending: ["cancelled"],
  shipped: ["received"],
};

export type Move = {
  status: RequestStatus;
  by: string;
  note?: string;
  staffNote?: string;
  /** productId → units actually sent (staff, when shipping). */
  shippedQty?: Record<string, number>;
  /** Replaces what's recorded as taken from stock counts ([] = nothing taken / put back). */
  stockTaken?: Array<{ productId: string; qty: number }>;
};

type MoveResult = { ok: true; request: StockRequest; before: StockRequest } | Fail;

/**
 * Change a request's status. `who.store` = the store's own account id (store
 * moves only, its own requests only). The same status again (staff) just
 * saves the note.
 */
export async function moveRequest(id: string, move: Move, who: { store?: string }): Promise<MoveResult> {
  return requests.mutate<MoveResult>((rows) => {
    const i = rows.findIndex((r) => r.id === id || r.ref === id.toUpperCase());
    const r = rows[i];
    if (!r || (who.store && r.accountId !== who.store)) return fail("That request no longer exists.", 404);
    const noteOnly = !who.store && move.status === r.status;
    const allowed = who.store ? STORE_MOVES[r.status] || [] : STAFF_MOVES[r.status];
    if (!noteOnly && !allowed.includes(move.status)) {
      return fail(`A request that's “${STATUS_LABEL[r.status]}” can't be changed to “${STATUS_LABEL[move.status]}”.`, 409);
    }
    const now = Date.now();
    let items = r.items;
    if (move.status === "shipped") {
      items = r.items.map((it) => {
        const q = move.shippedQty?.[it.productId];
        return { ...it, shippedQty: q !== undefined && Number.isFinite(q) && q >= 0 ? Math.min(MAX_QTY, Math.floor(q)) : it.shippedQty ?? it.qty };
      });
    }
    const next: StockRequest = {
      ...r,
      items,
      status: move.status,
      updatedAt: now,
      ...(move.staffNote !== undefined ? { staffNote: move.staffNote.trim().slice(0, 1000) || undefined } : {}),
      ...(move.status === "shipped" && r.status !== "shipped" ? { shippedAt: now } : {}),
      ...(move.status === "received" ? { receivedAt: now } : {}),
      ...(move.stockTaken ? { stockTaken: move.stockTaken.length ? move.stockTaken : undefined } : {}),
      history: noteOnly && !move.note ? r.history : [...r.history, { at: now, status: move.status, by: move.by, ...(move.note ? { note: move.note.slice(0, 300) } : {}) }].slice(-50),
    };
    const out = rows.slice();
    out[i] = next;
    return { data: out, result: { ok: true as const, request: next, before: r } };
  });
}

/** Units each request sent (shipped or received). */
export const sentUnits = (r: StockRequest) =>
  r.status === "shipped" || r.status === "received" ? r.items.map((it) => ({ productId: it.productId, name: it.name, qty: it.shippedQty ?? it.qty })) : [];

/**
 * "Shipped to us": totals per product, and per month (brand.timezone), from shipped
 * and received requests. Units only, never money.
 */
export function shippedTracking(list: StockRequest[], monthOf: (t: number) => string) {
  const sent = list.filter((r) => r.status === "shipped" || r.status === "received").sort((a, b) => (a.shippedAt || a.updatedAt) - (b.shippedAt || b.updatedAt));
  const products = new Map<string, { productId: string; name: string; units: number; shipments: number; lastAt: number }>();
  const months = new Map<string, number>();
  for (const r of sent) {
    const at = r.shippedAt || r.updatedAt;
    for (const it of sentUnits(r)) {
      if (it.qty <= 0) continue;
      const p = products.get(it.productId) || { productId: it.productId, name: it.name, units: 0, shipments: 0, lastAt: 0 };
      p.units += it.qty;
      p.shipments += 1;
      p.lastAt = Math.max(p.lastAt, at);
      p.name = it.name;
      products.set(it.productId, p);
      const m = monthOf(at);
      months.set(m, (months.get(m) || 0) + it.qty);
    }
  }
  const last = sent[sent.length - 1];
  return {
    totalUnits: Array.from(products.values()).reduce((n, p) => n + p.units, 0),
    shipments: sent.length,
    lastShippedAt: last ? last.shippedAt || last.updatedAt : undefined,
    products: Array.from(products.values()).sort((a, b) => b.units - a.units),
    months: Array.from(months.entries()).sort((a, b) => b[0].localeCompare(a[0])).map(([month, units]) => ({ month, units })),
  };
}
