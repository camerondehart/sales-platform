import { getProducts, isExternal } from "../storage";
import { getDiscounts } from "../discounts";
import { isEnabled } from "../flags";
import { cleanAmbassador, currentRate, DEFAULT_TERMS, getAmbassadors, termsOf, type Ambassador } from "../ambassadors";
import { ambassadorStatsFor } from "../ambassadorData";
import { REPORT_PERIODS, type ReportPeriod } from "../ambassadorReport";
import { pacificDay, pacificMidnight } from "../periods";
import type { GatewayTool } from "./gateway";
import type { ToolContext } from "./tools";
import type { ActionProposal, Audience } from "./shared";
import { brand } from "../brand";

/**
 * The staff Concierge and the Ambassadors tab: look up any ambassador's
 * numbers (visits, orders, sales, commission earned/paid/owed, trial…) and
 * prepare confirm cards to add/change an ambassador, record a payout or email
 * a progress report. Same rule as every other tool: the card calls the same
 * endpoint the dashboard's buttons use, and nothing happens until staff confirm.
 */

type Def = GatewayTool & { audiences: Audience[] };
type Result = Record<string, unknown>;

const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: "string", description, ...extra });
const num = (description: string) => ({ type: "number", description });
const bool = (description: string) => ({ type: "boolean", description });
const admin = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): Def => ({
  audiences: ["admin"],
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required } },
});

const PERIOD = str("Which period: this-month | last-month | 30-days | since-start (default since-start)", { enum: Object.keys(REPORT_PERIODS) });
const TERMS = {
  commission_pct: num("Commission % (e.g. 15)"),
  growth_pct: num("Room-to-grow higher rate % (e.g. 20)"),
  growth_goal: str("Goals that earn the higher rate, in words"),
  growth_on: bool("true = goals met, new orders earn the higher rate"),
  discount_pct: num("Community discount % given through their code (e.g. 10)"),
  trial_days: num("Trial length in days (0 = no trial)"),
  trial_reviewed: bool("true = the end-of-trial review has happened"),
  start_date: str("Start date YYYY-MM-DD"),
  window_days: num("Attribution window: days after visiting their page an order still counts"),
  repeat_purchases: bool("false = only each customer's first order counts"),
  payout_schedule: str("monthly | quarterly | on request"),
  terms_notes: str("Other terms & notes (staff only): products sent, content permissions…"),
};

export const AMBASSADOR_DEFS: Def[] = [
  admin(
    "ambassadors",
    "Read-only: ambassadors (influencers with their own page on the site, /<name>) and their numbers. Without `ambassador`: everyone with page visits, orders, paid sales, commission earned, paid out and OWED NOW, trial status, plus totals. With `ambassador` (id or name): that person in detail for a period — visits and QR scans, orders, units, sales, earned and pending commission, owed, month by month, top products, trial, their terms, payouts and recent credited orders. Commission = rate × (order total − shipping) on PAID orders; cancelled orders don't count.",
    { ambassador: str("Optional: ambassador id or name"), period: PERIOD },
  ),
  admin(
    "propose_ambassador",
    "Prepare adding an ambassador, or changing one (pass ambassador id/name and ONLY the fields that change). Covers their page (name, page address, headline, words, photo link, featured public products, social links, linked discount code, live on/off), their email for reports and their terms. Staff must confirm.",
    {
      ambassador: str("To change someone: their id or name. Leave empty to add a new ambassador."),
      name: str("Full name"),
      slug: str("Page address: the site's /<slug> (letters, numbers, dashes)"),
      email: str("Their email for progress reports"),
      headline: str("Headline on their page"),
      bio: str("A few words on their page"),
      photo: str("Photo link (https://…)"),
      products: { type: "array", items: { type: "string" }, description: "Featured public-shop products (names or ids), in order. Replaces the current list." },
      socials: { type: "array", items: { type: "string" }, description: "Social links (instagram.com/name…). Replaces the current list." },
      discount_code: str("An existing discount code to link (\"\" to unlink)"),
      active: bool("Page live (true) or off (false)"),
      ...TERMS,
    },
  ),
  admin(
    "propose_ambassador_payout",
    "Prepare recording money paid to an ambassador (after staff paid them by Zelle/Venmo; the site never moves money). Lowers what's owed. Staff must confirm.",
    { ambassador: str("Ambassador id or name"), amount: num("Amount paid in dollars"), date: str("Paid on, YYYY-MM-DD (default today)"), note: str("e.g. Zelle, October commission") },
    ["ambassador", "amount"],
  ),
  admin(
    "propose_ambassador_report",
    "Prepare emailing an ambassador their progress report (visits, orders, sales, commission earned/paid/owed, top products, trial). Shows totals only, never customers. Red card: it sends an email. Staff must confirm.",
    { ambassador: str("Ambassador id or name"), period: PERIOD, note: str("Optional personal note (blank = a warm thank-you)") },
    ["ambassador"],
  ),
];

