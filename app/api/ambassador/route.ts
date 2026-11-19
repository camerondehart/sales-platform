import { NextResponse } from "next/server";
import { getAmbassadorSession, panelData, pickableProducts } from "@/lib/ambassadorPanel";
import { cleanRange } from "@/lib/ambassadorPanelMath";
import { savePicks } from "@/lib/ambassadors";
import { auditSystem } from "@/lib/audit";

export const dynamic = "force-dynamic";

// The Ambassador panel's data (switch ambassador_panel). Only the signed-in
// ambassador's own numbers; nothing about who bought.
// GET ?range=7|30|90|365|all · PUT { productIds } = the products on their page.

const noStore = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  const s = await getAmbassadorSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: noStore });
  const range = cleanRange(new URL(req.url).searchParams.get("range"));
  return NextResponse.json(await panelData(s, range), { headers: noStore });
}

export async function PUT(req: Request) {
  const s = await getAmbassadorSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { productIds?: unknown } | null;
  const allowed = new Set((await pickableProducts()).map((p) => p.id));
  const r = await savePicks(s.ambassador.id, body?.productIds, allowed);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  await auditSystem({
    action: "ambassador.picks",
    actor: s.actingAs || s.member.email,
    actorType: s.actingAs ? "admin" : "member",
    source: "human",
    targetType: "ambassador",
    targetId: s.ambassador.id,
    before: { products: r.before },
    after: { products: r.after },
    ok: true,
    note: s.actingAs ? `Changed ${s.ambassador.name}'s picks while logged in as them (Ambassador panel)` : `${s.ambassador.name} changed their picks in the Ambassador panel`,
  }).catch(() => {});
  return NextResponse.json({ ok: true, selected: r.after });
}
