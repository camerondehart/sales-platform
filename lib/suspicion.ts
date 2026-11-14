/**
 * Suspicious-activity detection: finds members, guests and orders that look
 * fake so staff can review them. It only ever FLAGS. Nothing here blocks a
 * sign-up, a sign-in or an order.
 *
 * No imports, so the admin route and the unit test (tests/unit/suspicion.cjs)
 * share it. Input is what the site already stores (members, orders) plus the
 * small sign-up / checkout log in lib/riskLog.ts (internet address, browser,
 * country).
 *
 * How it works:
 *  1. Every person is one email address (a member, a guest shopper, or both).
 *  2. "Link" signals tie people together (same internet address, same shipping
 *     address, look-alike emails, the same sign-up note, the same phone…).
 *     "Solo" signals are about one person (unpaid orders piling up, a
 *     throwaway email, an order far bigger than normal…).
 *  3. Linked people are merged into one case. Each signal has a weight; a case
 *     is shown once its weights add up to SHOW_AT, and marked strong at STRONG_AT.
 *     One weak signal alone (two people on one wifi, a family at one address)
 *     never makes a case.
 */

export type RiskEvent = {
  id: string;
  kind: "signup" | "order";
  /** Member id or order id. */
  ref: string;
  email: string;
  ip?: string;
  ua?: string;
  country?: string;
  region?: string;
  at: number;
};

type Addr = { addressLine1?: string; addressLine2?: string; city?: string; state?: string; postalCode?: string };

export type SusUser = Addr & {
  id: string;
  email: string;
  name: string;
  status: "pending" | "approved" | "rejected";
  message?: string;
  createdAt: number;
  approvedAt?: number;
  importedFrom?: string;
  phone?: string;
};

export type SusOrder = {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  total: number;
  status: string;
  createdAt: number;
  paidAt?: number;
  isInquiry?: boolean;
  paymentMethod?: string;
  shippingMethod?: string;
  shippingAddress?: Addr;
  note?: string;
  discountCode?: string;
  placedBy?: string;
  items?: Array<{ quantity: number }>;
};

export type CaseReason = { code: string; text: string; weight: number };
export type CasePerson = {
  email: string;
  name: string;
  userId?: string;
  status: "pending" | "approved" | "rejected" | "guest";
  joinedAt?: number;
  orders: number;
  unpaid: number;
  paid: number;
};
export type CaseOrder = { id: string; name: string; email: string; total: number; status: string; createdAt: number };
export type SusCase = {
  id: string;
  level: "strong" | "look";
  score: number;
  latestAt: number;
  reasons: CaseReason[];
  people: CasePerson[];
  morePeople: number;
  orders: CaseOrder[];
  moreOrders: number;
};

export const SHOW_AT = 3;
export const STRONG_AT = 6;
const DAY = 86400000;
const HOUR = 3600000;
/** A case is listed only while something in it happened this recently. */
export const RECENT_DAYS = 90;

// Throwaway inbox services. Not complete, and doesn't need to be: it's one signal among many.
const DISPOSABLE = new Set(
  "mailinator.com guerrillamail.com guerrillamail.net sharklasers.com grr.la 10minutemail.com 10minutemail.net tempmail.com temp-mail.org tempmail.net tempmailo.com throwawaymail.com yopmail.com yopmail.net getnada.com nada.email maildrop.cc trashmail.com trashmail.net dispostable.com fakeinbox.com mailnesia.com mintemail.com mytemp.email emailondeck.com moakt.com tempr.email discard.email spamgourmet.com mailcatch.com inboxkitten.com tmpmail.org tmpmail.net mohmal.com burnermail.io tempinbox.com fakemail.net luxusmail.org minuteinbox.com tmail.ws 1secmail.com 1secmail.net 1secmail.org dropmail.me harakirimail.com mail.tm mailsac.com spam4.me tempail.com vomoto.com zeroe.ml".split(" ")
);

