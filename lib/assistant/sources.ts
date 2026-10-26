import path from "path";
import { VersionedStore } from "../versionedStore";
import { singleton } from "./singleton";
import { brand } from "@/lib/brand";

/**
 * Web pages the Concierge learns from (Assistant tab → "Learn from web pages").
 *
 * Each page's readable text is fetched on demand ("Refresh") and stored, so
 * chats never wait on another website. This sits alongside — never replaces —
 * the owner's tone and notes in the assistant settings.
 */

export type Source = {
  id: string; // the URL
  url: string;
  title: string;
  text: string;
  fetchedAt: number;
  ok: boolean;
  error?: string;
};

const PER_PAGE = 8000; // characters kept per page
const TOTAL_IN_PROMPT = 24000;
const MAX_SOURCES = 40;

const store = new VersionedStore<Source>({
  name: "assistant-sources",
  legacyKey: "assistant-sources.json",
  localFile: path.join(process.cwd(), "data", "assistant-sources.json"),
  keep: 8,
  reconcileLegacy: false,
});

const C = singleton("sourcesCache", () => ({ at: 0, rows: null as Source[] | null }));

export async function listSources(fresh = false): Promise<Source[]> {
  if (!fresh && C.rows && Date.now() - C.at < 60_000) return C.rows;
  try {
    const rows = (await store.read()).data;
    Object.assign(C, { at: Date.now(), rows });
    return rows;
  } catch (err) {
    console.error("[sources] read failed", err);
    return C.rows ?? [];
  }
}

/** Only public http(s) addresses — never the server's own network. */
export function checkUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(String(raw).trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const h = u.hostname.toLowerCase();
  // Test harness only: lets the local mock server stand in for a real website.
  if (process.env.SOURCES_TEST_ALLOW_HOST && u.host === process.env.SOURCES_TEST_ALLOW_HOST) return u;
  if (
    h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h === "0.0.0.0" || h.startsWith("[") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(h) || !h.includes(".")
  ) {
    return null;
  }
  u.hash = "";
  return u;
}

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

/** Readable text from an HTML page (drops scripts, menus, footers). */
export function htmlToText(html: string): { title: string; text: string } {
  const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim()).slice(0, 120);
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] || html.match(/<article[\s\S]*?<\/article>/i)?.[0] || html;
  const text = decode(
    main
      .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)[^>]*>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*/g, "\n")
    .trim();
  return { title, text: text.slice(0, PER_PAGE) };
}

async function fetchPage(u: URL): Promise<{ ok: true; title: string; text: string; body: string } | { ok: false; error: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const r = await fetch(u.toString(), {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": `${brand.shortName.replace(/\W+/g, "")}Concierge/1.0 (+${brand.siteUrl})`, Accept: "text/html,application/xml;q=0.9,*/*;q=0.5" },
      cache: "no-store",
    });
    if (!r.ok) return { ok: false, error: `The page answered HTTP ${r.status}.` };
    const body = (await r.text()).slice(0, 1_500_000);
    const { title, text } = htmlToText(body);
    return { ok: true, title: title || u.hostname, text, body };
  } catch (err) {
    return { ok: false, error: err instanceof Error && err.name === "AbortError" ? "The page took too long to load." : "Couldn't reach that page." };
  } finally {
    clearTimeout(t);
  }
}

/** Add a page — or, for a sitemap.xml, up to 20 of its pages. Returns how many were added/updated. */
export async function addSource(raw: string): Promise<{ added: number; failed: number; error?: string }> {
  const u = checkUrl(raw);
  if (!u) return { added: 0, failed: 1, error: "Use a full public web address, like https://www.example.com/pages/faq" };
  let urls = [u];
  if (/sitemap[^/]*\.xml$/i.test(u.pathname)) {
    const sm = await fetchPage(u);
    if (!sm.ok) return { added: 0, failed: 1, error: sm.error };
    urls = Array.from(sm.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi))
      .map((m) => checkUrl(decode(m[1])))
      .filter((x): x is URL => !!x && !/\.xml$/i.test(x.pathname))
      .slice(0, 20);
    if (urls.length === 0) return { added: 0, failed: 1, error: "That sitemap doesn't list any pages." };
  }
  const results = await Promise.all(urls.map(async (x) => ({ url: x.toString(), r: await fetchPage(x) })));
  const now = Date.now();
  await store.mutate((rows) => {
    const next = rows.slice();
    for (const { url, r } of results) {
      const rec: Source = r.ok
        ? { id: url, url, title: r.title, text: r.text, fetchedAt: now, ok: true }
        : { id: url, url, title: next.find((x) => x.id === url)?.title || url, text: next.find((x) => x.id === url)?.text || "", fetchedAt: now, ok: false, error: r.error };
      const i = next.findIndex((x) => x.id === url);
      if (i >= 0) next[i] = rec;
      else next.push(rec);
    }
    return { data: next.slice(-MAX_SOURCES), result: undefined };
  }, { allowShrink: true });
  C.at = 0;
  const failed = results.filter((x) => !x.r.ok).length;
  return { added: results.length - failed, failed, error: failed && results.length === 1 ? (results[0].r as { error: string }).error : undefined };
}

export async function refreshAll(): Promise<{ refreshed: number; failed: number }> {
  const rows = await listSources(true);
  let refreshed = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += 5) {
    const batch = await Promise.all(rows.slice(i, i + 5).map((s) => addSource(s.url)));
    for (const b of batch) {
      refreshed += b.added;
      failed += b.failed;
    }
  }
  return { refreshed, failed };
}

export async function removeSource(id: string): Promise<boolean> {
  const removed = await store.mutate((rows) => {
    const next = rows.filter((r) => r.id !== id);
    return next.length === rows.length ? { data: null, result: false } : { data: next, result: true };
  }, { allowShrink: true });
  C.at = 0;
  return removed;
}

/** The imported pages as a prompt section (bounded), or "" if none. */
export async function sourcesForPrompt(): Promise<string> {
  const rows = (await listSources()).filter((s) => s.text);
  if (rows.length === 0) return "";
  let budget = TOTAL_IN_PROMPT;
  const parts: string[] = [];
  for (const s of rows) {
    if (budget <= 200) break;
    const chunk = s.text.slice(0, Math.min(s.text.length, budget));
    parts.push(`### ${s.title} (${s.url})\n${chunk}`);
    budget -= chunk.length;
  }
  return parts.join("\n\n");
}
