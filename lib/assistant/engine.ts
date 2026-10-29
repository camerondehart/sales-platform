import { getVisitor, isAdmin } from "../auth";
import type { User } from "../users";
import { getAssistantConfig, updateAssistantConfig, type AssistantConfig } from "./config";
import { chatCompletion, costOf, explainGatewayError, gatewayCredential, GatewayError, type GatewayMessage, resolveAnsweringModel } from "./gateway";
import { buildSystemPrompt, cachedUsers, OFF_LIMITS } from "./knowledge";
import { clientIp, overLimit, MESSAGE_LIMITS } from "./limits";
import { flushUsage, monthKey, monthSpend, recordUsage } from "./usage";
import { runTool, staffInbox, toolsFor, type ToolContext } from "./tools";
import { todayItemInfo } from "./adminActions";
import type { Audience, ChatMessage, ChatReply, WidgetMode } from "./shared";
import { SUPPORT_EMAIL } from "./shared";
import { getFlags, isEnabled } from "../flags";
import { productCardsFor } from "./productCards";
import { brand } from "../brand";

const MAX_STEPS = 6;
const MAX_HISTORY = 16;
const MAX_USER_CHARS = 2000;
const MAX_ANY_CHARS = 4000;

/** Who is asking, decided from cookies only — never from the request body. */
export async function resolveAudience(mode: WidgetMode): Promise<{ audience: Audience; user: User | null } | null> {
  if (mode === "admin") return (await isAdmin()) ? { audience: "admin", user: null } : null;
  const v = await getVisitor(); // JWT check only, no storage read
  if (v) {
    // Cached member list: avoids a Blob read on every message.
    const u = (await cachedUsers()).find((x) => x.id === v.userId);
    if (u && u.status === "approved") return { audience: "member", user: u };
  }
  return { audience: "public", user: null };
}

export function enabledFor(config: AssistantConfig, audience: Audience): boolean {
  return audience === "admin" ? config.enabledStaff : audience === "member" ? config.enabledMembers : config.enabledPublic;
}

/** Clean untrusted history from the browser. */
export function sanitizeHistory(input: unknown): ChatMessage[] | null {
  if (!Array.isArray(input)) return null;
  const msgs: ChatMessage[] = input
    .filter((m): m is { role: string; content: string } => !!m && typeof m === "object" && typeof (m as any).content === "string")
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as ChatMessage["role"], content: m.content.trim().slice(0, MAX_ANY_CHARS) }))
    .filter((m) => m.content.length > 0)
    .slice(-MAX_HISTORY);
  // Must start with a user turn and end with one.
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  if (msgs.length === 0 || msgs[msgs.length - 1].role !== "user") return null;
  const last = msgs[msgs.length - 1];
  if (last.content.length > MAX_USER_CHARS) last.content = last.content.slice(0, MAX_USER_CHARS);
  return msgs;
}

/**
 * Topics the customer-facing assistant never names. Enforced on the final
 * reply, after the model, so it holds even if a prompt or a product
 * description pulls the model off course. Staff chat is not filtered.
 * (a word containing "shroom" never matches: \bshroom needs a word boundary.)
 */
const REDIRECT_REPLY =
  `Great question — that's one our team answers personally. Email [${SUPPORT_EMAIL}](mailto:${SUPPORT_EMAIL}) and they'll get back to you, usually within a business day. If you'd like, I can pass your question along for you — just share your name and email. Anything else I can help with in the meantime?`;

export function guardReply(text: string, audience: Audience): string {
  // The "[Shown with this reply — recorded by the site: …]" notes are written by
  // the staff widget, never by the model; drop any the model imitates.
  if (audience === "admin") return text.replace(/\n*\[Shown with this reply — recorded by the site:[\s\S]*?\]\s*$/g, "").trim() || text;
  if (!OFF_LIMITS.test(text)) return text;
  console.warn(`[assistant] off-limits term in a ${audience} reply; replaced with redirect`);
  return REDIRECT_REPLY;
}

