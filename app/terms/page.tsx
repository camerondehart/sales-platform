import { brand } from "@/lib/brand";
import { isEnabled } from "@/lib/flags";
import SiteNav from "@/app/components/SiteNav";

export const metadata = {
  title: `Terms of Service · ${brand.name}`,
  description: `Terms of Service for ${brand.name} and ${brand.members}.`,
};

/*
 * ⚠️ BOILERPLATE — STARTING POINT ONLY. REQUIRES LEGAL REVIEW BEFORE RELYING ON IT.
 *
 * This text was drafted as a generic template so the site has a Terms page.
 * It has NOT been reviewed by a lawyer. Before treating it as binding, have
 * counsel review and adapt it — in particular: governing law and venue,
 * product and health disclaimers, age requirements, the membership terms,
 * payment/refund terms, liability limits, and privacy commitments.
 * Update LAST_UPDATED whenever the text changes.
 */
const LAST_UPDATED = "September 25, 2026";

export const dynamic = "force-dynamic";

export default async function TermsPage() {
  const stores = await isEnabled("store_locator").catch(() => false);
  return (
    <div className="shell">
      <header className="masthead">
        <a className="masthead-brand" href="/" aria-label={`${brand.name} home`}>
          <div className="logo-mark floaty" aria-hidden="true">
            <span></span><span></span><span></span><span></span>
          </div>
          <h1 className="masthead-title">{brand.name}</h1>
        </a>
        <SiteNav stores={stores} />
      </header>

      <article className="about terms">
        <div className="about-hero">
          <div className="about-kicker">The fine print</div>
          <h2 className="about-title">Terms of Service</h2>
          <p className="about-lede">Last updated {LAST_UPDATED}</p>
        </div>

        <section className="about-block">
          <h3>1. Who we are</h3>
          <p>
            These terms cover your use of this website, including the public shop and {brand.members} (our members-only area),
            operated by {brand.legalName} (&ldquo;we&rdquo;, &ldquo;us&rdquo;). By using the site, placing an order or
            requesting membership, you agree to these terms.
          </p>

          <h3>2. Eligibility and membership</h3>
          <p>
            You must be at least {brand.minimumAge || 18} years old to request membership. Membership is by approval and may be declined or
            withdrawn at our discretion. You are responsible for keeping your login details private and for activity on your
            account. Tell us promptly at <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a> if
            you think your account has been used without permission.
          </p>

          <h3>3. Products and wellness information</h3>
          <p>
            Our products are wellness products. They are not intended to diagnose, treat, cure or prevent any disease, and
            statements on this site have not been evaluated by the Food and Drug Administration. Information on the site,
            including answers from our online assistant, is general and is not medical advice. Talk to a qualified healthcare
            professional before use if you are pregnant, nursing, taking medication or have a medical condition.
          </p>

          <h3>4. Orders, pricing and payment</h3>
          <p>
            Prices are shown in US dollars and may change without notice. An order is an offer to buy; we may decline or cancel
            an order, for example if an item is unavailable or a price was shown in error. Orders are paid by the methods
            described in your invoice or at pickup. We don&rsquo;t process card payments on this site.
          </p>

          <h3>5. Shipping, pickup and returns</h3>
          <p>
            Shipping costs are shown at checkout. Delivery times are estimates. For questions about a delivery, damaged items or
            returns, contact us and we&rsquo;ll work with you to put it right.
          </p>

          <h3>6. Promotions, discount codes and loyalty points</h3>
          <p>
            Promotions, discount codes and loyalty points have no cash value, can&rsquo;t be exchanged for cash, and may have
            their own conditions and end dates. We may change or end a promotion or the loyalty program at any time.
          </p>

          <h3>7. Our online assistant</h3>
          <p>
            The site&rsquo;s assistant is automated and can make mistakes. It can&rsquo;t change an order total or make
            commitments on our behalf. Conversations with the assistant are saved for 30 days so our team can follow up
            and improve the service, then deleted automatically. Please don&rsquo;t share passwords or payment details in the
            chat. For anything important, our team is available at{" "}
            <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>.
          </p>

          <h3>8. Acceptable use</h3>
          <p>
            Don&rsquo;t misuse the site: no attempts to access other people&rsquo;s accounts or information, interfere with the
            site, or use it for anything unlawful.
          </p>

          <h3>9. Emails</h3>
          <p>
            If you join our mailing list we&rsquo;ll send occasional news and offers. Membership in {brand.members} includes
            these emails too: when you join, you&rsquo;re added to our mailing list. Use the unsubscribe link in any
            marketing email and we&rsquo;ll stop. We&rsquo;ll still send emails about your orders and account.
          </p>

          <h3>10. Liability</h3>
          <p>
            To the extent the law allows, the site and products are provided &ldquo;as is&rdquo;, and we are not liable for
            indirect or consequential losses. Nothing in these terms limits rights you have under consumer protection law.
          </p>

          <h3>11. Changes to these terms</h3>
          <p>
            We may update these terms. The date at the top shows when they last changed. Continuing to use the site after a
            change means you accept the updated terms.
          </p>

          <h3>12. Contact</h3>
          <p>
            Questions about these terms: <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>.
          </p>
        </section>
      </article>
    </div>
  );
}
