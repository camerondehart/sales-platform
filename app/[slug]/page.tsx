import { notFound } from "next/navigation";
import { headers } from "next/headers";
import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { isEnabled, applyVideoFlag } from "@/lib/flags";
import { isAdmin } from "@/lib/auth";
import { getProducts, isExternal } from "@/lib/storage";
import { applyStockFlag } from "@/lib/stock";
import { getAmbassadorBySlug, SLUG_RE, socialKind, SOCIAL_NAMES, type Ambassador } from "@/lib/ambassadors";
import RetailClient from "@/app/retail/RetailClient";
import Scene from "@/app/components/Scene";
import { brand } from "@/lib/brand";
import { countAmbassadorVisit } from "@/lib/ambassadorData";
import { isBot } from "@/lib/traffic";
import RememberAmbassador from "./RememberAmbassador";
import SocialIcon from "./SocialIcon";
import AmbassadorWelcome from "./AmbassadorWelcome";
import CopyCode from "./CopyCode";
import { findDiscountByCode, type Discount } from "@/lib/discounts";
import { AMBASSADOR_LOOKS, emojiFor, firstEmoji, lookFor, welcomeScript } from "@/lib/ambassadorLooks";

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

/** Their headline as shown: an emoji typed into it moves to the photo badge (or goes, when switched off). */
function displayTitle(a: Ambassador): string {
  const first = a.name.split(" ")[0];
  const raw = a.headline || `${first}'s favorites`;
  const e = firstEmoji(raw);
  return (e ? raw.split(e).join(" ") : raw).replace(/\s+/g, " ").trim() || `${first}'s favorites`;
}

/** Their linked code, only while it really works (active, not expired, not used up), with its exact amount. */
async function liveCode(code: string | undefined): Promise<{ code: string; off: string; min?: number } | null> {
  if (!code) return null;
  const d: Discount | undefined = await findDiscountByCode(code).catch(() => undefined);
  if (!d || !d.active || !(d.value > 0)) return null;
  if (d.expiresAt && d.expiresAt < Date.now()) return null;
  if (d.maxUses && d.uses >= d.maxUses) return null;
  const n = Number.isInteger(d.value) ? String(d.value) : d.value.toFixed(2);
  return { code: d.code, off: d.type === "percentage" ? `${n}% off` : `$${n} off`, min: d.minOrderAmount || undefined };
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const hit = await load(params.slug);
  if (!hit) return {};
  const { a } = hit;
  return {
    title: `${a.headline ? (a.showEmoji === false ? displayTitle(a) : a.headline) : `${a.name}'s picks`} · ${brand.name}`,
    description: a.bio?.slice(0, 160) || `${a.name}'s favorite ${brand.name} products.`,
    openGraph: a.photo ? { images: [a.photo] } : undefined,
    robots: { index: false, follow: false },
  };
}

