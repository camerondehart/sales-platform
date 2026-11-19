import { brand } from "@/lib/brand";
import { notFound } from "next/navigation";
import { giftCardByToken } from "@/lib/giftCards";
import { getApprovedVisitor } from "@/lib/auth";
import { giftMoney } from "@/lib/giftCardRules";
import Scene from "@/app/components/Scene";
import GiftCardArt from "@/app/components/GiftCardArt";
import CopyCode from "./CopyCode";

export const dynamic = "force-dynamic";
export const metadata = { title: `Your gift card · ${brand.shortName}`, robots: { index: false } };

// The link in the recipient's email: their card coming out of its envelope,
// the note, the code (with Copy) and buttons for what to do next.
// The token is the secret.
export default async function GiftPage({ params }: { params: { token: string } }) {
  const card = await giftCardByToken(params.token).catch(() => null);
  if (!card || card.state === "awaiting") notFound();
  const user = await getApprovedVisitor().catch(() => null);
  const isBonus = card.kind === "bonus";
  // Sign-in and the membership request open with this card's email filled in.
  const emailQ = card.toEmail ? `&email=${encodeURIComponent(card.toEmail)}` : "";
  const partial = card.balance < card.amount;
  return (
    <>
      <Scene variant="soft" />
      <main className="gift-open-page">
        <div className="gift-kicker">{brand.name} · {brand.members}</div>
        <h1>{isBonus ? "Your bonus credit" : `${card.fromName} sent you a gift`}</h1>
        <GiftCardArt occasion={card.occasion} amount={card.amount} toName={card.toName} fromName={card.fromName} bonus={isBonus} reveal />

        <section className="gift-open-panel">
          {card.note && !isBonus && (
            <blockquote className="gift-open-note">
              “{card.note}”
              <small>— {card.fromName}</small>
            </blockquote>
          )}

          {card.state === "void" ? (
            <p className="gift-open-text">
              This gift card is no longer active. Questions? Email{" "}
              <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>.
            </p>
          ) : (
            <>
              <div className="gift-open-balance">
                <span>{partial ? "Left to spend" : "Gift card value"}</span>
                <strong>{giftMoney(card.balance)}</strong>
                <em>Never expires</em>
              </div>

              <div className="gift-open-label">Your gift card code</div>
              <CopyCode code={card.code} />

              <p className="gift-open-text">
                Spend it in {brand.members}, our members&apos; shop. Once it&apos;s in your account it comes off automatically at checkout.
              </p>

              {user ? (
                <div className="gift-open-actions">
                  <a className="gift-btn" href="/gallery?giftcards=1">Open my gift cards</a>
                  <a className="gift-btn gift-btn-ghost" href="/gallery">Go to the shop</a>
                </div>
              ) : (
                <div className="gift-open-paths">
                  <div className="gift-open-path">
                    <h2>Already a member?</h2>
                    <p>Sign in with {card.toEmail ? <strong>{card.toEmail}</strong> : "this email"} and the card is already in your account. Signed in with another email? Add the code under Account → Gift cards.</p>
                    <a className="gift-btn" href={`/?next=/gallery${emailQ}`}>Sign in</a>
                  </div>
                  <div className="gift-open-path">
                    <h2>New to {brand.members}?</h2>
                    <p>Request membership with this email. Once you&apos;re approved, the card is waiting in your account.</p>
                    <a className="gift-btn gift-btn-ghost" href={`/?next=/gallery${emailQ}#join`}>Request membership</a>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </>
  );
}
