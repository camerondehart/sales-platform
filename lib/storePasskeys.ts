import path from "path";
import crypto from "crypto";
import { VersionedStore } from "./versionedStore";

/**
 * Store portal Face ID / Touch ID sign-in. Same as members' passkeys
 * (lib/memberPasskeys.ts; shared helpers in lib/passkeys.ts), in a store of
 * their own so a store's key can only ever open the store portal. Only the
 * PUBLIC key is kept here.
 */

export type StorePasskey = {
  id: string;
  /** The store login (lib/retail.ts RetailLogin.id) it signs in as. */
  loginId: string;
  publicKey: string;
  counter: number;
  transports?: string[];
  device: string;
  rpID: string;
  createdAt: number;
  lastUsedAt?: number;
};

const store = new VersionedStore<StorePasskey>({
  name: "store-passkeys",
  legacyKey: "store-passkeys.json",
  localFile: path.join(process.cwd(), "data", "store-passkeys.json"),
  keep: 8,
  reconcileLegacy: false,
});

export async function getStorePasskeys(): Promise<StorePasskey[]> {
  return (await store.read()).data;
}

export async function addStorePasskey(p: StorePasskey): Promise<void> {
  // At most 10 per login (oldest dropped), 2000 overall.
  await store.mutate<null>((rows) => {
    const mine = rows.filter((r) => r.loginId === p.loginId && r.id !== p.id);
    const drop = new Set(mine.slice(0, Math.max(0, mine.length - 9)).map((r) => r.id));
    return { data: [...rows.filter((r) => r.id !== p.id && !drop.has(r.id)), p].slice(-2000), result: null };
  });
}

/** Removes one of THIS login's passkeys (never someone else's). */
export async function removeStorePasskey(id: string, loginId: string): Promise<StorePasskey | null> {
  return store.mutate<StorePasskey | null>((rows) => {
    const hit = rows.find((r) => r.id === id && r.loginId === loginId) || null;
    if (!hit) return { data: null, result: null };
    return { data: rows.filter((r) => r !== hit), result: hit };
  }, { allowShrink: true });
}

export async function touchStorePasskey(id: string, counter: number): Promise<void> {
  await store.mutate<null>((rows) => {
    const i = rows.findIndex((r) => r.id === id);
    if (i === -1) return { data: null, result: null };
    const out = rows.slice();
    out[i] = { ...rows[i], counter: Math.max(rows[i].counter, counter), lastUsedAt: Date.now() };
    return { data: out, result: null };
  });
}

export const storePasskeyView = (p: StorePasskey) => ({ id: p.id, device: p.device, rpID: p.rpID, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt });

/** A stable, non-identifying WebAuthn user id for a store login. */
export const storeUserIdFor = (loginId: string) => new Uint8Array(crypto.createHash("sha256").update(`fp-store:${loginId}`).digest().subarray(0, 16));
