import { auditSystem } from "../audit";
import { isEnabled } from "../flags";
import { recentDone } from "../todayDone";
import { getAssistantConfig } from "./config";
import { chatCompletion, costOf, gatewayCredential, resolveAnsweringModel, type GatewayMessage } from "./gateway";
import { applyReview, getNotes, getRuns, nightlyDue, parseReviewJson, recordRun, reviewMaterial, REVIEW_INSTRUCTIONS, saveReviewResult } from "./learnedNotes";
import { flushUsage, monthSpend, recordUsage } from "./usage";

const DAILY_KEYS = ["requests", "members", "unpaid", "fulfil", "events", "codes"];

/**
 * The Concierge's notes review (see lib/assistant/learnedNotes.ts).
 * Nightly from the cron tick, or "Review chats now" in the Assistant tab.
 * Uses the main model, counts toward the monthly AI limit, never throws.
 */
export async function runNotesReview(opts: { trigger: "nightly" | "manual"; req?: Request }): Promise<{ ok: boolean; skipped?: string; summary?: string; added?: number; removed?: number; kept?: number; rejected?: number; error?: string }> {
  if (!(await isEnabled("concierge_learning"))) return { ok: false, skipped: "The “Concierge learns from chats” switch is off." };
  if (opts.trigger === "nightly") {
    const last = (await getRuns().catch(() => []))[0];
    if (!nightlyDue(last?.at)) return { ok: true, skipped: "not due" };
  }
  const config = await getAssistantConfig();
  if (config.monthlyCapUsd > 0 && (await monthSpend().catch(() => 0)) >= config.monthlyCapUsd) {
    await recordRun({ at: Date.now(), ok: false, trigger: opts.trigger, error: "Monthly AI limit reached — skipped." });
    return { ok: false, skipped: "Monthly AI limit reached." };
  }
  const credential = gatewayCredential(opts.req);
  if (!credential) return { ok: false, skipped: "No AI Gateway key." };

  const started = Date.now();
  // Activity log: a button press is staff, the nightly run is the schedule.
  const who = opts.trigger === "manual" ? { actor: "admin", actorType: "admin" as const, source: "human" as const } : {};
  let model = config.model;
  try {
    const { todaySuggestions } = await import("../todayBulletin");
    const { runTool } = await import("./tools");
    const [{ manager, marketing }, todayDone, current] = await Promise.all([
      todaySuggestions(config.monthlyCapUsd).catch(() => ({ manager: [], marketing: [] })),
      recentDone(7).catch(() => []),
      getNotes(true),
    ]);
    const todayKeys = Array.from(new Set([...DAILY_KEYS, ...[...manager, ...marketing].map((s) => s.key)]));
    const snapshot = await runTool("business_snapshot", "{}", {
      audience: "admin", user: null, ip: "cron", config, transcript: [], actions: [], draft: null, allowActions: false,
    }).catch(() => undefined);
    const material = await reviewMaterial({ todayKeys, todayDone, snapshot });
    const pinned = current.filter((n) => n.pinned || n.source === "staff").map((n) => `- (${n.scope}${n.todayKey ? ` ${n.todayKey}` : ""}) ${n.text}`).join("\n");
    const mine = current.filter((n) => !(n.pinned || n.source === "staff")).map((n) => `- (${n.scope}${n.todayKey ? ` ${n.todayKey}` : ""}) ${n.text}`).join("\n");

    const convo: GatewayMessage[] = [
      { role: "system", content: REVIEW_INSTRUCTIONS },
      { role: "user", content: `PINNED / STAFF NOTES (kept as they are):\n${pinned || "(none)"}\n\nYOUR CURRENT NOTES (revise, keep or drop):\n${mine || "(none yet)"}\n\n${material.text}` },
    ];
    let costUsd = 0;
    const ask = async () => {
      const callStarted = Date.now();
      const res = await chatCompletion({
        credential,
        model: config.model,
        fallbackModel: config.fallbackModel,
        messages: convo,
        // Thinking models spend part of this on reasoning before the JSON.
        maxTokens: 8000,
        timeoutMs: 25_000, // x2 attempts still fits the 60 s cron
      });
      model = resolveAnsweringModel(res.model, config.model, config.fallbackModel);
      const cost = await costOf(model, res.usage);
      costUsd += cost;
      recordUsage({ audience: "admin", model, inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens, costUsd: cost, toolCalls: 0, latencyMs: Date.now() - callStarted });
      return (res.message.content || "").trim();
    };

    let reply = await ask();
    let raw: unknown;
    try {
      raw = parseReviewJson(reply);
    } catch {
      // One more go if there's time: some models add prose or run out of room.
      if (Date.now() - started > 30_000) throw new Error(reply ? `The model didn't reply with the notes list (it began: “${reply.slice(0, 80)}”).` : "The model's reply was empty — it may have used its whole allowance thinking. Try again, or pick another model.");
      convo.push({ role: "assistant", content: reply || "(empty)" }, { role: "user", content: "Reply again with ONLY the JSON object described ({\"notes\":[...],\"summary\":\"...\"}) — no other text, no code fences." });
      reply = await ask();
      try {
        raw = parseReviewJson(reply);
      } catch {
        throw new Error(reply ? `The model didn't reply with the notes list (it began: “${reply.slice(0, 80)}”).` : "The model's reply was empty — it may have used its whole allowance thinking. Try again, or pick another model.");
      }
    } finally {
      await flushUsage();
    }

    const r = applyReview(current, raw, todayKeys);
    await saveReviewResult(r.next);
    const summary = String((raw as { summary?: unknown })?.summary || "").slice(0, 200);
    await recordRun({ at: Date.now(), ok: true, trigger: opts.trigger, model, costUsd, chats: material.chats, added: r.added, removed: r.removed, kept: r.kept, rejected: r.rejected });
    await auditSystem({
      action: "concierge.notes_review",
      ...who,
      targetType: "assistant",
      ok: true,
      note: `${opts.trigger === "nightly" ? "Nightly" : "Manual"} review of ${material.chats} chats: ${r.added} added, ${r.removed} removed, ${r.kept} kept${r.rejected ? `, ${r.rejected} rejected by the checks` : ""}${summary ? ` — ${summary}` : ""}`,
      before: current.map((n) => `${n.scope}: ${n.text}`),
      after: r.next.map((n) => `${n.scope}: ${n.text}`),
    });
    return { ok: true, summary, added: r.added, removed: r.removed, kept: r.kept, rejected: r.rejected };
  } catch (err) {
    const error = err instanceof Error ? err.message.slice(0, 200) : "Review failed.";
    console.error("[notes] review failed", err);
    await recordRun({ at: Date.now(), ok: false, trigger: opts.trigger, model, error }).catch(() => {});
    await auditSystem({ action: "concierge.notes_review", ...who, targetType: "assistant", ok: false, note: error }).catch(() => {});
    return { ok: false, error };
  }
}