export default async function AmbassadorPage({ params, searchParams }: { params: { slug: string }; searchParams?: { qr?: string; welcome?: string } }) {
  const hit = await load(params.slug);
  if (!hit) notFound();
  const { a, preview } = hit;
  // Count the visit (and QR scan) for their numbers; never staff previews or bots.
  if (!preview && !isBot(headers().get("user-agent") || "")) countAmbassadorVisit(a.id, searchParams?.qr === "1");
  const [products, stores, welcomeOn, pickup, code] = await Promise.all([
    getProducts().then((all) => applyVideoFlag(all.filter(isExternal))).then(applyStockFlag),
    isEnabled("store_locator").catch(() => false),
    isEnabled("ambassador_welcome").catch(() => false),
    isEnabled("cash_pickup").catch(() => false),
    liveCode(a.discountCode),
  ]);
  // Only public-shop products can be featured; members-only ones never show here.
  const publicIds = new Set(products.map((p) => p.id));
  const featured = a.productIds.filter((id) => publicIds.has(id));
  const first = a.name.split(" ")[0];
  // Their look (lib/ambassadorLooks.ts) and emoji: the emoji leaves the headline and becomes a badge on their photo.
  const look = lookFor(a);
  const emoji = emojiFor(a);
  const title = displayTitle(a);
  const bio = a.bio ? a.bio.split(/\n{2,}/) : [];
  // ?welcome=1 replays it (the Ambassadors tab's Preview welcome button).
  const force = searchParams?.welcome === "1";

  const intro = (
    <section className="amb-hero">
      {preview && (
        <div className="amb-preview">
          Staff preview — {a.active ? "turn on Ambassador pages in Settings → Feature switches" : "this page is switched off"}, so customers can&rsquo;t see it yet.
        </div>
      )}
      <div className="amb-card">
        <div className="amb-aura" aria-hidden="true">
          <span className="amb-orb amb-orb-1" />
          <span className="amb-orb amb-orb-2" />
          <span className="amb-sparkle amb-sparkle-1">✦</span>
          <span className="amb-sparkle amb-sparkle-2">✧</span>
          <span className="amb-sparkle amb-sparkle-3">✦</span>
          <span className="amb-mark">{emoji || AMBASSADOR_LOOKS[look].glyphs[0]}</span>
        </div>
        <div className="amb-portrait amb-rv" style={{ "--d": "0.05s" } as CSSProperties}>
          <span className="amb-halo" aria-hidden="true" />
          {a.photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="amb-photo" src={a.photo} alt={a.name} />
          ) : (
            <span className="amb-photo amb-photo-blank" aria-hidden="true">{first.slice(0, 1)}</span>
          )}
          {emoji && <span className="amb-emoji" aria-hidden="true">{emoji}</span>}
        </div>
        <div className="amb-text">
          <div className="amb-kicker amb-rv" style={{ "--d": "0.15s" } as CSSProperties}>{brand.shortName} ambassador</div>
          <h2 className="amb-title amb-rv" style={{ "--d": "0.25s" } as CSSProperties}>{title}</h2>
          {a.headline && <div className="amb-name amb-rv" style={{ "--d": "0.35s" } as CSSProperties}>with {a.name}</div>}
          {code && (
            <div className="amb-offer amb-rv" style={{ "--d": "0.4s" } as CSSProperties}>
              <div className="amb-offer-text">
                <strong>{code.off}</strong> with {first}&rsquo;s code{code.min ? ` on orders of $${code.min.toFixed(2).replace(/\.00$/, "")} or more` : ""}
                <span>Filled in for you at checkout when you shop from this page.</span>
              </div>
              <CopyCode code={code.code} />
            </div>
          )}
          {bio.length > 0 && (
            <blockquote className="amb-quote amb-rv" style={{ "--d": "0.45s" } as CSSProperties}>
              {bio.map((p, i) => <p key={i} className="amb-bio">{p}</p>)}
              <footer className="amb-sign">— {first}</footer>
            </blockquote>
          )}
          {a.socials.length > 0 && (
            <div className="amb-socials amb-rv" style={{ "--d": "0.55s" } as CSSProperties}>
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
      <div className="amb-picks-head amb-rv" style={{ "--d": "0.65s" } as CSSProperties}>
        <div>
          <h3>{featured.length ? `${first}'s picks` : "The shop"}</h3>
          {featured.length > 0 && (
            <p className="amb-picks-sub">
              Hand-picked by {first} · {featured.length} {featured.length === 1 ? "favorite" : "favorites"}
            </p>
          )}
          <svg className="amb-flourish" viewBox="0 0 220 14" aria-hidden="true">
            <path d="M2,9 C40,2 70,13 110,7 C150,1 180,12 218,5" />
          </svg>
        </div>
        {/* On phones this sits at the bottom of the page instead (amb-more), so shoppers stay with their picks. */}
        <a className="amb-shop-top" href="/retail">See the whole shop&nbsp;→</a>
      </div>
    </section>
  );

  return (
    <div className={`amb-page amb-look-${look}`}>
      {/* The site's valley, softened behind the shop like the members' gallery; it follows the seasons like every page. */}
      <Scene variant="soft" />
      {welcomeOn && a.welcome !== false && (
        <>
          <script dangerouslySetInnerHTML={{ __html: welcomeScript(a.slug, force) }} />
          <AmbassadorWelcome slug={a.slug} look={look} title={title} name={a.name} photo={a.photo} emoji={emoji} force={force} />
        </>
      )}
      {!preview && <RememberAmbassador slug={a.slug} code={a.discountCode} />}
      <RetailClient
        products={products}
        stores={stores}
        featuredIds={featured.length ? featured : undefined}
        pickedBy={featured.length ? first : undefined}
        intro={intro}
        outro={
          <>
          <section className="amb-join amb-rv" style={{ "--d": "0.2s" } as CSSProperties}>
            <span className="amb-join-mark" aria-hidden="true">{emoji || "🌿"}</span>
            <div className="amb-join-text">
              <div className="amb-kicker">{brand.members}</div>
              <h3>Love what {first} loves?</h3>
              <p>{first}&rsquo;s picks are just the start. Our members enjoy a private catalog, member pricing and early access to events.</p>
            </div>
            <a className="amb-join-go" href="/#join">Request membership&nbsp;→</a>
          </section>
          <p className="amb-more"><a href="/retail">Browse everything in the shop&nbsp;→</a></p>
          </>
        }
        pickup={pickup}
      />
    </div>
  );
}
