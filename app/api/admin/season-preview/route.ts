import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { isEntranceKey } from "@/lib/entranceThemes";
import { SEASON_PREVIEW_COOKIE } from "@/lib/seasonPreview";

export const dynamic = "force-dynamic";

/**
 * Settings → Entrance animation → Preview background. Staff only: shows one
 * season's site background in THIS browser for up to an hour (a cookie the
 * layout honours only for signed-in staff). Nothing is saved; nobody else sees it.
 *   GET ?key=<theme>&to=/      start previewing, then open `to`
 *   GET ?key=off&to=/admin     stop
 */
export async function GET(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || "off";
  const toRaw = url.searchParams.get("to") || "/";
  const to = toRaw.startsWith("/") && !toRaw.startsWith("//") ? toRaw : "/";
  const res = NextResponse.redirect(new URL(to, url.origin), 303);
  if (key !== "off" && isEntranceKey(key)) {
    res.cookies.set(SEASON_PREVIEW_COOKIE, key, { path: "/", maxAge: 3600, sameSite: "lax", httpOnly: true, secure: url.protocol === "https:" });
  } else {
    res.cookies.set(SEASON_PREVIEW_COOKIE, "", { path: "/", maxAge: 0 });
  }
  return res;
}
