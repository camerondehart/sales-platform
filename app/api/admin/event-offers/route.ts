import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { audited, auditDetail } from "@/lib/audit";
import { getDiscounts } from "@/lib/discounts";
import { eventKey, getEventOffers, offerText, setEventOffer, usable } from "@/lib/eventOffers";

export const dynamic = "force-dynamic";

/** Marketing → Event sign-up QR code → "Offer for this event". */
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [offers, discounts] = await Promise.all([getEventOffers(), getDiscounts()]);
  const byId = new Map(discounts.map((d) => [d.id, d]));
  return NextResponse.json(
    {
      offers: offers.map((o) => {
        const d = byId.get(o.discountId);
        return { ...o, code: d?.code || null, text: d ? offerText(d) : null, live: usable(d) };
      }),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

async function PUT_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { event?: unknown; discountId?: unknown };
  const event = String(body.event || "").trim();
  if (!eventKey(event)) return NextResponse.json({ error: "Type the event name first." }, { status: 400 });
  const discountId = body.discountId ? String(body.discountId) : null;
  if (discountId) {
    const d = (await getDiscounts()).find((x) => x.id === discountId);
    if (!d) return NextResponse.json({ error: "That discount code doesn't exist any more." }, { status: 400 });
    const code = d.code;
    if (!usable(d)) return NextResponse.json({ error: `${code} is switched off, expired or used up — pick another or update it under Discount codes.` }, { status: 400 });
  }
  const { before, after } = await setEventOffer(event, discountId);
  auditDetail({ targetId: eventKey(event), before, after });
  return GET();
}

export const PUT = audited("event_offer.set", "event", PUT_handler);
