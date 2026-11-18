import { NextResponse } from "next/server";
import { Resend } from "resend";
import { tooMany } from "@/lib/publicLimits";
import { getApprovedVisitor, getVisitor } from "@/lib/auth";
import { isEnabled } from "@/lib/flags";
import { getSettings } from "@/lib/settings";
import { addOrder, updateOrder } from "@/lib/orders";
import { customerReplyTo } from "@/lib/replyTo";
import { buildInvoiceEmail, escapeHtml } from "@/lib/invoiceEmail";
import { addAwaitingCard, claimByCode, giftCardsSentBy, giftWallet, toWalletCard } from "@/lib/giftCards";
import { siteUrlFrom } from "@/lib/giftCardDelivery";
import { recordRisk } from "@/lib/riskLog";
import {
  DEFAULT_GIFT_BONUS,
  GIFT_NOTE_MAX,
  GIFT_OCCASIONS,
  giftBonusFor,
  giftMoney,
  occasionOf,
  validGiftAmount,
  GIFT_MIN,
  GIFT_MAX,
  type GiftBonusRule,
} from "@/lib/giftCardRules";

export const dynamic = "force-dynamic";

async function bonusRule(): Promise<GiftBonusRule> {
  const s = await getSettings();
  return {
    enabled: s.giftBonusEnabled ?? DEFAULT_GIFT_BONUS.enabled,
    per: s.giftBonusPer ?? DEFAULT_GIFT_BONUS.per,
    step: s.giftBonusStep ?? DEFAULT_GIFT_BONUS.step,
    max: s.giftBonusMax ?? DEFAULT_GIFT_BONUS.max,
  };
}

// A member's gift cards: what they hold, what they've sent, and the bonus rule.
export async function GET() {
  const user = await getApprovedVisitor();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const enabled = await isEnabled("gift_cards").catch(() => false);
  if (!enabled) return NextResponse.json({ enabled: false, cards: [], sent: [], balance: 0 });
  const [wallet, sent] = await Promise.all([giftWallet(user), giftCardsSentBy(user.id)]);
  return NextResponse.json(
    {
      enabled: true,
      balance: wallet.balance,
      cards: wallet.cards.map(toWalletCard),
      sent: sent.map((c) => ({ id: c.id, amount: c.amount, occasion: c.occasion, toName: c.toName, state: c.state, createdAt: c.createdAt, deliveredAt: c.deliveredAt })),
      bonus: await bonusRule(),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  const limited = tooMany(req, "gift-cards", { max: 20, minutes: 10 });
  if (limited) return limited;
  const user = await getApprovedVisitor();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isEnabled("gift_cards").catch(() => false))) return NextResponse.json({ error: "Gift cards aren't available right now." }, { status: 403 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (body.action === "claim") {
    const r = await claimByCode(user, String(body.code || ""));
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true, card: toWalletCard(r.card) });
  }

  if (body.action !== "buy") return NextResponse.json({ error: "Unknown action." }, { status: 400 });

  const amount = validGiftAmount(body.amount);
  if (amount === null) return NextResponse.json({ error: `Choose an amount from ${giftMoney(GIFT_MIN)} to ${giftMoney(GIFT_MAX)}, in whole dollars.` }, { status: 400 });
  const occasion = occasionOf(body.occasion);
  const toName = String(body.toName || "").trim().slice(0, 60);
  const toEmail = String(body.toEmail || "").trim().toLowerCase().slice(0, 200);
  const fromName = (String(body.fromName || "").trim() || user.name).slice(0, 60);
  const note = String(body.note || "").trim().slice(0, GIFT_NOTE_MAX) || undefined;
  if (!toName) return NextResponse.json({ error: "Who is the card for? Add their name." }, { status: 400 });
  if (!EMAIL_RE.test(toEmail)) return NextResponse.json({ error: "Add the recipient's email so we can send them the card." }, { status: 400 });

  const bonus = giftBonusFor(amount, await bonusRule());
  const label = GIFT_OCCASIONS.find((o) => o.key === occasion)?.label || "Gift";
  const visitor = await getVisitor().catch(() => null);

  // A normal order carries the payment: pay link, invoice, reminders, Venmo/Zelle matching.
  const order = await addOrder({
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    items: [{ productId: "gift-card", productName: `${label} gift card for ${toName}`, price: giftMoney(amount), quantity: 1 }],
    shippingMethod: "pickup",
    shippingCost: 0,
    subtotal: amount,
    total: amount,
    isInquiry: false,
    status: "pending",
    paymentMethod: "invoice",
    source: "member",
    giftCardOrder: true,
    ...(visitor?.as ? { placedBy: visitor.as } : {}),
  });

  try {
    await addAwaitingCard({ amount, occasion, toName, toEmail, fromName, fromEmail: user.email, fromUserId: user.id, buyerName: user.name, note, orderId: order.id, bonus: bonus > 0 ? bonus : undefined });
  } catch (err) {
    console.error("[gift cards] couldn't save the card", err);
    await updateOrder(order.id, { status: "cancelled" }).catch(() => {});
    return NextResponse.json({ error: "We couldn't save your gift card. Nothing was charged. Please try again in a minute." }, { status: 503 });
  }
  if (!order.placedBy) await recordRisk(req, "order", order.id, order.userEmail);

  const site = siteUrlFrom(req);
  const payLink = `${site}/pay/${order.paymentToken}`;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev";
  const ref = order.id.slice(-6).toUpperCase();
  let emailed = false;
  if (apiKey) {
    const resend = new Resend(apiKey);
    try {
      const sent = await resend.emails.send({ from, to: user.email, reply_to: customerReplyTo(), subject: `Your ${giftMoney(amount)} gift card for ${toName}: how to pay (Ref ${ref})`, html: buildInvoiceEmail(order, payLink) });
      emailed = !sent.error;
      if (sent.error) console.error("[gift cards] invoice refused", sent.error);
    } catch (err) {
      console.error("[gift cards] invoice failed", err);
    }
    const adminEmail = process.env.INQUIRY_TO_EMAIL;
    if (adminEmail) {
      try {
        await resend.emails.send({
          from,
          to: adminEmail,
          reply_to: user.email,
          subject: `${emailed ? "" : "⚠ Customer email NOT sent — "}New gift card from ${user.name} — ${giftMoney(amount)}`,
          html: `<p><strong>${escapeHtml(user.name)}</strong> (${escapeHtml(user.email)}) ordered a <strong>${giftMoney(amount)} ${escapeHtml(label)} gift card</strong> for ${escapeHtml(toName)} (${escapeHtml(toEmail)}). Ref <strong>${ref}</strong>.</p><p>The card is sent automatically once the payment is confirmed: match the Venmo/Zelle payment, or mark the order Paid or Completed.${bonus > 0 ? ` The buyer then gets ${giftMoney(bonus)} bonus credit.` : ""}</p><p><a href="${site}/admin?order=${order.id}">Open this order in admin</a></p>`,
        });
      } catch (err) {
        console.error("[gift cards] admin email failed", err);
      }
    }
  }
  return NextResponse.json({ ok: true, orderId: order.id, ref, total: amount, bonus, emailed, payLink: `/pay/${order.paymentToken}` });
}
