import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { readAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Activity log for the dashboard: newest first, with simple filters. */
export async function GET(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const p = new URL(req.url).searchParams;
  const entries = await readAudit({
    months: Number(p.get("months")) || 1,
    action: p.get("action") || undefined,
    source: p.get("source") || undefined,
    targetType: p.get("targetType") || undefined,
    q: p.get("q") || undefined,
    failedOnly: p.get("failed") === "1",
    limit: Number(p.get("limit")) || 200,
  });
  return NextResponse.json({ entries }, { headers: { "Cache-Control": "no-store" } });
}