const OFFLINE_REPLY = `I'm offline at the moment. For anything urgent, email [${SUPPORT_EMAIL}](mailto:${SUPPORT_EMAIL}) and the team will get back to you.`;

export async function capReached(config: AssistantConfig): Promise<boolean> {
  if (!config.monthlyCapUsd || config.monthlyCapUsd <= 0) return false;
  try {
    return (await monthSpend()) >= config.monthlyCapUsd;
  } catch (err) {
    console.error("[assistant] spend check failed; allowing", err);
    return false;
  }
}

/** Email staff once per month when the ceiling is hit. Never throws. */
async function alertCapOnce(config: AssistantConfig): Promise<void> {
  const month = monthKey();
  if (config.capAlertMonth === month) return;
  try {
    await updateAssistantConfig({ capAlertMonth: month });
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return;
    const { Resend } = await import("resend");
    await new Resend(apiKey).emails.send({
      from: process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev",
      to: staffInbox(config),
      subject: "Site assistant paused — monthly limit reached",
      html: `<p>The website assistant has reached its monthly limit of $${config.monthlyCapUsd.toFixed(2)} and is now offline for customers until the 1st.</p><p>To turn it back on sooner, raise the limit in the admin dashboard → Assistant tab.</p>`,
    });
  } catch (err) {
    console.error("[assistant] cap alert failed", err);
  }
}

export async function assistantStatus(req: Request) {
  const [config, master, voiceOn, photosOn] = await Promise.all([getAssistantConfig(), isEnabled("ai_assistant"), isEnabled("voice_concierge").catch(() => false), isEnabled("concierge_photos").catch(() => false)]);
  const hasKey = !!gatewayCredential(req);
  const capped = hasKey ? await capReached(config) : false;
  const ok = master && hasKey && !capped;
  let staffNote: string | undefined;
  if (!master) staffNote = "The assistant is switched off (Settings → Feature switches → AI assistant).";
  else if (!hasKey) staffNote = "No AI Gateway key is set. Add AI_GATEWAY_API_KEY in Vercel → Settings → Environment Variables, then redeploy.";
  else if (capped) staffNote = `Monthly limit of $${config.monthlyCapUsd.toFixed(2)} reached. Raise it in the Assistant tab.`;
  else if (!config.enabledStaff) staffNote = "The staff assistant is switched off in the Assistant tab.";
  return {
    available: {
      public: ok && config.enabledPublic,
      member: ok && config.enabledMembers,
      admin: ok && config.enabledStaff,
    },
    name: config.assistantName,
    voice: ok && voiceOn,
    photos: ok && photosOn,
    staffNote,
  };
}

/**
 * After a tool runs: drop any card identical to one already prepared in this
 * reply (models sometimes call the same tool twice, and two identical "Create
 * code" cards invite a double click), and tell the model exactly what the
 * person now sees, so it describes the cards accurately instead of guessing.
 */
function settleCards(actions: ToolContext["actions"], before: number, result: unknown): unknown {
  if (actions.length <= before) return result;
  const sig = (a: (typeof actions)[number]) => `${a.kind}|${a.title}|${(a.lines || []).join("|")}`;
  const seen = new Set(actions.slice(0, before).map(sig));
  const added = actions.splice(before);
  const kept: typeof actions = [];
  let dropped = 0;
  for (const a of added) {
    const k = sig(a);
    if (seen.has(k)) dropped++;
    else {
      seen.add(k);
      kept.push(a);
    }
  }
  actions.push(...kept);
  if (typeof result !== "object" || result === null || Array.isArray(result)) return result;
  return {
    ...(result as Record<string, unknown>),
    ...(kept.length ? { card_shown: kept.map((a) => ({ title: a.title, details: a.lines })) } : {}),
    ...(dropped
      ? { already_prepared: "An identical card is already showing above, so no second one was added. Don't prepare it again and don't apologise — just refer to the card above." }
      : {}),
  };
}

