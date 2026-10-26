/**
 * Import customers exported from the old Shopify store (Customers → Export).
 *
 *  - Everyone with an email becomes an approved member, except people who
 *    told Shopify they're under 21 (skipped entirely).
 *  - Anyone who already has an account here is left exactly as they are —
 *    details, status and mailing-list choice untouched.
 *  - Mailing list: "Accepts Email Marketing = yes" → subscribed;
 *    "no" → an opt-out record, so they get account emails (like the
 *    set-password invite) but no campaigns. Existing list entries are never
 *    changed.
 *  - No emails are sent here. Members get a long random password nobody
 *    knows; the "set your password" invite is a separate step.
 *  - Re-importing the same file is safe: everyone is "already a member".
 */

import bcrypt from "bcryptjs";
import crypto from "crypto";
import { parseCsvRecords } from "./csvImport";
import { mutateUsers, type User } from "./users";
import { mutateSubscribers, type Subscriber } from "./subscribers";

type Rec = Record<string, string>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Shopify prefixes ids and phone numbers with ' so spreadsheets keep them as text. */
const clean = (v: string | undefined) => (v || "").trim().replace(/^'+/, "");
/** Column whose name starts with a phrase (Shopify's metafield headers are long). */
const col = (r: Rec, starts: string) => {
  const k = Object.keys(r).find((h) => h.startsWith(starts.toLowerCase()));
  return k ? clean(r[k]) : "";
};
const yes = (v: string) => /^(yes|true|y)$/i.test(v.trim());
const no = (v: string) => /^(no|false|n)$/i.test(v.trim());
const num = (v: string) => {
  const n = Number(clean(v).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : undefined;
};

export type ShopifyRow = {
  email: string;
  name: string;
  marketing: boolean;
  under21: boolean;
  user: Omit<User, "id" | "passwordHash" | "createdAt" | "status">;
};

/** Is this a Shopify customers export? */
export function looksLikeShopify(records: Rec[]): boolean {
  const h = Object.keys(records[0] || {});
  return h.includes("email") && h.includes("accepts email marketing") && h.some((x) => x.startsWith("default address"));
}

export function mapShopify(records: Rec[]): { rows: ShopifyRow[]; noEmail: number; duplicatesInFile: number } {
  const rows: ShopifyRow[] = [];
  const seen = new Set<string>();
  let noEmail = 0;
  let duplicatesInFile = 0;
  for (const r of records) {
    const email = clean(r["email"]).toLowerCase();
    if (!EMAIL_RE.test(email)) {
      noEmail++;
      continue;
    }
    if (seen.has(email)) {
      duplicatesInFile++;
      continue;
    }
    seen.add(email);
    const first = clean(r["first name"]);
    const last = clean(r["last name"]);
    const name = `${first} ${last}`.trim() || email.split("@")[0];
    const over21 = col(r, "are you 21 or older");
    const usedBefore = col(r, "have you used");
    const totalOrders = num(r["total orders"]);
    const country = clean(r["default address country code"]).toUpperCase();
    const consult = col(r, "would you like to schedule");
    const tags = clean(r["tags"])
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    rows.push({
      email,
      name,
      marketing: yes(r["accepts email marketing"] || ""),
      under21: no(over21),
      user: {
        email,
        name,
        ageVerified: yes(over21) ? true : undefined,
        priorCustomer: yes(usedBefore) ? true : no(usedBefore) ? (totalOrders ? true : false) : totalOrders ? true : undefined,
        message: clean(r["note"]) || undefined,
        addressLine1: clean(r["default address address1"]) || undefined,
        addressLine2: clean(r["default address address2"]) || undefined,
        city: clean(r["default address city"]) || undefined,
        state: clean(r["default address province code"]) || undefined,
        postalCode: clean(r["default address zip"]) || undefined,
        country: country && country !== "US" ? country : undefined,
        company: clean(r["default address company"]) || undefined,
        phone: clean(r["phone"]) || clean(r["default address phone"]) || undefined,
        importedFrom: "shopify",
        needsPassword: true,
        shopify: {
          customerId: clean(r["customer id"]) || undefined,
          totalSpent: num(r["total spent"]),
          totalOrders,
          tags: tags.length ? tags : undefined,
          experience: col(r, "would you consider yourself") || undefined,
          wantsConsultation: yes(consult) ? true : no(consult) ? false : undefined,
          lastEmailOpen: col(r, "seguno last open date") || undefined,
        },
      },
    });
  }
  return { rows, noEmail, duplicatesInFile };
}

export type ImportSummary = {
  rowsInFile: number;
  newMembers: number;
  alreadyMembers: number;
  under21Skipped: number;
  noEmail: number;
  duplicatesInFile: number;
  subscribed: number;
  optedOut: number;
  alreadyOnList: number;
  withAddress: number;
  usedBefore: number;
  sample: Array<{ name: string; email: string; city?: string; orders?: number; marketing: boolean }>;
};

/** Work out (dryRun) or apply the import. Never changes an existing member or list entry. */
export async function importShopify(csv: string, opts: { dryRun: boolean; now?: number }): Promise<ImportSummary | { error: string }> {
  const records = parseCsvRecords(csv);
  if (records.length === 0) return { error: "That file looked empty." };
  if (!looksLikeShopify(records)) return { error: "This doesn't look like a Shopify customers export (Customers → Export → CSV)." };
  const { rows, noEmail, duplicatesInFile } = mapShopify(records);
  const now = opts.now ?? Date.now();
  const eligible = rows.filter((r) => !r.under21);
  const unusedHash = opts.dryRun ? "" : await bcrypt.hash(crypto.randomBytes(24).toString("hex"), 10);

  // 1) Members: add only people who don't have an account (any status).
  const added: ShopifyRow[] = [];
  const memberResult = await mutateUsers((users) => {
    const existing = new Set(users.map((u) => u.email.toLowerCase()));
    // People an earlier run of this import already added (so a re-run can finish their mailing-list step).
    const earlier = new Set(users.filter((u) => u.importedFrom === "shopify").map((u) => u.email.toLowerCase()));
    const toAdd: User[] = [];
    let already = 0;
    for (const r of eligible) {
      if (existing.has(r.email)) {
        already++;
        continue;
      }
      existing.add(r.email);
      added.push(r);
      toAdd.push({
        ...r.user,
        id: `u_${now.toString(36)}_${crypto.randomBytes(4).toString("hex")}`,
        passwordHash: unusedHash,
        status: "approved",
        createdAt: now,
        approvedAt: now,
        importedAt: now,
        // They already know us — no "your membership is approved" email.
        welcomeEmailSentAt: now,
      });
    }
    return { users: opts.dryRun || toAdd.length === 0 ? null : [...users, ...toAdd], result: { already, earlier } };
  });
  // Mailing-list step covers new members plus earlier imports (if a previous run stopped half-way).
  const forList = [...added, ...eligible.filter((r) => memberResult.earlier.has(r.email))];

  // 2) Mailing list, for the people we're adding only. Existing entries are left alone.
  const listResult = await mutateSubscribers((subs) => {
    const onList = new Set(subs.map((s) => s.email.toLowerCase()));
    const add: Subscriber[] = [];
    let subscribed = 0;
    let optedOut = 0;
    let alreadyOnList = 0;
    for (const r of forList) {
      if (onList.has(r.email)) {
        alreadyOnList++;
        continue;
      }
      onList.add(r.email);
      add.push({
        id: `sub_${now}_${crypto.randomBytes(4).toString("hex")}`,
        email: r.email,
        name: r.name,
        source: "shopify",
        unsubscribeToken: crypto.randomBytes(16).toString("hex"),
        subscribedAt: now,
        ...(r.marketing ? {} : { unsubscribedAt: now }),
      });
      if (r.marketing) subscribed++;
      else optedOut++;
    }
    return { subs: opts.dryRun || add.length === 0 ? null : [...subs, ...add], result: { subscribed, optedOut, alreadyOnList } };
  });

  return {
    rowsInFile: records.length,
    newMembers: added.length,
    alreadyMembers: memberResult.already,
    under21Skipped: rows.length - eligible.length,
    noEmail,
    duplicatesInFile,
    ...listResult,
    withAddress: added.filter((r) => r.user.addressLine1).length,
    usedBefore: added.filter((r) => r.user.priorCustomer).length,
    sample: added.slice(0, 5).map((r) => ({ name: r.name, email: r.email, city: r.user.city, orders: r.user.shopify?.totalOrders, marketing: r.marketing })),
  };
}