const lower = (s: unknown) => String(s || "").trim().toLowerCase();
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The mailbox an address really delivers to: no +tag, and no dots for Gmail. */
export function canonicalEmail(email: string): string {
  const e = lower(email);
  const at = e.lastIndexOf("@");
  if (at < 1) return e;
  let local = e.slice(0, at).split("+")[0];
  let domain = e.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

/** Same network: the whole address for IPv4, the first half (/64) for IPv6. */
export function ipKey(ip?: string): string {
  const v = lower(ip);
  if (!v || v === "unknown" || v === "::1" || v.startsWith("127.")) return "";
  if (v.includes(":")) return v.split(":").slice(0, 4).join(":");
  return v;
}

const WORDS: Record<string, string> = { street: "st", avenue: "ave", road: "rd", drive: "dr", boulevard: "blvd", lane: "ln", court: "ct", place: "pl", apartment: "apt", suite: "ste", north: "n", south: "s", east: "e", west: "w", unit: "apt" };
export function addressKey(a?: Addr): string {
  if (!a || !a.addressLine1 || !a.postalCode) return "";
  const norm = (s?: string) =>
    lower(s)
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => WORDS[w] || w)
      .join("");
  const line = norm(a.addressLine1) + norm(a.addressLine2);
  const zip = lower(a.postalCode).replace(/[^a-z0-9]/g, "").slice(0, 5);
  return line.length >= 4 && zip ? `${line}|${zip}` : "";
}