/** A photo sent with the latest message: a data URL, JPEG/PNG/WebP, already shrunk by the widget. */
const PHOTO_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const PHOTO_MAX_CHARS = 1_600_000; // ~1.2 MB image
export function cleanPhoto(input: unknown): string | null | "bad" {
  if (input === undefined || input === null || input === "") return null;
  if (typeof input !== "string" || input.length > PHOTO_MAX_CHARS || !PHOTO_URL.test(input)) return "bad";
  return input;
}

/** Added to the system prompt for a turn with a photo (kept apart from the SAFETY text). */
const PHOTO_GUIDE = (audience: Audience) =>
  `PHOTO: The latest message includes a photo the ${audience === "admin" ? "staff member" : "customer"} just took or picked. Look at it and answer about what's actually in it. ` +
  `If it shows a product, label, bottle or packaging, say what it is and use your product tools to find the matching ${brand.shortName} product before recommending anything. ` +
  `Never identify pills, powders, mushrooms, plants or other unknown substances from a photo, and never say whether something is safe to take, eat or combine: say you can't tell from a picture and point them to a pharmacist, doctor or the team. ` +
  `Don't read out or repeat personal details that appear in a photo (names, addresses, card or ID numbers). If the photo is unclear, say what you can see and ask for a closer or brighter one. ` +
  (audience === "admin" ? "Staff may send photos of products, shelves, invoices or packing slips: describe them, pull out what's useful (names, counts, prices) and offer the usual confirm cards for any change — nothing changes from a photo alone. If they want the photo in an email campaign, call prepare_campaign_draft with use_photo true (put [[PHOTO]] on its own line where it goes); it's added when they open the draft in the composer." : "");

/** Marker the Concierge adds when a spoken conversation is over (stripped by the chat route). */
export const END_MARK = "[[end]]";
const CONVERSATION_GUIDE =
  `CONVERSATION MODE: this person is talking to you out loud and hears your reply read aloud, then the mic listens again. ` +
  `Talk exactly as you do in text — same personality, phrases and style — just shorter: about half your usual length, often a sentence or two. ` +
  `When they're clearly finished (they say thanks and that they're good, goodbye, that's all, or similar), reply with one short, warm goodbye and put ${END_MARK} at the very end — that switches their mic off. Never add ${END_MARK} otherwise, and never when they asked another question.`;

