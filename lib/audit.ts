import { AsyncLocalStorage } from "async_hooks";
import { promises as fs } from "fs";
import path from "path";
import { adminActor } from "./auth";

/**
 * Audit log — one immutable record per admin change.
 *
 * Storage: one small file per entry in Blob (`audit/2026-09/<time>_<id>.json`),
 * the same append-only pattern the orders use. A new file can't collide with
 * or overwrite anything, so simultaneous writes never lose an entry and
 * nothing has to be read before writing.
 *
 * Coverage: every admin write route is wrapped with `audited()`, which writes
 * exactly ONE entry per request — whatever branch the handler takes — with the
 * outcome taken from the response status. Handlers can add detail (the
 * "before" value, the real target) with `auditDetail()`.
 *
 * Attribution: staff who sign in with their emailed link are recorded by
 * email; the shared admin password is recorded as "admin" (plus IP and browser). Changes confirmed from a Concierge card are
 * marked `source: "ai"` — the AI proposed it, a signed-in admin approved it.
 *
 * Secrets never land here: keys that look like passwords, hashes or tokens
 * are replaced with "[redacted]", and large payloads are trimmed.
 */

export type AuditEntry = {
  id: string;
  at: number;
  action: string;
  actor: string;
  actorType: "admin" | "system" | "member" | "visitor";
  source: "human" | "ai" | "system";
  targetType?: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
  ok: boolean;
  status?: number;
  note?: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
  /** For AI-confirmed actions: which kind of card was confirmed. */
  proposal?: string;
};

const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
const LOCAL_FILE = path.join(process.cwd(), "data", "audit.jsonl");
const PREFIX = "audit/";
const MAX_JSON = 6000;

const SECRET_KEY = /pass(word)?|hash|token|secret|apikey|api_key|authorization|cookie/i;

/** Remove secrets and trim size so the log is safe to show and cheap to store. */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 6) return "[…]";
  if (Array.isArray(value)) {
    const arr = value.slice(0, 50).map((v) => redact(v, depth + 1));
    if (value.length > 50) arr.push(`…${value.length - 50} more`);
    return arr;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 2000) return `${value.slice(0, 2000)}…`;
  return value;
}

function trim(value: unknown): unknown {
  if (value === undefined) return undefined;
  const clean = redact(value);
  const json = JSON.stringify(clean);
  if (json && json.length > MAX_JSON) return { truncated: true, preview: json.slice(0, MAX_JSON) };
  return clean;
}

const monthOf = (t: number) => new Date(t).toISOString().slice(0, 7);

