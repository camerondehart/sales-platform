import path from "path";
import { auditSystem, readAuditRange, type AuditEntry } from "../audit";
import { pacificDay, pacificMidnight } from "../periods";
import { recentDone } from "../todayDone";
import { VersionedStore } from "../versionedStore";
import { isEnabled } from "../flags";
import { getAssistantConfig, managerModelOf } from "./config";
import { chatCompletion, costOf, explainGatewayError, GatewayError, gatewayCredential, resolveAnsweringModel, type GatewayMessage } from "./gateway";
import { getNotes } from "./learnedNotes";
import { flushUsage, monthSpend, recordUsage } from "./usage";
import { brand } from "../brand";

/**
 * The site manager review: a smarter "manager model"
 * (Assistant → Model & access) looks over the whole site at once — Today
 * list and ideas, Concierge notes, sales, analytics, chats and the full
 * Activity log since the last review — and writes a manager's briefing.
 *
 * It may make low-risk display tweaks on its own for today only: move Today
 * cards to another priority, or hide ones that don't matter. Every tweak is
 * logged in the Activity log and can be undone from the Manager's take card.
 * Anything touching money, customers or sending stays a suggestion that the
 * staff hand to the Concierge, which still asks for Confirm on every card.
 *
 * From the cron tick (managerRunsPerDay times a day from midnight Pacific, see managerDue), or
 * "Run now" on the Today panel. It also writes a build brief under up to 3
 * open site requests a night (lib/siteRequests.ts addBrief), never changing
 * their size, labels or approval.
 * Counts toward the monthly AI limit.
 */

export const PRIORITIES = ["now", "today", "this week", "campaign", "idea"] as const;
export type ManagerPriority = (typeof PRIORITIES)[number];

export type ManagerTweak = { id: string; priority?: ManagerPriority; hide?: boolean; why: string; task?: string };
export type ManagerReview = {
  id: "latest";
  at: number;
  day: string; // Pacific day the tweaks apply to
  ok: boolean;
  trigger: "nightly" | "manual";
  model?: string;
  /** The manager model that was asked; differs from `model` when the backup answered. */
  wanted?: string;
  /** Why the manager model didn't write it, when the backup did. */
  primaryError?: string;
  costUsd?: number;
  error?: string;
  headline?: string;
  wins?: string[];
  concerns?: string[];
  insights?: string[];
  missed?: string[];
  actions?: Array<{ title: string; ask: string }>;
  tweaks?: ManagerTweak[];
  undone?: boolean;
  logEntries?: number;
  briefed?: number;
};

const store = new VersionedStore<ManagerReview>({
  name: "manager-review",
  legacyKey: "manager-review.json",
  localFile: path.join(process.cwd(), "data", "manager-review.json"),
  keep: 6,
  reconcileLegacy: false,
});

export async function latestReview(): Promise<ManagerReview | null> {
  try {
    return (await store.read()).data[0] || null;
  } catch {
    return null;
  }
}

async function saveReview(r: ManagerReview) {
  await store.mutate((rows) => ({ data: [r], result: r }));
}

/** Today's active tweaks (none once undone or from an earlier day). */
export async function activeTweaks(day = pacificDay()): Promise<ManagerTweak[]> {
  if (!(await isEnabled("manager_review"))) return [];
  const r = await latestReview();
  if (!r || !r.ok || r.undone || r.day !== day) return [];
  return r.tweaks || [];
}

export async function undoTweaks(): Promise<boolean> {
  const r = await latestReview();
  if (!r || r.undone || !r.tweaks?.length) return false;
  await saveReview({ ...r, undone: true });
  await auditSystem({ action: "manager.undo", actor: "admin", actorType: "admin", source: "human", targetType: "today", ok: true, note: `Undid ${r.tweaks.length} Today tweak(s) from the manager review`, before: r.tweaks });
  return true;
}

/**
 * Scheduled runs: `runsPerDay` (Assistant → Model & access, default 1) spread
 * evenly from midnight Pacific, so the first run is ready for the nightly
 * report (sent ~1–2am). 2 = midnight + noon, 3 = midnight, 8am, 4pm, and so on.
 * Each run starts in the first hour of its slot. 0 = only Run now.
 */
