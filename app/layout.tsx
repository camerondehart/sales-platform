import type { Metadata } from "next";
import "./globals.css";
import SiteBanner from "./SiteBanner";
import SiteAssistant from "./components/assistant/SiteAssistant";
import Tracker from "./components/Tracker";
import SiteFooter from "./SiteFooter";
import { getBanner } from "@/lib/banner";
import { brand } from "@/lib/brand";
import { safeBannerHtml, safeHref } from "@/lib/safeHtml";
import { currentSiteSeason } from "@/lib/entrance";
import { SITE_LOOKS, siteLookVars } from "@/lib/seasonLooks";
import { cookies, headers } from "next/headers";
import { isAdmin } from "@/lib/auth";
import { ENTRANCE_THEMES, isEntranceKey } from "@/lib/entranceThemes";
import { SEASON_PREVIEW_COOKIE } from "@/lib/seasonPreview";
import SeasonDrift from "./components/SeasonDrift";
import NightSky from "./components/NightSky";
import { isEnabled } from "@/lib/flags";
import { NIGHT_PREVIEW_COOKIE, nightHeadScript, roughArea } from "@/lib/nightSky";
import { geoFromHeaders } from "@/lib/localEvents";

export const metadata: Metadata = {
  title: `${brand.name} · ${brand.members}`,
  description: `${brand.members}: the members-only side of ${brand.name}.`,
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const banner = await getBanner();
  // Seasonal site background (Settings → Entrance animation; switch seasonal_site). null = the usual look.
  let season = await currentSiteSeason().catch(() => null);
  // Staff "Preview background" (Settings → Entrance animation): this browser only, staff only.
  const previewKey = cookies().get(SEASON_PREVIEW_COOKIE)?.value;
  const previewing = previewKey && isEntranceKey(previewKey) && (await isAdmin().catch(() => false)) ? previewKey : null;
  if (previewing) season = previewing === "classic" ? null : previewing;
  const seasonVars = season ? siteLookVars(season) : null;
  // Night sky (switch night_sky): dusk to dawn on the visitor's own clock, decided in the
  // browser by the <head> script below. Staff can preview night or day (Settings → Entrance animation).
  const nightOn = await isEnabled("night_sky").catch(() => false);
  const nightCookie = cookies().get(NIGHT_PREVIEW_COOKIE)?.value;
  const nightForce = (nightCookie === "on" || nightCookie === "off") && (await isAdmin().catch(() => false)) ? nightCookie : null;
  // Meadow decor only: "plain" has no valley to turn to night.
  const nightSky = brand.decor === "meadow" && (nightOn || nightForce === "on"); // staff can preview it with the switch off too
  // Rough area (Vercel's IP headers, rounded, never stored) so dusk matches where the visitor is.
  const nightArea = nightSky ? roughArea(geoFromHeaders((n) => headers().get(n))) : null;
  // Whether a banner will render. SiteBanner also hides it on staff pages,
  // which only the client knows, so this is a "probably" — close enough for
  // the first-paint estimate below.
  const bannerLikely =
    !!banner.enabled &&
    !!banner.message?.trim() &&
    (!banner.countdownTo || banner.countdownTo > Date.now());

  return (
    // suppressHydrationWarning: the night script sets data-night on <html> before React loads.
    <html lang="en" suppressHydrationWarning style={{ ["--brand-emoji" as any]: `"${brand.emoji}"`, ["--brand-members" as any]: `"${brand.members.replace(/"/g, "")}"` }}>
      <head>
        {nightSky && <script dangerouslySetInnerHTML={{ __html: nightHeadScript(nightForce, nightArea) }} />}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        {/*
          Brand fonts:
          - Libre Baskerville: free on Google Fonts, used as primary serif for headings/body serif moments
          - Optima: licensed system font; we fall back to a humanist-sans stack
            (Optima → Candara → URW Classico → "Helvetica Neue" → sans-serif) used for UI/body
          - Quincy: paid display serif from Indestructible Type Foundry; we fall back to
            a stylish display serif (Cormorant Garamond → "Big Caslon" → serif) for hero/display moments
          Once you've licensed Optima/Quincy and have web font files, drop them in /public/fonts/
          and add @font-face declarations at the top of globals.css — they'll automatically take over.
        */}
        <link
          href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,400&display=swap"
          rel="stylesheet"
        />
        {/* A sensible starting height for the banner so full-height sections
            are already the right size on first paint. SiteBanner measures the
            real height after hydration and corrects this. */}
        {bannerLikely && (
          <style dangerouslySetInnerHTML={{ __html: ":root{--banner-h:46px}" }} />
        )}
      </head>
      <body data-season={season || undefined} style={seasonVars || undefined}>
        <SiteBanner initial={{ ...banner, message: safeBannerHtml(banner.message), linkUrl: (banner.linkUrl && safeHref(banner.linkUrl)) || undefined }} />
        {children}
        {/* After the page so it drifts over the valley but behind the content (z-index 1). */}
        {season && SITE_LOOKS[season]?.drift && <SeasonDrift {...SITE_LOOKS[season]!.drift!} />}
        {nightSky && <NightSky force={nightForce} area={nightArea} />}
        {nightForce && (
          <div className="season-preview-bar night-preview-bar" role="status">
            {/* One span: the bar is a flex row, and loose text + <strong> became separate squeezed columns. */}
            <span>Previewing the site {nightForce === "on" ? <strong>at night</strong> : <strong>by day</strong>} · only you see this</span>
            <a href="/api/admin/season-preview?night=auto&amp;to=/admin">Stop</a>
          </div>
        )}
        {previewing && (
          <div className="season-preview-bar" role="status">
            <span>Previewing the <strong>{ENTRANCE_THEMES[previewing].label}</strong> background · only you see this</span>
            <a href="/api/admin/season-preview?key=off&amp;to=/admin">Stop</a>
          </div>
        )}
        <SiteFooter />
        <SiteAssistant />
        <Tracker />
      </body>
    </html>
  );
}
