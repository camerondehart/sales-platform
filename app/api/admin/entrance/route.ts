import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { audited, auditDetail } from "@/lib/audit";
import { entranceStatus, setEntranceChoice } from "@/lib/entrance";
import { cleanEntranceChoice } from "@/lib/entranceThemes";

export const dynamic = "force-dynamic";

// Settings → Entrance animation. GET = what's showing and the schedule; PUT { choice } = "auto" | a theme key.
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await entranceStatus(), { headers: { "Cache-Control": "no-store" } });
}

async function PUT_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { choice?: unknown };
  if (b.choice !== "auto" && cleanEntranceChoice(b.choice) !== b.choice) return NextResponse.json({ error: "Unknown entrance theme." }, { status: 400 });
  const r = await setEntranceChoice(cleanEntranceChoice(b.choice));
  auditDetail({ targetId: "entrance", before: { choice: r.before }, after: { choice: r.after } });
  return NextResponse.json({ ok: true, ...(await entranceStatus()) });
}

export const PUT = audited("entrance.set", "settings", PUT_handler);
