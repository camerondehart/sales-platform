import path from "path";
import { VersionedStore } from "./versionedStore";
import { singleton } from "./assistant/singleton";

/**
 * Feature flags — switch features on and off without a redeploy.
 *
 * Stored per environment (`VERCEL_ENV`: production / preview / development,
 * set by Vercel automatically) because stage and production share one Blob
 * store: flipping a switch on stage must never flip it in production.
 *
 * Reads are cached for 15 seconds per server instance, so a change takes
 * effect everywhere within about 15 seconds (instantly on the instance that
 * saved it). A flag that has never been set uses its default below.
 */

export type Env = "production" | "preview" | "development";

export const FLAG_KEYS = [
  "ai_assistant",
  "ai_admin_actions",
  "email_code_login",
  "admin_magic_link",
  "campaigns",
  "bundles_specific_products",
  "invoice_reminders",
  "product_videos",
  "analytics_v2",
  "versioned_catalog",
  "concierge_learning",
  "ai_product_copy",
  "store_locator",
  "stock_counts",
  "venmo_matching",
  "voice_concierge",
  "concierge_photos",
  "ambassador_pages",
  "admin_passkeys",
  "rotating_staff_password",
  "cash_pickup",
  "member_passkeys",
  "faq_page",
] as const;
export type FlagKey = (typeof FLAG_KEYS)[number];

export type FlagDef = {
  label: string;
  description: string;
  /** Default when the flag has never been set in this environment. */
  defaults: Record<Env, boolean>;
  /** False while the feature is waiting on a decision (switch has no effect yet). */
  built: boolean;
  /**
   * One switch for stage AND the live site (stored once, not per environment).
   * Only for things that change how the shared data itself is stored.
   */
  shared?: boolean;
};

const on = { production: true, preview: true, development: true };
const off = { production: false, preview: false, development: false };

