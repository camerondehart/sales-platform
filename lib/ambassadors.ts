import path from "path";
import { VersionedStore } from "./versionedStore";
import { pacificDay } from "./periods";
import { brand } from "./brand";

/** "example.com", for messages about page addresses. */
const SITE_HOST = brand.siteUrl.replace(/^https?:\/\/(www\.)?/, "");

/**
 * Ambassadors (dashboard → Ambassadors; public page at <site>/<slug>,
 * reached only by its link or QR code). Each ambassador has their own page
 * with the products they feature, their photo, a few words and links to their
 * socials, plus their own terms (commission, trial, attribution window…).
 * Orders are credited to an ambassador when the shopper came through their
 * page (the browser remembers the page for the ambassador's window; nothing
 * personal is stored) or, for members, when they check out with the
 * ambassador's linked discount code. Attribution only: it never changes a price.
 */

/** Default attribution window (days); each ambassador can have their own. */
export const ATTRIBUTION_DAYS = 30;
/** The browser remembers a page this long at most; the ambassador's own window decides. */
export const MAX_WINDOW_DAYS = 365;

export type PayoutSchedule = "monthly" | "quarterly" | "on request";

/** Their agreement, configurable per ambassador. Defaults follow the first invitation (Oct 2026). */
export type AmbassadorTerms = {
  /** Commission on eligible net product sales, %. */
  commissionPct: number;
  /** The "room to grow" rate, % (used once growthOn is ticked). */
  growthPct?: number;
  /** What earns the growth rate, in words. */
  growthGoal?: string;
  growthOn: boolean;
  /** Their community's discount, % (given through their linked code). */
  discountPct?: number;
  /** Trial length in days (0 = no trial). */
  trialDays: number;
  /** The end-of-trial review has happened. */
  trialReviewed?: boolean;
  /** When the partnership started (YYYY-MM-DD, Pacific). */
  startDate: string;
  /** Days after visiting their page that an order still counts. */
  windowDays: number;
  /** Repeat purchases count (false = only each customer's first order). */
  repeatPurchases: boolean;
  payoutSchedule: PayoutSchedule;
  /** Complimentary products, content permissions, exclusivity… */
  notes?: string;
};

export type Payout = { id: string; at: number; amount: number; note?: string };

export const DEFAULT_TERMS: Omit<AmbassadorTerms, "startDate"> = {
  commissionPct: 15,
  growthPct: 20,
  growthGoal: "",
  growthOn: false,
  discountPct: 10,
  trialDays: 90,
  windowDays: ATTRIBUTION_DAYS,
  repeatPurchases: true,
  payoutSchedule: "monthly",
};

export type SocialLink = { url: string; label?: string };

export type Ambassador = {
  id: string;
  /** The page address: <site>/<slug>. */
  slug: string;
  name: string;
  /** Big line at the top, e.g. "Maya's favorites". */
  headline?: string;
  /** A few words from or about them. */
  bio?: string;
  photo?: string;
  /** Public-shop products on their page, in this order. */
  productIds: string[];
  socials: SocialLink[];
  /** Existing discount code that also credits them (members' checkout). */
  discountCode?: string;
  /** Where progress reports go. */
  email?: string;
  terms?: AmbassadorTerms;
  payouts?: Payout[];
  lastReportAt?: number;
  active: boolean;
  createdAt: number;
  updatedAt: number;
};

/** What an order records about the ambassador it's credited to (rate = their commission % at the time). */
export type OrderAmbassador = { id: string; slug: string; name: string; via: "page" | "code"; rate?: number };

/** Their terms, with defaults filled in for older records. */
export function termsOf(a: Pick<Ambassador, "terms" | "createdAt">): AmbassadorTerms {
  return { ...DEFAULT_TERMS, startDate: pacificDay(a.createdAt), ...(a.terms || {}) };
}
/** The commission % that applies today. */
export function currentRate(t: AmbassadorTerms): number {
  return t.growthOn && typeof t.growthPct === "number" ? t.growthPct : t.commissionPct;
}

