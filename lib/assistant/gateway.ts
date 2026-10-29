/**
 * Thin client for Vercel AI Gateway's OpenAI-compatible Chat Completions API.
 *
 * Plain fetch rather than an SDK: fewer moving parts, and only documented
 * request fields are used (model, models, messages, tools, tool_choice,
 * max_tokens, optional temperature) so a gateway change can't break us on a field we
 * don't need.
 *
 * Reliability: every call has a hard timeout; network errors, 429s and 5xx
 * responses get one retry with backoff; and a fallback model is passed via
 * the gateway's documented `models` field so the gateway itself fails over.
 */

import { singleton } from "./singleton";

// Overridable only so the test harness can point at a local mock gateway.
const BASE = (process.env.AI_GATEWAY_BASE_URL || "https://ai-gateway.vercel.sh/v1").replace(/\/$/, "");

export type GatewayToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

/** A user turn with a photo: text + image (OpenAI-compatible content parts). */
export type GatewayUserPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export type GatewayMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | GatewayUserPart[] }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: GatewayToolCall[];
      /**
       * The model's "thinking" from this turn, exactly as the gateway sent it.
       * Reasoning models (e.g. Claude Opus 5.x) require it to be sent back with
       * the tool results; without it the next step fails and the gateway
       * silently answers with the fallback model instead.
       */
      reasoning_details?: unknown[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

export type GatewayTool = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type Usage = { inputTokens: number; outputTokens: number };

export class GatewayError extends Error {
  constructor(message: string, readonly status: number, readonly retryable: boolean) {
    super(message);
  }
}

/**
 * Plain-English explanation for staff. Billing and access problems are not
 * "try again later" problems — they need someone to act in Vercel.
 */
export function explainGatewayError(err: unknown): string {
  if (!(err instanceof GatewayError)) return "Couldn't reach the AI service. Try again in a moment.";
  const m = err.message.toLowerCase();
  if (err.status === 401) {
    return "The AI Gateway key was rejected. Check AI_GATEWAY_API_KEY in Vercel → Settings → Environment Variables (it may have been deleted or belong to someone who left the team), then redeploy.";
  }
  if (err.status === 402 || /credit|free tier|top.?up|billing|payment|quota|budget/.test(m)) {
    return "AI Gateway needs paid credits for this model. Add credits in Vercel → AI Gateway (Top up), then try again — no redeploy needed.";
  }
  if (err.status === 403) return "AI Gateway refused access to this model for this account. Try another model in the Assistant tab, or check the AI Gateway settings in Vercel.";
  if (err.status === 404 || (err.status === 400 && /model/.test(m))) {
    return "That model isn't available on AI Gateway. Pick another one in the Assistant tab.";
  }
  if (err.status === 429) return "AI Gateway is rate-limiting requests right now. Try again in a minute.";
  if (err.status === 504) return "The AI service took too long to answer. Try again in a moment.";
  return "The AI service had a problem. Try again in a moment.";
}

/**
 * The credential to use. An explicit API key wins; on Vercel the project's
 * OIDC token also works (arrives as a request header at runtime).
 */
export function gatewayCredential(req?: Request): string | null {
  const key = process.env.AI_GATEWAY_API_KEY?.trim();
  if (key) return key;
  const header = req?.headers.get("x-vercel-oidc-token")?.trim();
  if (header) return header;
  const env = process.env.VERCEL_OIDC_TOKEN?.trim();
  return env || null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Models that only accept tool_choice "auto" (the gateway rejects "none").
 * Learned the first time a model refuses, so later calls go straight to
 * "auto" — the model can then still write its answer, it just isn't forced to.
 */
const AUTO_ONLY: Set<string> = ((globalThis as unknown as { __fpAutoOnly?: Set<string> }).__fpAutoOnly ??= new Set<string>());

/**
 * Which of the models WE asked for actually answered. The gateway sometimes
 * reports a variant name — e.g. "openai/gpt-6-luna" for a request to
 * "openai/gpt-6-luna-fast", or the id without the provider prefix — so
 * compare loosely. Anything that isn't clearly the backup is counted as the
 * main model, so usage, cost (which is priced from this id) and the "Main"
 * tag all line up with what was selected.
 */
export function resolveAnsweringModel(returned: string | undefined, main: string, fallback?: string): string {
  if (!returned) return main;
  const base = (id: string) => id.toLowerCase().split("/").pop() || "";
  const same = (a: string, b: string) => base(a) === base(b);
  if (same(returned, main)) return main;
  if (fallback && same(returned, fallback)) return fallback;
  const r = base(returned);
  const related = (id: string) => base(id).startsWith(`${r}-`) || r.startsWith(`${base(id)}-`);
  if (related(main)) return main;
  if (fallback && related(fallback)) return fallback;
  return main;
}

export async function chatCompletion(opts: {
  credential: string;
  model: string;
  fallbackModel?: string;
  messages: GatewayMessage[];
  tools?: GatewayTool[];
  toolChoice?: "auto" | "none";
  maxTokens: number;
  temperature?: number;
  timeoutMs?: number;
}): Promise<{
  message: { content: string | null; tool_calls?: GatewayToolCall[]; reasoning_details?: unknown[] };
  usage: Usage;
  model: string;
}> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    max_tokens: opts.maxTokens,
    stream: false,
  };
  // Only sent when asked for: several reasoning models reject the parameter
  // outright, and the admin can pick any model from the gateway.
  if (typeof opts.temperature === "number") body.temperature = opts.temperature;
  if (opts.fallbackModel && opts.fallbackModel !== opts.model) body.models = [opts.fallbackModel];
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools;
    body.tool_choice = opts.toolChoice ?? "auto";
    if (body.tool_choice !== "auto" && AUTO_ONLY.has(opts.model)) body.tool_choice = "auto";
  }

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.credential}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
        cache: "no-store",
      });
      const text = await res.text();
      if (!res.ok) {
        let msg = `Gateway HTTP ${res.status}`;
        try {
          const j = JSON.parse(text);
          if (j?.error?.message) msg = `${msg}: ${j.error.message}`;
        } catch {
          /* non-JSON error body */
        }
        // Some models only support tool_choice "auto": remember that and
        // resend straight away with "auto" (doesn't use up the retry).
        if (res.status === 400 && /tool_choice/i.test(msg) && body.tool_choice && body.tool_choice !== "auto") {
          AUTO_ONLY.add(opts.model);
          body.tool_choice = "auto";
          attempt -= 1;
          continue;
        }
        const retryable = res.status === 429 || res.status >= 500;
        throw new GatewayError(msg, res.status, retryable);
      }
      const json = JSON.parse(text);
      const choice = json?.choices?.[0];
      if (!choice?.message) throw new GatewayError("Gateway returned no message", 502, true);
      return {
        message: {
          content: typeof choice.message.content === "string" ? choice.message.content : null,
          tool_calls: Array.isArray(choice.message.tool_calls) ? choice.message.tool_calls : undefined,
          reasoning_details:
            Array.isArray(choice.message.reasoning_details) && choice.message.reasoning_details.length > 0
              ? choice.message.reasoning_details
              : undefined,
        },
        usage: {
          inputTokens: Number(json?.usage?.prompt_tokens) || 0,
          outputTokens: Number(json?.usage?.completion_tokens) || 0,
        },
        model: typeof json?.model === "string" ? json.model : opts.model,
      };
    } catch (err) {
      lastErr = err;
      const retryable =
        err instanceof GatewayError ? err.retryable : true; // network error / timeout
      if (!retryable || attempt === 2) break;
      await sleep(700);
    } finally {
      clearTimeout(timer);
    }
  }
  if (lastErr instanceof GatewayError) throw lastErr;
  const aborted = lastErr instanceof Error && lastErr.name === "AbortError";
  throw new GatewayError(aborted ? "Gateway timed out" : `Gateway unreachable: ${String(lastErr)}`, 504, true);
}