export const FLAGS: Record<FlagKey, FlagDef> = {
  ai_assistant: {
    label: "AI assistant (master switch)",
    description: "Turns the Concierge off everywhere at once — visitors, members and staff. The per-audience switches in the Assistant tab still apply when this is on.",
    defaults: on,
    built: true,
  },
  ai_admin_actions: {
    label: "Assistant can prepare changes",
    description: "Lets the staff Concierge prepare confirm cards (sales, emails, order status…). Off = it can still look things up and answer questions.",
    defaults: on,
    built: true,
  },
  campaigns: {
    label: "Email template library",
    description: "Seasonal and saved templates in the Marketing tab. Sending campaigns works either way.",
    defaults: on,
    built: true,
  },
  product_videos: {
    label: "Product videos",
    description: "Shows a product's video (YouTube, Vimeo or a video link) in its pop-up. Off hides videos without deleting the links.",
    defaults: on,
    built: true,
  },
  email_code_login: {
    label: "Sign in with an email code",
    description: "Members can choose \"Email me a code instead\" on the sign-in form: a 6-digit code, good once for 10 minutes. Passwords keep working.",
    defaults: off,
    built: true,
  },
  admin_magic_link: {
    label: "Admin sign-in link by email",
    description: "Staff on the list in Settings → Staff sign-in can get a one-time sign-in link (15 minutes). The shared admin password keeps working as a backup.",
    defaults: off,
    built: true,
  },
  bundles_specific_products: {
    label: "Mix-and-match bundle discounts",
    description: "Prices carts with the bundles in Marketing → Mix & match bundles (e.g. 4 capsules, 20% off the set). Off = bundles are kept but not applied.",
    defaults: off,
    built: true,
  },
  invoice_reminders: {
    label: "Automatic payment reminders",
    description: "Emails unpaid invoices at 24 h, 48 h, 1 week and 2 weeks, then moves them to Expired (still pending, one click to revive). Only orders placed after this is switched on. Timing and wording: Settings → Payment reminders.",
    defaults: off,
    built: true,
  },
  ai_product_copy: {
    label: "Concierge tidies product descriptions",
    description: "Adds a “Tidy with Concierge” button to the product form that rewrites the description in the house format (lede, short paragraphs, ingredient bullets, How to use). Staff read it and press Save; nothing changes until then. Needs the AI master switch; a cent or two per rewrite, counted toward the monthly limit.",
    defaults: on,
    built: true,
  },
  store_locator: {
    label: "Store locator (Find us in stores)",
    description: "The public /stores page with the map, its footer link, “Find it in a store near you” in product pop-ups, and the Concierge answering where to buy in person. Stores are added in Settings → Store locations (works with this off, so you can set them up first).",
    defaults: { production: false, preview: true, development: true },
    built: true,
  },
  stock_counts: {
    label: "Stock counts (Currently restocking)",
    description: "Each order takes its items off the counts in Products → Stock counts. At 0 a product shows “Currently restocking” and can still be ordered; those order lines are marked so you know they wait for new stock. Cancelling an order puts its items back. Products left blank aren't counted. Enter the counts first (that works with this off).",
    defaults: { production: false, preview: true, development: true },
    built: true,
  },
  venmo_matching: {
    label: "Venmo payment matching",
    description: "Orders → Venmo payments: Venmo's “paid you” emails (forwarded from Gmail) are checked, read and matched to unpaid orders. Staff confirm every match; nothing is marked paid on its own. Also adds a Today item and the Concierge's confirm cards. Emails are collected even with this off.",
    defaults: { production: false, preview: true, development: true },
    built: true,
  },
  voice_concierge: {
    label: "Concierge voice (talk + read aloud)",
    description: "A mic button in the Concierge chat (tap to talk, see the words before sending) and a play button on answers, plus “Read answers aloud”. Speech goes through the AI Gateway (Assistant → Voice picks the voice). Off hides it everywhere.",
    defaults: { production: false, preview: true, development: true },
    built: true,
  },
  concierge_photos: {
    label: "Concierge photos",
    description: "A camera button in the Concierge chat: take a photo or pick one, and the Concierge looks at it (a product, a label, a shelf, a receipt…). Photos are shrunk on the phone first and never saved in transcripts. Needs a model that reads images (the default Claude Haiku does).",
    defaults: { production: false, preview: true, development: true },
    built: true,
  },
  analytics_v2: {
    label: "Visitor analytics",
    description: "Cookie-free visit counting for the Analytics tab. Off = stop counting (sales, members and assistant figures still show).",
    defaults: on,
    built: true,
  },
  concierge_learning: {
    label: "Concierge learns from chats",
    description: "Every night the Concierge reviews the last week of chats, card decisions and Today ticks, and rewrites its own notes (Assistant tab → Concierge notes). Notes are used straight away by the staff and customer Concierge and the Today list; you can edit, pin or delete any of them. Uses a few cents of AI a night, counted toward the monthly limit.",
    defaults: off,
    built: true,
  },
  ambassador_pages: {
    label: "Ambassador pages",
    description: "Each ambassador's own page at yoursite/<their name> (Ambassadors tab), shared only by link or QR code: their photo, a few words, links to their socials and the products they feature, with Add to cart. Orders are credited to them when the shopper came through their page (within their attribution window, remembered in the shopper's own browser, nothing personal) or a member used their linked discount code; commission, payouts and progress reports in the Ambassadors tab. Prices never change. Off = pages are a 404 and no orders are credited; ambassadors can still be set up and previewed.",
    defaults: { production: false, preview: true, development: true },
    built: true,
  },
  admin_passkeys: {
    label: "Staff sign-in with Face ID / Touch ID / fingerprint",
    description: "Staff can add Face ID / Touch ID (a passkey) for each of their devices in Settings → Staff sign-in, then sign in with one tap on the admin sign-in page. An extra option: the shared password and the emailed link keep working. Off = the Face ID button is hidden and passkeys can't be used (they stay saved).",
    defaults: on,
    built: true,
  },
  rotating_staff_password: {
    label: "Daily staff password",
    description: "The staff password becomes a new two-word phrase each day (e.g. maple-otter-42), changing at midnight local time. It's in the nightly report email and always shown in Settings → Steward password. Yesterday's still works until noon. The old fixed password keeps working for 7 days after this first runs, then stops. Face ID and the emailed link keep working. Off = back to the fixed password.",
    defaults: on,
    built: true,
  },
  faq_page: {
    label: "FAQ page",
    description: "The Smart FAQ page at /faq: questions and answers you write and publish in Settings → FAQ page. The Concierge answers from the published ones (it may repeat dosing guidance from them word-for-word, never beyond it). The page stays hidden until at least one answer is published. Off = /faq is hidden and the Concierge stops using it (answers stay saved).",
    defaults: on,
    built: true,
  },
  member_passkeys: {
    label: "Member sign-in with Face ID / Touch ID / fingerprint",
    description: "Members can sign in with one tap (a passkey on their phone or computer). Right after a member signs in another way, a one-click popup offers to set it up on that device; \"Not now\" isn't asked again on that device. They can add or remove devices under Account → Face ID. Passwords and email codes keep working. Off = the button and popup are hidden and passkeys can't be used (they stay saved).",
    defaults: on,
    built: true,
  },
  cash_pickup: {
    label: "Cash pickup deals & public-shop pickup",
    description: "Products → a sale can be ticked \"Cash pickup only\": it applies only to Local pickup orders paid in cash (members' and public shop), and everyone else pays the regular price. Also adds Local pickup (pay by invoice or cash at pickup) to the public shop checkout. Off = the public shop is ship-only again and the tick is hidden; products already ticked keep their cash-only sale for members' cash pickup orders.",
    defaults: { production: false, preview: true, development: true },
    built: true,
  },
  versioned_catalog: {
    label: "Safe storage for products & discount codes",
    description: "Saves products and discount codes the same race-proof way as members (a new numbered copy on every save), so two edits at once can't undo each other. SHARED by stage and the live site — switch on only once the live site runs this version; to roll the live site back, switch this off first.",
    defaults: off,
    built: true,
    shared: true,
  },
};