const store = new VersionedStore<Ambassador>({
  name: "ambassadors",
  legacyKey: "ambassadors.json",
  localFile: path.join(process.cwd(), "data", "ambassadors.json"),
  keep: 8,
  reconcileLegacy: false,
});

export async function getAmbassadors(): Promise<Ambassador[]> {
  return (await store.read()).data.slice().sort((a, b) => a.name.localeCompare(b.name));
}

export async function getAmbassadorBySlug(slug: string): Promise<Ambassador | null> {
  const s = String(slug || "").toLowerCase();
  return (await getAmbassadors()).find((a) => a.slug === s) || null;
}

/**
 * Top-level addresses the site already uses (pages, APIs, files). An
 * ambassador page can never take one of these.
 */
export const RESERVED_SLUGS = new Set([
  "about", "account", "admin", "ambassador", "ambassadors", "api", "app", "assets", "blog", "cart", "checkout", "contact",
  "events", "favicon", "gallery", "help", "home", "index", "join", "login", "logout", "media", "members", "new", "orders",
  "p", "pay", "privacy", "public", "retail", "robots", "set-password", "settings", "shop", "signup", "sitemap", "static",
  "stores", "support", "terms", "unsubscribe", "welcome", "www",
]);

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** "Maya Rose!" → "mayarose" — a suggestion for the page address. */
export function suggestSlug(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "").slice(0, 40);
}

const t = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function cleanUrl(raw: string): string | null {
  let u = raw.trim();
  if (!u) return null;
  if (u.startsWith("@")) return null; // a handle, not a link
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try {
    const p = new URL(u);
    if (p.protocol !== "https:" && p.protocol !== "http:") return null;
    if (!p.hostname.includes(".")) return null;
    return p.toString();
  } catch {
    return null;
  }
}

/** Instagram, TikTok… from a link's address (used for the icon and default label). */
export function socialKind(url: string): "instagram" | "tiktok" | "youtube" | "facebook" | "x" | "pinterest" | "threads" | "spotify" | "link" {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {}
  if (host.endsWith("instagram.com")) return "instagram";
  if (host.endsWith("tiktok.com")) return "tiktok";
  if (host.endsWith("youtube.com") || host === "youtu.be") return "youtube";
  if (host.endsWith("facebook.com") || host === "fb.com") return "facebook";
  if (host === "x.com" || host.endsWith("twitter.com")) return "x";
  if (host.endsWith("pinterest.com")) return "pinterest";
  if (host.endsWith("threads.net") || host.endsWith("threads.com")) return "threads";
  if (host.endsWith("spotify.com")) return "spotify";
  return "link";
}

export const SOCIAL_NAMES: Record<ReturnType<typeof socialKind>, string> = {
  instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", facebook: "Facebook", x: "X",
  pinterest: "Pinterest", threads: "Threads", spotify: "Spotify", link: "Website",
};

type Clean = Omit<Ambassador, "id" | "createdAt" | "updatedAt">;

