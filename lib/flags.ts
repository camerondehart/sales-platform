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
