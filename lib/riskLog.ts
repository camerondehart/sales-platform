/**
 * The small log behind Members → Suspicious activity (lib/suspicion.ts).
 *
 * One row per membership request and per checkout: the internet address,
 * browser and country it came from. Kept apart from the member and order
 * records on purpose, so none of it reaches the member's own pages, exports
 * or the Concierge. Rows are deleted after KEEP_DAYS.
 *
 * Recording never blocks or fails a sign-up or an order: every error is
 * swallowed, and nothing is written while the suspicious_activity switch is off.
 */

import path from "path";
import { VersionedStore } from "./versionedStore";
import { isEnabled } from "./flags";
import { clientIp } from "./assistant/limits";
import type { RiskEvent } from "./suspicion";

export const KEEP_DAYS = 180;
const MAX_ROWS = 6000;

const store = new VersionedStore<RiskEvent>({
  name: "risk-log",
  legacyKey: "risk-log.json",
  localFile: path.join(process.cwd(), "data", "risk-log.json"),
  keep: 6,
  reconcileLegacy: false,
});

export async function readRiskLog(): Promise<RiskEvent[]> {
  return (await store.read()).data;
}

export async function recordRisk(req: Request, kind: RiskEvent["kind"], ref: string, email: string): Promise<void> {
  try {
    if (!(await isEnabled("suspicious_activity"))) return;
    const h = req.headers;
    const ip = clientIp(req);
    const at = Date.now();
    const row: RiskEvent = {
      id: `rk_${at.toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      kind,
      ref: String(ref).slice(0, 80),
      email: String(email).trim().toLowerCase().slice(0, 200),
      ip: ip && ip !== "unknown" ? ip.slice(0, 60) : undefined,
      ua: (h.get("user-agent") || "").slice(0, 160) || undefined,
      // Added by Vercel on every request; absent locally.
      country: (h.get("x-vercel-ip-country") || "").slice(0, 2).toUpperCase() || undefined,
      region: (h.get("x-vercel-ip-country-region") || "").slice(0, 6).toUpperCase() || undefined,
      at,
    };
    const cutoff = at - KEEP_DAYS * 86400000;
    await store.mutate(
      (rows) => ({ data: [...rows.filter((r) => r.at >= cutoff), row].slice(-MAX_ROWS), result: undefined }),
      { allowShrink: true }
    );
  } catch (err) {
    console.error("[risk-log] could not record", kind, err);
  }
}

// ---- cases staff have looked at ("Looks fine")

export type Reviewed = { id: string; at: number; by: string; summary?: string };

const reviewedStore = new VersionedStore<Reviewed>({
  name: "risk-reviewed",
  legacyKey: "risk-reviewed.json",
  localFile: path.join(process.cwd(), "data", "risk-reviewed.json"),
  keep: 6,
  reconcileLegacy: false,
});

export async function readReviewed(): Promise<Reviewed[]> {
  return (await reviewedStore.read()).data;
}

export async function setReviewed(id: string, reviewed: boolean, by: string, summary?: string): Promise<void> {
  await reviewedStore.mutate(
    (rows) => {
      const rest = rows.filter((r) => r.id !== id);
      if (reviewed) rest.push({ id, at: Date.now(), by, summary: summary?.slice(0, 200) });
      return { data: rest.slice(-1000), result: undefined };
    },
    { allowShrink: true }
  );
}