export const AMBASSADOR_TOOL_NAMES = new Set(AMBASSADOR_DEFS.map((d) => d.function.name));

const s = (v: unknown, max = 500) => String(v ?? "").trim().slice(0, max);
const money = (n: number) => `$${n.toFixed(2)}`;
const newId = () => `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const READY = { proposed: true, say: "The card is ready for them to confirm. Nothing has changed yet." };
const day = (t: number) => new Date(t).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric" });
function push(ctx: ToolContext, a: Omit<ActionProposal, "id">) {
  ctx.actions.push({ id: newId(), ...a });
}

function find(list: Ambassador[], q: string): Ambassador | undefined {
  const n = q.toLowerCase().trim();
  if (!n) return undefined;
  return list.find((a) => a.id === q) || list.find((a) => a.slug === n) || list.find((a) => a.name.toLowerCase() === n) || list.find((a) => a.name.toLowerCase().includes(n));
}

function range(period: ReportPeriod, startDate: string, now = Date.now()): { from: number; to: number } | undefined {
  const today = pacificDay(now);
  const first = `${today.slice(0, 7)}-01`;
  if (period === "since-start") return { from: pacificMidnight(startDate), to: now };
  if (period === "30-days") return { from: now - 30 * 86_400_000, to: now };
  if (period === "last-month") {
    const [y, m] = first.split("-").map(Number);
    const prev = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
    return { from: pacificMidnight(prev), to: pacificMidnight(first) - 1 };
  }
  return { from: pacificMidnight(first), to: now };
}
const periodOf = (v: unknown): ReportPeriod => ((Object.keys(REPORT_PERIODS) as string[]).includes(String(v)) ? (String(v) as ReportPeriod) : "since-start");

function termsLine(a: Ambassador): string {
  const t = termsOf(a);
  return [
    `${currentRate(t)}% commission${t.growthPct && !t.growthOn ? ` (→ ${t.growthPct}%${t.growthGoal ? ` once ${t.growthGoal}` : " after agreed goals"})` : ""}`,
    typeof t.discountPct === "number" ? `${t.discountPct}% community discount${a.discountCode ? ` (code ${a.discountCode})` : ""}` : "",
    `${t.windowDays}-day window${t.repeatPurchases ? "" : ", first orders only"}`,
    t.trialDays ? `${t.trialDays}-day trial from ${t.startDate}` : `started ${t.startDate}`,
    `payouts ${t.payoutSchedule}`,
  ].filter(Boolean).join(" · ");
}

export async function runAmbassadorTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<Result | null> {
  if (!AMBASSADOR_TOOL_NAMES.has(name)) return null;
  if (ctx.audience !== "admin") return { error: "Not available." };
  const list = await getAmbassadors();
  const site = (process.env.NEXT_PUBLIC_SITE_URL || brand.siteUrl).replace(/\/$/, "");

  switch (name) {
    case "ambassadors": {
      const switchOn = await isEnabled("ambassador_pages").catch(() => false);
      const q = s(args.ambassador, 120);
      if (q) {
        const a = find(list, q);
        if (!a) return { error: `No ambassador called “${q}”. Call ambassadors without a name to list them.` };
        const period = periodOf(args.period);
        const st = (await ambassadorStatsFor([a], range(period, termsOf(a).startDate)))[a.id];
        return {
          id: a.id, name: a.name, page: `${site}/${a.slug}`, live: a.active && switchOn, email: a.email || null, code: a.discountCode || null,
          terms: termsLine(a),
          terms_notes: termsOf(a).notes || null,
          period: REPORT_PERIODS[period],
          numbers: {
            page_visits: st.visits, qr_scans: st.qrScans, orders: st.orders, units: st.units,
            sales_paid: st.sales, sales_unpaid: st.pendingSales, commission_earned: st.earned, commission_pending: st.pending,
            conversion_pct: st.conversion ?? null,
          },
          all_time: { earned: st.earnedAllTime, paid_out: st.paidOut, owed_now: st.owed },
          trial: st.trial,
          months: st.months.slice(0, 6),
          top_products: st.topProducts,
          payouts: (a.payouts || []).slice(-10).reverse().map((p) => ({ amount: p.amount, on: day(p.at), note: p.note })),
          recent_orders: st.list.slice(0, 15).map((o) => ({ ref: `#${o.ref}`, placed: day(o.at), status: o.status, net: o.net, commission: o.commission, earned: o.earned, via: o.via })),
          last_report: a.lastReportAt ? day(a.lastReportAt) : null,
          ...(switchOn ? {} : { note: "The Ambassador pages switch is off: pages aren't live and new orders aren't credited." }),
        };
      }
      if (!list.length) return { ambassadors: [], note: "No ambassadors yet. Add one in the Ambassadors tab (or propose_ambassador)." };
      const stats = await ambassadorStatsFor(list);
      const rows = list.map((a) => {
        const st = stats[a.id];
        return {
          id: a.id, name: a.name, page: `/${a.slug}`, live: a.active, rate_pct: currentRate(termsOf(a)),
          visits: st.visits, orders: st.orders, sales_paid: st.sales, earned: st.earnedAllTime, paid_out: st.paidOut, owed_now: st.owed,
          trial: st.trial.status === "trial" ? `day ${st.trial.day} of ${st.trial.length}` : st.trial.status === "review" ? "trial over: review due" : st.trial.status,
          last_report: a.lastReportAt ? day(a.lastReportAt) : null,
        };
      }).sort((x, y) => y.owed_now - x.owed_now);
      const sum = (k: "visits" | "orders" | "sales_paid" | "earned" | "paid_out" | "owed_now") => Math.round(rows.reduce((n, r) => n + r[k], 0) * 100) / 100;
      return {
        switch_on: switchOn,
        totals: { live: rows.filter((r) => r.live).length, visits: sum("visits"), orders: sum("orders"), sales_paid: sum("sales_paid"), earned: sum("earned"), paid_out: sum("paid_out"), owed_now: sum("owed_now") },
        ambassadors: rows,
      };
    }

    case "propose_ambassador": {
      const q = s(args.ambassador, 120);
      const existing = q ? find(list, q) : undefined;
      if (q && !existing) return { error: `No ambassador called “${q}”.` };
      const base: Record<string, unknown> = existing
        ? { ...existing, terms: { ...termsOf(existing) } }
        : { name: "", slug: "", productIds: [], socials: [], active: true, terms: { ...DEFAULT_TERMS, startDate: pacificDay() } };
      const changes: string[] = [];
      const setF = (key: string, label: string, val: unknown) => {
        base[key] = val;
        changes.push(label);
      };
      if (args.name !== undefined) setF("name", `Name: ${s(args.name, 80)}`, s(args.name, 80));
      if (args.slug !== undefined) setF("slug", `Page: ${site.replace(/^https?:\/\//, "")}/${s(args.slug, 40).toLowerCase()}`, s(args.slug, 40).toLowerCase());
      if (!existing && !base.slug && base.name) base.slug = String(base.name).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "").slice(0, 40);
      if (args.email !== undefined) setF("email", `Email: ${s(args.email, 200) || "(none)"}`, s(args.email, 200));
      if (args.headline !== undefined) setF("headline", `Headline: ${s(args.headline, 120) || "(none)"}`, s(args.headline, 120));
      if (args.bio !== undefined) setF("bio", "Their words updated", s(args.bio, 1200));
      if (args.photo !== undefined) setF("photo", "Photo updated", s(args.photo, 600));
      if (args.active !== undefined) setF("active", args.active ? "Page: live" : "Page: off", !!args.active);
      if (Array.isArray(args.products)) {
        const all = (await getProducts()).filter(isExternal);
        const ids: string[] = [];
        const missing: string[] = [];
        for (const w of args.products.map((x) => s(x, 120)).filter(Boolean).slice(0, 24)) {
          const n = w.toLowerCase();
          const hit = all.find((p) => p.id === w) || all.find((p) => p.name.toLowerCase() === n) || all.find((p) => p.name.toLowerCase().includes(n));
          if (hit) ids.push(hit.id);
          else missing.push(w);
        }
        setF("productIds", `Featured: ${ids.map((id) => all.find((p) => p.id === id)!.name).join(", ") || "(whole shop)"}${missing.length ? ` · not in the public shop, left off: ${missing.join(", ")}` : ""}`, ids);
      }
      if (Array.isArray(args.socials)) setF("socials", `Social links: ${args.socials.map((x) => s(x, 200)).filter(Boolean).join(", ") || "(none)"}`, args.socials.map((x) => ({ url: s(x, 400) })).filter((x) => x.url));
      if (args.discount_code !== undefined) {
        const code = s(args.discount_code, 40).toUpperCase();
        if (code && !(await getDiscounts()).some((d) => d.code === code)) return { error: `There's no discount code ${code}. Make it first (propose_discount_code), then link it.` };
        setF("discountCode", code ? `Linked code: ${code} (also works in the public shop)` : "Linked code: none", code);
      }
      const t = base.terms as Record<string, unknown> | undefined;
      const terms: Record<string, unknown> = { ...(t || {}) };
      const tmap: Array<[string, string, (v: unknown) => unknown, (v: unknown) => string]> = [
        ["commission_pct", "commissionPct", Number, (v) => `Commission: ${v}%`],
        ["growth_pct", "growthPct", Number, (v) => `Higher rate: ${v}%`],
        ["growth_goal", "growthGoal", (v) => s(v, 300), (v) => `Goals for the higher rate: ${v}`],
        ["growth_on", "growthOn", (v) => !!v, (v) => (v ? "Goals met: new orders earn the higher rate" : "Back to the base rate")],
        ["discount_pct", "discountPct", Number, (v) => `Community discount: ${v}%`],
        ["trial_days", "trialDays", Number, (v) => `Trial: ${v} days`],
        ["trial_reviewed", "trialReviewed", (v) => !!v, (v) => (v ? "Trial review: done" : "Trial review: not yet")],
        ["start_date", "startDate", (v) => s(v, 10), (v) => `Started: ${v}`],
        ["window_days", "windowDays", Number, (v) => `Attribution window: ${v} days`],
        ["repeat_purchases", "repeatPurchases", (v) => !!v, (v) => (v ? "Repeat purchases count" : "First order per customer only")],
        ["payout_schedule", "payoutSchedule", (v) => s(v, 20), (v) => `Payouts: ${v}`],
        ["terms_notes", "notes", (v) => s(v, 2000), () => "Terms notes updated"],
      ];
      let termsChanged = false;
      for (const [arg, key, conv, label] of tmap) {
        if (args[arg] === undefined) continue;
        terms[key] = conv(args[arg]);
        changes.push(label(terms[key]));
        termsChanged = true;
      }
      if (termsChanged || !existing) base.terms = terms;
      if (existing && !changes.length) return { error: "Nothing to change. Say which fields change." };
      const c = cleanAmbassador(base, list.filter((a) => a.id !== existing?.id));
      if (!c.ok) return { error: c.error };
      const v = c.value;
      push(ctx, {
        kind: "ambassador",
        title: existing ? `Update ambassador: ${existing.name}` : `Add ambassador: ${v.name}`,
        lines: existing
          ? changes
          : [
              `Page: ${site.replace(/^https?:\/\//, "")}/${v.slug} (link/QR only, not in the menus)`,
              v.email ? `Reports go to ${v.email}` : "No email yet (needed for progress reports)",
              `Terms: ${termsLine({ ...v, id: "x", createdAt: Date.now(), updatedAt: Date.now() } as Ambassador)}`,
              ...changes.filter((x) => /^(Featured|Social|Linked)/.test(x)),
            ],
        confirmLabel: existing ? "Save" : "Add ambassador",
        request: existing ? { method: "PUT", url: "/api/admin/ambassadors", body: { ...v, id: existing.id } } : { method: "POST", url: "/api/admin/ambassadors", body: v },
        refresh: ["ambassadors"],
      });
      return READY;
    }

    case "propose_ambassador_payout": {
      const a = find(list, s(args.ambassador, 120));
      if (!a) return { error: "No ambassador by that name. Use ambassadors first." };
      const amount = Math.round(Number(args.amount) * 100) / 100;
      if (!Number.isFinite(amount) || amount <= 0) return { error: "amount must be more than 0." };
      const date = s(args.date, 10);
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "date must look like 2026-10-31." };
      const owed = (await ambassadorStatsFor([a]))[a.id].owed;
      push(ctx, {
        kind: "ambassador_payout",
        title: `Record payout: ${money(amount)} to ${a.name}`,
        lines: [
          `Paid ${date || "today"}${s(args.note, 200) ? ` · ${s(args.note, 200)}` : ""}`,
          `Owed now ${money(owed)} → ${money(Math.max(0, owed - amount))}`,
          amount > owed + 0.004 ? `⚠ That's more than they're owed (${money(owed)}). Check before confirming.` : "",
          "Records it only: pay them yourself (Zelle, Venmo…). The site never moves money.",
        ].filter(Boolean),
        confirmLabel: "Record payout",
        danger: amount > owed + 0.004,
        request: { method: "PUT", url: "/api/admin/ambassadors", body: { id: a.id, payout: { amount, at: date || undefined, note: s(args.note, 200) || undefined } } },
        refresh: ["ambassadors"],
      });
      return READY;
    }

    case "propose_ambassador_report": {
      const a = find(list, s(args.ambassador, 120));
      if (!a) return { error: "No ambassador by that name. Use ambassadors first." };
      if (!a.email) return { error: `${a.name} has no email yet. Add it first (propose_ambassador with email).` };
      const period = periodOf(args.period);
      const st = (await ambassadorStatsFor([a], range(period, termsOf(a).startDate)))[a.id];
      const note = s(args.note, 3000);
      push(ctx, {
        kind: "ambassador_report",
        title: `Email ${a.name} their progress report`,
        lines: [
          `To ${a.email} · covering ${REPORT_PERIODS[period].toLowerCase()}`,
          `${st.visits} page visits · ${st.orders} orders · ${money(st.sales)} paid sales · ${money(st.earned)} earned${st.pending ? ` (+${money(st.pending)} pending)` : ""}`,
          `Since they started: ${money(st.earnedAllTime)} earned, ${money(st.paidOut)} paid, ${money(st.owed)} still owed`,
          "Totals and product names only, never customers' details. Replies go to the support inbox.",
          "To see the full email first, use Email a progress report in the Ambassadors tab.",
        ],
        preview: note || undefined,
        confirmLabel: "Send report",
        busyLabel: "Sending…",
        danger: true,
        request: { method: "POST", url: "/api/admin/ambassadors/report", body: { id: a.id, period, note: note || undefined, send: true } },
        refresh: ["ambassadors"],
      });
      return READY;
    }
  }
  return null;
}
