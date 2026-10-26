import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { COURSE_HTML } from "../courseHtml";

export const dynamic = "force-dynamic";

// Serves the course as a standalone page (its own tab, full width, printable).
// Same admin gate as /help — the course documents the whole back office.
export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.redirect(
      new URL("/admin", process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000")
    );
  }
  return new NextResponse(COURSE_HTML, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
