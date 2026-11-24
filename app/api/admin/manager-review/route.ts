import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { audited } from "@/lib/audit";
import { runManagerReview, undoTweaks } from "@/lib/assistant/managerReview";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Today panel → Manager's take: "Run now" and "Undo tweaks". */
async function POST_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { action?: unknown };
  if (b.action === "undo") {
    const ok = await undoTweaks();
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Nothing to undo." }, { status: 400 });
  }
  if (b.action === "run") {
    const r = await runManagerReview({ trigger: "manual", req });
    if (r.skipped) return NextResponse.json({ error: r.skipped }, { status: 400 });
    if (!r.ok) return NextResponse.json({ error: r.error || "The review didn't finish." }, { status: 502 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
export const POST = audited("manager.change", "today", POST_handler);
