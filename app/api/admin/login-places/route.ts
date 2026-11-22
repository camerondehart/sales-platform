import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { isEnabled } from "@/lib/flags";
import { addDays, pacificDay } from "@/lib/periods";
import { LOGIN_KINDS, summarize, type LoginKind } from "@/lib/loginPlaces";
import { readLoginPlaces } from "@/lib/loginPlacesLog";

export const dynamic = "force-dynamic";

/** Analytics → Where people sign in: totals per rough town for the last N local days. */
export async function GET(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isEnabled("login_map"))) return NextResponse.json({ on: false });
  const url = new URL(req.url);
  const days = Math.min(400, Math.max(1, Math.floor(Number(url.searchParams.get("days")) || 30)));
  const k = url.searchParams.get("kind") || "";
  const kind = (LOGIN_KINDS as string[]).includes(k) ? (k as LoginKind) : undefined;
  try {
    const rows = await readLoginPlaces();
    const fromDay = addDays(pacificDay(), -(days - 1));
    const { places, total } = summarize(rows, fromDay, kind);
    const firstDay = rows.reduce<string | null>((m, r) => (!m || r.day < m ? r.day : m), null);
    return NextResponse.json(
      { on: true, days, kind: kind || "all", total, towns: places.length, places: places.slice(0, 300), firstDay },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[login-places] read failed", err);
    return NextResponse.json({ error: "Couldn't load sign-in places. Try again in a moment." }, { status: 500 });
  }
}
