import Scene from "@/app/components/Scene";
import ScrollHint from "@/app/components/ScrollHint";
import { AskAssistantLink } from "@/app/components/assistant/AskAssistant";
import RetailClient from "@/app/retail/RetailClient";
import { getProducts, isExternal, type Product } from "@/lib/storage";
import { applyVideoFlag, isEnabled } from "@/lib/flags";
import { applyStockFlag } from "@/lib/stock";
import { offerForEvent } from "@/lib/eventOffers";
import JoinForm from "./JoinForm";
import { brand } from "@/lib/brand";

export const metadata = {
  title: `Join our mailing list · ${brand.name}`,
  description: `Sign up for news, new batches and event dates from ${brand.name}.`,
};

export const dynamic = "force-dynamic";

// The page behind the event QR code. Mailing list only — no account, no
// password, no approval step. `?event=Farmers%20Market` tags where they
// signed up so the list can be sorted by event later.
// Below the form sits the public shop, same as the homepage (with the same
// gentle "there's more below" peek), so a visitor can buy on the spot.
export default async function JoinPage({ searchParams }: { searchParams: { event?: string } }) {
  const event = (searchParams.event || "").trim().slice(0, 80);
  // The event's welcome code (set in Marketing). Teased here; the code itself only goes by email.
  const offer = await offerForEvent(event);
  // If the shop can't load, the sign-up form still works on its own.
  let shopProducts: Product[] = [];
  try {
    shopProducts = await applyStockFlag(await applyVideoFlag((await getProducts()).filter(isExternal)));
  } catch (err) {
    console.error("[join] shop products failed to load", err);
  }

  return (
    <>
      <Scene />
      {shopProducts.length > 0 && <ScrollHint />}
      <div id="top" className="gate gate-scene">
        <div className="gate-card join-card">
          <div className="gate-kicker">{event ? event : "Stay in the loop"}</div>
          <h1 className="gate-title">
            <a className="gate-title-link" href="/">{brand.name}</a>
          </h1>
          <div className="gate-ornament" aria-hidden="true">
            <span></span><span></span><span></span><span></span>
          </div>
          <p className="gate-subtitle">
            New batches, classes and event dates — a few times a month, never more.
            Unsubscribe any time with one click.
          </p>
          {offer && (
            <div className="join-offer">
              <span aria-hidden="true">🎁</span> Join today and we&apos;ll email you <strong>{offer.text}</strong> your order.
            </div>
          )}

          <JoinForm event={event} />

          <div className="gate-footer">
            Looking for the member area? <a href="/">Sign in here</a>
          </div>

          {shopProducts.length > 0 && (
            <a className="scroll-cue" href="#shop" aria-label="Scroll down to our shop, open to everyone">
              <span className="scroll-cue-lead">No account needed</span>
              <span className="scroll-cue-main">Shop our range below</span>
              <span className="scroll-cue-chev" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
            </a>
          )}
        </div>
      </div>

      {shopProducts.length > 0 && (
        <section id="shop" className="home-shop">
          <div className="home-shop-head">
            <div className="about-kicker">Open to everyone</div>
            <h2 className="about-title">{brand.name}</h2>
            <p className="about-lede">{brand.tagline}</p>
            <div className="home-shop-links">
              <a href="/about">Read about us →</a>
              <a href="/events">Classes &amp; events →</a>
              <AskAssistantLink label="Not sure where to start? Ask our Concierge" question="I'm new here — what would you recommend to start with?" />
            </div>
          </div>

          <RetailClient products={shopProducts} embedded pickup={await isEnabled("cash_pickup").catch(() => false)} />

          <footer className="footnotes">
            <div className="footnotes-ornament" aria-hidden="true">
              <span></span><span>{brand.emoji}</span><span></span>
            </div>
            <div className="footnotes-grid">
              <div className="footnote">
                <div className="footnote-icon" aria-hidden="true">📦</div>
                <div className="footnote-title">Shipping</div>
                <p>
                  {brand.shippingNote} Questions? Email{" "}
                  <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>.{" "}
                  <a href="/terms">Terms of Service</a>
                </p>
              </div>
              <div className="footnote">
                <div className="footnote-icon" aria-hidden="true">🌿</div>
                <div className="footnote-title">Join the mailing list</div>
                <p>
                  New batches, classes and event dates in your inbox.{" "}
                  <a href="#top">Sign up ↑</a>
                </p>
              </div>
            </div>
          </footer>
        </section>
      )}
    </>
  );
}
