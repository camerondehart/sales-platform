import { redirect } from "next/navigation";
import { getApprovedVisitor } from "@/lib/auth";
import { getProducts, isExternal } from "@/lib/storage";
import { applyVideoFlag, isEnabled } from "@/lib/flags";
import { applyStockFlag } from "@/lib/stock";
import AuthForms from "./AuthForms";
import Scene from "./components/Scene";
import ScrollHint from "./components/ScrollHint";
import { AskAssistantLink } from "./components/assistant/AskAssistant";
import RetailClient from "./retail/RetailClient";
import { brand } from "@/lib/brand";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (await getApprovedVisitor()) redirect("/gallery");

  // The public shop lives on the homepage below the sign-in hero, so a
  // visitor who isn't a member has something to do rather than a dead end.
  const shopProducts = await applyStockFlag(await applyVideoFlag((await getProducts()).filter(isExternal)));
  const stores = await isEnabled("store_locator").catch(() => false);

  return (
    <>
    <Scene />
    {shopProducts.length > 0 && <ScrollHint />}
    <div id="top" className="gate gate-scene home-hero">
      {/* 👇 Wider card */}
      <div className="gate-card" style={{ maxWidth: "560px" }}>
        {/* Staff sign-in: a quiet icon in the corner (staff use Face ID, an emailed link or the daily password). */}
        <a href="/admin" className="home-staff-link" aria-label="Staff sign-in" title="Staff sign-in">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="5" y="10.5" width="14" height="10" rx="2.2" />
            <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" />
            <circle cx="12" cy="15.3" r="1.2" />
          </svg>
        </a>
        <div className="gate-kicker">Member Access</div>
        <h1 className="gate-title">{brand.members}</h1>
        <div className="gate-ornament" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
          <span></span>
        </div>
        <p className="gate-subtitle">
          The members&rsquo; shop for {brand.name}. Sign in, or join to request access.
        </p>
        <AuthForms
          codeLogin={await isEnabled("email_code_login").catch(() => false)}
          staffLink={await isEnabled("admin_magic_link").catch(() => false)}
          faceId={await isEnabled("member_passkeys").catch(() => false)}
        />
        {shopProducts.length > 0 ? (
          <a className="scroll-cue" href="#shop" aria-label="Scroll down to our shop, open to everyone">
            <span className="scroll-cue-lead">No account needed</span>
            <span className="scroll-cue-main">Shop our range below</span>
            <span className="scroll-cue-chev" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </a>
        ) : (
          <div className="gate-footer">
            Not a member yet? Request access above.
          </div>
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
            {stores && <a href="/stores">Find us in stores →</a>}
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
              <div className="footnote-title">Join {brand.members}</div>
              <p>
                Members get early access to events and a private catalog.{" "}
                <a href="#top">Request access ↑</a>
              </p>
            </div>
          </div>
        </footer>
      </section>
    )}
    </>
  );
}
