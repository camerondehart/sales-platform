import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { recordCardFeedback } from "@/lib/assistant/learnedNotes";

export const dynamic = "force-dynamic";

/**
 * Staff chat → what happened to a Concierge card (confirmed / dismissed /
 * failed). Only feeds the nightly notes review; the confirmed change itself is
 * already in the Activity log, so this small note isn't logged again.
 */
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    await recordCardFeedback({ kind: body.kind, title: body.title, outcome: body.outcome, todayKey: body.todayKey });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't save." }, { status: 400 });
  }
}