const phoneKey = (p?: string) => {
  const d = String(p || "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
};
const nameKey = (n?: string) => lower(n).replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();

/** A name that looks typed at random ("asdfgh", "xkcd qwrt", "John123"). Deliberately cautious. */
export function looksRandom(name: string): boolean {
  const n = lower(name);
  if (/\d/.test(n)) return true;
  const letters = n.replace(/[^a-z]/g, "");
  if (letters.length < 2) return true;
  if (/(.)\1{3,}/.test(letters)) return true;
  if (/[^aeiouy]{6,}/.test(letters)) return true;
  if (letters.length >= 5 && (letters.match(/[aeiouy]/g) || []).length / letters.length < 0.15) return true;
  return false;
}

const paidStatus = (s: string) => s === "paid" || s === "completed" || s === "shipped" || s === "picked-up";
const isPaid = (o: SusOrder) => !!o.paidAt || paidStatus(o.status);
/** Never paid: still waiting (including expired), or cancelled without ever being paid. */
const isUnpaid = (o: SusOrder) => !isPaid(o) && (o.status === "pending" || o.status === "cancelled") && o.paymentMethod !== "cash";

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

type Signal = { code: string; text: string; weight: number; emails: string[]; link: boolean };

export function findSuspicious(input: {
  users: SusUser[];
  orders: SusOrder[];
  events: RiskEvent[];
  /** Discount codes with a per-customer limit (upper case). */
  limitedCodes?: string[];
  now?: number;
}): SusCase[] {
  const now = input.now ?? Date.now();
  const users = input.users;
  // Orders staff placed for someone ("Log in as") and price inquiries say nothing about the customer.
  const orders = input.orders.filter((o) => !o.isInquiry && !o.placedBy && lower(o.userEmail));
  const events = input.events.filter((e) => lower(e.email));

  // ---- people
  type Person = { email: string; user?: SusUser; orders: SusOrder[]; names: Set<string> };
  const people = new Map<string, Person>();
  const person = (email: string) => {
    const k = lower(email);
    let p = people.get(k);
    if (!p) people.set(k, (p = { email: k, orders: [], names: new Set() }));
    return p;
  };
  for (const u of users) {
    const p = person(u.email);
    p.user = u;
    if (u.name) p.names.add(u.name.trim());
  }
  for (const o of orders) {
    const p = person(o.userEmail);
    p.orders.push(o);
    if (o.userName) p.names.add(o.userName.trim());
  }

  // Signed up on the site themselves (not imported, not added by staff: those are approved the instant they're created).
  const selfSignup = (u: SusUser) => !u.importedFrom && !(u.approvedAt && Math.abs(u.approvedAt - u.createdAt) < 2000);

  const signals: Signal[] = [];
  const groupBy = <T,>(rows: T[], key: (r: T) => string): Map<string, T[]> => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const k = key(r);
      if (!k) continue;
      const list = m.get(k);
      if (list) list.push(r);
      else m.set(k, [r]);
    }
    return m;
  };
  const distinct = (list: string[]) => Array.from(new Set(list.map(lower).filter(Boolean)));

  // ---- link: same internet address
  groupBy(events, (e) => ipKey(e.ip)).forEach((list, key) => {
    const emails = distinct(list.map((e) => e.email));
    if (emails.length < 2) return;
    const signups = distinct(list.filter((e) => e.kind === "signup").map((e) => e.email)).length;
    const orderCount = list.filter((e) => e.kind === "order").length;
    const sorted = [...list].sort((a, b) => a.at - b.at);
    const where = [sorted[sorted.length - 1].region, sorted[sorted.length - 1].country].filter(Boolean).join(", ");
    const shown = `${list[0].ip && list[0].ip.includes(":") ? `${key}:…` : key}${where ? `, ${where}` : ""}`;
    const what = [signups ? plural(signups, "membership request") : "", orderCount ? plural(orderCount, "order") : ""].filter(Boolean).join(" and ");
    if (emails.length >= 3) {
      const span = sorted[sorted.length - 1].at - sorted[0].at;
      const quick = span <= DAY ? " within a day" : "";
      signals.push({ code: "same-ip", link: true, weight: emails.length >= 5 || span <= DAY ? 4 : 3, emails, text: `${what} under ${emails.length} different emails came from the same internet address${quick} (${shown}).` });
      return;
    }
    // Two people on one connection is normal (a couple, housemates). Minutes apart is less so.
    let close = false;
    for (let i = 1; i < sorted.length; i++) if (lower(sorted[i].email) !== lower(sorted[i - 1].email) && sorted[i].at - sorted[i - 1].at <= HOUR) close = true;
    if (close) signals.push({ code: "same-ip-pair", link: true, weight: 2, emails, text: `${what} under 2 different emails came from the same internet address within an hour (${shown}).` });
  });

  // ---- link: same shipping address
  const addrRows: Array<{ k: string; email: string; label: string }> = [];
  const label = (a: Addr) => [a.addressLine1, a.addressLine2, a.city, a.state].filter(Boolean).join(", ");
  for (const u of users) if (addressKey(u)) addrRows.push({ k: addressKey(u), email: u.email, label: label(u) });
  for (const o of orders) if (o.shippingMethod !== "pickup" && addressKey(o.shippingAddress)) addrRows.push({ k: addressKey(o.shippingAddress), email: o.userEmail, label: label(o.shippingAddress as Addr) });
  groupBy(addrRows, (r) => r.k).forEach((list) => {
    const emails = distinct(list.map((r) => r.email));
    if (emails.length >= 3) signals.push({ code: "same-address", link: true, weight: emails.length >= 5 ? 3 : 2, emails, text: `${emails.length} different emails use the same shipping address (${list[0].label}).` });
  });

  // ---- link: emails that are really one mailbox
  groupBy(Array.from(people.keys()), (e) => canonicalEmail(e)).forEach((list, canon) => {
    if (list.length >= 2) signals.push({ code: "same-mailbox", link: true, weight: 3, emails: list, text: `${list.length} emails are the same mailbox written differently (dots or +tags): they all deliver to ${canon}.` });
  });

  // ---- link: numbered emails (name1@, name2@, name3@)
  groupBy(Array.from(people.keys()), (e) => {
    const at = e.lastIndexOf("@");
    if (at < 1) return "";
    const stem = e.slice(0, at).replace(/\d+/g, "");
    return stem.length >= 4 && stem !== e.slice(0, at) ? `${stem}@${e.slice(at + 1)}` : "";
  }).forEach((list, stem) => {
    if (list.length >= 3) signals.push({ code: "numbered-emails", link: true, weight: 2, emails: list, text: `${list.length} emails follow the same numbered pattern (${stem.replace("@", "…@")}).` });
  });

  // ---- link: the same sign-up note
  groupBy(users.filter((u) => selfSignup(u) && lower(u.message).replace(/\s+/g, " ").length >= 20), (u) => lower(u.message).replace(/\s+/g, " ")).forEach((list) => {
    if (list.length >= 2) signals.push({ code: "same-note", link: true, weight: list.length >= 3 ? 3 : 2, emails: list.map((u) => lower(u.email)), text: `${list.length} membership requests carry the exact same note (“${String(list[0].message).trim().slice(0, 60)}${String(list[0].message).trim().length > 60 ? "…" : ""}”).` });
  });

  // ---- link: same phone
  const phoneRows: Array<{ k: string; email: string }> = [];
  for (const u of users) if (phoneKey(u.phone)) phoneRows.push({ k: phoneKey(u.phone), email: u.email });
  for (const o of orders) {
    const m = /Phone:\s*([^·]+)/.exec(o.note || "");
    if (m && phoneKey(m[1])) phoneRows.push({ k: phoneKey(m[1]), email: o.userEmail });
  }
  groupBy(phoneRows, (r) => r.k).forEach((list, k) => {
    const emails = distinct(list.map((r) => r.email));
    if (emails.length >= 3) signals.push({ code: "same-phone", link: true, weight: 2, emails, text: `${emails.length} different emails gave the same phone number (ending ${k.slice(-4)}).` });
  });

  // ---- link: the same name on several emails
  const nameRows: Array<{ k: string; email: string; name: string }> = [];
  people.forEach((p) => p.names.forEach((n) => { const k = nameKey(n); if (k.includes(" ") && k.length >= 7) nameRows.push({ k, email: p.email, name: n }); }));
  groupBy(nameRows, (r) => r.k).forEach((list) => {
    const emails = distinct(list.map((r) => r.email));
    if (emails.length >= 3) signals.push({ code: "same-name", link: true, weight: 1, emails, text: `The name “${list[0].name}” is on ${emails.length} different emails.` });
  });

  // ---- link: a burst of membership requests
  const selfs = users.filter(selfSignup).sort((a, b) => a.createdAt - b.createdAt);
  for (let i = 0; i < selfs.length; ) {
    let j = i;
    while (j + 1 < selfs.length && selfs[j + 1].createdAt - selfs[i].createdAt <= 10 * 60000) j++;
    if (j - i + 1 >= 5) {
      signals.push({ code: "signup-burst", link: true, weight: 2, emails: selfs.slice(i, j + 1).map((u) => lower(u.email)), text: `${j - i + 1} membership requests arrived within 10 minutes of each other.` });
      i = j + 1;
    } else i++;
  }

  // ---- solo signals
  const paidTotals = orders.filter(isPaid).map((o) => o.total).filter((t) => t > 0);
  const typical = paidTotals.length >= 10 ? median(paidTotals) : 0;
  const lastEvent = new Map<string, RiskEvent>();
  for (const e of events) {
    const k = lower(e.email);
    const cur = lastEvent.get(k);
    if (!cur || e.at > cur.at) lastEvent.set(k, e);
  }

  people.forEach((p) => {
    const solo = (code: string, weight: number, text: string) => signals.push({ code, weight, text, emails: [p.email], link: false });
    const who = p.user?.name || p.orders[0]?.userName || p.email;
    const domain = p.email.slice(p.email.lastIndexOf("@") + 1);
    if (DISPOSABLE.has(domain)) solo("throwaway-email", 2, `${p.email} is a throwaway inbox (${domain}).`);
    if (p.user && selfSignup(p.user) && looksRandom(p.user.name)) solo("random-name", 1, `The name “${p.user.name}” looks typed at random.`);

    const mine = [...p.orders].sort((a, b) => a.createdAt - b.createdAt);
    const unpaid = mine.filter(isUnpaid);
    const paid = mine.filter(isPaid);
    if (!paid.length && unpaid.length >= 3) solo("never-paid", 3, `${who} has placed ${unpaid.length} orders and never paid for any ($${unpaid.reduce((s, o) => s + o.total, 0).toFixed(2)} in all).`);
    else if (!paid.length && unpaid.length === 2) solo("never-paid", 1, `${who} has 2 unpaid orders and has never paid for one.`);

    for (let i = 0; i + 2 < mine.length; i++) {
      if (mine[i + 2].createdAt - mine[i].createdAt <= HOUR) {
        let n = 3;
        while (i + n < mine.length && mine[i + n].createdAt - mine[i].createdAt <= HOUR) n++;
        solo("order-burst", 2, `${who} placed ${n} orders within an hour.`);
        break;
      }
    }

    const first = mine[0];
    if (first && !isPaid(first)) {
      const units = (first.items || []).reduce((s, it) => s + (Number(it.quantity) || 0), 0);
      const maxLine = Math.max(0, ...(first.items || []).map((it) => Number(it.quantity) || 0));
      if (typical > 0 && first.total >= Math.max(5 * typical, 400)) solo("big-first-order", 2, `${who}'s first order is $${first.total.toFixed(2)}, unpaid, when a typical paid order is about $${typical.toFixed(0)}.`);
      else if (maxLine >= 10 || units >= 20) solo("big-first-order", 2, `${who}'s first order asks for ${units} items${maxLine >= 10 ? ` (${maxLine} of one product)` : ""} and is unpaid.`);
    }

    const orderNames = distinct(mine.map((o) => nameKey(o.userName)));
    if (!p.user && orderNames.length >= 3) solo("many-names", 2, `Orders from ${p.email} were placed under ${orderNames.length} different names.`);

    const ev = lastEvent.get(p.email);
    if (ev && ev.country && ev.country !== "US") solo("outside-us", 1, `${who}'s latest ${ev.kind === "signup" ? "membership request" : "order"} came from outside the US (${ev.country}).`);
  });

  // ---- merge linked people into cases
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) && parent.get(r) !== r) r = parent.get(r) as string;
    parent.set(x, r);
    return r;
  };
  const involved = new Set<string>();
  for (const s of signals) for (const e of s.emails) { involved.add(e); if (!parent.has(e)) parent.set(e, e); }
  for (const s of signals) if (s.link) for (let i = 1; i < s.emails.length; i++) {
    const a = find(s.emails[0]), b = find(s.emails[i]);
    if (a !== b) parent.set(b, a);
  }
  const clusters = new Map<string, { emails: Set<string>; signals: Signal[] }>();
  involved.forEach((e) => {
    const r = find(e);
    if (!clusters.has(r)) clusters.set(r, { emails: new Set(), signals: [] });
    (clusters.get(r) as { emails: Set<string> }).emails.add(e);
  });
  for (const s of signals) (clusters.get(find(s.emails[0])) as { signals: Signal[] }).signals.push(s);

  const limited = new Set((input.limitedCodes || []).map((c) => c.toUpperCase()));
  const cases: SusCase[] = [];
  clusters.forEach((c) => {
    const emails = Array.from(c.emails);
    const members = emails.map((e) => people.get(e)).filter((p): p is Person => !!p);
    const reasons: CaseReason[] = c.signals.map((s) => ({ code: s.code, text: s.text, weight: s.weight }));

    if (emails.length >= 2) {
      // Signals that only mean something once people are linked.
      const rejected = members.filter((p) => p.user?.status === "rejected");
      if (rejected.length && rejected.length < members.length) reasons.push({ code: "linked-to-rejected", weight: 2, text: `Linked to ${rejected.length === 1 ? `a request you already rejected (${rejected[0].email})` : `${rejected.length} requests you already rejected`}.` });
      const byCode = new Map<string, Set<string>>();
      for (const p of members) for (const o of p.orders) {
        const code = (o.discountCode || "").toUpperCase();
        if (!code || !limited.has(code)) continue;
        if (!byCode.has(code)) byCode.set(code, new Set());
        (byCode.get(code) as Set<string>).add(p.email);
      }
      byCode.forEach((set, code) => {
        if (set.size >= 2) reasons.push({ code: "code-reuse", weight: 2, text: `The limited code ${code} was used by ${set.size} of these linked emails.` });
      });
    }

    const score = reasons.reduce((s, r) => s + r.weight, 0);
    if (score < SHOW_AT) return;

    let latestAt = 0;
    for (const p of members) {
      if (p.user && selfSignup(p.user)) latestAt = Math.max(latestAt, p.user.createdAt);
      for (const o of p.orders) latestAt = Math.max(latestAt, o.createdAt);
    }
    if (now - latestAt > RECENT_DAYS * DAY) return;

    const allPeople: CasePerson[] = members
      .map((p) => ({
        email: p.email,
        name: p.user?.name || p.orders[p.orders.length - 1]?.userName || "",
        userId: p.user?.id,
        status: (p.user?.status || "guest") as CasePerson["status"],
        joinedAt: p.user?.createdAt,
        orders: p.orders.length,
        unpaid: p.orders.filter(isUnpaid).length,
        paid: p.orders.filter(isPaid).length,
      }))
      .sort((a, b) => (b.joinedAt || 0) - (a.joinedAt || 0) || a.email.localeCompare(b.email));
    const allOrders: CaseOrder[] = members
      .flatMap((p) => p.orders)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((o) => ({ id: o.id, name: o.userName, email: lower(o.userEmail), total: o.total, status: isPaid(o) && o.status === "pending" ? "paid" : o.status, createdAt: o.createdAt }));

    reasons.sort((a, b) => b.weight - a.weight);
    cases.push({
      // Same people + same kinds of reason = same case, so "Looks fine" sticks until something new turns up.
      id: `sus_${hash([...emails].sort().join(",") + "|" + Array.from(new Set(reasons.map((r) => r.code))).sort().join(","))}`,
      level: score >= STRONG_AT ? "strong" : "look",
      score,
      latestAt,
      reasons,
      people: allPeople.slice(0, 12),
      morePeople: Math.max(0, allPeople.length - 12),
      orders: allOrders.slice(0, 8),
      moreOrders: Math.max(0, allOrders.length - 8),
    });
  });

  return cases.sort((a, b) => b.score - a.score || b.latestAt - a.latestAt);
}