// ------------------------------------------------------------------ models

export type ModelInfo = {
  id: string;
  name: string;
  provider: string;
  /** US dollars per million tokens, or null when the gateway doesn't say. */
  inputPerM: number | null;
  outputPerM: number | null;
  contextWindow: number | null;
  toolUse: boolean | null;
  /** Release date (epoch seconds) when the gateway says. */
  released?: number | null;
  /**
   * Whether every provider serving it promises not to train on your prompts:
   * "all" = yes; "some" = depends which provider answers; "none" = no promise.
   */
  noTraining?: "all" | "some" | "none" | null;
  /** Zero data retention, same scale as noTraining. */
  zdr?: "all" | "some" | "none" | null;
};

const scale = (v: unknown): "all" | "some" | "none" | null => (v === "all" || v === "some" || v === "none" ? v : null);

const MC = singleton("models", () => ({ cache: null as { at: number; list: ModelInfo[] } | null }));
const MODEL_TTL = 30 * 60_000;

function perMillion(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? Math.round(n * 1_000_000 * 10000) / 10000 : null;
}

/** The gateway's model catalogue (public endpoint), cached for 30 minutes. */
export async function listModels(credential?: string | null): Promise<ModelInfo[]> {
  if (MC.cache && Date.now() - MC.cache.at < MODEL_TTL) return MC.cache.list;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(`${BASE}/models`, {
      headers: credential ? { Authorization: `Bearer ${credential}` } : {},
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`models HTTP ${res.status}`);
    const json = await res.json();
    const raw: Array<Record<string, unknown>> = Array.isArray(json?.data) ? json.data : [];
    const list: ModelInfo[] = raw
      .filter((m) => typeof m.id === "string")
      .filter((m) => {
        const type = typeof m.type === "string" ? m.type : "";
        if (type && type !== "language") return false;
        return !/embed|image|tts|whisper|dall-e|veo|rerank|moderation/i.test(String(m.id));
      })
      .map((m) => {
        const pricing = (m.pricing || {}) as Record<string, unknown>;
        const tags = Array.isArray(m.tags) ? (m.tags as unknown[]).map(String) : null;
        return {
          id: String(m.id),
          name: typeof m.name === "string" ? m.name : String(m.id),
          provider: String(m.owned_by || String(m.id).split("/")[0]),
          inputPerM: perMillion(pricing.input),
          outputPerM: perMillion(pricing.output),
          contextWindow: typeof m.context_window === "number" ? m.context_window : null,
          toolUse: tags ? tags.includes("tool-use") : null,
          released: typeof m.released === "number" ? m.released : null,
          noTraining: scale(m.no_training),
          zdr: scale(m.zdr),
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
    // Never cache an empty answer — it would make every cost estimate fall
    // back to worst-case prices for half an hour.
    if (list.length > 0) MC.cache = { at: Date.now(), list };
    return list.length > 0 ? list : MC.cache?.list ?? [];
  } catch (err) {
    console.error("[assistant] model list fetch failed", err);
    return MC.cache?.list ?? [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cost of a call in US dollars from the gateway's published per-token prices.
 * Unknown pricing falls back to a conservative estimate rather than zero, so
 * the monthly ceiling can't be silently bypassed by an unpriced model.
 */
export async function costOf(model: string, usage: Usage): Promise<number> {
  const models = await listModels();
  const m = models.find((x) => x.id === model);
  const inP = m?.inputPerM ?? 3; // conservative fallback: $3 / $15 per M
  const outP = m?.outputPerM ?? 15;
  return (usage.inputTokens * inP + usage.outputTokens * outP) / 1_000_000;
}
