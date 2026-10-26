import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { wrapCampaign } from "@/lib/campaignEmail";

export const dynamic = "force-dynamic";

/**
 * Staff preview of an email template or campaign draft: the exact HTML a
 * subscriber would get (house header, body, footer), with a sample first name.
 * Read-only — nothing is saved or sent. Shown in a sandboxed frame.
 */
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { subject?: unknown; body?: unknown };
  const body = String(b.body || "").slice(0, 50_000);
  const subject = String(b.subject || "").slice(0, 200);
  if (!body.trim()) return NextResponse.json({ error: "Nothing to preview yet." }, { status: 400 });
  return NextResponse.json({ subject, html: wrapCampaign(body, "#unsubscribe", "Alex") }, { headers: { "Cache-Control": "no-store" } });
}
