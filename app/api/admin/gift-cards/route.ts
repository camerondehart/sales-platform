import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { audited, auditDetail } from "@/lib/audit";
import { isEnabled } from "@/lib/flags";
import { allGiftCards, voidCard } from "@/lib/giftCards";

export const dynamic = "force-dynamic";

// Settings → Gift cards: every card with its state and balance (staff only).
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const cards = (await allGiftCards()).slice().sort((a, b) => b.createdAt - a.createdAt);
  return NextResponse.json(
    {
      switchOn: await isEnabled("gift_cards").catch(() => false),
      cards: cards.map(({ token: _t, ...c }) => ({ ...c, ref: c.orderId.slice(-6).toUpperCase() })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

async function POST_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (body.action !== "void" || !body.id) return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const before = (await allGiftCards()).find((c) => c.id === body.id);
  const card = await voidCard(String(body.id));
  if (!card) return NextResponse.json({ error: "That card isn't active." }, { status: 409 });
  auditDetail({ targetId: card.id, before: before ? { state: before.state, balance: before.balance } : undefined, after: { state: "void", code: card.code, to: card.toEmail }, note: `Gift card ${card.code} voided` });
  return NextResponse.json({ ok: true });
}

export const POST = audited("giftcard.void", "giftcard", POST_handler);
