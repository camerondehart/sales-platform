import { brand } from "@/lib/brand";
import { notFound } from "next/navigation";
import { giftCardByToken } from "@/lib/giftCards";
import { getApprovedVisitor } from "@/lib/auth";
import { giftMoney } from "@/lib/giftCardRules";
import Scene from "@/app/components/Scene";
import GiftCardArt from "@/app/components/GiftCardArt";

export const dynamic = "force-dynamic";
export const metadata = { title: `Your gift card · ${brand.shortName}`, robots: { index: false } };

// The link in the recipient's email: their card coming out of its envelope,
// the note, the code and how to spend it. The token is the secret.
export default async function GiftPage({ params }: { params: { token: string } }) {
  const card = await giftCardByToken(params.token).catch(() => null);
  if (!card || card.state === "awaiting") notFound();
  const user = await getApprovedVisitor().catch(() => null);
  const isBonus = card.kind === "bonus";
  return (
    <>
      <Scene variant="soft" />
      <main className="gift-open-page">
        <div className="gift-kicker">{brand.name} · {brand.members}</div>
        <h1>{isBonus ? "Your bonus credit" : `${card.fromName} sent you a gift`}</h1>
        <GiftCardArt occasion={card.occasion} amount={card.amount} toName={card.toName} fromName={card.fromName} bonus={isBonus} reveal />
        {card.note && !isBonus && (
          <div className="gift-preview-note" style={{ marginTop: "1.6rem" }}>
            “{card.note}”
            <small>— {card.fromName}</small>
          </div>
        )}
        {card.state === "void" ? (
          <p>This gift card is no longer active. Questions? Email {brand.supportEmail}.</p>
        ) : (
          <>
            <div className="gift-open-code">{card.code}</div>
            <p>
              {card.balance < card.amount ? `${giftMoney(card.balance)} left to spend. ` : ""}
              Spend it in {brand.members}, our members&apos; shop: it comes off automatically at checkout. It never expires.
            </p>
            {user ? (
              <a className="gift-btn" href="/gallery?giftcards=1" style={{ marginTop: "1rem" }}>Open my gift cards</a>
            ) : (
              <p>
                Already a member? <a href="/?next=/gallery">Sign in</a> with this email and it&apos;s in your account (or add the code under Account → Gift cards).
                <br />New to {brand.members}? <a href="/join">Request membership</a> with this email.
              </p>
            )}
          </>
        )}
      </main>
    </>
  );
}
