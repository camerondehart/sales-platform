import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { checkPoints, fixPoints } from "@/lib/loyalty";
import { audited, auditDetail } from "@/lib/audit";

// Settings → Sales & loyalty rules → Points check. The sanity check (GET) and
// its fix (POST): every member's points from orders since Nov 1 must equal the
// product dollars of their completed orders since Nov 1.
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await checkPoints());
}

async function POST_handler() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const done = await fixPoints();
  auditDetail({ after: { orders: done.length, changes: done } });
  return NextResponse.json({ ok: true, done, check: await checkPoints() });
}

// One audit-log entry per request (see lib/audit.ts).
export const POST = audited("loyalty.points_fix", "member", POST_handler);
