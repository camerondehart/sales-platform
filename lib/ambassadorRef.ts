/**
 * Browser side of ambassador attribution: remembers which ambassador's page
 * this browser came through (just their page name and when). Sent with the
 * checkout, where the ambassador's own window (e.g. 30 days) decides whether
 * it still counts. Nothing personal, no cookies.
 */
const KEY = "fp_ambassador";
const KEEP_DAYS = 365; // MAX_WINDOW_DAYS in lib/ambassadors.ts

/** `code` = their discount code, filled in at checkout for their community. */
export function rememberAmbassador(slug: string, code?: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ slug, at: Date.now(), ...(code ? { code } : {}) }));
  } catch {}
}

export function ambassadorRef(): { slug: string; at: number; code?: string } | undefined {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null") as { slug?: string; at?: number; code?: string } | null;
    if (!v?.slug || !v.at || Date.now() - v.at > KEEP_DAYS * 86_400_000) return undefined;
    return { slug: String(v.slug).slice(0, 60), at: Number(v.at), ...(v.code ? { code: String(v.code).slice(0, 40) } : {}) };
  } catch {
    return undefined;
  }
}
