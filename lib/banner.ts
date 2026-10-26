// Site-wide announcement banner with an optional live countdown.
// Stored as banner.json in Vercel Blob (or data/banner.json locally),
// following the same dual-backend pattern as the other lib modules.

import { promises as fs } from "fs";
import path from "path";

export type Banner = {
  enabled: boolean;
  message: string;        // basic HTML allowed (admin-authored)
  linkUrl?: string;       // optional call-to-action link
  linkLabel?: string;
  background: string;     // CSS colour
  textColor: string;      // CSS colour
  countdownTo?: number;   // epoch ms; when set, a live countdown renders
  countdownLabel?: string;
  updatedAt: number;
};

export const DEFAULT_BANNER: Banner = {
  enabled: false,
  message: "",
  background: "#85ba45",
  textColor: "#ffffff",
  updatedAt: 0,
};

const DATA_FILE = path.join(process.cwd(), "data", "banner.json");
const BLOB_KEY = "banner.json";
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

async function blobGet(): Promise<Banner | null> {
  try {
    const { list } = await import("@vercel/blob");
    const { blobs } = await list({ prefix: BLOB_KEY });
    const match = blobs.find((b) => b.pathname === BLOB_KEY);
    if (!match) return null;
    const url = `${match.url}${match.url.includes("?") ? "&" : "?"}nocache=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as Banner;
  } catch (err) {
    console.error("Banner read failed:", err);
    return null;
  }
}

export async function getBanner(): Promise<Banner> {
  if (useBlob) {
    const b = await blobGet();
    return b ? { ...DEFAULT_BANNER, ...b } : DEFAULT_BANNER;
  }
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    return { ...DEFAULT_BANNER, ...(JSON.parse(raw) as Banner) };
  } catch {
    return DEFAULT_BANNER;
  }
}

/** For partial updates: the saved banner, or an error if it can't be read. */
export async function getBannerForUpdate(): Promise<Banner> {
  if (!useBlob) return getBanner();
  const { list } = await import("@vercel/blob");
  const { blobs } = await list({ prefix: BLOB_KEY });
  const match = blobs.find((b) => b.pathname === BLOB_KEY);
  if (!match) return DEFAULT_BANNER;
  const url = `${match.url}${match.url.includes("?") ? "&" : "?"}nocache=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Couldn't read the banner (HTTP ${res.status}).`);
  return { ...DEFAULT_BANNER, ...((await res.json()) as Banner) };
}

export async function saveBanner(banner: Banner): Promise<Banner> {
  const next: Banner = { ...banner, updatedAt: Date.now() };
  if (useBlob) {
    const { put } = await import("@vercel/blob");
    await put(BLOB_KEY, JSON.stringify(next, null, 2), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true, // required by @vercel/blob 2.x to update a blob in place
      cacheControlMaxAge: 60,
    });
    return next;
  }
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
}
