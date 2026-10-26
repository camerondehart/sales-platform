import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { pageTranscripts, pruneTranscripts } from "@/lib/assistant/transcripts";
import { chatInsights } from "@/lib/assistant/chatInsights";
import { singleton } from "@/lib/assistant/singleton";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const P = singleton("transcriptPrune", () => ({ at: 0 }));

/** Concierge conversations (last 30 days) + insights. ?audience=public|member|admin&flagged=1&q=…&page=0&pageSize=20 */
export async function GET(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Housekeeping: drop anything past 30 days (at most every 6 hours per instance).
  if (Date.now() - P.at > 6 * 3600_000) {
    P.at = Date.now();
    pruneTranscripts().catch((err) => console.error("[transcripts] prune failed", err));
  }
  const p = new URL(req.url).searchParams;
  const audience = ["public", "member", "admin"].includes(String(p.get("audience"))) ? String(p.get("audience")) : undefined;
  const [pg, insights] = await Promise.all([
    pageTranscripts({
      audience,
      flagged: p.get("flagged") === "1",
      q: p.get("q") || undefined,
      page: Number(p.get("page")) || 0,
      pageSize: Number(p.get("pageSize")) || 20,
    }),
    p.get("insights") === "0" ? Promise.resolve(null) : chatInsights(),
  ]);
  return NextResponse.json(
    { items: pg.items, page: pg.page, pageSize: pg.pageSize, hasMore: pg.hasMore, total: pg.total, insights },
    { headers: { "Cache-Control": "no-store" } }
  );
}
