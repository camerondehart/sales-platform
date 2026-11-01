import { notFound } from "next/navigation";
import { isEnabled } from "@/lib/flags";
import { publishedFaq, type FaqItem } from "@/lib/faq";
import SiteNav from "@/app/components/SiteNav";
import FormattedDescription from "@/app/components/FormattedDescription";
import { AskAssistantLink } from "@/app/components/assistant/AskAssistant";
import { brand } from "@/lib/brand";

export const metadata = {
  title: `FAQ · ${brand.name}`,
  description: `Answers to common questions about ${brand.name} products, ordering, pickup and membership.`,
};

export const dynamic = "force-dynamic";

// The Smart FAQ page (Settings → FAQ page; switch `faq_page`). Written and
// approved by the business; the Concierge answers from the same entries.
// Hidden until at least one answer is published.
export default async function FaqPage() {
  const [on, stores, items] = await Promise.all([
    isEnabled("faq_page").catch(() => false),
    isEnabled("store_locator").catch(() => false),
    publishedFaq().catch((): FaqItem[] => []),
  ]);
  if (!on || items.length === 0) notFound();

  const groups: Array<{ name: string; items: FaqItem[] }> = [];
  for (const f of items) {
    const name = f.category || "General";
    let g = groups.find((x) => x.name === name);
    if (!g) groups.push((g = { name, items: [] }));
    g.items.push(f);
  }

  return (
    <div className="shell">
      <header className="masthead">
        <a className="masthead-brand" href="/" aria-label={`${brand.name} home`}>
          <div className="logo-mark floaty" aria-hidden="true">
            <span></span><span></span><span></span><span></span>
          </div>
          <h1 className="masthead-title">{brand.name}</h1>
        </a>
        <SiteNav stores={stores} concierge />
      </header>

      <article className="about faq">
        <div className="about-hero">
          <div className="about-kicker">Questions &amp; answers</div>
          <h2 className="about-title">Frequently asked</h2>
          <p className="about-lede">The things people ask us most. Can&rsquo;t find yours? Ask our Concierge or email us.</p>
        </div>

        {groups.length > 1 && (
          <nav className="faq-jump" aria-label="FAQ topics">
            {groups.map((g) => (
              <a key={g.name} href={`#faq-${g.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{g.name}</a>
            ))}
          </nav>
        )}

        {groups.map((g) => (
          <section key={g.name} className="faq-group" id={`faq-${g.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
            {groups.length > 1 && <h3>{g.name}</h3>}
            {g.items.map((f) => (
              <details key={f.id} className="faq-item" id={f.id}>
                <summary>{f.question}</summary>
                <div className="faq-answer">
                  <FormattedDescription text={f.answer} />
                </div>
              </details>
            ))}
          </section>
        ))}

        <div className="faq-more">
          <AskAssistantLink label="Still wondering? Ask our Concierge" />
          <span>
            or email <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>
          </span>
        </div>
      </article>
    </div>
  );
}
