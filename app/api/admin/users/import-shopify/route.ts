import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { audited, auditDetail } from "@/lib/audit";
import { importShopify } from "@/lib/shopifyImport";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Members → Import from Shopify. { csv, dryRun: true } previews what would
// happen (nothing saved); { csv, dryRun: false } does it. No emails are sent.
async function POST_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { csv?: unknown; dryRun?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Could not read that file." }, { status: 400 });
  }
  const csv = typeof body.csv === "string" ? body.csv : "";
  if (!csv.trim()) return NextResponse.json({ error: "That file looked empty." }, { status: 400 });
  const dryRun = body.dryRun !== false;
  // Never let the file itself reach the Activity log.
  auditDetail({ after: { file: "Shopify customers CSV (not stored)", dryRun } });
  try {
    const out = await importShopify(csv, { dryRun });
    if ("error" in out) return NextResponse.json(out, { status: 400 });
    if (!dryRun) {
      // Counts only — no customer details in the Activity log.
      const { sample: _s, ...counts } = out;
      auditDetail({ after: counts });
    }
    return NextResponse.json({ ok: true, dryRun, ...out });
  } catch (err) {
    console.error("[shopify import] failed", err);
    return NextResponse.json({ error: "The import didn't finish — nothing half-done is left behind for existing members. Please try again." }, { status: 500 });
  }
}

export const POST = audited("member.import_shopify", "member", POST_handler);
