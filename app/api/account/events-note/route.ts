import { NextResponse } from "next/server";
import { getApprovedVisitor, getVisitor } from "@/lib/auth";
import { markEventsNoteSeen } from "@/lib/localEventsNote";

// The one-time events note for locals has been shown (lib/localEvents.ts).
export async function POST() {
  const user = await getApprovedVisitor();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Staff "Log in as" never uses up the member's note.
  if ((await getVisitor())?.as) return NextResponse.json({ ok: true, skipped: true });
  const ok = await markEventsNoteSeen(user.id);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "user not found" }, { status: 404 });
}
