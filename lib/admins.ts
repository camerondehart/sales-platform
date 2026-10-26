import path from "path";
import { VersionedStore } from "./versionedStore";
import { brand } from "@/lib/brand";

/**
 * Staff who can sign in to the dashboard with an emailed link
 * (Settings → Staff sign-in). The shared admin password keeps working
 * as a backup. Starts with the support inbox.
 */

export type AdminUser = { id: string; email: string; name: string; addedAt: number };

export const DEFAULT_ADMINS: AdminUser[] = [
  { id: brand.supportEmail, email: brand.supportEmail, name: "Support", addedAt: 0 },
];
const MAX_ADMINS = 20;

const store = new VersionedStore<AdminUser>({
  name: "admins",
  legacyKey: "admins.json",
  localFile: path.join(process.cwd(), "data", "admins.json"),
  keep: 8,
  reconcileLegacy: false,
});

export async function getAdmins(): Promise<AdminUser[]> {
  const rows = (await store.read()).data;
  return rows.length ? rows : DEFAULT_ADMINS;
}

export async function findAdmin(email: string): Promise<AdminUser | null> {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return null;
  return (await getAdmins()).find((a) => a.email === e) || null;
}

const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i;

export function cleanAdmins(input: unknown): { ok: true; value: AdminUser[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: "Send a list of staff." };
  const seen = new Set<string>();
  const out: AdminUser[] = [];
  for (const raw of input as Array<Partial<AdminUser>>) {
    const email = String(raw?.email || "").trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 200) return { ok: false, error: `"${String(raw?.email || "").slice(0, 60)}" isn't an email address.` };
    if (seen.has(email)) continue;
    seen.add(email);
    out.push({ id: email, email, name: String(raw?.name || "").trim().slice(0, 60) || email.split("@")[0], addedAt: Number(raw?.addedAt) || Date.now() });
  }
  if (out.length === 0) return { ok: false, error: "Keep at least one person on the list." };
  if (out.length > MAX_ADMINS) return { ok: false, error: `Up to ${MAX_ADMINS} people.` };
  return { ok: true, value: out };
}

export async function saveAdmins(list: AdminUser[]): Promise<{ before: AdminUser[]; after: AdminUser[] }> {
  return store.mutate((rows) => {
    const before = rows.length ? rows : DEFAULT_ADMINS;
    return { data: list, result: { before, after: list } };
  }, { allowShrink: true });
}
