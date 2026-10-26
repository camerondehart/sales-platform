import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { escalationStatus, recentEscalations } from "@/lib/assistant/usage";

export const dynamic = "force-dynamic";

/** How many "handed to the team" requests are still waiting — for the tab badge. */
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const all = await recentEscalations();
  return NextResponse.json(
    { open: all.filter((e) => escalationStatus(e) === "open").length },
    { headers: { "Cache-Control": "no-store" } }
  );
}
