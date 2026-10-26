/**
 * Brand values for the whole app. Edit brand.config.ts, or set the
 * NEXT_PUBLIC_BRAND_* variables below at build time to override it without
 * touching code (useful when one repo serves several deployments).
 *
 * Safe to import from server code, client components and route handlers.
 */
import brandConfig from "@/brand.config";

const env = (key: string, fallback: string) => {
  const v = process.env[key];
  return v && v.trim() ? v.trim() : fallback;
};

const siteUrl = env("NEXT_PUBLIC_SITE_URL", brandConfig.siteUrl).replace(/\/$/, "");
const hostOf = (u: string) => {
  try { return new URL(u).hostname; } catch { return ""; }
};

export const brand = {
  ...brandConfig,
  name: env("NEXT_PUBLIC_BRAND_NAME", brandConfig.name),
  shortName: env("NEXT_PUBLIC_BRAND_SHORT_NAME", brandConfig.shortName),
  members: env("NEXT_PUBLIC_BRAND_MEMBERS", brandConfig.members),
  legalName: env("NEXT_PUBLIC_BRAND_LEGAL_NAME", brandConfig.legalName),
  siteUrl,
  domains: Array.from(new Set([...brandConfig.domains, hostOf(siteUrl)].filter(Boolean))),
  supportEmail: env("NEXT_PUBLIC_SUPPORT_EMAIL", brandConfig.supportEmail),
  tagline: env("NEXT_PUBLIC_BRAND_TAGLINE", brandConfig.tagline),
  city: env("NEXT_PUBLIC_BRAND_CITY", brandConfig.city),
  emoji: env("NEXT_PUBLIC_BRAND_EMOJI", brandConfig.emoji),
  timezone: env("NEXT_PUBLIC_BRAND_TIMEZONE", brandConfig.timezone),
  payments: {
    venmoHandle: env("NEXT_PUBLIC_VENMO_HANDLE", brandConfig.payments.venmoHandle),
    zelle: env("NEXT_PUBLIC_ZELLE_CONTACT", brandConfig.payments.zelle),
  },
};

/** "the Northwind team" — sign-off used in emails. */
export const TEAM = `The ${brand.shortName} team`;
/** Plain string helpers for template literals. */
export const SUPPORT_EMAIL = brand.supportEmail;
export const SITE_URL = brand.siteUrl;
export const EMOJI = brand.emoji;

/** Host-only check: is this link to our own site? */
export function isOwnHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return brand.domains.some((d) => d.toLowerCase().replace(/^www\./, "") === h);
}

/** Regex source matching our own hostnames (for "outside link" checks). */
export const OWN_HOSTS_RE_SRC = brand.domains.map((d) => d.replace(/^www\./, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");

/** Replaces {{BRAND}}-style tokens in static HTML (the staff guide). */
export function applyBrandTokens(html: string): string {
  return html
    .replace(/\{\{BRAND\}\}/g, brand.name)
    .replace(/\{\{SHORT\}\}/g, brand.shortName)
    .replace(/\{\{MEMBERS\}\}/g, brand.members)
    .replace(/\{\{SUPPORT\}\}/g, brand.supportEmail)
    .replace(/\{\{SITE\}\}/g, brand.siteUrl)
    .replace(/\{\{HOST\}\}/g, hostOf(brand.siteUrl) || "example.com")
    .replace(/\{\{EMOJI\}\}/g, brand.emoji)
    .replace(/\{\{TZ\}\}/g, brand.timezoneLabel)
    .replace(/\{\{PICKUP_ADDRESS\}\}/g, brand.pickup.address)
    .replace(/\{\{PICKUP_WHERE\}\}/g, brand.pickup.where);
}
