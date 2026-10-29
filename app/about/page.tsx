import { brand } from "@/lib/brand";
import { isEnabled } from "@/lib/flags";
import SiteNav from "@/app/components/SiteNav";

export const metadata = {
  title: `About Us · ${brand.name}`,
  description: `About ${brand.name}: ${brand.description}.`,
};

// Public About page. Replace the three sections below with the client's own story.
export const dynamic = "force-dynamic";

export default async function AboutPage() {
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
        <SiteNav current="about" stores={stores} />
      </header>

      <article className="about">
        <div className="about-hero">
          <div className="about-kicker">Our Story</div>
          <h2 className="about-title">{brand.name}</h2>
          <p className="about-lede">{brand.tagline}</p>
        </div>

        <div className="about-ornament" aria-hidden="true">
          <span></span><span>{brand.emoji}</span><span></span>
        </div>

        <section className="about-block">
          <h3>Our mission</h3>
          <p>
            {brand.name} exists to make {brand.productsPhrase} that people are glad to
            have in their lives. We put care into every batch, tell you plainly what
            goes into it, and stand behind what we make.
          </p>
        </section>

        <section className="about-block">
          <h3>Our vision</h3>
          <p>
            A small business can be the best kind of business: close to its customers,
            honest about its work, and generous with what it knows. That is the company
            we are building.
          </p>
        </section>

        <section className="about-block">
          <h3>Who we are</h3>
          <p>
            {brand.name} is {brand.description}. We work in small batches, source
            thoughtfully, and keep the people who buy from us close.
          </p>
          <p>
            Our members-only side, {brand.members}, is where our regulars find a private
            catalog, member pricing and early word on events. Everyone is welcome in the
            public shop; membership is by request.
          </p>
        </section>

        <div className="about-values">
          <div className="about-value">
            <div className="about-value-icon" aria-hidden="true">🌱</div>
            <div className="about-value-title">Thoughtfully sourced</div>
            <p>Ingredients and materials chosen with care, from people we trust.</p>
          </div>
          <div className="about-value">
            <div className="about-value-icon" aria-hidden="true">✋</div>
            <div className="about-value-title">Independently owned</div>
            <p>A small business, run by the people who make every batch.</p>
          </div>
          <div className="about-value">
            <div className="about-value-icon" aria-hidden="true">🤝</div>
            <div className="about-value-title">Community first</div>
            <p>Built through education, shared experience and care.</p>
          </div>
        </div>

        <div className="about-cta">
          <a className="about-cta-btn" href="/retail">Browse the shop</a>
          <a className="about-cta-alt" href="/events">See upcoming classes and events&nbsp;→</a>
        </div>
      </article>

      <footer className="footnotes">
        <div className="footnotes-ornament" aria-hidden="true">
          <span></span><span>{brand.emoji}</span><span></span>
        </div>
        <div className="footnotes-grid">
          <div className="footnote">
            <div className="footnote-icon" aria-hidden="true">✉</div>
            <div className="footnote-title">Get in touch</div>
            <p>
              Questions about a product or an order? Email{" "}
              <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>.
            </p>
          </div>
          <div className="footnote">
            <div className="footnote-icon" aria-hidden="true">🌿</div>
            <div className="footnote-title">Join {brand.members}</div>
            <p>
              Members get a private catalog and early access to events.{" "}
              <a href="/">Request access&nbsp;→</a>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
