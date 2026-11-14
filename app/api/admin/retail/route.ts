import { NextResponse } from "next/server";
import { isAdmin, adminActor } from "@/lib/auth";
import { audited, auditDetail } from "@/lib/audit";
import { isEnabled } from "@/lib/flags";
import { getStores } from "@/lib/stores";
import { getStock } from "@/lib/stock";
import { addLogin, changeLogin, createAccount, deleteAccount, getAccount, getAccounts, getRequests, moveRequest, staffView, REQUEST_STATUSES, type RequestStatus } from "@/lib/retail";
import { sendStoreSetupLink } from "@/lib/retailAuth";
import { portalProducts, siteUrlOf } from "@/lib/retailPortal";
import { getProducts } from "@/lib/storage";
import { returnStock, takeStock } from "@/lib/stock";
import { updateAccount } from "@/lib/retail";

export const dynamic = "force-dynamic";

/**
 * Retail tab (staff only; every write is in the Activity log).
 *   GET                         → accounts (no password hashes), requests, map stores, products, stock counts
 *   POST   { name, storeId?, contactName?, phone?, staffNotes?, logins: [{name, email}], invite? }
 *   PUT    { id, ...fields }                              → edit an account
 *          { id, addLogin: { name, email }, invite? }      → add a login
 *          { id, loginId, active? | remove? | invite? }    → change / remove / (re)send the set-password email
 *   PATCH  { requestId, status, staffNote?, shippedQty?, stock?: "take" | "return" } → move a stock request
 *   DELETE ?id=                                          → delete an account (its requests stay)
 *
 * Stock counts change only when staff choose `stock` (the tab asks each time).
 */

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function GET() {
  if (!(await isAdmin())) return bad("unauthorized", 401);
  const [accounts, requests, stores, products, stockOn, portal] = await Promise.all([
    getAccounts(),
    getRequests(),
    getStores().catch(() => []),
    portalProducts(),
    isEnabled("stock_counts").catch(() => false),
    isEnabled("retail_portal").catch(() => false),
  ]);
  const stock = await getStock().catch(() => new Map<string, number>());
  return NextResponse.json(
    {
      accounts: accounts.map(staffView),
      requests,
      stores: stores.map((s) => ({ id: s.id, name: s.name, city: s.city, active: s.active })),
      products,
      stockOn,
      portalOn: portal,
      stock: Object.fromEntries(stock),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function body(req: Request): Promise<Record<string, any> | null> {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? b : null;
  } catch {
    return null;
  }
}

async function invite(req: Request, accountId: string, loginId: string): Promise<string | null> {
  const account = await getAccount(accountId);
  const login = account?.logins.find((l) => l.id === loginId);
  if (!account || !login) return "That login no longer exists.";
  if (!account.active || !login.active) return "Switch the store and login on first.";
  const r = await sendStoreSetupLink(account, login, siteUrlOf(req));
  return r.ok ? null : r.error;
}

async function POST_handler(req: Request) {
  if (!(await isAdmin())) return bad("unauthorized", 401);
  const b = await body(req);
  if (!b) return bad("Bad request.");
  const r = await createAccount({ ...b, logins: Array.isArray(b.logins) ? b.logins : [] });
  if (!r.ok) return bad(r.error, r.status);
  auditDetail({ targetId: r.account.id, after: { name: r.account.name, storeId: r.account.storeId, logins: r.account.logins.map((l) => l.email) } });
  const failed: string[] = [];
  if (b.invite) for (const l of r.account.logins) if (await invite(req, r.account.id, l.id)) failed.push(l.email);
  return NextResponse.json({ ok: true, account: staffView((await getAccount(r.account.id)) || r.account), ...(failed.length ? { warning: `Saved, but the email didn't send to ${failed.join(", ")}. Try "Send link" again.` } : {}) });
}

async function PUT_handler(req: Request) {
  if (!(await isAdmin())) return bad("unauthorized", 401);
  const b = await body(req);
  const id = String(b?.id || "");
  if (!b || !id) return bad("Which store account?");

  if (b.addLogin && typeof b.addLogin === "object") {
    const r = await addLogin(id, b.addLogin);
    if (!r.ok) return bad(r.error, r.status);
    auditDetail({ action: "retail.login_add", targetId: id, after: { email: r.login.email } });
    const err = b.invite ? await invite(req, id, r.login.id) : null;
    return NextResponse.json({ ok: true, account: staffView((await getAccount(id))!), ...(err ? { warning: `Login added, but the email didn't send: ${err}` } : {}) });
  }

  if (b.loginId) {
    const loginId = String(b.loginId);
    if (b.invite) {
      auditDetail({ action: "retail.login_invite", targetId: id, after: { loginId } });
      const err = await invite(req, id, loginId);
      if (err) return bad(err, 502);
      return NextResponse.json({ ok: true, account: staffView((await getAccount(id))!) });
    }
    const r = await changeLogin(id, loginId, { active: b.active === undefined ? undefined : !!b.active, remove: !!b.remove, name: typeof b.name === "string" ? b.name : undefined });
    if (!r.ok) return bad(r.error, r.status);
    auditDetail({ action: b.remove ? "retail.login_remove" : "retail.login_update", targetId: id, after: { email: r.login.email, active: b.remove ? "removed" : r.login.active } });
    return NextResponse.json({ ok: true, account: staffView((await getAccount(id))!) });
  }

  const r = await updateAccount(id, b);
  if (!r.ok) return bad(r.error, r.status);
  auditDetail({ targetId: id, before: { name: r.before.name, active: r.before.active, storeId: r.before.storeId }, after: { name: r.account.name, active: r.account.active, storeId: r.account.storeId } });
  return NextResponse.json({ ok: true, account: staffView(r.account) });
}

async function PATCH_handler(req: Request) {
  if (!(await isAdmin())) return bad("unauthorized", 401);
  const b = await body(req);
  const requestId = String(b?.requestId || "");
  const status = String(b?.status || "") as RequestStatus;
  if (!b || !requestId || !REQUEST_STATUSES.includes(status) || status === "cancelled") return bad("Bad request.");
  const before = (await getRequests()).find((r) => r.id === requestId);
  if (!before) return bad("That request no longer exists.", 404);

  let shippedQty: Record<string, number> | undefined;
  if (b.shippedQty && typeof b.shippedQty === "object") {
    shippedQty = {};
    for (const [k, v] of Object.entries(b.shippedQty as Record<string, unknown>)) {
      const n = Math.floor(Number(v));
      if (Number.isFinite(n) && n >= 0) shippedQty[k.slice(0, 80)] = n;
    }
  }

  // Stock counts: only when staff chose to (the tab asks).
  let stockTaken: Array<{ productId: string; qty: number }> | undefined;
  let stockNote: string | undefined;
  if (b.stock === "take" && status === "shipped" && !(before.stockTaken || []).length) {
    const products = new Map((await getProducts()).map((p) => [p.id, p]));
    const lines = before.items.map((it) => ({ productId: it.productId, quantity: shippedQty?.[it.productId] ?? it.shippedQty ?? it.qty })).filter((l) => l.quantity > 0);
    const r = await takeStock(lines, products);
    stockTaken = r.taken;
    stockNote = r.taken.length ? `Took ${r.taken.reduce((n, t) => n + t.qty, 0)} units off stock counts` : "None of these products are counted in Stock counts";
  } else if (b.stock === "return" && (before.stockTaken || []).length && status !== "shipped" && status !== "received") {
    await returnStock(before.stockTaken!);
    stockTaken = [];
    stockNote = `Put ${before.stockTaken!.reduce((n, t) => n + t.qty, 0)} units back on stock counts`;
  }

  const r = await moveRequest(requestId, {
    status,
    by: await adminActor(),
    note: stockNote,
    staffNote: typeof b.staffNote === "string" ? b.staffNote : undefined,
    shippedQty,
    stockTaken,
  }, {});
  if (!r.ok) {
    // The move was refused after stock was taken: put it straight back.
    if (stockTaken?.length) await returnStock(stockTaken);
    return bad(r.error, r.status);
  }
  auditDetail({ action: "retail.request_status", targetType: "retail_request", targetId: requestId, before: { status: r.before.status }, after: { status, store: r.request.storeName, ref: r.request.ref, ...(stockNote ? { stock: stockNote } : {}) } });
  return NextResponse.json({ ok: true, request: r.request, ...(stockNote ? { stockNote } : {}) });
}

async function DELETE_handler(req: Request) {
  if (!(await isAdmin())) return bad("unauthorized", 401);
  const id = new URL(req.url).searchParams.get("id") || "";
  const gone = id ? await deleteAccount(id) : null;
  if (!gone) return bad("That store account no longer exists.", 404);
  auditDetail({ targetId: id, before: { name: gone.name, logins: gone.logins.map((l) => l.email) } });
  return NextResponse.json({ ok: true });
}

export const POST = audited("retail.account_create", "retail", POST_handler);
export const PUT = audited("retail.account_update", "retail", PUT_handler);
export const PATCH = audited("retail.request_status", "retail_request", PATCH_handler);
export const DELETE = audited("retail.account_delete", "retail", DELETE_handler);
