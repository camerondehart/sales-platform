/**
 * A small JSON list store on Vercel Blob that is safe for many writers.
 *
 * WHY THIS EXISTS
 * The member list and the mailing list are each one JSON file that several
 * requests read, change and write back. Overwriting a blob in place has two
 * problems Vercel documents openly: the CDN can serve the OLD content for up
 * to 60 seconds after a write (and `useCache: false` is only honoured on
 * private stores), and two writers can silently erase each other's changes.
 * That combination is how a new member request could vanish after the
 * "new request" email had already gone out.
 *
 * HOW IT WORKS
 * Blobs are treated as immutable, which is Vercel's own recommendation:
 *   - every save writes a NEW file:  users/v000000124.json
 *   - a unique URL can never serve stale content, so reads are exact
 *   - the write is create-only; if another writer already created that
 *     version number, the store refuses it and we retry from a fresh read
 *   - old versions are pruned in the background, keeping a short history
 * The very first write migrates from the legacy single file (users.json).
 *
 * Locally (no Blob token) it is a plain file guarded by an in-process lock.
 */

import { promises as fs } from "fs";
import path from "path";

export type Snapshot<T> = { data: T[]; version: number };

export class Conflict extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type StoreOptions<T> = {
  /** Folder name in the store, e.g. "users" → users/v000000001.json */
  name: string;
  /** The old single-file key to migrate from, e.g. "users.json" */
  legacyKey: string;
  /** Local file used when no Blob token is set */
  localFile: string;
  /** How many old versions to keep around. Default 12. */
  keep?: number;
  /**
   * Refuse a write. Return a message to block, null to allow. Called with
   * what was read and what is about to be written.
   */
  guard?: (before: T[], after: T[], opts: { allowShrink: boolean }) => string | null;
  /**
   * Check the legacy single file for records written by an older deployment
   * on every read. Costs one extra Blob list() per read; only needed for
   * stores that were migrated from a legacy file. Default true.
   */
  reconcileLegacy?: boolean;
};

