import { brand } from "@/lib/brand";
import { isEnabled } from "@/lib/flags";
import SiteNav from "@/app/components/SiteNav";

export const metadata = {
  title: `Privacy Policy · ${brand.name}`,
  description: `How ${brand.name} collects, uses and protects your information.`,
};

/*
 * Based on a lawyer-reviewed draft for one client (Nov 1, 2026), written to
 * match how this platform works and filled in from brand.config.ts (name,
 * members area, support email, minimum age, payment apps, legal.state and
 * legal.county). Each business should still have its own counsel review it.
 * Original note: checked against how the site actually works (CalOPPA: what's collected, who it's shared with, choices, Do Not
 * Track, effective date). Keep it true to the site and in step with /terms
 * §14; bump EFFECTIVE when it changes. The 12-month / 7-year retention
 * periods come from the lawyer's draft; the business confirms them.
 */
const EFFECTIVE = "November 1, 2026";
const SUPPORT = brand.supportEmail;
const AGE = brand.minimumAge || 18;
const HOST = brand.siteUrl.replace(/^https?:\/\//, "").replace(/^www\./, "");
const PAY = [brand.payments.venmoHandle ? "Venmo" : "", brand.payments.zelle ? "Zelle" : ""].filter(Boolean);
const PAY_TEXT = PAY.length ? PAY.join(" or ") : "the payment apps shown at checkout";

export const dynamic = "force-dynamic";

const Mail = () => <a href={`mailto:${SUPPORT}`}>{SUPPORT}</a>;

const COLLECT: Array<[string, string, string]> = [
  ["Contact and account details", "Name, email, phone, shipping address", "When you order, request membership, sign up for emails, register for an event, ask for a consultation or contact us"],
  ["Sign-in details", "Your password, stored only in scrambled (hashed) form. If you use Face ID, Touch ID or a fingerprint sensor, your fingerprint or face never leaves your device: we keep only a security key from it", "When you create a password or set up Face ID / Touch ID"],
  ["Orders and payments", `Items, totals, order history, payment status.${brand.payments.venmoHandle ? " To confirm Venmo payments, Venmo's notification email with the payer name, amount, note and date" : ""}`, "When you order. We never see your card or bank details"],
  ["Membership and loyalty", "Membership request, approval status, loyalty points", "When you request or use membership"],
  ["Our previous online store", "If you were a customer of our earlier shop, the account details and order history you had there", "When we moved our customers to this site"],
  ["Events and consultations", "Event registrations and notes. Consultation requests: your interest, preferred time, comments and the name you typed to sign the acknowledgement", "When you register or ask for a consultation"],
  ["Concierge conversations", "What you type, or the text of what you say by voice", "When you use the Concierge. Photos you share with it are used to answer and not saved"],
  ["Email activity", "Whether our emails are opened and which links are clicked", "When you open our emails"],
  ["Site information", "Pages viewed, products looked at, which link or code brought you here and country, counted as daily totals. Your browser remembers a creator's page you came through", "Automatically, as you use the site. We don't keep a record of individual visits or IP addresses"],
  ["Location you choose to share", "Your browser's location", "Only when you tap \"use my location\" on the store map. It's used once to sort stores and not stored"],
];

const KEEP: Array<[string, string]> = [
  ["Concierge conversations", "30 days, then deleted automatically"],
  ["Voice recordings and chat photos", "Not kept. Only the text of the conversation is saved, as above"],
  ["Account and membership details", "While your account is open, and up to 12 months after you close it"],
  ["Orders and payment records", "As long as needed for tax and accounting, typically 7 years"],
  ["Event registrations and consultation requests", "As long as needed to run the event or arrange your call, then as part of our ordinary records"],
  ["Mailing list", "Until you unsubscribe. We keep your email on a do-not-send list so we don't email you again"],
  ["Site information", "Daily totals, kept to see trends. They don't identify you"],
];

export default async function PrivacyPage() {
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

      <article className="about terms privacy">
        <div className="about-hero">
          <div className="about-kicker">Your information</div>
          <h2 className="about-title">Privacy Policy</h2>
          <p className="about-lede">Effective {EFFECTIVE}</p>
        </div>

        <section className="about-block">
          <h3>1. Who we are</h3>
          <p>
            This policy explains how {brand.name} (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;) collects, uses
            and protects personal information when you use {HOST}, including the public shop and {brand.members}, our members-only
            area. It applies to everyone who visits the site, shops with us, joins our mailing list or becomes a
            member. Our <a href="/terms">Terms of Service</a> also apply.
          </p>

          <h3>2. What we collect</h3>
          <div className="legal-table-wrap">
            <table className="legal-table">
              <thead><tr><th>What</th><th>Examples</th><th>When</th></tr></thead>
              <tbody>
                {COLLECT.map(([a, b, c]) => (
                  <tr key={a}><td>{a}</td><td>{b}</td><td>{c}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Please don&rsquo;t share health information, passwords or payment details in the chat or in messages. We
            don&rsquo;t need them. If you do mention a health concern or a reaction to a product, our team may see it so we can
            follow up with you.
          </p>

          <h3>3. How we use it</h3>
          <ul>
            <li>Run the site, your account and your membership</li>
            <li>Process, confirm and deliver orders, and match payments to them</li>
            <li>Send the emails you&rsquo;ve asked for or that relate to your orders, account, events and consultations (see Section 7 for choices)</li>
            <li>Answer questions through our team and our Concierge, and arrange consultations you ask for</li>
            <li>Run events, loyalty points, promotions and discount codes</li>
            <li>Credit creators and ambassadors for sales from their pages, links or codes</li>
            <li>Understand how the site and our emails are used, and improve them</li>
            <li>Keep the site and your account secure and prevent fraud or misuse</li>
            <li>Meet our legal, tax and accounting obligations</li>
          </ul>

          <h3>4. Who we share it with</h3>
          <p>We don&rsquo;t sell your personal information, and we don&rsquo;t share it for cross-site advertising.</p>
          <p>We share it only with service providers that help us run the site, and only what they need to do their job:</p>
          <ul>
            <li>Website hosting and data storage</li>
            <li>Email delivery, including counting opens and clicks</li>
            <li>The technology provider that powers our Concierge, which processes chat, voice and photos to generate answers</li>
            <li>Shipping carriers and our shipping-label service</li>
            <li>Payment apps you choose to use, such as {PAY_TEXT}, which have their own privacy policies</li>
            <li>Map and address-lookup services, for the store map</li>
          </ul>
          <p>
            Creators and ambassadors see only sales totals and product names, never who bought. We may also disclose information
            if the law requires it, to protect our rights or someone&rsquo;s safety, or as part of a sale or transfer of the
            business.
          </p>

          <h3>5. Cookies and similar technology</h3>
          <p>
            We use cookies only to keep you signed in and to keep sign-in secure. Your browser also stores a few things for you
            on your own device: your cart, settings such as dark mode and layout, the creator page you came through (usually
            counted for 30 days), and whether you&rsquo;ve turned down the offer to sign in with Face ID. Our site statistics are
            built in, use no cookies, and only count totals. We don&rsquo;t use third-party advertising or tracking cookies. You
            can clear or block cookies and site data in your browser, but staying signed in and your cart will stop working.
          </p>

          <h3>6. How long we keep it</h3>
          <div className="legal-table-wrap">
            <table className="legal-table">
              <thead><tr><th>Information</th><th>How long</th></tr></thead>
              <tbody>
                {KEEP.map(([a, b]) => (
                  <tr key={a}><td>{a}</td><td>{b}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>7. Your choices and rights</h3>
          <ul>
            <li>
              <strong>Emails:</strong> use the unsubscribe link in any marketing email. It takes effect right away, and always
              within 10 business days. You&rsquo;ll still get messages about your orders, account, events you registered for and
              consultations you requested. To avoid open tracking, you can turn off images in your email app.
            </li>
            <li>
              <strong>Access, correction and deletion:</strong> email <Mail /> to ask for a copy of your information, to correct
              it, or to delete it. We&rsquo;ll respond within 45 days. We may need to confirm your identity first, and we may keep
              records the law requires, such as order history for tax purposes.
            </li>
            <li>
              <strong>Your account:</strong> you can update your shipping address, change your password, and add or remove Face
              ID / Touch ID devices from your account page. To change your name, email or phone, or to close your account,
              email us.
            </li>
            <li>
              <strong>California residents:</strong> we don&rsquo;t sell or share personal information as defined by California
              law, and we don&rsquo;t use it to make automated decisions with legal effects. Under California&rsquo;s &ldquo;Shine
              the Light&rdquo; law, you can ask whether we&rsquo;ve shared information with third parties for their own marketing.
              We haven&rsquo;t.
            </li>
            <li>We won&rsquo;t treat you differently for using any of these choices.</li>
          </ul>

          <h3>8. Security</h3>
          <p>
            We use reasonable safeguards to protect your information, including encrypted connections, passwords stored only in
            hashed form, optional Face ID / Touch ID sign-in, one-time codes and links that expire, limits on repeated sign-in
            attempts, and access limited to staff who need it. Staff may view your account to help you, and those actions are
            logged. No system is perfectly secure, so please use a strong password and keep your email account private, since
            password resets go there.
          </p>

          <h3>9. Age requirement</h3>
          <p>
            The site is for adults {AGE} and over. We don&rsquo;t knowingly collect information from anyone under {AGE}. If we learn we
            have, we&rsquo;ll delete it.
          </p>

          <h3>10. Do Not Track</h3>
          <p>
            Some browsers send a &ldquo;Do Not Track&rdquo; signal. There&rsquo;s no common standard for it, so our site
            doesn&rsquo;t respond to it. We don&rsquo;t track you across other websites either way.
          </p>

          <h3>11. Changes to this policy</h3>
          <p>
            We may update this policy. The effective date at the top shows when it last changed, and we&rsquo;ll email members
            about significant changes before they take effect.
          </p>

          <h3>12. Contact</h3>
          <p>
            Questions or requests about your privacy: <Mail />.
            <br />
            {brand.legalName || brand.name}, {[brand.city, brand.legal.state].filter(Boolean).join(", ")}
          </p>
        </section>
      </article>
    </div>
  );
}
