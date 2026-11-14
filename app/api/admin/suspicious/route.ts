import { NextResponse } from "next/server";
import { isAdmin, adminActor } from "@/lib/auth";
import { audited, auditDetail } from "@/lib/audit";
import { isEnabled } from "@/lib/flags";
import { getUsers } from "@/lib/users";
import { getOrders } from "@/lib/orders";
import { getDiscounts } from "@/lib/discounts";
import { findSuspicious, RECENT_DAYS, type SusCase } from "@/lib/suspicion";
import { readRiskLog, readReviewed, setReviewed, KEEP_DAYS } from "@/lib/riskLog";

export const dynamic = "force-dynamic";

/**
 * Members → Suspicious activity. Read-only detection (lib/suspicion.ts) over
 * members, orders and the sign-up / checkout log. Flags for staff to review;
 * nothing is ever blocked or changed here except the "Looks fine" tick.
 */
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isEnabled("suspicious_activity"))) return NextResponse.json({ on: false }, { headers: { "Cache-Control": "no-store" } });
  try {
    const [users, orders, events, reviewed, discounts] = await Promise.all([
      getUsers(),
      getOrders(),
      readRiskLog().catch(() => []),
      readReviewed().catch(() => []),
      getDiscounts().catch(() => []),
    ]);
    const all = findSuspicious({
      users,
      orders,
      events,
      limitedCodes: discounts.filter((d) => d.perCustomerLimit).map((d) => d.code),
    });
    const seen = new Map(reviewed.map((r) => [r.id, r]));
    const open: SusCase[] = [];
    const done: Array<SusCase & { reviewedAt: number; reviewedBy: string }> = [];
    for (const c of all) {
      const r = seen.get(c.id);
      if (r) done.push({ ...c, reviewedAt: r.at, reviewedBy: r.by });
      else open.push(c);
    }
    return NextResponse.json(
      { on: true, cases: open, reviewed: done, logged: events.length, recentDays: RECENT_DAYS, keepDays: KEEP_DAYS },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[suspicious] failed", err);
    return NextResponse.json({ error: "Couldn't check for suspicious activity. Try again in a moment." }, { status: 503 });
  }
}

/** Tick a case as looked at ("Looks fine"), or put it back. */
async function POST_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { id?: unknown; reviewed?: unknown; summary?: unknown };
  const id = typeof body.id === "string" && /^sus_[a-z0-9]{1,16}$/.test(body.id) ? body.id : "";
  if (!id) return NextResponse.json({ error: "Which one?" }, { status: 400 });
  const reviewed = body.reviewed !== false;
  const summary = typeof body.summary === "string" ? body.summary : undefined;
  await setReviewed(id, reviewed, await adminActor(), summary);
  auditDetail({ targetId: id, note: `${reviewed ? "Marked as looks fine" : "Put back for review"}${summary ? `: ${summary.slice(0, 160)}` : ""}` });
  return NextResponse.json({ ok: true });
}
export const POST = audited("suspicious.review", "suspicious", POST_handler);
