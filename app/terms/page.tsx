import { brand } from "@/lib/brand";
import { isEnabled } from "@/lib/flags";
import { CONSULT_ACK } from "@/lib/consultSlots";
import SiteNav from "@/app/components/SiteNav";

export const metadata = {
  title: `Terms of Service · ${brand.name}`,
  description: `Terms of Service for ${brand.name} and ${brand.members}.`,
};

/*
 * Based on a lawyer-reviewed draft for one client (Nov 1, 2026), written to
 * match how this platform works and filled in from brand.config.ts (name,
 * members area, support email, minimum age, payment apps, legal.state and
 * legal.county). Each business should still have its own counsel review it.
 * Original note: checked against how the site actually works. Keep it true to the site: when a feature changes (sign-in, payments,
 * the Concierge, consultations, emails), update this page and /privacy, and
 * bump LAST_UPDATED. Members are emailed about significant changes (§18).
 */
const LAST_UPDATED = "November 1, 2026";
const SUPPORT = brand.supportEmail;
const AGE = brand.minimumAge || 18;
const PAY = [brand.payments.venmoHandle ? "Venmo" : "", brand.payments.zelle ? "Zelle" : ""].filter(Boolean);
const PAY_TEXT = PAY.length ? PAY.join(" or ") : "the payment apps shown at checkout";

export const dynamic = "force-dynamic";

