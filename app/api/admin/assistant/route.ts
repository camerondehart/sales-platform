import { NextResponse } from "next/server";
import { addDays, pacificDay } from "@/lib/periods";
import { isAdmin } from "@/lib/auth";
import {
  cleanConfigPatch,
  getAssistantConfig,
  updateAssistantConfig,
} from "@/lib/assistant/config";
import { chatCompletion, costOf, explainGatewayError, gatewayCredential, GatewayError, type GatewayMessage, type GatewayTool, resolveAnsweringModel } from "@/lib/assistant/gateway";
import { allUsage, escalationStatus, flushUsage, monthKey, recentEscalations, recordUsage } from "@/lib/assistant/usage";
import { audited } from "@/lib/audit";
import { brand } from "@/lib/brand";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const unauthorized = () => NextResponse.json({ error: "unauthorized" }, { status: 401 });

/** Settings, usage stats and recent escalations for the Assistant tab. */
export async function GET(req: Request) {
  if (!(await isAdmin())) return unauthorized();
  // Push this instance's unflushed tally first so the numbers are current.
  await flushUsage(true);
  const [config, rows, escalations] = await Promise.all([
    getAssistantConfig({ fresh: true }),
    allUsage(true),
    recentEscalations(),
  ]);

  const month = monthKey();
  const monthRows = rows.filter((r) => r.day.startsWith(month));
  const sum = (list: typeof rows) =>
    list.reduce(
      (a, r) => ({
        requests: a.requests + r.requests,
        inputTokens: a.inputTokens + r.inputTokens,
        outputTokens: a.outputTokens + r.outputTokens,
        costUsd: a.costUsd + r.costUsd,
        toolCalls: a.toolCalls + r.toolCalls,
        errors: a.errors + r.errors,
        latencyMs: a.latencyMs + (r.latencyMs || 0),
      }),
      { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, toolCalls: 0, errors: 0, latencyMs: 0 }
    );
  const groupBy = (key: "audience" | "model", list: typeof rows = monthRows) => {
    const m = new Map<string, typeof rows>();
    list.forEach((r) => m.set(r[key], [...(m.get(r[key]) || []), r]));
    return Array.from(m.entries())
      .map(([k, list]) => ({ key: k, ...sum(list) }))
      .sort((a, b) => b.costUsd - a.costUsd);
  };
  // Last 30 days, zero-filled so the chart has no gaps.
  const days: Array<{ day: string; requests: number; costUsd: number }> = [];
  for (let i = 29; i >= 0; i--) {
    const d = addDays(pacificDay(), -i);
    const t = sum(rows.filter((r) => r.day === d));
    days.push({ day: d, requests: t.requests, costUsd: t.costUsd });
  }

  return NextResponse.json(
    {
      config,
      keyConfigured: !!gatewayCredential(req),
      keySource: process.env.AI_GATEWAY_API_KEY ? "api-key" : gatewayCredential(req) ? "oidc" : "none",
      month,
      totals: sum(monthRows),
      byAudience: groupBy("audience"),
      byModel: groupBy("model"),
      // Spend by model and by audience for a few periods (usage is kept 120 days).
      spend: Object.fromEntries(
        (
          [
            ["month", monthRows],
            ["d30", rows.filter((r) => r.day >= addDays(pacificDay(), -29))],
            ["d120", rows],
          ] as const
        ).map(([k, list]) => [k, { totals: sum(list as typeof rows), byModel: groupBy("model", list as typeof rows), byAudience: groupBy("audience", list as typeof rows) }])
      ),
      days,
      // Every open request, plus the most recent resolved ones.
      escalations: [
        ...escalations.filter((e) => escalationStatus(e) === "open"),
        ...escalations.filter((e) => escalationStatus(e) !== "open").slice(0, 40),
      ]
        .sort((a, b) => b.at - a.at)
        .map((e) => ({ ...e, status: escalationStatus(e), replies: e.replies || [], transcript: e.transcript || [] })),
      escalationsOpen: escalations.filter((e) => escalationStatus(e) === "open").length,
      escalationsThisMonth: escalations.filter((e) => pacificDay(e.at).startsWith(month)).length,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/** Save settings. */
async function PUT_handler(req: Request) {
  if (!(await isAdmin())) return unauthorized();
  let input: Record<string, unknown>;
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const cleaned = cleanConfigPatch(input);
  if (!cleaned.ok) return NextResponse.json({ error: cleaned.error }, { status: 400 });
  try {
    const config = await updateAssistantConfig(cleaned.patch);
    return NextResponse.json({ ok: true, config });
  } catch (err) {
    console.error("[assistant] config save failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not save." }, { status: 500 });
  }
}

/**
 * Test a model the way a real chat uses it: with a tool, a tool result sent
 * back, and then a written answer — on that model ONLY (no fallback), so a
 * problem shows up here with the gateway's own reason instead of being
 * hidden by the backup model answering.
 */
async function POST_handler(req: Request) {
  if (!(await isAdmin())) return unauthorized();
  const credential = gatewayCredential(req);
  if (!credential) {
    return NextResponse.json({ ok: false, error: "No AI Gateway key is configured on this deployment." });
  }
  let model = "";
  try {
    const body = await req.json();
    model = String(body?.model || "");
  } catch {
    /* use saved model */
  }
  const config = await getAssistantConfig();
  if (!model) model = config.model;
  const started = Date.now();
  const tools: GatewayTool[] = [
    {
      type: "function",
      function: {
        name: "get_shop_hours",
        description: `Today's opening hours for the ${brand.shortName} shop.`,
        parameters: { type: "object", properties: {} },
      },
    },
  ];
  const messages: GatewayMessage[] = [
    {
      role: "system",
      content: "You are a connectivity test for a shop assistant. Call get_shop_hours first, then reply with one short friendly sentence that mentions the hours.",
    },
    { role: "user", content: "What are the shop hours today?" },
  ];
  let usage = { inputTokens: 0, outputTokens: 0 };
  let cost = 0;
  let usedTool = false;
  let answeredBy = model;
  let step = "the first reply";
  try {
    let res = await chatCompletion({ credential, model, messages, tools, toolChoice: "auto", maxTokens: 2000, timeoutMs: 25_000 });
    answeredBy = resolveAnsweringModel(res.model, model);
    usage = { inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens };
    cost += await costOf(answeredBy, res.usage);
    const calls = res.message.tool_calls || [];
    if (calls.length > 0) {
      usedTool = true;
      step = "the reply after using a tool";
      messages.push({
        role: "assistant",
        content: res.message.content ?? null,
        tool_calls: calls,
        ...(res.message.reasoning_details ? { reasoning_details: res.message.reasoning_details } : {}),
      });
      for (const c of calls) {
        messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify({ hours: "10am – 5pm local" }) });
      }
      res = await chatCompletion({ credential, model, messages, tools, toolChoice: "none", maxTokens: 2000, timeoutMs: 25_000 });
      answeredBy = resolveAnsweringModel(res.model, model);
      usage = { inputTokens: usage.inputTokens + res.usage.inputTokens, outputTokens: usage.outputTokens + res.usage.outputTokens };
      cost += await costOf(answeredBy, res.usage);
    }
    recordUsage({ audience: "admin", model: answeredBy, ...usage, costUsd: cost, toolCalls: usedTool ? 1 : 0, latencyMs: Date.now() - started });
    await flushUsage();
    return NextResponse.json({
      ok: true,
      model: answeredBy,
      usedTool,
      reply: (res.message.content || "").trim(),
      ms: Date.now() - started,
      costUsd: cost,
    });
  } catch (err) {
    console.error("[assistant] model test failed", err);
    // Staff get the plain-English version plus the gateway's own words, so
    // an unusual failure can be looked up or passed to support.
    const raw = err instanceof GatewayError ? err.message.replace(/^Gateway HTTP \d+:\s*/, "").slice(0, 300) : "";
    return NextResponse.json({
      ok: false,
      error: `${explainGatewayError(err)} (Failed at ${step}.)`,
      detail: raw || undefined,
      ms: Date.now() - started,
    });
  }
}

// One audit-log entry per request (see lib/audit.ts).
export const PUT = audited("assistant.settings_update", "assistant", PUT_handler);
export const POST = audited("assistant.model_test", "assistant", POST_handler);
