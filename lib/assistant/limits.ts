/**
 * In-memory rate limits for the assistant.
 *
 * Per server instance, like the site's login limiter: good enough to stop a
 * script hammering a paid endpoint from one address, and costs nothing — no
 * storage reads or writes. The monthly spend ceiling is the second line of
 * defence, and the gateway's prepaid credit is the third.
 */

import { singleton } from "./singleton";

type Window = { count: number; start: number };
const L = singleton("limits", () => ({ windows: new Map<string, Window>(), lastSweep: Date.now() }));
const windows = L.windows;

function sweep() {
  const now = Date.now();
  if (now - L.lastSweep < 60_000) return;
  L.lastSweep = now;
  windows.forEach((w, k) => {
    if (now - w.start > 24 * 3600_000) windows.delete(k);
  });
}

/** Count a hit. Returns true when the key is over its limit for the window. */
export function overLimit(key: string, max: number, windowMs: number): boolean {
  sweep();
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now - w.start > windowMs) {
    windows.set(key, { count: 1, start: now });
    return false;
  }
  w.count += 1;
  return w.count > max;
}

export function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

/** Messages per audience: [per 5 minutes, per day]. */
export const MESSAGE_LIMITS = {
  public: [15, 80],
  member: [30, 200],
  admin: [120, 2000],
} as const;
