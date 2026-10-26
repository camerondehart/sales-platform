// Site-wide configurable rules: the "bundle & save" cart discount and
// loyalty settings. Stored as settings.json in Blob (data/ locally).

import { promises as fs } from "fs";
import path from "path";

export type SiteSettings = {
  // Buy N or more items, get X% off the cart
  bundleRuleEnabled: boolean;
  bundleRuleMinItems: number;   // e.g. 3
  bundleRulePercent: number;    // e.g. 10
  // Loyalty
  loyaltyEnabled: boolean;
  pointsPerDollar: number;      // points earned per $1 spent
  pointsPerDollarRedeemed: number; // points needed for $1 of credit
  minPointsToRedeem: number;
  /** Box and packing added to every parcel's weight, in ounces (shipping labels). */
  packagingOz?: number;
  updatedAt: number;
};

export const DEFAULT_SETTINGS: SiteSettings = {
  bundleRuleEnabled: false,
  bundleRuleMinItems: 3,
  bundleRulePercent: 10,
  loyaltyEnabled: false,
  pointsPerDollar: 1,
  pointsPerDollarRedeemed: 100,
  minPointsToRedeem: 100,
  updatedAt: 0,
};

const DATA_FILE = path.join(process.cwd(), "data", "settings.json");
const BLOB_KEY = "settings.json";
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

export async function getSettings(): Promise<SiteSettings> {
  if (useBlob) {
    try {
      const { list } = await import("@vercel/blob");
      const { blobs } = await list({ prefix: BLOB_KEY });
      const match = blobs.find((b) => b.pathname === BLOB_KEY);
      if (!match) return DEFAULT_SETTINGS;
      const url = `${match.url}${match.url.includes("?") ? "&" : "?"}nocache=${Date.now()}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return DEFAULT_SETTINGS;
      return { ...DEFAULT_SETTINGS, ...((await res.json()) as SiteSettings) };
    } catch (err) {
      console.error("Settings read failed:", err);
      return DEFAULT_SETTINGS;
    }
  }
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(await fs.readFile(DATA_FILE, "utf8")) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** For partial updates: the saved settings, or an error if they can't be read. */
export async function getSettingsForUpdate(): Promise<SiteSettings> {
  if (!useBlob) return getSettings();
  const { list } = await import("@vercel/blob");
  const { blobs } = await list({ prefix: BLOB_KEY });
  const match = blobs.find((b) => b.pathname === BLOB_KEY);
  if (!match) return DEFAULT_SETTINGS;
  const url = `${match.url}${match.url.includes("?") ? "&" : "?"}nocache=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Couldn't read settings (HTTP ${res.status}).`);
  return { ...DEFAULT_SETTINGS, ...((await res.json()) as SiteSettings) };
}

export async function saveSettings(settings: SiteSettings): Promise<SiteSettings> {
  const next = { ...settings, updatedAt: Date.now() };
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

// "Buy N, save X%" applied to the cart subtotal (after per-item pricing).
export function bundleRuleDiscount(
  settings: SiteSettings,
  totalItemCount: number,
  subtotal: number
): number {
  if (!settings.bundleRuleEnabled) return 0;
  if (totalItemCount < settings.bundleRuleMinItems) return 0;
  return Math.round(subtotal * (settings.bundleRulePercent / 100) * 100) / 100;
}