/** Validates staff input. `others` = the other ambassadors (for a unique address). */
export function cleanAmbassador(input: Record<string, unknown>, others: Ambassador[]): { ok: true; value: Clean } | { ok: false; error: string } {
  const name = t(input.name, 80);
  if (!name) return { ok: false, error: "Add the ambassador's name." };
  const slug = t(input.slug, 60).toLowerCase().replace(/^\/+/, "");
  if (!slug) return { ok: false, error: `Choose the page address (${SITE_HOST}/…).` };
  if (!SLUG_RE.test(slug)) return { ok: false, error: "The page address can only use letters, numbers and dashes (2–40 characters, no spaces)." };
  if (slug.length < 2) return { ok: false, error: "The page address needs at least 2 characters." };
  if (RESERVED_SLUGS.has(slug)) return { ok: false, error: `${SITE_HOST}/${slug} is already part of the site. Pick another address.` };
  if (others.some((a) => a.slug === slug)) return { ok: false, error: `${SITE_HOST}/${slug} is already another ambassador's page.` };

  const headline = t(input.headline, 120);
  const bio = String(input.bio ?? "").replace(/\r/g, "").trim().slice(0, 1200);
  const photoRaw = t(input.photo, 600);
  const photo = photoRaw ? cleanUrl(photoRaw) : null;
  if (photoRaw && !photo) return { ok: false, error: "The photo link doesn't look right. Upload a photo or paste a full link." };

  const productIds = Array.isArray(input.productIds)
    ? Array.from(new Set(input.productIds.map((x) => t(x, 80)).filter(Boolean))).slice(0, 24)
    : [];

  const socials: SocialLink[] = [];
  if (Array.isArray(input.socials)) {
    for (const raw of input.socials.slice(0, 8)) {
      const r = (raw && typeof raw === "object" ? raw : { url: raw }) as Record<string, unknown>;
      const rawUrl = t(r.url, 400);
      if (!rawUrl) continue;
      const url = cleanUrl(rawUrl);
      if (!url) return { ok: false, error: `“${rawUrl}” isn't a full link. Paste the address of their profile (e.g. instagram.com/theirname).` };
      const label = t(r.label, 40);
      socials.push(label ? { url, label } : { url });
    }
  }

  const discountCode = t(input.discountCode, 40).toUpperCase();
  const email = t(input.email, 200).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "That email address doesn't look right." };
  const terms = cleanTerms(input.terms);
  if (!terms.ok) return terms;
  return {
    ok: true,
    value: {
      slug, name,
      headline: headline || undefined,
      bio: bio || undefined,
      photo: photo || undefined,
      productIds,
      socials,
      discountCode: discountCode || undefined,
      email: email || undefined,
      ...(terms.value ? { terms: terms.value } : {}),
      active: input.active === undefined ? true : !!input.active,
    },
  };
}

function pct(v: unknown, label: string): number | undefined | { error: string } {
  if (v === undefined || v === null || String(v).trim() === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) return { error: `${label} must be between 0 and 100%.` };
  return Math.round(n * 100) / 100;
}
function wholeDays(v: unknown, label: string, max: number): number | undefined | { error: string } {
  if (v === undefined || v === null || String(v).trim() === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) return { error: `${label} must be between 0 and ${max} days.` };
  return Math.round(n);
}

/** Validates the terms (missing ones use the defaults). Undefined input = leave terms as they are. */
export function cleanTerms(input: unknown): { ok: true; value?: AmbassadorTerms } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true };
  if (typeof input !== "object") return { ok: false, error: "Bad terms." };
  const r = input as Record<string, unknown>;
  const fields = {
    commissionPct: pct(r.commissionPct, "Commission"),
    growthPct: pct(r.growthPct, "The growth rate"),
    discountPct: pct(r.discountPct, "The community discount"),
    trialDays: wholeDays(r.trialDays, "The trial", 730),
    windowDays: wholeDays(r.windowDays, "The attribution window", MAX_WINDOW_DAYS),
  };
  for (const v of Object.values(fields)) if (v && typeof v === "object") return { ok: false, error: v.error };
  const n = fields as Record<string, number | undefined>;
  const startDate = t(r.startDate, 10);
  if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return { ok: false, error: "The start date doesn't look right." };
  const sched = String(r.payoutSchedule || "");
  const value: AmbassadorTerms = {
    commissionPct: n.commissionPct ?? DEFAULT_TERMS.commissionPct,
    growthPct: n.growthPct,
    growthGoal: t(r.growthGoal, 300) || undefined,
    growthOn: !!r.growthOn,
    discountPct: n.discountPct,
    trialDays: n.trialDays ?? 0,
    trialReviewed: !!r.trialReviewed,
    startDate: startDate || pacificDay(),
    windowDays: n.windowDays || ATTRIBUTION_DAYS,
    repeatPurchases: r.repeatPurchases === undefined ? true : !!r.repeatPurchases,
    payoutSchedule: sched === "quarterly" || sched === "on request" ? sched : "monthly",
    notes: String(r.notes ?? "").replace(/\r/g, "").trim().slice(0, 2000) || undefined,
  };
  if (value.growthOn && value.growthPct === undefined) return { ok: false, error: "Add the growth rate before switching to it." };
  return { ok: true, value };
}