const Mail = () => <a href={`mailto:${SUPPORT}`}>{SUPPORT}</a>;

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
            operated by {brand.name} (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;). By using the site, placing an
            order, subscribing to updates or requesting membership, you agree to these terms and to our{" "}
            <a href="/privacy">Privacy Policy</a>. If you don&rsquo;t agree, please don&rsquo;t use the site.
          </p>

          <h3>2. Eligibility and membership</h3>
          <p>
            You must be at least {AGE} years old to use the site, place an order or request membership. Membership in {brand.members}
            is by approval. We may decline a request, and we may suspend or close a membership if these terms are broken or the
            account is misused.
          </p>
          <p>
            You can close your membership at any time by emailing <Mail />. Closing an account ends your access to member pages
            and any unused loyalty points. We may keep order records we need for accounting, tax or legal reasons.
          </p>

          <h3>3. Your account</h3>
          <p>
            You sign in with your email address and password. Depending on what&rsquo;s available on your device, you can also
            sign in with a one-time code we email you, or with Face ID, Touch ID or your device&rsquo;s fingerprint sensor once
            you&rsquo;ve set it up. Password set-up and reset links are emailed to you and work once. Keep your password and
            your email account private: anyone who can open your email can reset your password. You&rsquo;re responsible for
            activity on your account and for keeping your details (name, email, shipping address, phone) accurate. Tell us
            promptly at <Mail /> if you think your account has been used without permission.
          </p>

          <h3>4. Products and wellness information</h3>
          <p>
            Our products are wellness products. They are not intended to diagnose, treat, cure or prevent any disease, and
            statements on this site have not been evaluated by the Food and Drug Administration. Information on the site,
            including guides, FAQs, consultations and answers from our Concierge, is general and is not medical advice. Talk to
            a qualified healthcare professional before use if you are pregnant, nursing, taking medication or have a medical
            condition.
          </p>

          <h3>5. Orders, pricing and payment</h3>
          <p>
            Prices are shown in US dollars and may change without notice. An order is an offer to buy. We may decline or cancel
            an order, for example if an item is unavailable, a price was shown in error, or payment isn&rsquo;t received. We
            don&rsquo;t process card payments on this site.
          </p>
          <p>
            Orders are paid by the methods shown at checkout or on your invoice, such as {PAY_TEXT}, or in cash when you
            pick up, where that&rsquo;s offered. Some sale prices are for local pickup paid in cash only, and say so. Unpaid
            orders may be cancelled. Please put your order number in the payment note so we can match it.
          </p>
          {brand.payments.venmoHandle && (
            <p>
              To confirm Venmo payments, we receive Venmo&rsquo;s payment notification emails. We use the payer name, amount,
              note and date only to match a payment to your order, and a team member confirms every match before an order is
              marked paid.
            </p>
          )}
          <p>Payment apps are run by their own companies, and their terms apply to your payment.</p>

          <h3>6. Shipping, pickup and returns</h3>
          <p>
            Shipping costs are shown at checkout, and delivery times are estimates. Local pickup, where offered, is at the
            address and times shown at checkout and in your order email. For questions about a delivery, damaged items or
            returns, contact us and we&rsquo;ll work with you to put it right.
          </p>

          <h3>7. Promotions, discount codes and loyalty points</h3>
          <p>
            Promotions, discount codes and loyalty points have no cash value, can&rsquo;t be exchanged for cash or transferred,
            and may have their own conditions and end dates. Only one discount code applies per order unless we say otherwise,
            and a code can&rsquo;t be combined with a bundle deal. We may change or end a promotion or the loyalty program at
            any time, and we may remove points earned through misuse or on orders that are cancelled or returned.
          </p>

          <h3>8. Events and classes</h3>
          <p>
            When you register for an event or class, we use your details to hold your place, send confirmations and updates,
            and let you know if a waitlist spot opens. Spaces may be limited, and we may change or cancel an event; if we do,
            we&rsquo;ll let registered guests know.
          </p>

          <h3>9. Our Concierge</h3>
          <p>
            The Concierge is the site&rsquo;s automated chat assistant, and it can make mistakes. It can&rsquo;t change an order
            total or make commitments on our behalf, and anything that would change your order or account is handled by our
            team. Conversations with the Concierge are saved for 30 days so our team can follow up and improve the service,
            then deleted automatically.
          </p>
          <p>
            If you use voice, your recording is converted to text by the technology provider that powers the Concierge so it
            can answer, and spoken replies are generated the same way. We keep the text of the conversation, not the recording.
            Voice is optional, and the microphone is used only when you tap it. If you share a photo with the Concierge, where
            that&rsquo;s available, it&rsquo;s used to answer you and isn&rsquo;t saved.
          </p>
          <p>
            Please don&rsquo;t share passwords, payment details or health information in the chat. For anything important, our
            team is available at <Mail />.
          </p>

          <h3>10. Phone consultations</h3>
          <p>
            You can ask for a free phone consultation on our <a href="/consultation">consultation page</a> or through the
            Concierge. The time you pick is a request; we&rsquo;ll confirm it with you by phone or email. Before booking,
            you&rsquo;ll be asked to agree to this statement: &ldquo;{CONSULT_ACK}&rdquo;
            Consultations are general, friendly conversations about our products. They aren&rsquo;t medical advice or a
            substitute for a healthcare professional (see Section 4). Please let us know if you need to reschedule.
          </p>

          <h3>11. Store map</h3>
          <p>
            The store map lists shops that carry our products. Stores are independent businesses. Their hours, stock and prices
            are set by them and may differ from what&rsquo;s shown. If you choose &ldquo;use my location&rdquo;, your browser
            shares your location only to sort nearby stores. We don&rsquo;t store it.
          </p>

          <h3>12. Creator and ambassador links</h3>
          <p>
            Some people who share our products are creators or ambassadors who earn a commission. When you visit through their
            page or link, or use their code, your browser remembers it for a limited time (usually 30 days) so the sale is
            credited to them. This doesn&rsquo;t change your price, apart from any discount the code gives you. Creators are
            independent, speak from their own experience, and are asked to disclose the partnership. Their views are their own.
          </p>

          <h3>13. Emails and other messages</h3>
          <p>
            If you join our mailing list, we&rsquo;ll send occasional news, offers and event updates. Membership in{" "}
            {brand.members} includes these emails too: when you join, you&rsquo;re added to our mailing list. Every marketing email
            has an unsubscribe link. Unsubscribing takes effect right away, and always within 10 business days.
          </p>
          <p>
            We&rsquo;ll still send messages you need about your orders, payments, account, events you registered for and
            consultations you requested. We don&rsquo;t currently send text messages. If we add them, we&rsquo;ll ask for your
            separate consent first.
          </p>

          <h3>14. Your information</h3>
          <p>
            We collect what you give us (such as your name, email, phone, shipping address, orders, membership request, event
            registrations, consultation requests and messages to us or the Concierge) and basic site information, such as
            which pages are visited, counted in total rather than per person, and which link or code brought you here. Our
            emails tell us when they&rsquo;re opened and which links are clicked.
          </p>
          <p>
            We use it to run the site and your account, fulfil and confirm orders, send the messages described in Section 13,
            credit creators, improve the site, and keep it secure. We don&rsquo;t sell your personal information.
          </p>
          <p>
            We share it only with service providers who help us run the site, such as website hosting, email delivery, the
            Concierge&rsquo;s technology provider, shipping carriers and payment apps. They may use it only to provide their
            service to us. We may also share it if the law requires it. You can ask to see, correct or delete your information
            by emailing <Mail />. Our <a href="/privacy">Privacy Policy</a> has the full detail, including how long we keep
            things.
          </p>

          <h3>15. Acceptable use</h3>
          <p>
            Please don&rsquo;t misuse the site. That includes trying to access other people&rsquo;s accounts or information,
            sharing your account, interfering with the site or its security, scraping or copying it with automated tools,
            submitting false orders, payments or requests, abusing discount codes or loyalty points, or using the site for
            anything unlawful. We may suspend access if we see this.
          </p>

          <h3>16. Site content</h3>
          <p>
            The site&rsquo;s text, photos, product designs, logos and other content belong to {brand.legalName || brand.name} or are used
            with permission. You may view and share it for personal, non-commercial use, but please don&rsquo;t copy, sell or
            reuse it without our written permission. If you send us reviews, photos or feedback, you let us use them to run and
            promote the site, and we&rsquo;ll credit you if you ask.
          </p>

          <h3>17. Liability</h3>
          <p>
            To the extent the law allows, the site and products are provided &ldquo;as is&rdquo;. We are not liable for indirect
            or consequential losses, and our total liability for any claim is limited to the amount you paid for the order
            involved. We aren&rsquo;t responsible for third-party services we link to or rely on, such as payment apps,
            carriers, maps or stores. Nothing in these terms limits rights you have under consumer protection law.
          </p>

          <h3>18. Changes to these terms</h3>
          <p>
            We may update these terms. The date at the top shows when they last changed, and we&rsquo;ll email members about
            significant changes. Continuing to use the site after a change means you accept the updated terms.
          </p>

          <h3>19. Governing law</h3>
          <p>
            These terms are governed by the laws of the State of {brand.legal.state}. Before bringing a claim, please contact us so we
            can try to resolve it informally. Any dispute that can&rsquo;t be resolved goes to the state or federal courts
            {brand.legal.county ? `for ${brand.legal.county} County, ${brand.legal.state}` : `in ${brand.legal.state}`}, unless consumer law gives you the right to bring it elsewhere.
          </p>

          <h3>20. Contact</h3>
          <p>
            Questions about these terms or your information: <Mail />.
          </p>
        </section>
      </article>
    </div>
  );
}
