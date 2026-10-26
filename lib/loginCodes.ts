import crypto from "crypto";
import path from "path";
import { VersionedStore } from "./versionedStore";

/**
 * One-time sign-in secrets:
 *   - member email codes: 6 digits, 10 minutes, single use, 5 tries
 *   - admin sign-in links: long random token, 15 minutes, single use
 *   - staff codes: a 6-digit code typed on the member sign-in by someone on
 *     the staff list — signs in to the dashboard, so tighter limits
 *     (3 tries per code, at most 6 codes a day per address)
 *
 * Only an HMAC of each secret is stored (keyed with AUTH_SECRET), so even
 * someone who read the stored file couldn't work out a code or a link.
 * Using a code is a race-safe write: two tabs can't both use the same one.
 */

export type Purpose = "member" | "admin" | "staff";

type Row = {
  id: string;
  purpose: Purpose;
  email: string;
  hash: string;
  createdAt: number;
  expiresAt: number;
  usedAt?: number;
  attempts: number;
  ip?: string;
};

export const CODE_TTL_MS = 10 * 60_000;
export const LINK_TTL_MS = 15 * 60_000;
const MAX_TRIES = 5;
/** Per address: at most 3 codes per 15 minutes (admin links: 10 — the token can't be guessed, so this only stops inbox flooding). */
const PER_EMAIL = 3;
const ADMIN_LINKS_PER_EMAIL = 10;
/** Per IP: at most 10 requests per 15 minutes. */
const PER_IP = 10;
const WINDOW = 15 * 60_000;
/** Staff codes: fewer guesses, and a daily cap, since they open the dashboard. */
const STAFF_TRIES = 3;
const STAFF_PER_DAY = 6;
const isCode = (p: Purpose) => p === "member" || p === "staff";

const store = new VersionedStore<Row>({
  name: "login-codes",
  legacyKey: "login-codes.json",
  localFile: path.join(process.cwd(), "data", "login-codes.json"),
  keep: 4,
  reconcileLegacy: false,
});

function key(): string {
  const s = process.env.AUTH_SECRET;
  if (!s && process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET missing");
  return s || "dev-secret-please-change-in-production-12345";
}
const hmac = (purpose: Purpose, email: string, secret: string) =>
  crypto.createHmac("sha256", key()).update(`${purpose}|${email}|${secret}`).digest("hex");
const same = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const norm = (e: string) => String(e || "").trim().toLowerCase();

export type IssueResult = { ok: true; secret: string } | { ok: false; reason: "throttled" };

/**
 * Create a new code (member) or link token (admin) for this address.
 * Any earlier unused one for the same address stops working.
 */
export async function issue(purpose: Purpose, emailRaw: string, ip = "unknown"): Promise<IssueResult> {
  const email = norm(emailRaw);
  const secret = isCode(purpose) ? String(crypto.randomInt(0, 1_000_000)).padStart(6, "0") : crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  return store.mutate<IssueResult>((rows) => {
    const recent = rows.filter((r) => r.createdAt > now - WINDOW);
    if (recent.filter((r) => r.email === email && r.purpose === purpose).length >= (purpose === "admin" ? ADMIN_LINKS_PER_EMAIL : PER_EMAIL)) return { data: null, result: { ok: false as const, reason: "throttled" as const } };
    if (purpose === "staff" && rows.filter((r) => r.email === email && r.purpose === "staff" && r.createdAt > now - 86_400_000).length >= STAFF_PER_DAY)
      return { data: null, result: { ok: false as const, reason: "throttled" as const } };
    if (ip !== "unknown" && recent.filter((r) => r.ip === ip).length >= PER_IP) return { data: null, result: { ok: false as const, reason: "throttled" as const } };
    // Keep the file small: drop anything older than a day.
    const kept = rows
      .filter((r) => r.createdAt > now - 86_400_000)
      .map((r) => (r.email === email && r.purpose === purpose && !r.usedAt ? { ...r, usedAt: now } : r)); // older ones stop working
    const row: Row = {
      id: crypto.randomBytes(9).toString("base64url"),
      purpose,
      email,
      hash: hmac(purpose, email, secret),
      createdAt: now,
      expiresAt: now + (isCode(purpose) ? CODE_TTL_MS : LINK_TTL_MS),
      attempts: 0,
      ip,
    };
    return { data: [...kept, row], result: { ok: true as const, secret } };
  }, { allowShrink: true });
}

/** Check a member's 6-digit code. Returns the email on success. */
export async function useMemberCode(emailRaw: string, codeRaw: string): Promise<string | null> {
  return useCode("member", emailRaw, codeRaw);
}

/** Check a staff member's 6-digit code (typed on the member sign-in). Returns the email on success. */
export async function useStaffCode(emailRaw: string, codeRaw: string): Promise<string | null> {
  return useCode("staff", emailRaw, codeRaw);
}

async function useCode(purpose: "member" | "staff", emailRaw: string, codeRaw: string): Promise<string | null> {
  const email = norm(emailRaw);
  const code = String(codeRaw || "").replace(/\D/g, "");
  if (!email || code.length !== 6) return null;
  const now = Date.now();
  return store.mutate((rows) => {
    const i = rows.findIndex((r) => r.purpose === purpose && r.email === email && !r.usedAt && r.expiresAt > now);
    if (i < 0) return { data: null, result: null };
    const next = rows.slice();
    const r = rows[i];
    if (same(r.hash, hmac(purpose, email, code))) {
      next[i] = { ...r, usedAt: now };
      return { data: next, result: email };
    }
    const attempts = r.attempts + 1;
    // Too many wrong guesses: the code is spent.
    next[i] = { ...r, attempts, ...(attempts >= (purpose === "staff" ? STAFF_TRIES : MAX_TRIES) ? { usedAt: now } : {}) };
    return { data: next, result: null };
  });
}

/** Use an admin sign-in link. Returns the admin's email on success. */
export async function useAdminLink(tokenRaw: string): Promise<string | null> {
  const token = String(tokenRaw || "").trim();
  if (token.length < 30 || token.length > 100) return null;
  const now = Date.now();
  return store.mutate((rows) => {
    const i = rows.findIndex((r) => r.purpose === "admin" && !r.usedAt && r.expiresAt > now && same(r.hash, hmac("admin", r.email, token)));
    if (i < 0) return { data: null, result: null };
    const next = rows.slice();
    next[i] = { ...rows[i], usedAt: now };
    return { data: next, result: rows[i].email };
  });
}
