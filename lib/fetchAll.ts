/**
 * Download many small JSON files without losing any.
 *
 * The nightly report once showed $0 for the last 30 days because about half
 * the order files failed to download in one big burst and were skipped
 * without an error, so the figures were worked out from the older half only.
 * This loader takes a few files at a time, tries each one again if it fails,
 * and refuses to return a partial list.
 *
 * No server-only imports, so the unit check can run it (tests/unit/fetch-all.cjs).
 */

export type FetchLike = (url: string, init?: { cache: "no-store" }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type FetchAllOptions = {
  /** Files downloading at the same moment. */
  concurrency?: number;
  /** Tries per file before giving up. */
  attempts?: number;
  /** Pause before try 2, doubled-ish for each later try (ms). */
  backoffMs?: number;
  /** Turn a file's url into the one to request (cache busting). */
  url?: (url: string) => string;
  fetchImpl?: FetchLike;
  /** What the files are, for the error message ("order"). */
  what?: string;
};

/**
 * Returns one entry per file, in the same order: the parsed JSON, or null for
 * a file that no longer exists (404) or whose contents aren't JSON.
 * Throws if any file still can't be downloaded after every try.
 */
export async function fetchAllJson<T>(files: Array<{ url: string }>, opts: FetchAllOptions = {}): Promise<Array<T | null>> {
  const concurrency = Math.max(1, opts.concurrency ?? 24);
  const attempts = Math.max(1, opts.attempts ?? 4);
  const backoffMs = opts.backoffMs ?? 300;
  const toUrl = opts.url ?? ((u: string) => u);
  const doFetch: FetchLike = opts.fetchImpl ?? ((u, init) => fetch(u, init));
  const out: Array<T | null> = new Array(files.length).fill(null);
  let failed = 0;
  let lastProblem = "";

  async function one(i: number): Promise<void> {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, backoffMs * attempt));
      let res: Awaited<ReturnType<FetchLike>>;
      try {
        res = await doFetch(toUrl(files[i].url), { cache: "no-store" });
      } catch (err) {
        lastProblem = err instanceof Error ? err.message : "network error";
        continue;
      }
      if (res.status === 404) return; // deleted since the listing
      if (!res.ok) {
        lastProblem = `HTTP ${res.status}`;
        continue;
      }
      try {
        out[i] = (await res.json()) as T;
        return;
      } catch {
        // Cut-off download: try again. A file that never parses is skipped
        // (as before) so one bad file can't take the whole list down.
        if (attempt === attempts - 1) {
          console.error(`Unreadable ${opts.what || "data"} file skipped: ${files[i].url}`);
          return;
        }
      }
    }
    failed++;
  }

  let next = 0;
  const worker = async () => {
    while (next < files.length) await one(next++);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));

  if (failed) {
    throw new Error(`Couldn't load ${failed} of ${files.length} ${opts.what || "data"} files (${lastProblem}). Nothing was changed; try again in a minute.`);
  }
  return out;
}
