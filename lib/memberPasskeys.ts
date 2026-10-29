import path from "path";
import crypto from "crypto";
import { VersionedStore } from "./versionedStore";

/**
 * Members' Face ID / Touch ID / fingerprint sign-in (switch `member_passkeys`).
 * Same idea as staff passkeys (lib/passkeys.ts, which also has the shared
 * helpers: relying party, device names, one-time challenges), kept in their
 * own store so a member's key can never open the dashboard.
 *
 * A member adds one while signed in: the one-click prompt after signing in,
 * or Account → Face ID. The site only keeps the PUBLIC key; the device keeps
 * the private key behind Face ID / Touch ID / the device PIN.
 */

export type MemberPasskey = {
  /** Credential id (base64url), as the browser reports it. */
  id: string;
  userId: string;
  /** Public key (COSE, base64url). Not secret. */
  publicKey: string;
  counter: number;
  transports?: string[];
  /** "iPhone", "Mac"… so they can tell them apart. */
  device: string;
  /** The web address it works on. */
  rpID: string;
  createdAt: number;
  lastUsedAt?: number;
};

const store = new VersionedStore<MemberPasskey>({
  name: "member-passkeys",
  legacyKey: "member-passkeys.json",
  localFile: path.join(process.cwd(), "data", "member-passkeys.json"),
  keep: 8,
  reconcileLegacy: false,
});

export async function getMemberPasskeys(): Promise<MemberPasskey[]> {
  return (await store.read()).data;
}

export async function addMemberPasskey(p: MemberPasskey): Promise<void> {
  // At most 10 per member (oldest dropped), 5000 overall.
  await store.mutate<null>((rows) => {
    const mine = rows.filter((r) => r.userId === p.userId && r.id !== p.id);
    const drop = new Set(mine.slice(0, Math.max(0, mine.length - 9)).map((r) => r.id));
    return { data: [...rows.filter((r) => r.id !== p.id && !drop.has(r.id)), p].slice(-5000), result: null };
  });
}

/** Removes one of THIS member's passkeys (never someone else's). */
export async function removeMemberPasskey(id: string, userId: string): Promise<MemberPasskey | null> {
  return store.mutate<MemberPasskey | null>((rows) => {
    const hit = rows.find((r) => r.id === id && r.userId === userId) || null;
    if (!hit) return { data: null, result: null };
    return { data: rows.filter((r) => r !== hit), result: hit };
  }, { allowShrink: true });
}

/** After a sign-in: the signature counter and when it was last used. */
export async function touchMemberPasskey(id: string, counter: number): Promise<void> {
  await store.mutate<null>((rows) => {
    const i = rows.findIndex((r) => r.id === id);
    if (i === -1) return { data: null, result: null };
    const out = rows.slice();
    out[i] = { ...rows[i], counter: Math.max(rows[i].counter, counter), lastUsedAt: Date.now() };
    return { data: out, result: null };
  });
}

/** Safe to show the member (no key material). */
export const memberPublicView = (p: MemberPasskey) => ({ id: p.id, device: p.device, rpID: p.rpID, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt });

/** A stable, non-identifying WebAuthn user id for a member. */
export const memberUserIdFor = (userId: string) => new Uint8Array(crypto.createHash("sha256").update(`fp-member:${userId}`).digest().subarray(0, 16));
