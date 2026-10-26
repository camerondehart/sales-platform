import { promises as fs } from "fs";
import path from "path";
import type { Promo } from "./pricing";
import { VersionedStore } from "./versionedStore";
import { isEnabled, isEnabledStrict } from "./flags";
import { singleton } from "./assistant/singleton";

// Promotion types:
//  - "percent": X% off the regular price (auto-computed)
//  - "bogo":    buy one, get one X% off (every 2nd item discounted)
export type { Promo };

export type ProductVisibility = "internal" | "external" | "both";

export type Product = {
  id: string;
  name: string;
  description: string;
  price: string;
  salePrice?: string; // fixed sale price, e.g. "$50" — takes precedence over promo "percent"
  promo?: Promo;
  image: string;
  /** Optional video link (YouTube, Vimeo or an https .mp4/.webm) — same pattern as `image`. */
  video?: string;
  /** Shipping weight of one unit, packed, in ounces (for shipping labels). */
  weightOz?: number;
  category?: string;
  // Where the product is sold:
  //  "internal" — members-only gallery (default)
  //  "external" — public retail shop only
  //  "both"     — appears in both
  visibility?: ProductVisibility;
  // Legacy flag, kept so old data keeps working. `visibility` wins when set.
  retail?: boolean;
  // Admin-defined fixed bundle: sells as a single product made of others
  isBundle?: boolean;
  bundleProducts?: string[]; // product IDs included in the bundle
  bundleDiscount?: number;   // optional % off the combined component price
  createdAt: number;
};

// Resolve a product's visibility, honouring the legacy `retail` flag
// for products saved before this setting existed.
export function productVisibility(
  p: Pick<Product, "visibility" | "retail">
): ProductVisibility {
  if (p.visibility) return p.visibility;
  return p.retail ? "both" : "internal";
}

// Shown in the members-only gallery?
export function isInternal(p: Pick<Product, "visibility" | "retail">): boolean {
  const v = productVisibility(p);
  return v === "internal" || v === "both";
}

// Shown in the public retail shop?
export function isExternal(p: Pick<Product, "visibility" | "retail">): boolean {
  const v = productVisibility(p);
  return v === "external" || v === "both";
}

// Pricing lives in lib/pricing.ts so client components can use the exact
// same maths without pulling `fs` into the browser bundle. Re-exported here
// because the server routes already import them from this module.
export {
  formatMoney,
  effectivePrice,
  lineDiscount,
  onSale,
  discountPercent,
  promoLabel,
} from "./pricing";

const DATA_FILE = path.join(process.cwd(), "data", "products.json");
const OVERRIDES_FILE = path.join(process.cwd(), "data", "overrides.json");

const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
const BLOB_KEY = "products.json";
const OVERRIDES_BLOB_KEY = "overrides.json";

// ---------------------------------------------------------------------------
// Safe (versioned) storage — behind the shared "versioned_catalog" switch.
//
// Off (default): products.json is read and overwritten in place, as before.
// On: every save writes a new numbered copy (products/v000000123.json) via
// VersionedStore — exact reads, and two saves at once can't undo each other.
// Each versioned save is also copied to products.json, so switching off (or
// rolling the live site back to older code) still sees the latest catalog.
// ---------------------------------------------------------------------------

const productStore = singleton(
  "productStore",
  () =>
    new VersionedStore<Product>({
      name: "products",
      legacyKey: BLOB_KEY,
      localFile: DATA_FILE,
      keep: 30,
      reconcileLegacy: false, // products.json is our own mirror, not a second source
      guard: (before, after) =>
        before.length > 0 && after.length === 0
          ? `Refusing to write empty products list – existing list has ${before.length} product(s). If this is intentional, delete products one at a time instead.`
          : null,
    })
);

/** Reads: never throws (a failed switch read means the last known value or off). */
const versionedReads = () => isEnabled("versioned_catalog");
/** Writes: must know for sure, or the save could land where nobody reads it. */
const versionedWrites = () => isEnabledStrict("versioned_catalog");

async function mirrorProducts(products: Product[]): Promise<void> {
  if (!useBlob) return; // locally the store already writes data/products.json
  try {
    await blobPut(BLOB_KEY, products);
  } catch (err) {
    console.error("products: copy to products.json failed (the versioned copy is saved)", err);
  }
}

