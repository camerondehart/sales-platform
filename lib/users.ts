import bcrypt from "bcryptjs";
import crypto from "crypto";
import path from "path";
import { VersionedStore } from "./versionedStore";

export type UserStatus = "pending" | "approved" | "rejected";

export type User = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  status: UserStatus;
  message?: string;
  ageVerified?: boolean; //Over 21 or not
  priorCustomer?: boolean; //Has used products before?
  // ---------- address fields ----------
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  // -----------------------------------
  // ---------- loyalty ----------
  loyaltyPoints?: number;
  pointsHistory?: Array<{ amount: number; reason: string; date: number; orderId?: string }>;
  // -----------------------------------
  createdAt: number;
  approvedAt?: number;
  /** Set once the welcome email is sent, so approving again won't re-send it. */
  welcomeEmailSentAt?: number;
  // ---------- imported customers (e.g. from a previous Shopify store) ----------
  phone?: string;
  company?: string;
  /** Two-letter country code when it isn't the US. */
  country?: string;
  importedFrom?: "shopify";
  importedAt?: number;
  /** Has never chosen a password on this site (imported). Cleared when they set or reset one. */
  needsPassword?: boolean;
  /** When a "set your password" link was last emailed, and how many times. */
  inviteSentAt?: number;
  inviteCount?: number;
  /** What the old store knew about them (read-only history). */
  shopify?: {
    customerId?: string;
    totalSpent?: number;
    totalOrders?: number;
    tags?: string[];
    /** "Beginner" | "Novice" | "Expert", as they answered. */
    experience?: string;
    wantsConsultation?: boolean;
    lastEmailOpen?: string;
  };
};


export type PublicUser = Omit<User, "passwordHash">;

const USERS_FILE = path.join(process.cwd(), "data", "users.json");
const USERS_BLOB_KEY = "users.json";

const store = new VersionedStore<User>({
  name: "users",
  legacyKey: USERS_BLOB_KEY,
  localFile: USERS_FILE,
  keep: 12,
  // Deletes are the only writes allowed to shrink the list. Anything else
  // that would shrink it can only be a bug, and a refused write is
  // recoverable where an erased member is not.
  guard: (before, after, { allowShrink }) => {
    const lastMemberDelete = allowShrink && before.length === 1;
    if (after.length === 0 && before.length > 0 && !lastMemberDelete) {
      return `Refusing to write empty users list — existing list has ${before.length} user(s).`;
    }
    if (!allowShrink && after.length < before.length) {
      return `Refusing to write: member list would shrink from ${before.length} to ${after.length} in a non-delete write.`;
    }
    return null;
  },
});

export async function getUsers(): Promise<User[]> {
  return (await store.read()).data;
}

/**
 * Apply a change to the member list safely — see lib/versionedStore.ts.
 *
 * `fn` receives a fresh copy of the list and returns the list to write plus a
 * result to hand back. Return `users: null` to write nothing (e.g. validation
 * failed) — the result is still returned. If another request wrote between
 * our read and our write, the store refuses ours and we retry from a fresh
 * read, so no change is ever applied on top of stale data.
 */
export async function mutateUsers<T>(
  fn: (users: User[]) => { users: User[] | null; result: T } | Promise<{ users: User[] | null; result: T }>,
  opts?: { allowShrink?: boolean }
): Promise<T> {
  return store.mutate<T>(async (data) => {
    const out = await fn(data);
    return { data: out.users, result: out.result };
  }, opts);
}

/**
 * Legacy whole-list save, kept for callers that already hold a modified copy.
 * Prefer mutateUsers(). This folds the caller's records over a fresh read
 * rather than replacing it, so a member the caller never saw can't be lost.
 */
export async function saveUsers(
  users: User[],
  opts?: { allowShrink?: boolean }
): Promise<void> {
  const ours = new Map(users.map((u) => [u.id, u]));
  await mutateUsers((current) => {
    if (opts?.allowShrink) return { users, result: undefined };
    const merged = current.map((u) => ours.get(u.id) ?? u);
    const currentIds = new Set(current.map((u) => u.id));
    for (const u of users) if (!currentIds.has(u.id)) merged.push(u);
    return { users: merged, result: undefined };
  }, opts);
}

// Clear the "welcome sent" stamp after a send actually failed, so the member
// isn't left marked as emailed when nothing arrived. Approving them again
// will then send it — the retry needs no special handling anywhere else.
export async function clearWelcomeSent(id: string): Promise<void> {
  try {
    await mutateUsers((users) => {
      const u = users.find((x) => x.id === id);
      if (!u) return { users: null, result: undefined };
      u.welcomeEmailSentAt = undefined;
      return { users, result: undefined };
    });
  } catch (err) {
    console.error("Could not clear welcome-sent stamp", err);
  }
}

export function toPublic(u: User): PublicUser {
  const { passwordHash, ...rest } = u;
  return rest;
}

export async function findUserByEmail(email: string): Promise<User | undefined> {
  const users = await getUsers();
  return users.find((u) => u.email.toLowerCase() === email.toLowerCase());
}

