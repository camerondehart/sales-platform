import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { audited, auditDetail } from "@/lib/audit";
import { addPayout, deleteAmbassador, getAmbassadors, removePayout, saveAmbassador } from "@/lib/ambassadors";
import { ambassadorStatsFor } from "@/lib/ambassadorData";

export const dynamic = "force-dynamic";

// Dashboard → Ambassadors. Staff only; every write is in the Activity log.
// GET: every ambassador with their numbers (all-time) and the totals.

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ambassadors = await getAmbassadors();
  const stats = await ambassadorStatsFor(ambassadors);
  const live = ambassadors.filter((a) => a.active);
  const sum = (k: "visits" | "orders" | "sales" | "earnedAllTime" | "paidOut" | "owed") => Math.round(Object.values(stats).reduce((n, s) => n + s[k], 0) * 100) / 100;
  const overview = { live: live.length, total: ambassadors.length, visits: sum("visits"), orders: sum("orders"), sales: sum("sales"), earned: sum("earnedAllTime"), paidOut: sum("paidOut"), owed: sum("owed") };
  return NextResponse.json({ ambassadors, stats, overview }, { headers: { "Cache-Control": "no-store" } });
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? b : null;
  } catch {
    return null;
  }
}

const summary = (a: { name: string; slug: string; active: boolean; productIds: string[]; discountCode?: string; socials: unknown[]; email?: string; terms?: { commissionPct: number; growthOn: boolean; growthPct?: number; trialDays: number; windowDays: number; repeatPurchases: boolean } }) => ({
  name: a.name, page: `/${a.slug}`, live: a.active, products: a.productIds.length, socials: a.socials.length, code: a.discountCode || null, email: a.email || null,
  ...(a.terms ? { commission: a.terms.growthOn ? a.terms.growthPct : a.terms.commissionPct, trialDays: a.terms.trialDays, windowDays: a.terms.windowDays, repeat: a.terms.repeatPurchases } : {}),
});

async function POST_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await readBody(req);
  if (!body) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const r = await saveAmbassador(undefined, body);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  auditDetail({ targetId: r.ambassador.id, after: summary(r.ambassador) });
  return NextResponse.json({ ok: true, ambassador: r.ambassador });
}

async function PUT_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await readBody(req);
  const id = String(body?.id || "");
  if (!body || !id) return NextResponse.json({ error: "Which ambassador?" }, { status: 400 });
  // Record a payout ({ id, payout: { amount, at, note } }) or undo one ({ id, removePayout }).
  if (body.payout && typeof body.payout === "object") {
    const p = await addPayout(id, body.payout as Record<string, unknown>);
    if (!p.ok) return NextResponse.json({ error: p.error }, { status: p.status });
    auditDetail({ targetId: id, action: "ambassador.payout", after: { name: p.ambassador.name, amount: p.payout.amount, note: p.payout.note || null } });
    return NextResponse.json({ ok: true, ambassador: p.ambassador });
  }
  if (typeof body.removePayout === "string") {
    const p = await removePayout(id, body.removePayout);
    if (!p) return NextResponse.json({ error: "That payout is already gone." }, { status: 404 });
    auditDetail({ targetId: id, action: "ambassador.payout_removed", before: { name: p.ambassador.name, amount: p.payout.amount, note: p.payout.note || null } });
    return NextResponse.json({ ok: true, ambassador: p.ambassador });
  }
  const r = await saveAmbassador(id, body);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  auditDetail({ targetId: id, before: r.before ? summary(r.before) : undefined, after: summary(r.ambassador) });
  return NextResponse.json({ ok: true, ambassador: r.ambassador });
}

async function DELETE_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") || "";
  const gone = id ? await deleteAmbassador(id) : null;
  if (!gone) return NextResponse.json({ error: "That ambassador no longer exists." }, { status: 404 });
  auditDetail({ targetId: id, before: summary(gone) });
  return NextResponse.json({ ok: true });
}

export const POST = audited("ambassador.create", "ambassador", POST_handler);
export const PUT = audited("ambassador.update", "ambassador", PUT_handler);
export const DELETE = audited("ambassador.delete", "ambassador", DELETE_handler);
