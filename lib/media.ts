import { promises as fs } from "fs";
import path from "path";
import { getProductsForUpdate } from "./storage";
import { getEventsForUpdate } from "./events";

/**
 * Uploaded photos and videos (Products / Events → "Upload").
 *
 * Files go straight from the browser into the site's existing Vercel Blob
 * store under media/, so they never pass through a server function (which
 * caps request bodies at ~4.5 MB). The server only hands out a short-lived,
 * single-file upload token to signed-in staff — see app/api/admin/upload.
 *
 * Clean-up: when a product or event stops using an uploaded file (replaced,
 * cleared or deleted), the file is deleted — but only if it's one of OUR
 * uploads (media/ in this store) and nothing else still uses it (bundles
 * often borrow a product's photo). Pasted links to other sites are never
 * touched.
 */

export type MediaKind = "image" | "video";

export const MEDIA: Record<MediaKind, { dir: string; types: string[]; maxBytes: number; label: string }> = {
  image: {
    dir: "media/images/",
    types: ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"],
    maxBytes: 15 * 1024 * 1024,
    label: "JPEG, PNG, WebP or GIF up to 15 MB",
  },
  video: {
    dir: "media/videos/",
    types: ["video/mp4"],
    maxBytes: 250 * 1024 * 1024,
    label: "MP4 up to 250 MB",
  },
};

/** Test harness only: lets upload tokens be generated without a real Blob store. */
export function uploadToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.UPLOAD_TEST_TOKEN || undefined;
}

/** "vercel_blob_rw_<storeId>_<secret>" → "<storeid>" (the public host starts with it). */
function storeId(): string | null {
  const t = uploadToken();
  const m = t?.match(/^vercel_blob_rw_([A-Za-z0-9]+)_/);
  return m ? m[1].toLowerCase() : null;
}

/** Is this URL a file WE uploaded (media/ in this Blob store)? */
export function isOurMedia(url: string | undefined | null): boolean {
  if (!url) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || !u.hostname.endsWith(".public.blob.vercel-storage.com")) return false;
  const id = storeId();
  if (id && !u.hostname.startsWith(`${id}.`)) return false;
  return u.pathname.startsWith("/media/");
}

const LOCAL_LOG = path.join(process.cwd(), "data", "media-deleted.log");

/**
 * Delete uploaded files that nothing uses any more. Safe to call with any
 * URLs: non-uploads and files still in use are skipped. Never throws.
 */
export async function cleanupMedia(candidates: Array<string | undefined | null>): Promise<string[]> {
  const urls = Array.from(new Set(candidates.filter((u): u is string => isOurMedia(u))));
  if (urls.length === 0) return [];
  try {
    // Strict reads: if the catalog can't be read, nothing is deleted.
    const [products, events] = await Promise.all([getProductsForUpdate(), getEventsForUpdate()]);
    const used = new Set<string>();
    for (const p of products) {
      if (p.image) used.add(p.image);
      if (p.video) used.add(p.video);
    }
    for (const e of events) if (e.image) used.add(e.image);
    const unused = urls.filter((u) => !used.has(u));
    if (unused.length === 0) return [];
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const { del } = await import("@vercel/blob");
      await del(unused);
    } else {
      await fs.mkdir(path.dirname(LOCAL_LOG), { recursive: true });
      await fs.appendFile(LOCAL_LOG, unused.map((u) => `${new Date().toISOString()} ${u}\n`).join(""), "utf8");
    }
    return unused;
  } catch (err) {
    console.error("[media] clean-up skipped", err);
    return [];
  }
}