export async function handleChat(req: Request, body: { mode?: unknown; messages?: unknown; photo?: unknown; conversation?: unknown }): Promise<{ status: number; reply: ChatReply; model?: string }> {
  const mode: WidgetMode = body.mode === "admin" ? "admin" : "site";
  const who = await resolveAudience(mode);
  if (!who) return { status: 401, reply: { reply: "Please sign in to the dashboard again.", offline: true } };
  const { audience, user } = who;

  const history = sanitizeHistory(body.messages);
  if (!history) return { status: 400, reply: { reply: "I didn't catch a question there.", degraded: true } };
  const photo = cleanPhoto((body as { photo?: unknown }).photo);
  if (photo === "bad") return { status: 400, reply: { reply: "I couldn't open that photo. Try a JPEG or PNG, or a smaller picture.", degraded: true } };

  const ip = clientIp(req);
  const [perBurst, perDay] = MESSAGE_LIMITS[audience];
  const rateKey = audience === "member" && user ? `u:${user.id}` : `ip:${ip}`;
  if (overLimit(`msg5:${audience}:${rateKey}`, perBurst, 5 * 60_000) || overLimit(`msgD:${audience}:${rateKey}`, perDay, 86_400_000)) {
    return { status: 429, reply: { reply: "That's a lot of questions in a short time — give me a few minutes and try again.", degraded: true } };
  }

  const [config, flags] = await Promise.all([getAssistantConfig(), getFlags()]);
  // Master kill switch (Settings → Feature switches) — takes effect within seconds, no deploy.
  if (!flags.ai_assistant || !enabledFor(config, audience)) return { status: 200, reply: { reply: OFFLINE_REPLY, offline: true } };

  const credential = gatewayCredential(req);
  if (!credential) {
    console.error("[assistant] no AI_GATEWAY_API_KEY / OIDC token configured");
    return { status: 200, reply: { reply: OFFLINE_REPLY, offline: true } };
  }
  if (await capReached(config)) {
    void alertCapOnce(config);
    return { status: 200, reply: { reply: OFFLINE_REPLY, offline: true } };
  }

  if (photo) {
    if (!flags.concierge_photos) return { status: 400, reply: { reply: "Photos aren't switched on right now — please describe it in words.", degraded: true } };
    const photoKey = audience === "member" && user ? `u:${user.id}` : `ip:${ip}`;
    if (overLimit(`photo:${audience}:${photoKey}`, audience === "admin" ? 60 : 12, 60 * 60_000)) {
      return { status: 429, reply: { reply: "That's a lot of photos in a short time — give me a little while and try again, or describe it in words.", degraded: true } };
    }
  }
  const allowActions = audience !== "admin" || flags.ai_admin_actions;
  const ctx: ToolContext = { audience, user, ip, config, transcript: history, actions: [], draft: null, allowActions };
  const tools = toolsFor(audience, { actions: allowActions });
  const system = await buildSystemPrompt({ audience, config, user });
  const messages: GatewayMessage[] = [
    { role: "system", content: [system, photo ? PHOTO_GUIDE(audience) : "", body.conversation === true ? CONVERSATION_GUIDE : ""].filter(Boolean).join("\n\n") },
    ...history.map((m, i) =>
      // The photo goes with the latest message only; earlier turns keep their "[Photo]" text.
      (photo && i === history.length - 1
        ? { role: "user", content: [{ type: "text", text: m.content }, { type: "image_url", image_url: { url: photo } }] }
        : { role: m.role, content: m.content }) as GatewayMessage
    ),
  ];
  // A Today-list button: look the item up now and hand it over, so the model
  // goes straight to preparing the cards instead of searching for people.
  const lastAsk = history[history.length - 1];
  const todayKey = audience === "admin" && lastAsk?.role === "user" ? /^Today item ([^\s:]+):/.exec(lastAsk.content)?.[1] : undefined;
  if (todayKey) {
    try {
      const item = await todayItemInfo(todayKey, config.monthlyCapUsd);
      // Added to the one system message (some providers reject a second one mid-chat).
      messages[0] = { role: "system", content: `${system}\n\nTODAY ITEM ${todayKey} — the staff just pressed this Today-list button; it's already looked up, so don't call today_item:\n${JSON.stringify(item).slice(0, 8000)}` };
    } catch (err) {
      console.error("[assistant] today item lookup failed", err);
    }
  }
  // A ceiling, not a target: replies are kept short by the prompt. Reasoning
  // models spend part of this on thinking, so a tight cap can cut them off.
  const maxTokens = audience === "admin" ? 4000 : 2000;

  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let toolCalls = 0;
  let latencyMs = 0;
  let modelUsed = config.model;
  let finalText = "";

  try {
    for (let step = 1; step <= MAX_STEPS; step++) {
      const lastStep = step === MAX_STEPS;
      const callStarted = Date.now();
      const res = await chatCompletion({
        credential,
        model: config.model,
        fallbackModel: config.fallbackModel,
        messages,
        tools,
        // On the last step, force a written answer so we never end mid-loop.
        toolChoice: lastStep ? "none" : "auto",
        maxTokens,
        timeoutMs: 30_000,
      });
      latencyMs += Date.now() - callStarted;
      modelUsed = resolveAnsweringModel(res.model, config.model, config.fallbackModel);
      if (modelUsed !== config.model) {
        console.warn(`[assistant] ${config.model} didn't answer; the gateway used ${res.model} (step ${step})`);
      }
      inputTokens += res.usage.inputTokens;
      outputTokens += res.usage.outputTokens;
      costUsd += await costOf(modelUsed, res.usage);

      const calls = res.message.tool_calls || [];
      if (calls.length === 0 || lastStep) {
        finalText = (res.message.content || "").trim();
        break;
      }
      // Keep the model's reasoning with its tool calls — reasoning models
      // reject the next step without it (see GatewayMessage).
      messages.push({
        role: "assistant",
        content: res.message.content ?? null,
        tool_calls: calls,
        ...(res.message.reasoning_details ? { reasoning_details: res.message.reasoning_details } : {}),
      });
      for (const call of calls.slice(0, 6)) {
        toolCalls += 1;
        let result: unknown;
        const cardsBefore = ctx.actions.length;
        try {
          result = await runTool(call.function?.name || "", call.function?.arguments || "", ctx);
        } catch (err) {
          console.error(`[assistant] tool ${call.function?.name} failed`, err);
          result = { error: "That lookup failed. Tell the user briefly and offer another way to help." };
        }
        result = settleCards(ctx.actions, cardsBefore, result);
        const content = typeof result === "string" ? result : JSON.stringify(result);
        messages.push({ role: "tool", tool_call_id: call.id, content: content.slice(0, 12_000) });
      }
      // Any calls beyond 6 still need a tool response or the API rejects the turn.
      for (const call of calls.slice(6)) {
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: "Too many tool calls at once." }) });
      }
    }

    if (!finalText) {
      finalText = ctx.actions.length || ctx.draft ? "Here you go — take a look below." : ctx.productIds?.length ? "Here are a few I'd suggest:" : "Sorry, I couldn't put an answer together. Could you rephrase that?";
    }
    recordUsage({ audience, model: modelUsed, inputTokens, outputTokens, costUsd, toolCalls, latencyMs });
    await flushUsage();
    const safe = guardReply(finalText, audience);
    // No product cards on a redirected (off-limits) answer.
    const products = safe === finalText ? await productCardsFor(audience, ctx.productIds, finalText).catch(() => []) : [];
    return {
      status: 200,
      // Which model answered — kept in the staff-only transcript, never sent to the customer.
      model: modelUsed,
      reply: {
        reply: safe,
        products: products.length ? products : undefined,
        actions: ctx.actions.length ? ctx.actions : undefined,
        draft: ctx.draft ? { ...ctx.draft, ...(todayKey ? { todayKey } : {}) } : undefined,
        todayKey: todayKey && (ctx.actions.length || ctx.draft) ? todayKey : undefined,
      },
    };
  } catch (err) {
    const detail = err instanceof GatewayError ? `${err.status} ${err.message}` : String(err);
    console.error(`[assistant] chat failed (${audience}): ${detail}`);
    recordUsage({ audience, model: modelUsed, inputTokens, outputTokens, costUsd, toolCalls, error: true, latencyMs });
    await flushUsage();
    // Proposals already prepared are still valid and useful — return them.
    const hadWork = ctx.actions.length > 0 || !!ctx.draft;
    return {
      status: 200,
      model: `${modelUsed} (failed)`,
      reply: {
        reply: hadWork
          ? "I hit a hiccup finishing my reply, but here's what I prepared:"
          : audience === "admin"
            ? explainGatewayError(err)
            : `Sorry — I'm having trouble connecting right now. Please try again in a moment, or email [${SUPPORT_EMAIL}](mailto:${SUPPORT_EMAIL}).`,
        actions: ctx.actions.length ? ctx.actions : undefined,
        draft: ctx.draft ? { ...ctx.draft, ...(todayKey ? { todayKey } : {}) } : undefined,
        todayKey: todayKey && (ctx.actions.length || ctx.draft) ? todayKey : undefined,
        degraded: true,
      },
    };
  }
}
