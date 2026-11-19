import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { audited, auditDetail } from "@/lib/audit";
import { isEnabled } from "@/lib/flags";
import { adjustBalance, allGiftCards, voidCard } from "@/lib/giftCards";
import { giftMoney } from "@/lib/giftCardRules";

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
  // Edit balance: set an active card to a new amount (never below $0), with an optional reason.
  if (body.action === "balance" && body.id) {
    const reason = String(body.reason || "").trim().slice(0, 200);
    const r = await adjustBalance(String(body.id), Number(body.balance), reason);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
    const c = r.card;
    auditDetail({
      action: "giftcard.balance",
      targetId: c.id,
      before: { balance: r.before },
      after: { balance: c.balance, code: c.code, to: c.toEmail, reason: reason || undefined },
      note: `Gift card ${c.code} balance ${giftMoney(r.before)} → ${giftMoney(c.balance)}${reason ? ` (${reason})` : ""}`,
    });
    return NextResponse.json({ ok: true, balance: c.balance });
  }
  if (body.action !== "void" || !body.id) return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const before = (await allGiftCards()).find((c) => c.id === body.id);
  const card = await voidCard(String(body.id));
  if (!card) return NextResponse.json({ error: "That card isn't active." }, { status: 409 });
  auditDetail({ targetId: card.id, before: before ? { state: before.state, balance: before.balance } : undefined, after: { state: "void", code: card.code, to: card.toEmail }, note: `Gift card ${card.code} voided` });
  return NextResponse.json({ ok: true });
}

export const POST = audited("giftcard.void", "giftcard", POST_handler);