export async function createUser(args: {
  email: string;
  name: string;
  password: string;
  message?: string;
  ageVerified?: boolean;
  priorCustomer?: boolean;
}): Promise<{ ok: false; error: string } | { ok: true; user: User }> {
  const email = args.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Please enter a valid email address." };
  }
  if (!args.name.trim()) return { ok: false, error: "Please enter your name." };
  if (args.password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }

  const passwordHash = await bcrypt.hash(args.password, 10);

  // The duplicate check and the append happen against the same fresh read,
  // and the write is conditional on it — so two people signing up at the
  // same moment both land, and the same person double-submitting can't
  // create two records.
  return mutateUsers<{ ok: false; error: string } | { ok: true; user: User }>((users) => {
    const existing = users.find((u) => u.email.toLowerCase() === email);
    if (existing) {
      if (existing.status === "rejected") {
        return { users: null, result: { ok: false, error: "This email isn't currently eligible. Please reach out directly." } };
      }
      // Someone re-requesting because they haven't heard back needs reassurance,
      // not a message that sounds like something went wrong.
      if (existing.status === "pending") {
        return {
          users: null,
          result: {
            ok: false,
            error: "We already have your request and it's waiting for review. You'll get an email as soon as you're approved.",
          },
        };
      }
      return { users: null, result: { ok: false, error: "An account with this email already exists. Try signing in instead." } };
    }

    const user: User = {
      id: `u_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      email,
      name: args.name.trim(),
      passwordHash,
      status: "pending",
      message: args.message?.trim(),
      ageVerified: !!args.ageVerified,
      priorCustomer: !!args.priorCustomer,
      createdAt: Date.now(),
    };
    return { users: [...users, user], result: { ok: true, user } };
  });
}

/**
 * Admin-created member: approved immediately, no request step.
 *
 * For someone the owner already knows — a regular at the market, a friend whose
 * request went astray. The password is chosen (or generated) by the admin,
 * who can have it emailed. No welcome email is sent automatically; the
 * caller decides what to send.
 */
export async function createMemberByAdmin(args: {
  name: string;
  email: string;
  password: string;
}): Promise<{ ok: false; error: string } | { ok: true; user: User }> {
  const email = args.email.trim().toLowerCase();
  const name = args.name.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "That doesn't look like a valid email address." };
  }
  if (!name) return { ok: false, error: "Name can't be empty." };
  if (!args.password || args.password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }
  const passwordHash = await bcrypt.hash(args.password, 10);

  return mutateUsers<{ ok: false; error: string } | { ok: true; user: User }>((users) => {
    const existing = users.find((u) => u.email.toLowerCase() === email);
    if (existing) {
      const what =
        existing.status === "approved" ? "is already a member" :
        existing.status === "pending" ? "already has a request waiting — approve it instead" :
        "was previously rejected — find them under Rejected and approve instead";
      return { users: null, result: { ok: false, error: `${existing.email} ${what}.` } };
    }
    const now = Date.now();
    const user: User = {
      id: `u_${now}_${Math.random().toString(36).slice(2, 8)}`,
      email,
      name,
      passwordHash,
      status: "approved",
      ageVerified: true,
      createdAt: now,
      approvedAt: now,
      welcomeEmailSentAt: now, // the admin is telling them directly
    };
    return { users: [...users, user], result: { ok: true, user } };
  });
}

/**
 * Add many members in ONE read-modify-write.
 *
 * Creating them one at a time would rewrite the whole member file per row,
 * which is slow and risks later writes overwriting earlier ones. Emails that
 * already exist are skipped rather than overwritten, so re-importing the same
 * file is safe.
 *
 * Imported members get a long random password nobody ever sees. They use
 * "Forgot password?" on the sign-in page to have a real one emailed to them.
 */
export async function addUsersBulk(
  incoming: Array<{ name: string; email: string }>,
  status: UserStatus = "approved"
): Promise<{ added: number; alreadyThere: number; invalid: number }> {
  // Hash once up front (bcrypt is slow); nobody ever sees this password.
  const unusedHash = await bcrypt.hash(crypto.randomBytes(24).toString("hex"), 10);

  return mutateUsers((users) => {
    const seen = new Set(users.map((u) => u.email.toLowerCase()));
    let alreadyThere = 0;
    let invalid = 0;
    const toAdd: User[] = [];

    for (const row of incoming) {
      const email = (row.email || "").trim().toLowerCase();
      const name = (row.name || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { invalid++; continue; }
      if (seen.has(email)) { alreadyThere++; continue; }
      seen.add(email);
      toAdd.push({
        id: `u_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        email,
        name: name || email.split("@")[0],
        passwordHash: unusedHash,
        status,
        ageVerified: true,
        createdAt: Date.now(),
        approvedAt: status === "approved" ? Date.now() : undefined,
        // These people already know you — don't send them a "welcome" email.
        welcomeEmailSentAt: status === "approved" ? Date.now() : undefined,
      });
    }
    return {
      users: toAdd.length > 0 ? [...users, ...toAdd] : null,
      result: { added: toAdd.length, alreadyThere, invalid },
    };
  });
}