export async function writeAudit(e: Omit<AuditEntry, "id" | "at"> & { at?: number }): Promise<void> {
  const at = e.at ?? Date.now();
  const id = `${at.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const entry: AuditEntry = { ...e, at, id, before: trim(e.before), after: trim(e.after) };
  try {
    if (useBlob) {
      const { put } = await import("@vercel/blob");
      // Zero-padded time first so a plain name sort is newest-last.
      await put(`${PREFIX}${monthOf(at)}/${String(at).padStart(14, "0")}_${id}.json`, JSON.stringify(entry), {
        access: "public",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: false,
        cacheControlMaxAge: 31536000,
      });
    } else {
      await fs.mkdir(path.dirname(LOCAL_FILE), { recursive: true });
      await fs.appendFile(LOCAL_FILE, JSON.stringify(entry) + "\n", "utf8");
    }
  } catch (err) {
    // Never let logging break the action itself — but make the gap visible.
    console.error("[audit] could not write entry", entry.action, err);
  }
}

// ------------------------------------------------------------- request wrapper

type Detail = Partial<Pick<AuditEntry, "action" | "targetType" | "targetId" | "before" | "after" | "note">>;
const als = new AsyncLocalStorage<Detail>();

/** Add detail to the entry for the current request (no-op outside `audited`). */
export function auditDetail(d: Detail): void {
  const cur = als.getStore();
  if (cur) Object.assign(cur, d);
}

function requestMeta(req: Request) {
  const h = req.headers;
  const ip = (h.get("x-forwarded-for") || "").split(",")[0].trim() || h.get("x-real-ip") || undefined;
  const fromAi = h.get("x-fp-source") === "assistant";
  return {
    ip,
    userAgent: (h.get("user-agent") || "").slice(0, 200) || undefined,
    requestId: h.get("x-vercel-id") || undefined,
    source: (fromAi ? "ai" : "human") as AuditEntry["source"],
    proposal: fromAi ? (h.get("x-fp-proposal") || "").slice(0, 40) || undefined : undefined,
  };
}

const idFrom = (o: unknown): string | undefined => {
  if (!o || typeof o !== "object") return undefined;
  const r = o as Record<string, any>;
  const direct = r.id ?? r.orderId ?? r.userId ?? r.registrationId ?? r.discountId ?? r.key;
  if (typeof direct === "string" && direct) return direct.slice(0, 120);
  if (Array.isArray(r.ids) && r.ids.length) return r.ids.slice(0, 10).join(",").slice(0, 120);
  for (const k of ["product", "discount", "event", "order", "escalation", "user", "registration"]) {
    const v = r[k];
    if (v && typeof v === "object" && typeof v.id === "string") return v.id;
  }
  return undefined;
};

/**
 * Wrap an admin write handler so it produces exactly one audit entry.
 * Requests rejected as unauthorised (401) are not admin writes and are skipped.
 */
export function audited<A extends unknown[]>(
  action: string,
  targetType: string,
  handler: (req: Request, ...rest: A) => Promise<Response>
): (req: Request, ...rest: A) => Promise<Response> {
  return async (req: Request, ...rest: A) => {
    const detail: Detail = {};
    let input: unknown;
    try {
      const type = req.headers.get("content-type") || "";
      if (type.includes("application/json")) input = await req.clone().json();
    } catch {
      /* not JSON — fine */
    }
    const url = new URL(req.url);
    const actor = await adminActor();
    const query = Object.fromEntries(url.searchParams.entries());
    let res: Response;
    try {
      res = await als.run(detail, () => handler(req, ...rest));
    } catch (err) {
      await writeAudit({
        ...requestMeta(req),
        action: detail.action || action,
        actor,
        actorType: "admin",
        targetType: detail.targetType || targetType,
        targetId: detail.targetId || idFrom(input) || idFrom(query),
        before: detail.before,
        after: detail.after ?? input,
        ok: false,
        status: 500,
        note: err instanceof Error ? err.message.slice(0, 300) : "Unexpected error",
      });
      throw err;
    }
    if (res.status === 401) return res;
    let out: unknown;
    try {
      if ((res.headers.get("content-type") || "").includes("application/json")) out = await res.clone().json();
    } catch {
      /* ignore */
    }
    const ok = res.status < 400 && !(out && typeof out === "object" && (out as any).ok === false);
    await writeAudit({
      ...requestMeta(req),
      action: detail.action || action,
      actor,
      actorType: "admin",
      targetType: detail.targetType || targetType,
      targetId: detail.targetId || idFrom(input) || idFrom(query) || idFrom(out),
      before: detail.before,
      after: detail.after ?? (Object.keys(query).length && !input ? query : input),
      ok,
      status: res.status,
      note: detail.note || (!ok && out && typeof (out as any).error === "string" ? String((out as any).error).slice(0, 300) : undefined),
    });
    return res;
  };
}

/** Record something that isn't an admin request (scheduled jobs, assistant safety events). */
export function auditSystem(e: Omit<AuditEntry, "id" | "at" | "actorType" | "actor" | "source"> & { actor?: string; source?: AuditEntry["source"]; actorType?: AuditEntry["actorType"] }) {
  return writeAudit({ actor: e.actor || "system", actorType: e.actorType || "system", source: e.source || "system", ...e });
}

// ------------------------------------------------------------------- reading

export type AuditQuery = {
  months?: number;
  action?: string;
  source?: string;
  targetType?: string;
  q?: string;
  failedOnly?: boolean;
  limit?: number;
};

async function readMonth(month: string, limit: number): Promise<AuditEntry[]> {
  if (!useBlob) {
    try {
      const lines = (await fs.readFile(LOCAL_FILE, "utf8")).trim().split("\n").filter(Boolean);
      return lines.map((l) => JSON.parse(l) as AuditEntry).filter((e) => monthOf(e.at) === month).reverse().slice(0, limit);
    } catch {
      return [];
    }
  }
  const { list } = await import("@vercel/blob");
  const files: { pathname: string; url: string }[] = [];
  let cursor: string | undefined;
  do {
    const page: Awaited<ReturnType<typeof list>> = await list({ prefix: `${PREFIX}${month}/`, limit: 1000, cursor });
    files.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  files.sort((a, b) => (a.pathname < b.pathname ? 1 : -1)); // newest first
  const picked = files.slice(0, limit);
  const out: AuditEntry[] = [];
  for (let i = 0; i < picked.length; i += 25) {
    const batch = await Promise.all(
      picked.slice(i, i + 25).map(async (f) => {
        try {
          const r = await fetch(f.url, { cache: "no-store" });
          return r.ok ? ((await r.json()) as AuditEntry) : null;
        } catch {
          return null;
        }
      })
    );
    out.push(...(batch.filter(Boolean) as AuditEntry[]));
  }
  return out;
}

/**
 * Entries since a time, matching some actions — cheap: file names start with
 * the time, so only files newer than `since` are fetched (at most `max`).
 */
export async function readAuditSince(since: number, actions: string[], max = 400): Promise<AuditEntry[]> {
  const want = (e: AuditEntry) => e.at >= since && actions.some((a) => e.action.startsWith(a));
  if (!useBlob) {
    try {
      const lines = (await fs.readFile(LOCAL_FILE, "utf8")).trim().split("\n").filter(Boolean);
      return lines.map((l) => JSON.parse(l) as AuditEntry).filter(want);
    } catch {
      return [];
    }
  }
  const { list } = await import("@vercel/blob");
  const months = new Set([monthOf(since), monthOf(Date.now())]);
  const files: { pathname: string; url: string }[] = [];
  for (const m of months) {
    let cursor: string | undefined;
    do {
      const page: Awaited<ReturnType<typeof list>> = await list({ prefix: `${PREFIX}${m}/`, limit: 1000, cursor });
      files.push(...page.blobs.filter((b) => Number(b.pathname.split("/").pop()?.split("_")[0]) >= since));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  }
  files.sort((a, b) => (a.pathname < b.pathname ? 1 : -1));
  const out: AuditEntry[] = [];
  const picked = files.slice(0, max);
  for (let i = 0; i < picked.length; i += 25) {
    const batch = await Promise.all(
      picked.slice(i, i + 25).map(async (f) => {
        try {
          const r = await fetch(f.url, { cache: "no-store" });
          return r.ok ? ((await r.json()) as AuditEntry) : null;
        } catch {
          return null;
        }
      })
    );
    out.push(...(batch.filter(Boolean) as AuditEntry[]));
  }
  return out.filter(want);
}

/** Newest-first entries, filtered. Reads at most `limit` entries per month scanned. */
export async function readAudit(q: AuditQuery = {}): Promise<AuditEntry[]> {
  const limit = Math.min(Math.max(q.limit || 200, 1), 500);
  const months = Math.min(Math.max(q.months || 1, 1), 6);
  const now = new Date();
  const all: AuditEntry[] = [];
  for (let m = 0; m < months; m++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 1));
    all.push(...(await readMonth(d.toISOString().slice(0, 7), limit)));
  }
  const needle = (q.q || "").toLowerCase();
  return all
    .filter((e) => !q.action || e.action.startsWith(q.action))
    .filter((e) => !q.source || e.source === q.source)
    .filter((e) => !q.targetType || e.targetType === q.targetType)
    .filter((e) => !q.failedOnly || !e.ok)
    .filter((e) => !needle || JSON.stringify(e).toLowerCase().includes(needle))
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}
