import { getAdmins, type AdminUser } from "./admins";

// Checked on every dashboard request for link sign-ins, so cache the staff
// list for a minute (removing someone takes effect within 60 seconds).
const g = globalThis as unknown as { __fpAdmins?: { at: number; rows: AdminUser[] } };

export async function findAdminCached(email: string): Promise<AdminUser | null> {
  const e = email.toLowerCase();
  if (!g.__fpAdmins || Date.now() - g.__fpAdmins.at > 60_000) {
    g.__fpAdmins = { at: Date.now(), rows: await getAdmins() };
  }
  return g.__fpAdmins.rows.find((a) => a.email === e) || null;
}

export function forgetAdminsCache() {
  g.__fpAdmins = undefined;
}