export function managerDue(lastAt: number | undefined, runsPerDay = 1, now = Date.now()): boolean {
  const n = Math.max(0, Math.min(MAX_RUNS_PER_DAY, Math.floor(runsPerDay)));
  if (!n) return false;
  const hour = Number(new Date(now).toLocaleString("en-US", { timeZone: brand.timezone, hour: "numeric", hour12: false })) % 24;
  const slots = Array.from({ length: n }, (_, i) => Math.floor((i * 24) / n));
  if (!slots.includes(hour)) return false;
  const slotStart = pacificMidnight(pacificDay(now)) + hour * 3_600_000; // close enough on DST days
  return !lastAt || lastAt < slotStart - 5 * 60_000;
}
export const MAX_RUNS_PER_DAY = 8;

const LOG_CHARS = 60_000;
function compactLog(entries: AuditEntry[]): string {
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(`${e.action}${e.ok ? "" : " (FAILED)"}`, (counts.get(`${e.action}${e.ok ? "" : " (FAILED)"}`) || 0) + 1);
  const head = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}: ${n}`).join("\n");
  const fmt = (t: number) => new Date(t).toLocaleString("en-US", { timeZone: brand.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const lines: string[] = [];
  let used = head.length;
  // Failures first so they are never cut, then newest first.
  const ordered = [...entries.filter((e) => !e.ok), ...entries.filter((e) => e.ok)];
  for (const e of ordered) {
    const line = `${fmt(e.at)} ${e.ok ? "" : "FAILED "}${e.action} by ${e.actorType}${e.source === "ai" ? " via Concierge" : ""}${e.targetType ? ` on ${e.targetType}${e.targetId ? ` ${String(e.targetId).slice(0, 40)}` : ""}` : ""}${e.note ? ` — ${String(e.note).slice(0, 200)}` : ""}`;
    if (used + line.length > LOG_CHARS) {
      lines.push(`(… ${ordered.length - lines.length} more entries not shown)`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return `COUNTS BY ACTION:\n${head || "(none)"}\n\nENTRIES:\n${lines.join("\n") || "(none)"}`;
}

export const MANAGER_INSTRUCTIONS = `You are the site manager for ${brand.name}, a small members-only shop. Each morning you look over the whole website's state and write a short, practical briefing for the owner and staff, like a capable store manager would.

You get: today's to-do list and ideas (with ids), the Concierge's learned notes, a business snapshot, 30-day sales insights, daily site traffic, chat insights, which Today items staff ticked in the last week, and the full Activity log since your last review.

Read the Activity log carefully for things that were missed or went wrong: pickup orders marked completed without a ready-for-pickup email (order.pickup_ready), failed actions, orders stuck in a state, payments not matched, emails that failed, repeated errors, unusual sign-ins or changes, requests nobody answered.

Before any concern, action or tweak, check ALREADY PLANNED and TICKED DONE: if a campaign is already scheduled or sent, or a sale is already set up, for what an item suggests, treat that work as done (you may hide or lower that item and say why), and never ask staff to plan it again.

You may tweak today's list: set a different priority for an item (one of: now, today, this week, campaign, idea) or hide an item that isn't worth attention today. Only use ids from the list. Change only what clearly helps, and give a short reason for each.

For each site request listed, write a build brief so a developer AI can build it well: Goal (one line), Where (which page/tab/screen), What to change (numbered steps), Done when (testable checks), Keep the same (what must not change), Questions (anything unclear for the requester). Use only what the request says plus what you can see in the material; don't add features. Never include customer names, emails or other personal details in a brief.

Never invent numbers. Plain English, short sentences, no internal jargon. Actions are suggestions for staff; write each "ask" as an instruction to the staff Concierge (it prepares cards staff must confirm).