export class VersionedStore<T> {
  private readonly useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
  private readonly prefix: string;
  private readonly keep: number;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly o: StoreOptions<T>) {
    this.prefix = `${o.name}/v`;
    this.keep = o.keep ?? 12;
  }

  private keyFor(version: number): string {
    return `${this.prefix}${String(version).padStart(9, "0")}.json`;
  }
  private versionOf(pathname: string): number {
    const m = pathname.match(/\/v(\d{9})\.json$/);
    return m ? parseInt(m[1], 10) : 0;
  }

  // ---------------------------------------------------------------- read

  async read(): Promise<Snapshot<T>> {
    if (!this.useBlob) {
      try {
        return { data: JSON.parse(await fs.readFile(this.o.localFile, "utf8")) as T[], version: 1 };
      } catch {
        return { data: [], version: 0 };
      }
    }

    const blob = await import("@vercel/blob");
    const { blobs } = await blob.list({ prefix: this.prefix, limit: 1000 });
    const versions = blobs
      .map((b) => ({ v: this.versionOf(b.pathname), url: b.url, uploadedAt: b.uploadedAt }))
      .filter((x) => x.v > 0)
      .sort((a, b) => a.v - b.v);

    if (versions.length > 0) {
      const latest = versions[versions.length - 1];
      // Immutable URL: whatever the CDN has for it is, by construction, right.
      const res = await fetch(latest.url, { cache: "no-store" });
      if (!res.ok) throw new Error(`${this.o.name}: read v${latest.v} failed with HTTP ${res.status}`);
      let data = (await res.json()) as T[];

      // ROLLOUT SAFETY NET. While an older deployment is still writing the
      // legacy single file, records can land there after we migrated. If the
      // legacy file is newer than our latest version, fold in anything it has
      // that we don't (matched by id). Once every deployment is on this code
      // the legacy file stops changing and this is a cheap no-op.
      if (this.o.reconcileLegacy !== false) try {
        const legacy = await blob.list({ prefix: this.o.legacyKey });
        const match = legacy.blobs.find((b) => b.pathname === this.o.legacyKey);
        if (match && match.uploadedAt.getTime() > latest.uploadedAt.getTime()) {
          const url = `${match.url}${match.url.includes("?") ? "&" : "?"}nocache=${Date.now()}`;
          const lr = await fetch(url, { cache: "no-store" });
          if (lr.ok) {
            const legacyData = (await lr.json()) as T[];
            const have = new Set(data.map((x) => (x as { id?: string }).id));
            const missing = legacyData.filter((x) => !have.has((x as { id?: string }).id));
            if (missing.length > 0) {
              console.warn(`${this.o.name}: folding in ${missing.length} record(s) written to the legacy file by an older deployment`);
              data = [...data, ...missing];
            }
          }
        }
      } catch (err) {
        console.error(`${this.o.name}: legacy reconciliation skipped`, err);
      }
      return { data, version: latest.v };
    }

    // Not migrated yet: read the legacy single file, busting the cache as
    // best we can. This happens exactly once per store.
    const legacy = await blob.list({ prefix: this.o.legacyKey });
    const match = legacy.blobs.find((b) => b.pathname === this.o.legacyKey);
    if (!match) return { data: [], version: 0 };
    const url = `${match.url}${match.url.includes("?") ? "&" : "?"}nocache=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`${this.o.name}: legacy read failed with HTTP ${res.status}`);
    return { data: (await res.json()) as T[], version: 0 };
  }

  // --------------------------------------------------------------- write

  private async write(data: T[], basedOn: number): Promise<number> {
    if (!this.useBlob) {
      await fs.mkdir(path.dirname(this.o.localFile), { recursive: true });
      await fs.writeFile(this.o.localFile, JSON.stringify(data, null, 2), "utf8");
      return basedOn + 1;
    }
    const blob = await import("@vercel/blob");
    const next = basedOn + 1;
    try {
      await blob.put(this.keyFor(next), JSON.stringify(data, null, 2), {
        access: "public",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: false, // create-only: the store arbitrates the race
        cacheControlMaxAge: 31536000, // immutable — cache it forever
      });
    } catch (err) {
      if (err instanceof Error && /already exists|allowOverwrite/i.test(err.message)) {
        throw new Conflict(`${this.o.name}: v${next} was created by another writer`);
      }
      throw err;
    }
    this.prune(next).catch((err) => console.error(`${this.o.name}: prune failed`, err));
    return next;
  }

  /** Delete versions older than the last `keep`. Best effort, off the hot path. */
  private async prune(latest: number): Promise<void> {
    if (!this.useBlob) return;
    const cutoff = latest - this.keep;
    if (cutoff <= 0) return;
    const blob = await import("@vercel/blob");
    const { blobs } = await blob.list({ prefix: this.prefix, limit: 1000 });
    const old = blobs.filter((b) => {
      const v = this.versionOf(b.pathname);
      return v > 0 && v <= cutoff;
    });
    if (old.length > 0) await blob.del(old.map((b) => b.url));
  }

  // ------------------------------------------------------------ switching

  /**
   * Start a new version from the legacy single file. Used when a store that
   * was being written the old way is switched (back) to versions, so edits
   * made to the legacy file in the meantime are carried over, not lost.
   * Returns the number of records imported (0 locally or with no legacy file).
   */
  async importLegacy(): Promise<number> {
    if (!this.useBlob) return 0;
    const blob = await import("@vercel/blob");
    const legacy = await blob.list({ prefix: this.o.legacyKey });
    const match = legacy.blobs.find((b) => b.pathname === this.o.legacyKey);
    if (!match) return 0;
    const url = `${match.url}${match.url.includes("?") ? "&" : "?"}nocache=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`${this.o.name}: legacy read failed with HTTP ${res.status}`);
    const data = (await res.json()) as T[];
    if (!Array.isArray(data)) throw new Error(`${this.o.name}: legacy file isn't a list`);
    return this.mutate(() => ({ data, result: data.length }), { allowShrink: true });
  }

  // -------------------------------------------------------------- mutate

  private withLock<R>(task: () => Promise<R>): Promise<R> {
    const run = this.chain.then(task, task);
    this.chain = run.catch(() => undefined);
    return run;
  }

  /**
   * Read fresh → apply `fn` → write as a new version → retry on conflict.
   * `fn` returns `data: null` to write nothing (its result is still returned).
   */
  async mutate<R>(
    fn: (data: T[]) => { data: T[] | null; result: R } | Promise<{ data: T[] | null; result: R }>,
    opts?: { allowShrink?: boolean }
  ): Promise<R> {
    const MAX = 8;
    return this.withLock(async () => {
      for (let attempt = 1; attempt <= MAX; attempt++) {
        const snap = await this.read();
        // Shallow-copy each record so fn can't alter the snapshot in place.
        const out = await fn(snap.data.map((x) => (x && typeof x === "object" ? { ...x } : x)));
        if (out.data === null) return out.result;

        const blocked = this.o.guard?.(snap.data, out.data, { allowShrink: !!opts?.allowShrink });
        if (blocked) throw new Error(blocked);

        try {
          await this.write(out.data, snap.version);
          return out.result;
        } catch (err) {
          if (err instanceof Conflict) {
            console.warn(`${this.o.name}: another write landed first, retrying (${attempt}/${MAX})`);
            await sleep(100 * attempt + Math.random() * 150);
            continue;
          }
          throw err;
        }
      }
      throw new Error(`Could not save ${this.o.name} after several attempts — please try again.`);
    });
  }
}