export async function verifyPassword(email: string, password: string): Promise<User | null> {
  const user = await findUserByEmail(email);
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  return ok ? user : null;
}

export async function updateUserStatus(
  id: string,
  status: UserStatus
): Promise<{ user: User; changed: boolean; shouldSendWelcome: boolean }> {
  return mutateUsers((users) => {
  if (users.length === 0) {
    throw new Error("Could not load users for status update; please try again.");
  }
  const u = users.find((x) => x.id === id);
  // Previously a silent no-op, which looked like "approval didn't work".
  // Surface it so the admin sees a real error instead of nothing happening.
  if (!u) {
    throw new Error("That member could not be found. Refresh the page and try again.");
  }

  const changed = u.status !== status;

  // Send the welcome to anyone being approved who hasn't had one yet.
  //
  // Deliberately NOT verified by re-reading after the write: Blob writes are
  // eventually consistent, so a read-back can legitimately miss what we just
  // wrote and would suppress the email entirely. Getting the email out is far
  // more important than theoretically preventing a duplicate, and the stamp
  // below already stops every sequential re-click.
  //
  // Not requiring the previous status to be "pending" is what makes a failed
  // send self-heal: the caller clears the stamp on failure, so simply
  // approving again sends it. No special button, no manual step.
  const shouldSendWelcome = status === "approved" && !u.welcomeEmailSentAt;

  u.status = status;
  if (status === "approved" && !u.approvedAt) u.approvedAt = Date.now();
  if (shouldSendWelcome) u.welcomeEmailSentAt = Date.now();

  return { users, result: { user: u, changed, shouldSendWelcome } };
  });
}

/**
 * Admin correction of a member's name and/or email — e.g. someone typed
 * their address wrong at sign-up. Email must stay unique across members.
 * Returns the previous email so the caller can keep the mailing list in step.
 */
export const ADDRESS_FIELDS = ["addressLine1", "addressLine2", "city", "state", "postalCode", "phone"] as const;
export type AddressField = (typeof ADDRESS_FIELDS)[number];

export async function updateUserProfile(
  id: string,
  changes: { name?: string; email?: string; address?: Partial<Record<AddressField, string>> }
): Promise<{ ok: true; user: User; previousEmail: string; previousAddress: Partial<Record<AddressField, string>> } | { ok: false; error: string }> {
  const name = changes.name?.trim();
  const email = changes.email?.trim().toLowerCase();
  if (name !== undefined && !name) return { ok: false, error: "Name can't be empty." };
  if (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "That doesn't look like a valid email address." };
  }

  // Address and phone: trimmed, capped; an empty box clears that line.
  const addr: Partial<Record<AddressField, string | undefined>> = {};
  for (const k of ADDRESS_FIELDS) {
    const v = changes.address?.[k];
    if (v === undefined) continue;
    addr[k] = String(v).replace(/\s+/g, " ").trim().slice(0, k === "postalCode" ? 12 : k === "state" ? 40 : 120) || undefined;
  }

  type R = { ok: true; user: User; previousEmail: string; previousAddress: Partial<Record<AddressField, string>> } | { ok: false; error: string };
  return mutateUsers<R>((users) => {
    if (users.length === 0) return { users: null, result: { ok: false, error: "Could not load members; please try again." } };
    const u = users.find((x) => x.id === id);
    if (!u) return { users: null, result: { ok: false, error: "Member not found." } };

    const previousEmail = u.email;
    if (email !== undefined && email !== u.email.toLowerCase()) {
      if (users.some((x) => x.id !== id && x.email.toLowerCase() === email)) {
        return { users: null, result: { ok: false, error: "Another member already uses that email." } };
      }
      u.email = email;
    }
    if (name !== undefined) u.name = name;
    const previousAddress: Partial<Record<AddressField, string>> = {};
    for (const k of ADDRESS_FIELDS) if (u[k]) previousAddress[k] = u[k];
    for (const [k, v] of Object.entries(addr) as Array<[AddressField, string | undefined]>) u[k] = v;
    return { users, result: { ok: true, user: u, previousEmail, previousAddress } };
  });
}

export async function setUserPassword(id: string, newPassword: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!newPassword || newPassword.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters" };
  }
  const passwordHash = await bcrypt.hash(newPassword, 10);
  return mutateUsers<{ ok: true } | { ok: false; error: string }>((users) => {
    if (users.length === 0) return { users: null, result: { ok: false, error: "Could not load users; please try again." } };
    const u = users.find((x) => x.id === id);
    if (!u) return { users: null, result: { ok: false, error: "User not found" } };
    u.passwordHash = passwordHash;
    // Any password they can use (set via link, reset, staff) means they're set up.
    if (u.needsPassword) u.needsPassword = undefined;
    return { users, result: { ok: true } };
  });
}

export async function deleteUser(id: string): Promise<void> {
  await mutateUsers(
    (users) => {
      const filtered = users.filter((u) => u.id !== id);
      // Nothing to do — don't rewrite the file for no reason.
      if (filtered.length === users.length) return { users: null, result: undefined };
      return { users: filtered, result: undefined };
    },
    // A delete is the one write that's meant to shrink the list.
    { allowShrink: true }
  );
}