Reply with ONLY this JSON, no code fences:
{"headline":"one sentence","wins":["..."],"concerns":["..."],"insights":["..."],"missed":["things from the Activity log that may have been missed"],"actions":[{"title":"short button label","ask":"instruction for the Concierge"}],"tweaks":[{"id":"item id","priority":"now","why":"..."},{"id":"item id","hide":true,"why":"..."}],"briefs":[{"number":12,"brief":"markdown text"}]}
Keep each list to at most 5 items (actions at most 4, tweaks at most 8).`;

function parseJson(text: string): Record<string, unknown> {
  const t = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no json");
  return JSON.parse(t.slice(start, end + 1));
}

const strList = (v: unknown, n: number, len = 300) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).slice(0, n).map((x) => (x as string).trim().slice(0, len)) : []);

export function cleanReply(raw: Record<string, unknown>, validIds: Set<string>) {
  const actions = Array.isArray(raw.actions)
    ? raw.actions
        .filter((a): a is { title: string; ask: string } => !!a && typeof (a as { title?: unknown }).title === "string" && typeof (a as { ask?: unknown }).ask === "string")
        .slice(0, 4)
        .map((a) => ({ title: a.title.trim().slice(0, 60), ask: a.ask.trim().slice(0, 600) }))
    : [];
  const tweaks: ManagerTweak[] = [];
  if (Array.isArray(raw.tweaks)) {
    for (const t of raw.tweaks.slice(0, 8) as Array<Record<string, unknown>>) {
      const id = typeof t?.id === "string" ? t.id : "";
      if (!validIds.has(id) || tweaks.some((x) => x.id === id)) continue;
      const why = typeof t.why === "string" ? t.why.trim().slice(0, 200) : "";
      if (t.hide === true) tweaks.push({ id, hide: true, why });
      else if (PRIORITIES.includes(t.priority as ManagerPriority)) tweaks.push({ id, priority: t.priority as ManagerPriority, why });
    }
  }
  return {
    headline: typeof raw.headline === "string" ? raw.headline.trim().slice(0, 240) : "",
    wins: strList(raw.wins, 5),
    concerns: strList(raw.concerns, 5),
    insights: strList(raw.insights, 5),
    missed: strList(raw.missed, 5),
    actions,
    tweaks,
  };
}

export async function runManagerReview(opts: { trigger: "nightly" | "manual"; req?: Request; force?: boolean; budgetMs?: number }): Promise<{ ok: boolean; skipped?: string; error?: string; review?: ManagerReview }> {
  if (!(await isEnabled("manager_review"))) return { ok: false, skipped: "The “Site manager review” switch is off." };
  const last = await latestReview();
  const config = await getAssistantConfig();
  if (opts.trigger === "nightly" && !opts.force && !managerDue(last?.at, config.managerRunsPerDay ?? 1)) return { ok: true, skipped: "not due" };
  const model0 = managerModelOf(config);
  const who = opts.trigger === "manual" ? { actor: "admin", actorType: "admin" as const, source: "human" as const } : {};
  const fail = async (error: string) => {
    const r: ManagerReview = { id: "latest", at: Date.now(), day: pacificDay(), ok: false, trigger: opts.trigger, model: model0, error };
    // Keep the last good briefing on screen; only record the failure if there is none.
    if (!last?.ok) await saveReview(r).catch(() => {});
    await auditSystem({ action: "manager.review", ...who, targetType: "assistant", ok: false, note: error }).catch(() => {});
    return { ok: false, error };
  };
  if (config.monthlyCapUsd > 0 && (await monthSpend().catch(() => 0)) >= config.monthlyCapUsd) return { ok: false, skipped: "Monthly AI limit reached." };
  const credential = gatewayCredential(opts.req);
  if (!credential) return { ok: false, skipped: "No AI Gateway key." };

  let model = model0;
  try {
    const { todaySuggestions } = await import("../todayBulletin");
    const { runTool } = await import("./tools");
    const { readTraffic } = await import("../traffic");
    const { addDays } = await import("../periods");
    const ctx = { audience: "admin" as const, user: null, ip: "cron", config, transcript: [], actions: [], draft: null, allowActions: false };
    const today = pacificDay();
    // Full Activity log since the last good review (at most 3 days back).
    const since = Math.max(last?.ok ? last.at : 0, Date.now() - 3 * 86_400_000);
    const [daily, sugg, notes, snapshot, sales, chats, traffic, done, log] = await Promise.all([
      runTool("daily_tasks", "{}", ctx).catch(() => undefined) as Promise<{ tasks?: Array<{ priority: string; task: string; items?: string[] }> } | undefined>,
      todaySuggestions(config.monthlyCapUsd).catch(() => ({ manager: [], marketing: [] })),
      getNotes(true).catch(() => []),
      runTool("business_snapshot", "{}", ctx).catch(() => undefined),
      runTool("sales_insights", JSON.stringify({ days: 30 }), ctx).catch(() => undefined),
      runTool("chat_insights", "{}", ctx).catch(() => undefined),
      readTraffic(addDays(today, -13), today).catch(() => []),
      recentDone(7).catch(() => []),
      readAuditRange(since).catch(() => [] as AuditEntry[]),
    ]);
    // What's already planned, so the review never flags or moves work that's done.
    const fmtP = (t: number) => new Date(t).toLocaleString("en-US", { timeZone: brand.timezone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const planned = await (async () => {
      const lines: string[] = [];
      try {
        const { listCampaigns } = await import("../campaignSchedule");
        for (const c of (await listCampaigns()).filter((c) => c.status !== "cancelled" && (c.status !== "sent" || c.scheduledFor > Date.now() - 14 * 86_400_000)).slice(0, 25)) {
          lines.push(`Campaign "${c.subject}" — ${c.status === "sent" ? "sent" : c.status} ${fmtP(c.scheduledFor)}`);
        }
      } catch {}
      try {
        const { listSales } = await import("../siteSales");
        for (const x of (await listSales()).filter((x) => !x.endedAt && x.endsAt > Date.now()).slice(0, 10)) {
          lines.push(`Sitewide sale "${x.name}" ${x.percent}% off, ${fmtP(x.startsAt)} to ${fmtP(x.endsAt - 60_000)}`);
        }
      } catch {}
      return lines;
    })();
    const { requestsNeedingBrief, addBrief } = await import("../siteRequests");
    const requests = (await isEnabled("site_requests").catch(() => false)) ? (await requestsNeedingBrief().catch(() => [])).slice(0, 3) : [];
    const { todayItemIds } = await import("./managerIds");
    const items = todayItemIds(daily?.tasks || [], [...sugg.manager, ...sugg.marketing]);
    const validIds = new Set(items.map((i) => i.id));
    const material = [
      `TODAY (${today}) LIST — id | priority | task | items:\n${items.map((i) => `${i.id} | ${i.priority} | ${i.task}${i.items.length ? ` | ${i.items.slice(0, 6).join("; ")}` : ""}`).join("\n") || "(empty)"}`,
      `ALREADY PLANNED — scheduled and recent campaigns, upcoming sitewide sales (check these before suggesting or moving anything):\n${planned.join("\n") || "(none)"}`,
      `TICKED DONE, LAST 7 DAYS:\n${done.map((d) => `${d.day}: ${d.done.join(", ") || "-"}`).join("\n") || "(none)"}`,
      `CONCIERGE NOTES:\n${notes.map((n) => `- (${n.scope}${n.todayKey ? ` ${n.todayKey}` : ""}) ${n.text}`).join("\n") || "(none)"}`,
      `BUSINESS SNAPSHOT:\n${JSON.stringify(snapshot ?? {}).slice(0, 6000)}`,
      `SALES, LAST 30 DAYS:\n${JSON.stringify(sales ?? {}).slice(0, 8000)}`,
      `SITE TRAFFIC BY DAY (counters):\n${traffic.map((r) => `${r.id}: ${JSON.stringify(r.c)}`).join("\n").slice(0, 6000) || "(none)"}`,
      `CHAT INSIGHTS:\n${JSON.stringify(chats ?? {}).slice(0, 5000)}`,
      `SITE REQUESTS NEEDING A BUILD BRIEF:\n${requests.map((r) => `#${r.number} (${r.size}, ${r.status}) ${r.title}\n${r.details}`).join("\n\n") || "(none)"}`,
      `ACTIVITY LOG SINCE ${new Date(since).toLocaleString("en-US", { timeZone: brand.timezone })} (${log.length} entries):\n${compactLog(log)}`,
    ].join("\n\n");

    const convo: GatewayMessage[] = [
      { role: "system", content: MANAGER_INSTRUCTIONS },
      { role: "user", content: material },
    ];
    // Any model in the picker: one try on the manager model with a generous
    // time limit (thinking models can take minutes), then the backup model if
    // it fails or doesn't send a briefing. The card says when the backup wrote it.
    const deadline = Date.now() + (opts.budgetMs ?? 240_000);
    let raw: Record<string, unknown> | null = null;
    let costUsd = 0;
    let primaryError = "";
    const ask = async (id: string): Promise<Record<string, unknown>> => {
      const t0 = Date.now();
      const left = deadline - t0;
      if (left < 20_000) throw new Error("Ran out of time.");
      const res = await chatCompletion({ credential, model: id, messages: convo, maxTokens: 9000, timeoutMs: Math.min(left, 180_000), attempts: 1 });
      const used = resolveAnsweringModel(res.model, id);
      const cost = await costOf(used, res.usage);
      costUsd += cost;
      model = used;
      recordUsage({ audience: "admin", model: used, inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens, costUsd: cost, toolCalls: 0, latencyMs: Date.now() - t0 });
      const reply = (res.message.content || "").trim();
      try {
        return parseJson(reply);
      } catch {
        throw new Error(reply ? `it didn't reply with a briefing (it began: “${reply.slice(0, 80)}”)` : "its reply was empty (it may have spent its whole allowance thinking)");
      }
    };
    const why = (err: unknown) => {
      if (err instanceof Error && /abort/i.test(err.name + err.message)) return "it took too long to answer";
      if (err instanceof GatewayError) return `${explainGatewayError(err).replace(/\.$/, "")} (${err.message.slice(0, 160)})`;
      return err instanceof Error ? err.message : "it failed";
    };
    try {
      try {
        raw = await ask(model0);
      } catch (err) {
        primaryError = why(err);
        console.warn(`[manager] ${model0} failed: ${primaryError}`);
        const backup = config.fallbackModel;
        if (!backup || backup === model0) throw new Error(`${model0.split("/").pop()}: ${primaryError}`);
        try {
          raw = await ask(backup);
        } catch (err2) {
          throw new Error(`${model0.split("/").pop()}: ${primaryError}. The backup ${backup.split("/").pop()} also failed: ${why(err2)}.`);
        }
      }
    } finally {
      await flushUsage();
    }
    const c = cleanReply(raw, validIds);
    for (const t of c.tweaks) t.task = items.find((i) => i.id === t.id)?.task.slice(0, 120);
    // Build briefs for site requests (only the ones offered above; original text kept).
    let briefed = 0;
    if (Array.isArray(raw.briefs)) {
      const allowed = new Set(requests.map((r) => r.number));
      for (const b of (raw.briefs as Array<{ number?: unknown; brief?: unknown }>).slice(0, 3)) {
        const n = Number(b?.number);
        const text = typeof b?.brief === "string" ? b.brief.trim().slice(0, 4000) : "";
        if (!allowed.has(n) || text.length < 40) continue;
        allowed.delete(n);
        if (await addBrief(n, text).catch(() => false)) briefed++;
      }
    }
    const review: ManagerReview = { id: "latest", at: Date.now(), day: today, ok: true, trigger: opts.trigger, model, wanted: model0, primaryError: primaryError || undefined, costUsd, logEntries: log.length, briefed, ...c };
    await saveReview(review);
    await auditSystem({
      action: "manager.review",
      ...who,
      targetType: "today",
      ok: true,
      note: `${opts.trigger === "nightly" ? "Nightly" : "Manual"} manager review (${log.length} log entries read): ${c.tweaks.length} Today tweak(s), ${briefed} site request brief(s)${c.headline ? ` — ${c.headline}` : ""}`,
      after: c.tweaks,
    });
    return { ok: true, review };
  } catch (err) {
    console.error("[manager] review failed", err);
    return fail(err instanceof Error ? err.message.slice(0, 200) : "Review failed.");
  }
}
