import { EMAIL_ART } from "./emailArtData";
import type { ThemeKey } from "./campaignThemes";

/**
 * Where inboxes load a theme's artwork from. Emails need absolute https
 * image addresses that work for everyone, so the artwork is copied once into
 * the site's public Blob store (the same store product photos use) and served
 * from there. That also works for test emails sent from stage, whose own
 * address may be private. Without a Blob store (local runs, tests) the
 * site's own /email-art/ files are used.
 */

const VERSION = "v1";
const cache: Record<string, string> = {};
let listed: Promise<Record<string, string>> | null = null;

async function blobUrls(): Promise<Record<string, string>> {
  const blob = await import("@vercel/blob");
  const { blobs } = await blob.list({ prefix: `email-art/${VERSION}/`, limit: 200 });
  const out: Record<string, string> = {};
  for (const b of blobs) out[b.pathname.slice(`email-art/${VERSION}/`.length)] = b.url;
  return out;
}

async function urlFor(file: string, siteUrl: string): Promise<string> {
  if (!process.env.BLOB_READ_WRITE_TOKEN || !EMAIL_ART[file]) return `${siteUrl}/email-art/${file}`;
  if (cache[file]) return cache[file];
  try {
    listed ||= blobUrls();
    const have = await listed;
    if (have[file]) return (cache[file] = have[file]);
    const blob = await import("@vercel/blob");
    const put = await blob.put(`email-art/${VERSION}/${file}`, Buffer.from(EMAIL_ART[file], "base64"), {
      access: "public",
      addRandomSuffix: false,
      contentType: file.endsWith(".png") ? "image/png" : "image/jpeg",
      cacheControlMaxAge: 31536000,
    });
    return (cache[file] = put.url);
  } catch (err) {
    // Another server may have just uploaded it: look again before falling back.
    listed = null;
    try {
      listed = blobUrls();
      const have = await listed;
      if (have[file]) return (cache[file] = have[file]);
    } catch {}
    console.error("[email-art] couldn't use Blob, falling back to the site's own copy", err);
    listed = null;
    return `${siteUrl}/email-art/${file}`;
  }
}

export async function themeArt(key: ThemeKey, siteUrl: string): Promise<{ header: string; divider: string }> {
  const [header, divider] = await Promise.all([urlFor(`${key}-header.jpg`, siteUrl), urlFor(`${key}-divider.png`, siteUrl)]);
  return { header, divider };
}