const newId = () => `amb_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export async function saveAmbassador(id: string | undefined, input: Record<string, unknown>): Promise<{ ok: true; ambassador: Ambassador; before?: Ambassador } | { ok: false; error: string; status: number }> {
  const all = await getAmbassadors();
  const existing = id ? all.find((a) => a.id === id) : undefined;
  if (id && !existing) return { ok: false, error: "That ambassador no longer exists.", status: 404 };
  const c = cleanAmbassador(input, all.filter((a) => a.id !== id));
  if (!c.ok) return { ok: false, error: c.error, status: 400 };
  const now = Date.now();
  const saved = await store.mutate<Ambassador | "taken" | null>((rows) => {
    // Checked again inside the save, in case two people pick the same address at once.
    if (rows.some((r) => r.slug === c.value.slug && r.id !== id)) return { data: null, result: "taken" as const };
    if (existing) {
      const i = rows.findIndex((r) => r.id === existing.id);
      if (i === -1) return { data: null, result: null };
      const next: Ambassador = { ...rows[i], ...c.value, updatedAt: now };
      const out = rows.slice();
      out[i] = next;
      return { data: out, result: next };
    }
    const next: Ambassador = { id: newId(), ...c.value, createdAt: now, updatedAt: now };
    return { data: [...rows, next], result: next };
  });
  if (saved === "taken") return { ok: false, error: `${SITE_HOST}/${c.value.slug} is already another ambassador's page.`, status: 409 };
  if (!saved) return { ok: false, error: "That ambassador no longer exists.", status: 404 };
  return { ok: true, ambassador: saved, before: existing };
}

export async function deleteAmbassador(id: string): Promise<Ambassador | null> {
  return store.mutate<Ambassador | null>((rows) => {
    const hit = rows.find((r) => r.id === id) || null;
    if (!hit) return { data: null, result: null };
    return { data: rows.filter((r) => r.id !== id), result: hit };
  }, { allowShrink: true });
}

