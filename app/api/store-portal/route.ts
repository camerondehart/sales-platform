import { NextResponse } from "next/server";
import { cleanItems, moveRequest, type RequestStatus } from "@/lib/retail";
import { getStoreSession } from "@/lib/retailAuth";
import { messageTeam, portalData, portalOn, portalProducts, requestView, siteUrlOf, submitRequest } from "@/lib/retailPortal";
import { overLimit } from "@/lib/assistant/limits";
import { auditSystem } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * The signed-in store's portal (switch retail_portal). Used by the portal
 * page and by the Concierge's confirm cards (the same calls either way).
 *   GET                                         → me, account, location, products, requests, tracking
 *   POST { items: [{productId, qty}], note }    → new stock request (emails the team)
 *   PATCH { id, action: "cancel" | "received" } → cancel a pending request / confirm a delivery arrived
 *   PUT { message }                             → a message to the team (emailed)
 */

async function session() {
  if (!(await portalOn())) return { error: NextResponse.json({ error: "The store portal is closed right now." }, { status: 404 }) };
  const s = await getStoreSession();
  if (!s) return { error: NextResponse.json({ error: "Please sign in again." }, { status: 401 }) };
  return { s };
}

export async function GET() {
  const g = await session();
  if (g.error) return g.error;
  return NextResponse.json(await portalData(g.s!.account, g.s!.login), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const g = await session();
  if (g.error) return g.error;
  const { account, login } = g.s!;
  if (overLimit(`store-req:${account.id}`, 20, 60 * 60_000)) return NextResponse.json({ error: "That's a lot of requests in an hour. Please wait a little, or message the team." }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { items?: unknown; note?: unknown } | null;
  const items = cleanItems(body?.items, await portalProducts());
  if (!items.ok) return NextResponse.json({ error: items.error }, { status: 400 });
  const r = await submitRequest(account, login, items.items, String(body?.note ?? ""), siteUrlOf(req));
  await auditSystem({ action: "retail.request", actor: login.email, actorType: "store", source: req.headers.get("x-fp-source") === "assistant" ? "ai" : "human", targetType: "retail_request", targetId: r.id, after: { store: account.name, ref: r.ref, items: r.items.map((i) => `${i.name} × ${i.qty}`) }, ok: true }).catch(() => {});
  return NextResponse.json({ ok: true, request: requestView(r) });
}

export async function PATCH(req: Request) {
  const g = await session();
  if (g.error) return g.error;
  const { account, login } = g.s!;
  const body = (await req.json().catch(() => null)) as { id?: unknown; action?: unknown } | null;
  const id = String(body?.id || "").slice(0, 80);
  const status: RequestStatus | null = body?.action === "cancel" ? "cancelled" : body?.action === "received" ? "received" : null;
  if (!id || !status) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const r = await moveRequest(id, { status, by: login.email }, { store: account.id });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  await auditSystem({ action: `retail.request_${status}`, actor: login.email, actorType: "store", source: req.headers.get("x-fp-source") === "assistant" ? "ai" : "human", targetType: "retail_request", targetId: r.request.id, before: { status: r.before.status }, after: { status, store: account.name, ref: r.request.ref }, ok: true }).catch(() => {});
  return NextResponse.json({ ok: true, request: requestView(r.request) });
}

export async function PUT(req: Request) {
  const g = await session();
  if (g.error) return g.error;
  const { account, login } = g.s!;
  const body = (await req.json().catch(() => null)) as { message?: unknown } | null;
  const message = String(body?.message ?? "").trim().slice(0, 2000);
  if (message.length < 2) return NextResponse.json({ error: "Write a message first." }, { status: 400 });
  if (overLimit(`store-msg:${account.id}`, 10, 60 * 60_000)) return NextResponse.json({ error: "That's a lot of messages in an hour. Please email us instead." }, { status: 429 });
  const r = await messageTeam(account, login, message);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
  return NextResponse.json({ ok: true });
}
