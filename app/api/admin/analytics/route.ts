import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { computeDashboard } from "@/lib/dashboard";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Everything the Analytics tab draws, for 7 / 30 / 90 / 365 days. */
export async function GET(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const days = Number(new URL(req.url).searchParams.get("days")) || 30;
  try {
    return NextResponse.json(await computeDashboard(days), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[analytics] dashboard failed", err);
    return NextResponse.json({ error: "Couldn't build the dashboard. Try again in a moment." }, { status: 500 });
  }
}
