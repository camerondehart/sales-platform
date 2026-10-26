import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { adjustPoints } from "@/lib/loyalty";
import { audited } from "@/lib/audit";

// Admin: adjust a member's loyalty points.
async function POST_handler(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { userId, action, amount, reason } = await req.json();
  if (!userId) return NextResponse.json({ error: "missing userId" }, { status: 400 });

  if (action === "points") {
    const delta = Number(amount);
    if (!Number.isFinite(delta) || delta === 0) {
      return NextResponse.json({ error: "Enter a non-zero amount." }, { status: 400 });
    }
    const balance = await adjustPoints(
      userId,
      delta,
      reason?.trim() || "Manual adjustment by admin"
    );
    if (balance === null) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    return NextResponse.json({ ok: true, points: balance });
  }


  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

// One audit-log entry per request (see lib/audit.ts).
export const POST = audited("member.points_adjust", "member", POST_handler);
