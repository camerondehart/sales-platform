import path from "path";
import crypto from "crypto";
import { VersionedStore } from "./versionedStore";
import { brand } from "./brand";

/**
 * Face ID / Touch ID sign-in for staff (passkeys, WebAuthn). An extra option:
 * the shared password and the emailed link keep working.
 *
 * A staff member adds a passkey on a device while signed in (Settings → Staff
 * sign-in → Add Face ID for this device). The device keeps a private key that
 * only Face ID / Touch ID / the device PIN unlocks; the site only stores the
 * matching PUBLIC key, so nothing here could be used to sign in elsewhere.
 * Signing in answers a one-time challenge with that key.
 *
 * A passkey belongs to one web address (the "relying party"): the live domain
 * (www or not) for the live site, the stage address for stage. Each needs its
 * own passkey. Passkeys of people taken off the staff list stop working.
 */

export type Passkey = {
  /** Credential id (base64url), as the browser reports it. */
  id: string;
  /** The staff member it signs in as. */
  email: string;
  /** Public key (COSE, base64url). Not secret. */
  publicKey: string;
  counter: number;
  transports?: string[];
  /** "iPhone", "Mac"… so staff can tell them apart. */
  device: string;
  /** The web address it works on. */
  rpID: string;
  createdAt: number;
  lastUsedAt?: number;
};

const store = new VersionedStore<Passkey>({
  name: "passkeys",
  legacyKey: "passkeys.json",
  localFile: path.join(process.cwd(), "data", "passkeys.json"),
  keep: 8,
  reconcileLegacy: false,
});

export async function getPasskeys(): Promise<Passkey[]> {
  return (await store.read()).data;
}

export async function addPasskey(p: Passkey): Promise<void> {
  await store.mutate<null>((rows) => ({ data: [...rows.filter((r) => r.id !== p.id), p].slice(-200), result: null }));
}

export async function removePasskey(id: string): Promise<Passkey | null> {
  return store.mutate<Passkey | null>((rows) => {
    const hit = rows.find((r) => r.id === id) || null;
    if (!hit) return { data: null, result: null };
    return { data: rows.filter((r) => r.id !== id), result: hit };
  }, { allowShrink: true });
}

/** After a sign-in: the signature counter and when it was last used. */
export async function touchPasskey(id: string, counter: number): Promise<void> {
  await store.mutate<null>((rows) => {
    const i = rows.findIndex((r) => r.id === id);
    if (i === -1) return { data: null, result: null };
    const out = rows.slice();
    out[i] = { ...rows[i], counter: Math.max(rows[i].counter, counter), lastUsedAt: Date.now() };
    return { data: out, result: null };
  });
}

/** Remove the passkeys of anyone no longer on the staff list. */
export async function prunePasskeys(staffEmails: string[]): Promise<Passkey[]> {
  const keep = new Set(staffEmails.map((e) => e.toLowerCase()));
  return store.mutate<Passkey[]>((rows) => {
    const gone = rows.filter((r) => !keep.has(r.email));
    if (!gone.length) return { data: null, result: [] };
    return { data: rows.filter((r) => keep.has(r.email)), result: gone };
  }, { allowShrink: true });
}

/** Safe to show staff (no key material). */
export const publicView = (p: Passkey) => ({ id: p.id, email: p.email, device: p.device, rpID: p.rpID, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt });

// ------------------------------------------------------------------ the web address

/**
 * The relying party for this request: the live domain from brand.siteUrl (so a
 * passkey works with and without www), otherwise the request's own host (stage,
 * localhost). The browser itself refuses to use a passkey on any other site.
 */
export function relyingParty(req: Request): { rpID: string; origins: string[] } {
  const u = new URL(req.url);
  const host = u.hostname.toLowerCase();
  const live = (() => {
    try {
      return new URL(brand.siteUrl).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return "";
    }
  })();
  if (live && (host === live || host.endsWith(`.${live}`))) {
    return { rpID: live, origins: [`https://${live}`, `https://www.${live}`] };
  }
  return { rpID: host, origins: [u.origin] };
}

/** "iPhone", "iPad", "Mac", "Android phone", "Windows PC"… from the browser's user agent. */
export function deviceName(ua: string): string {
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
  if (/Android/i.test(ua)) return "Android device";
  if (/Windows/i.test(ua)) return "Windows PC";
  if (/CrOS/i.test(ua)) return "Chromebook";
  if (/Linux/i.test(ua)) return "Linux computer";
  return "This device";
}

// ------------------------------------------------------------------ one-time challenges

/**
 * The challenge for one sign-in / one "add Face ID", kept in a short-lived,
 * signed, httpOnly cookie (works across serverless instances; nothing stored).
 */
export const CHALLENGE_COOKIE = "fp_passkey";
const CHALLENGE_MS = 5 * 60 * 1000;

const secret = () => process.env.AUTH_SECRET || "dev-secret-please-change-in-production-12345";
const sign = (data: string) => crypto.createHmac("sha256", `passkey:${secret()}`).update(data).digest("base64url");

export type Challenge = { c: string; k: "reg" | "auth"; email?: string; e: number };

export function packChallenge(ch: Omit<Challenge, "e">): string {
  const body = Buffer.from(JSON.stringify({ ...ch, e: Date.now() + CHALLENGE_MS })).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function unpackChallenge(raw: string | undefined, kind: Challenge["k"]): Challenge | null {
  if (!raw) return null;
  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;
  const want = Buffer.from(sign(body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  try {
    const ch = JSON.parse(Buffer.from(body, "base64url").toString()) as Challenge;
    if (ch.k !== kind || typeof ch.c !== "string" || !(ch.e > Date.now())) return null;
    return ch;
  } catch {
    return null;
  }
}

/** A stable, non-identifying WebAuthn user id for a staff email. */
export const userIdFor = (email: string) => new Uint8Array(crypto.createHash("sha256").update(`fp-staff:${email.toLowerCase()}`).digest().subarray(0, 16));
