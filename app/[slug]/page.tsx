import { notFound } from "next/navigation";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { isEnabled, applyVideoFlag } from "@/lib/flags";
import { isAdmin } from "@/lib/auth";
import { getProducts, isExternal } from "@/lib/storage";
import { applyStockFlag } from "@/lib/stock";
import { getAmbassadorBySlug, SLUG_RE, socialKind, SOCIAL_NAMES, type Ambassador } from "@/lib/ambassadors";
import RetailClient from "@/app/retail/RetailClient";
import { countAmbassadorVisit } from "@/lib/ambassadorData";
import { isBot } from "@/lib/traffic";
import RememberAmbassador from "./RememberAmbassador";
import SocialIcon from "./SocialIcon";
import { brand } from "@/lib/brand";

export const dynamic = "force-dynamic";

// An ambassador's page: <site>/<slug> (dashboard → Ambassadors).
// Reached only by its link or QR code (not in the menus, not indexed by search
// engines). Every real page of the site wins over this one; unknown names are a 404.

async function load(slug: string): Promise<{ a: Ambassador; preview: boolean } | null> {
  const s = String(slug || "").toLowerCase();
  if (!SLUG_RE.test(s)) return null;
  const a = await getAmbassadorBySlug(s).catch(() => null);
  if (!a) return null;
  const live = a.active && (await isEnabled("ambassador_pages").catch(() => false));
  if (live) return { a, preview: false };
  // Staff can look at a page before it's live.
  return (await isAdmin().catch(() => false)) ? { a, preview: true } : null;
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const hit = await load(params.slug);
  if (!hit) return {};
  const { a } = hit;
  return {
    title: `${a.headline || `${a.name}'s picks`} · ${brand.name}`,
    description: a.bio?.slice(0, 160) || `${a.name}'s favorite ${brand.name} products.`,
    openGraph: a.photo ? { images: [a.photo] } : undefined,
    robots: { index: false, follow: false },
  };
}

export default async function AmbassadorPage({ params, searchParams }: { params: { slug: string }; searchParams?: { qr?: string } }) {
  const hit = await load(params.slug);
  if (!hit) notFound();
  const { a, preview } = hit;
  // Count the visit (and QR scan) for their numbers; never staff previews or bots.
  if (!preview && !isBot(headers().get("user-agent") || "")) countAmbassadorVisit(a.id, searchParams?.qr === "1");
  const [products, stores] = await Promise.all([
    getProducts().then((all) => applyVideoFlag(all.filter(isExternal))).then(applyStockFlag),
    isEnabled("store_locator").catch(() => false),
  ]);
  // Only public-shop products can be featured; members-only ones never show here.
  const publicIds = new Set(products.map((p) => p.id));
  const featured = a.productIds.filter((id) => publicIds.has(id));
  const first = a.name.split(" ")[0];

  const intro = (
    <section className="amb-hero">
      {preview && (
        <div className="amb-preview">
          Staff preview — {a.active ? "turn on Ambassador pages in Settings → Feature switches" : "this page is switched off"}, so customers can&rsquo;t see it yet.
        </div>
      )}
      <div className="amb-card">
        {a.photo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="amb-photo" src={a.photo} alt={a.name} />
        )}
        <div className="amb-text">
          <div className="about-kicker">{brand.shortName} ambassador</div>
          <h2 className="amb-title">{a.headline || `${first}'s favorites`}</h2>
          {a.headline && <div className="amb-name">with {a.name}</div>}
          {a.bio && a.bio.split(/\n{2,}/).map((p, i) => <p key={i} className="amb-bio">{p}</p>)}
          {a.socials.length > 0 && (
            <div className="amb-socials">
              {a.socials.map((s, i) => {
                const kind = socialKind(s.url);
                return (
                  <a key={i} className={`amb-social amb-${kind}`} href={s.url} target="_blank" rel="noopener noreferrer">
                    <SocialIcon kind={kind} />
                    <span>{s.label || SOCIAL_NAMES[kind]}</span>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <div className="amb-picks-head">
        <h3>{featured.length ? `${first}'s picks` : "The shop"}</h3>
        <a href="/retail">See the whole shop&nbsp;→</a>
      </div>
    </section>
  );

  return (
    <>
      {!preview && <RememberAmbassador slug={a.slug} code={a.discountCode} />}
      <RetailClient products={products} stores={stores} featuredIds={featured.length ? featured : undefined} intro={intro} pickup={await isEnabled("cash_pickup").catch(() => false)} />
    </>
  );
}