/**
 * Read → change → save the catalog in one safe step. `fn` returns the new
 * list (or null to save nothing) and a result. Throws if the catalog can't
 * be read, so a failed read is never saved over the real catalog.
 */
export async function mutateProducts<R>(
  fn: (products: Product[]) => { data: Product[] | null; result: R } | Promise<{ data: Product[] | null; result: R }>
): Promise<R> {
  if (await versionedWrites()) {
    let saved: Product[] | null = null;
    const result = await productStore.mutate(async (list) => {
      const out = await fn(list);
      saved = out.data;
      return out;
    });
    if (saved) await mirrorProducts(saved);
    return result;
  }
  const out = await fn(await getProductsForUpdate());
  if (out.data) await saveProducts(out.data);
  return out.result;
}

/** Switching the shared switch ON: start the versions from the current products.json. */
export async function startVersionedProducts(): Promise<number> {
  return productStore.importLegacy();
}
/** Switching it OFF: make sure products.json has the latest versioned catalog. */
export async function stopVersionedProducts(): Promise<void> {
  if (!useBlob) return;
  const snap = await productStore.read();
  if (snap.version > 0) await blobPut(BLOB_KEY, snap.data);
}

async function blobGet<T>(key: string, fallback: T): Promise<T> {
  try {
    const { list } = await import("@vercel/blob");
    const { blobs } = await list({ prefix: key });
    const match = blobs.find((b) => b.pathname === key);
    if (!match) return fallback;
    const res = await fetch(match.url, { cache: "no-store" });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

async function blobPut(key: string, value: unknown): Promise<void> {
  const { put } = await import("@vercel/blob");
  await put(key, JSON.stringify(value, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true, // required by @vercel/blob 2.x to update a blob in place
    // Keep the edge copy short-lived so the window where a read can return
    // pre-write data stays small. Every other store already does this.
    cacheControlMaxAge: 60,
  });
}

async function fsRead<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function fsWrite(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

export async function getProducts(): Promise<Product[]> {
  if (await versionedReads()) {
    try {
      return (await productStore.read()).data;
    } catch (err) {
      console.error("products: versioned read failed", err);
      return []; // display only; saves use a strict read
    }
  }
  if (useBlob) {
    // Distinguish "file genuinely doesn't exist" from "read failed":
    // we may only seed in the first case. Seeding after a transient
    // read failure would overwrite the real catalog with examples.
    let fileExists = false;
    try {
      const { list } = await import("@vercel/blob");
      const { blobs } = await list({ prefix: BLOB_KEY });
      const match = blobs.find((b) => b.pathname === BLOB_KEY);
      if (match) {
        fileExists = true;
        const url = `${match.url}${match.url.includes("?") ? "&" : "?"}nocache=${Date.now()}`;
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok) return (await res.json()) as Product[];
        console.error(`Blob read for ${BLOB_KEY} failed: HTTP ${res.status}`);
      }
    } catch (err) {
      console.error(`Blob list/read for ${BLOB_KEY} failed:`, err);
      // Unknown state — never seed on failure.
      return [];
    }

    if (fileExists) return []; // file exists but couldn't be read — do NOT seed

    // True first deploy: no products.json in the store yet.
    const seed = await fsRead<Product[]>(DATA_FILE, []);
    if (seed.length > 0) {
      await blobPut(BLOB_KEY, seed);
      return seed;
    }
    return [];
  }
  return fsRead<Product[]>(DATA_FILE, []);
}

/**
 * For adding a product: the current catalog, or an error if it can't be read.
 * getProducts() returns [] on a failed read (fine for display); adding to
 * that [] and saving would replace the whole catalog with one product.
 */
export async function getProductsForUpdate(): Promise<Product[]> {
  if (!useBlob) return fsRead<Product[]>(DATA_FILE, []);
  if (await versionedWrites()) return (await productStore.read()).data;
  const { list } = await import("@vercel/blob");
  const { blobs } = await list({ prefix: BLOB_KEY });
  const match = blobs.find((b) => b.pathname === BLOB_KEY);
  if (!match) return getProducts(); // first deploy: seeds as before
  const url = `${match.url}${match.url.includes("?") ? "&" : "?"}nocache=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Couldn't read the product catalog (HTTP ${res.status}). Please try again.`);
  return (await res.json()) as Product[];
}

export async function saveProducts(products: Product[]): Promise<void> {
  if (await versionedWrites()) {
    // Whole-list save (prefer mutateProducts): still exact, via a new version.
    await productStore.mutate(() => ({ data: products, result: undefined }));
    await mirrorProducts(products);
    return;
  }
  // Safety guard: refuse to overwrite a non-empty list with an empty one
  if (products.length === 0) {
    try {
      const existing = await getProducts();
      if (existing.length > 0) {
        throw new Error(
          `Refusing to write empty products list – existing list has ${existing.length} product(s). ` +
          `If this is intentional, delete products one at a time instead.`
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Refusing to write")) throw err;
      console.error("Safety guard could not read existing products:", err);
      throw new Error("Could not verify safety of empty-list write; aborting to prevent data loss.");
    }
  }

  // Rolling backup: preserve the previous catalog as products.prev.json
  // before every overwrite, so one bad write is always recoverable.
  if (useBlob) {
    try {
      const existing = await blobGet<Product[]>(BLOB_KEY, []);
      if (existing.length > 0) await blobPut("products.prev.json", existing);
    } catch (err) {
      console.error("Could not write products backup:", err);
    }
    return blobPut(BLOB_KEY, products);
  }
  return fsWrite(DATA_FILE, products);
}

export async function reorderProduct(id: string, direction: "up" | "down"): Promise<void> {
  if (await versionedWrites()) {
    return mutateProducts((products) => {
      const idx = products.findIndex((p) => p.id === id);
      const swapWith = direction === "up" ? idx - 1 : idx + 1;
      if (idx === -1 || swapWith < 0 || swapWith >= products.length) return { data: null, result: undefined };
      [products[idx], products[swapWith]] = [products[swapWith], products[idx]];
      return { data: products, result: undefined };
    });
  }
  const products = await getProducts();
  const idx = products.findIndex((p) => p.id === id);
  if (idx === -1) return;
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= products.length) return;
  const tmp = products[idx];
  products[idx] = products[swapWith];
  products[swapWith] = tmp;
  await saveProducts(products);
}

export async function updateProduct(
  id: string,
  changes: Partial<Omit<Product, "id" | "createdAt">>
): Promise<Product | null> {
  const updated = await updateProducts([id], () => changes);
  return updated[0] || null;
}

/**
 * Apply changes to any number of products in a SINGLE read-modify-write.
 *
 * The whole catalog lives in one file, so every update rewrites the entire
 * array. Doing that once per product means each write is based on a snapshot
 * taken before the previous one landed, and earlier changes get overwritten —
 * which is exactly how changing eight products could leave only four changed.
 * Batching them into one write removes the race for the whole batch.
 */
export async function updateProducts(
  ids: string[],
  changesFor: (p: Product) => Partial<Omit<Product, "id" | "createdAt">>
): Promise<Product[]> {
  if (ids.length === 0) return [];
  if (await versionedWrites()) {
    const wanted = new Set(ids);
    return mutateProducts((products) => {
      const updated: Product[] = [];
      const next = products.map((p) => {
        if (!wanted.has(p.id)) return p;
        const u: Product = { ...p, ...changesFor(p), id: p.id, createdAt: p.createdAt };
        updated.push(u);
        return u;
      });
      return { data: updated.length ? next : null, result: updated };
    });
  }
  // Read as late as possible so the snapshot is the freshest available.
  const products = await getProducts();
  const wanted = new Set(ids);
  const updated: Product[] = [];

  for (let i = 0; i < products.length; i++) {
    if (!wanted.has(products[i].id)) continue;
    const next: Product = {
      ...products[i],
      ...changesFor(products[i]),
      id: products[i].id,
      createdAt: products[i].createdAt,
    };
    products[i] = next;
    updated.push(next);
  }

  if (updated.length === 0) return [];
  await saveProducts(products);
  return updated;
}

type Overrides = {
  adminPassword?: string;
};

export async function getOverrides(): Promise<Overrides> {
  if (useBlob) return blobGet<Overrides>(OVERRIDES_BLOB_KEY, {});
  return fsRead<Overrides>(OVERRIDES_FILE, {});
}

export async function saveOverrides(o: Overrides): Promise<void> {
  if (useBlob) return blobPut(OVERRIDES_BLOB_KEY, o);
  return fsWrite(OVERRIDES_FILE, o);
}

export async function getAdminPassword(): Promise<string> {
  const o = await getOverrides();
  return o.adminPassword || process.env.ADMIN_PASSWORD || "changemetoo";
}
