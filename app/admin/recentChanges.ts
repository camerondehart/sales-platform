// Recent-changes overlay for the admin dashboard.
//
// The storage layer is eventually consistent: after an action, a page refresh
// can serve data from before the write for up to ~a minute. The write is NOT
// lost — the read is just behind. To the person clicking, though, it looks
// like their change silently reverted.
//
// So every successful mutation is remembered here (localStorage), and when a
// fresh list arrives from the server we lay the remembered changes back on
// top. Each entry is dropped as soon as the server's copy reflects it, or
// after a TTL, whichever comes first. Nothing here writes anywhere — it only
// papers over the read-lag window with what the server already confirmed.

type Entry = {
  kind: "order" | "user";
  id: string;
  patch: Record<string, unknown>;
  ts: number;
};

const KEY = "fp_admin_recent_changes_v1";
// Comfortably longer than the CDN's staleness window.
const TTL_MS = 2 * 60 * 1000;

function load(): Entry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e) => e && e.id && Date.now() - e.ts < TTL_MS);
  } catch {
    return [];
  }
}

function save(entries: Entry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {}
}

/** Call after the server confirms a mutation. */
export function rememberChange(kind: Entry["kind"], id: string, patch: Record<string, unknown>) {
  const entries = load().filter((e) => !(e.kind === kind && e.id === id));
  entries.push({ kind, id, patch, ts: Date.now() });
  save(entries);
}

/** The server rejected it after all — forget the overlay so the truth shows. */
export function forgetChange(kind: Entry["kind"], id: string) {
  save(load().filter((e) => !(e.kind === kind && e.id === id)));
}

/**
 * Lay remembered changes over a freshly fetched list. Entries the server has
 * caught up with are dropped; the rest are applied so the UI shows what was
 * actually saved rather than the stale read.
 */
export function applyRecentChanges<T extends { id: string }>(kind: Entry["kind"], items: T[]): T[] {
  const entries = load().filter((e) => e.kind === kind);
  if (entries.length === 0) return items;

  const caughtUp: Entry[] = [];
  const result = items.map((item) => {
    const entry = entries.find((e) => e.id === item.id);
    if (!entry) return item;
    const matches = Object.entries(entry.patch).every(
      ([k, v]) => (item as Record<string, unknown>)[k] === v
    );
    if (matches) {
      caughtUp.push(entry);
      return item;
    }
    return { ...item, ...entry.patch };
  });

  if (caughtUp.length > 0) {
    save(load().filter((e) => !caughtUp.some((c) => c.kind === e.kind && c.id === e.id)));
  }
  return result;
}
