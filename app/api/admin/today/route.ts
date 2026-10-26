import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { getAssistantConfig } from "@/lib/assistant/config";
import { assistantStatus } from "@/lib/assistant/engine";
import { runTool } from "@/lib/assistant/tools";
import { clientIp } from "@/lib/assistant/limits";
import { isEnabled } from "@/lib/flags";
import { type Priority, type Suggestion } from "@/lib/siteManager";
import { todaySuggestions } from "@/lib/todayBulletin";
import { singleton } from "@/lib/assistant/singleton";
import { doneToday, setDone } from "@/lib/todayDone";
import { audited } from "@/lib/audit";
import { notesForToday } from "@/lib/assistant/learnedNotes";

export const dynamic = "force-dynamic";

/**
 * Overview → "Today" bulletin, a stand-in site manager:
 *  1. the live to-do list the staff Concierge gives for "What needs my
 *     attention today?" (daily_tasks), and
 *  2. proactive suggestions from lib/siteManager.ts (stale orders, finished
 *     codes, slow sellers, quiet members, events filling slowly…).
 * No AI call here: read-only, no cost. Each item's button asks the staff
 * Concierge to prepare confirm cards (nothing happens until staff press
 * Confirm) or opens the right tab. Cached 60 s per server; ?fresh=1 skips it.
 */

const CACHE = singleton("todayBulletin", () => ({ at: 0, body: null as unknown }));
const RANK: Record<Priority, number> = { now: 0, today: 1, "this week": 2, campaign: 3, idea: 4 };

type Task = { priority: "now" | "today" | "this week"; task: string; items: string[] };

// What each kind of task's button does. Prompts stay under the widget's 300 characters.
function actionFor(task: string): { key: string; ask?: string; tab?: string; button: string } {
  if (/^Reply to/i.test(task)) return { key: "requests", tab: "assistant", button: "Open replies" };
  if (/membership request/i.test(task))
    return {
      key: "members",
      ask: "Prepare a card for each membership request that's waiting, so I can approve or decline each one. Point out anyone who didn't confirm 21+.",
      button: "Prepare approval cards",
    };
  if (/^Chase/i.test(task))
    return {
      key: "unpaid",
      ask: "Prepare payment reminder cards (with the pay button) for the unpaid orders on today's Chase list (daily_tasks) — one card per order, up to 10. Skip cash-at-pickup orders and any chased in the last 3 days.",
      button: "Prepare reminder cards",
    };
  if (/^Pack and/i.test(task))
    return {
      key: "fulfil",
      ask: "For the paid orders waiting to go out: prepare a shipping label card for each shipping order that still needs a label (leave the weight out — it's worked out from product weights), and a 'mark completed' card for each order that's ready. One card per order.",
      button: "Prepare shipping cards",
    };
  if (/event/i.test(task)) return { key: "events", tab: "events", button: "Open events" };
  if (/discount code/i.test(task)) return { key: "codes", tab: "marketing", button: "Open codes" };
  return { key: "other", tab: "overview", button: "Open" };
}

export async function GET(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  // Ticks are always read fresh (they're shared across devices); the list itself is cached 60 s.
  const done = await doneToday().catch(() => [] as string[]);
  if (!fresh && CACHE.body && Date.now() - CACHE.at < 60_000) return NextResponse.json({ ...(CACHE.body as object), done }, { headers: { "Cache-Control": "no-store" } });
  try {
    const [config, status, actionsOn] = await Promise.all([getAssistantConfig(), assistantStatus(req), isEnabled("ai_admin_actions")]);
    const out = (await runTool("daily_tasks", "{}", {
      audience: "admin",
      user: null,
      ip: clientIp(req),
      config,
      transcript: [],
      actions: [],
      draft: null,
      allowActions: false, // read-only here; cards come from the Concierge
    })) as { as_of?: string; all_clear?: boolean; tasks?: Task[]; error?: string };
    if (!out || typeof out !== "object" || out.error) throw new Error(out?.error || "no tasks");

    const conciergeReady = !!status.available.admin && actionsOn;
    const daily = (out.tasks || []).map((t) => {
      const a = actionFor(t.task);
      return {
        id: a.key, // stable all day, so a tick survives the numbers changing
        priority: t.priority as Priority,
        task: t.task,
        // "{id:…}" markers are for the Concierge, not for people.
        items: (t.items || []).map((s) => s.replace(/\s*\{id:[^}]*\}/g, "").trim()),
        // Without the Concierge, every button just opens the right tab.
        ask: conciergeReady ? a.ask : undefined,
        tab: a.tab || (a.key === "members" ? "members" : "orders"),
        orderFilter: a.key === "unpaid" ? "pending" : a.key === "fulfil" ? "paid" : undefined,
        button: conciergeReady || a.tab ? a.button : a.key === "members" ? "Open members" : "Open orders",
        why: undefined as string | undefined,
      };
    });

    const shape = (list: Suggestion[]) =>
      list.map((s) => ({
        id: s.key,
        priority: s.priority,
        task: s.task,
        items: s.items,
        ask: conciergeReady ? s.ask : undefined,
        tab: s.tab,
        orderFilter: s.orderFilter,
        button: conciergeReady || !s.ask ? s.button : "Open",
        why: s.why,
      }));

    // Proactive suggestions + campaign ideas (lib/todayBulletin.ts). Failures never hide the to-do list.
    const { manager, marketing } = await todaySuggestions(config.monthlyCapUsd);
    const ideas = shape(manager);
    const campaignIdeas = shape(marketing);

    const sorted = [...daily, ...ideas, ...campaignIdeas].sort((a, b) => RANK[a.priority as Priority] - RANK[b.priority as Priority]);
    // "Learned" lines from the Concierge's notes (Assistant tab → Concierge notes).
    const tasks = await Promise.all(sorted.map(async (t) => {
      const learned = await notesForToday(t.id);
      return learned.length ? { ...t, learned: learned.slice(0, 2) } : t;
    }));
    const body = { asOf: out.as_of || "", allClear: tasks.length === 0, tasks, conciergeReady };
    Object.assign(CACHE, { at: Date.now(), body });
    return NextResponse.json({ ...body, done }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[today] failed", err);
    return NextResponse.json({ error: "Couldn't load today's list. It'll try again in a moment." }, { status: 503 });
  }
}

/** Tick / untick an item for today — shared by every staff member and device. */
async function POST_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { id?: unknown; done?: unknown };
  const id = typeof body.id === "string" ? body.id.slice(0, 120) : "";
  if (!id) return NextResponse.json({ error: "Which item?" }, { status: 400 });
  const done = await setDone(id, body.done !== false);
  return NextResponse.json({ ok: true, done });
}
export const POST = audited("today.tick", "today", POST_handler);