const payoutId = () => `po_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Record money paid to an ambassador. */
export async function addPayout(id: string, input: { amount?: unknown; at?: unknown; note?: unknown }): Promise<{ ok: true; ambassador: Ambassador; payout: Payout } | { ok: false; error: string; status: number }> {
  const amount = Math.round(Number(input.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000) return { ok: false, error: "Enter the amount paid, e.g. 42.50.", status: 400 };
  const day = t(input.at, 10);
  let at = Date.now();
  if (day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, error: "The payout date doesn't look right.", status: 400 };
    at = Date.parse(`${day}T12:00:00-08:00`);
  }
  const payout: Payout = { id: payoutId(), at, amount, ...(t(input.note, 200) ? { note: t(input.note, 200) } : {}) };
  const saved = await store.mutate<Ambassador | null>((rows) => {
    const i = rows.findIndex((r) => r.id === id);
    if (i === -1) return { data: null, result: null };
    const next: Ambassador = { ...rows[i], payouts: [...(rows[i].payouts || []), payout].slice(-500), updatedAt: Date.now() };
    const out = rows.slice();
    out[i] = next;
    return { data: out, result: next };
  });
  return saved ? { ok: true, ambassador: saved, payout } : { ok: false, error: "That ambassador no longer exists.", status: 404 };
}

/** Undo a payout entered by mistake. */
export async function removePayout(id: string, payoutIdToGo: string): Promise<{ ambassador: Ambassador; payout: Payout } | null> {
  return store.mutate<{ ambassador: Ambassador; payout: Payout } | null>((rows) => {
    const i = rows.findIndex((r) => r.id === id);
    const hit = i === -1 ? undefined : (rows[i].payouts || []).find((p) => p.id === payoutIdToGo);
    if (!hit) return { data: null, result: null };
    const next: Ambassador = { ...rows[i], payouts: (rows[i].payouts || []).filter((p) => p.id !== payoutIdToGo), updatedAt: Date.now() };
    const out = rows.slice();
    out[i] = next;
    return { data: out, result: { ambassador: next, payout: hit } };
  }, { allowShrink: true });
}

/** Discount codes linked to live ambassadors (these always work in the public shop). */
export async function ambassadorCodes(): Promise<Set<string>> {
  try {
    return new Set((await getAmbassadors()).filter((a) => a.active && a.discountCode).map((a) => a.discountCode!));
  } catch {
    return new Set();
  }
}

/** Note when the last progress report went out. */
export async function markReported(id: string): Promise<void> {
  await store.mutate<null>((rows) => {
    const i = rows.findIndex((r) => r.id === id);
    if (i === -1) return { data: null, result: null };
    const out = rows.slice();
    out[i] = { ...rows[i], lastReportAt: Date.now() };
    return { data: out, result: null };
  });
}

/** What the shopper's browser remembered: the page and when they visited (older checkouts send just the page). */
function readRef(ref: unknown): { slug: string; at?: number } | null {
  if (typeof ref === "string") return ref.trim() ? { slug: ref.trim().toLowerCase().slice(0, 60) } : null;
  if (ref && typeof ref === "object") {
    const r = ref as Record<string, unknown>;
    const slug = typeof r.slug === "string" ? r.slug.trim().toLowerCase().slice(0, 60) : "";
    const at = Number(r.at);
    return slug ? { slug, at: Number.isFinite(at) ? at : undefined } : null;
  }
  return null;
}

/**
 * Who an order is credited to. A linked discount code (members' checkout)
 * wins over the page the shopper came from; only live ambassadors count.
 * Never throws: attribution must not stop an order.
 */
export async function creditFor(input: {
  ref?: unknown;
  discountCode?: string | null;
  /** The customer, for "first order only" terms. */
  email?: string;
  /** Earlier orders (for "first order only"), loaded only when needed. */
  pastOrders?: () => Promise<Array<{ userEmail: string; status: string; ambassador?: { id: string } }>>;
  now?: number;
}): Promise<OrderAmbassador | undefined> {
  try {
    const now = input.now ?? Date.now();
    const all = (await getAmbassadors()).filter((a) => a.active);
    let hit: Ambassador | undefined;
    let via: OrderAmbassador["via"] = "page";
    const code = String(input.discountCode || "").trim().toUpperCase();
    if (code) hit = all.find((a) => a.discountCode && a.discountCode === code);
    if (hit) via = "code";
    else {
      const ref = readRef(input.ref);
      const bySlug = ref ? all.find((a) => a.slug === ref.slug) : undefined;
      // The page visit must be inside this ambassador's window.
      if (bySlug && (ref?.at === undefined || (ref.at <= now + 60_000 && now - ref.at <= termsOf(bySlug).windowDays * 86_400_000))) hit = bySlug;
    }
    if (!hit) return undefined;
    const terms = termsOf(hit);
    if (!terms.repeatPurchases && input.email && input.pastOrders) {
      const email = input.email.toLowerCase();
      const before = (await input.pastOrders()).some((o) => o.ambassador?.id === hit!.id && o.userEmail.toLowerCase() === email && o.status !== "cancelled");
      if (before) return undefined;
    }
    return { id: hit.id, slug: hit.slug, name: hit.name, via, rate: currentRate(terms) };
  } catch (err) {
    console.error("[ambassadors] attribution skipped", err);
  }
  return undefined;
}