export function currentEnv(): Env {
  const v = process.env.VERCEL_ENV;
  return v === "production" || v === "preview" ? v : "development";
}

type Row = { id: FlagKey; on: boolean; updatedAt: number };

const stores = singleton("flagStores", () => new Map<Env, VersionedStore<Row>>());
function store(env: Env): VersionedStore<Row> {
  let s = stores.get(env);
  if (!s) {
    s = new VersionedStore<Row>({
      name: `flags-${env}`,
      legacyKey: `flags-${env}.json`,
      localFile: path.join(process.cwd(), "data", `flags-${env}.json`),
      keep: 20,
      reconcileLegacy: false,
    });
    stores.set(env, s);
  }
  return s;
}

// Shared switches (FlagDef.shared) live in one store for every environment.
const sharedStore = singleton(
  "flagSharedStore",
  () =>
    new VersionedStore<Row>({
      name: "flags-shared",
      legacyKey: "flags-shared.json",
      localFile: path.join(process.cwd(), "data", "flags-shared.json"),
      keep: 20,
      reconcileLegacy: false,
    })
);
const storeFor = (key: FlagKey, env: Env) => (FLAGS[key].shared ? sharedStore : store(env));

const cache = singleton("flagCache", () => ({ at: 0, env: "" as string, values: null as Record<FlagKey, boolean> | null }));
const TTL = 15_000;

function resolve(rows: Row[], env: Env, sharedRows: Row[] = []): Record<FlagKey, boolean> {
  const out = {} as Record<FlagKey, boolean>;
  for (const k of FLAG_KEYS) {
    const row = (FLAGS[k].shared ? sharedRows : rows).find((r) => r.id === k);
    // Unbuilt features stay off whatever is stored, so a stray toggle can't
    // switch on something that doesn't exist yet.
    out[k] = FLAGS[k].built ? (row ? !!row.on : FLAGS[k].defaults[env]) : false;
  }
  return out;
}

/** All flags for this environment. Never throws: on a read error, defaults are used. */
export async function getFlags(opts: { fresh?: boolean } = {}): Promise<Record<FlagKey, boolean>> {
  const env = currentEnv();
  if (!opts.fresh && cache.values && cache.env === env && Date.now() - cache.at < TTL) return cache.values;
  try {
    const [rows, sharedRows] = await Promise.all([store(env).read().then((s) => s.data), sharedStore.read().then((s) => s.data)]);
    const values = resolve(rows, env, sharedRows);
    Object.assign(cache, { at: Date.now(), env, values });
    return values;
  } catch (err) {
    console.error("[flags] read failed; using last known values or defaults", err);
    return cache.values ?? resolve([], env);
  }
}

/**
 * Like isEnabled, but throws if the switches can't be read and nothing recent
 * is cached. For decisions where guessing "off" could put data in the wrong place.
 */
export async function isEnabledStrict(key: FlagKey): Promise<boolean> {
  const env = currentEnv();
  if (cache.values && cache.env === env && Date.now() - cache.at < TTL) return cache.values[key];
  const [rows, sharedRows] = await Promise.all([store(env).read().then((s) => s.data), sharedStore.read().then((s) => s.data)]);
  const values = resolve(rows, env, sharedRows);
  Object.assign(cache, { at: Date.now(), env, values });
  return values[key];
}

export async function isEnabled(key: FlagKey): Promise<boolean> {
  return (await getFlags())[key];
}

/** Set one flag in the current environment. Returns before/after for the audit log. */
export async function setFlag(key: FlagKey, value: boolean): Promise<{ before: boolean; after: boolean }> {
  if (!FLAG_KEYS.includes(key)) throw new Error(`Unknown flag ${key}`);
  if (!FLAGS[key].built) throw new Error("That feature isn't built yet — see the decisions list.");
  const env = currentEnv();
  const before = (await getFlags({ fresh: true }))[key];
  await storeFor(key, env).mutate((rows) => {
    const next = rows.filter((r) => r.id !== key);
    next.push({ id: key, on: value, updatedAt: Date.now() });
    return { data: next, result: undefined };
  }, { allowShrink: false });
  cache.at = 0;
  await getFlags({ fresh: true });
  return { before, after: value };
}

/** Hide product video links from shoppers when the product_videos switch is off. */
export async function applyVideoFlag<T extends { video?: string }>(products: T[]): Promise<T[]> {
  if (await isEnabled("product_videos")) return products;
  return products.map((p) => {
    if (!p.video) return p;
    const { video: _hidden, ...rest } = p;
    return rest as T;
  });
}

/** When a switch was last turned ON in this environment (null if it's off or never set). */
export async function flagOnSince(key: FlagKey): Promise<number | null> {
  try {
    const rows = (await storeFor(key, currentEnv()).read()).data;
    const row = rows.find((r) => r.id === key);
    return row && row.on ? row.updatedAt : null;
  } catch {
    return null;
  }
}
