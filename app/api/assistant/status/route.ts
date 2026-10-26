import { NextResponse } from "next/server";
import { assistantStatus } from "@/lib/assistant/engine";

export const dynamic = "force-dynamic";

// Called by the chat launcher on page load. Reads only in-memory caches, and
// the response is shared through the CDN for a minute, so it costs no
// storage operations per visitor.
export async function GET(req: Request) {
  try {
    // Staff diagnostics are served from the admin-only endpoint instead —
    // this response is publicly cached.
    const { staffNote: _omit, ...status } = await assistantStatus(req);
    return NextResponse.json(status, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (err) {
    console.error("[assistant] status failed", err);
    return NextResponse.json(
      { available: { public: false, member: false, admin: false }, name: "Assistant" },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
