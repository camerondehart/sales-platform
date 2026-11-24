import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { audited } from "@/lib/audit";
import { isEnabled } from "@/lib/flags";
import { sendPickupReady } from "@/lib/pickupReady";

export const dynamic = "force-dynamic";

/** Order details → "Ready for pickup": email the customer their order is ready. */
async function POST_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isEnabled("pickup_ready"))) return NextResponse.json({ error: "The “Ready-for-pickup messages” switch is off." }, { status: 400 });
  const b = (await req.json().catch(() => ({}))) as { id?: unknown };
  const id = typeof b.id === "string" ? b.id.slice(0, 80) : "";
  if (!id) return NextResponse.json({ error: "Which order?" }, { status: 400 });
  const r = await sendPickupReady(id, "staff");
  if (!r.ok) return NextResponse.json({ error: r.error, order: r.order }, { status: r.order ? 502 : 400 });
  return NextResponse.json({ ok: true, order: r.order });
}
export const POST = audited("order.pickup_ready", "order", POST_handler);
