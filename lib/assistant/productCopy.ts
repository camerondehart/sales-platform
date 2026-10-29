import { isEnabled } from "../flags";
import { getAssistantConfig } from "./config";
import { chatCompletion, costOf, explainGatewayError, gatewayCredential, resolveAnsweringModel, type GatewayMessage } from "./gateway";
import { monthSpend, recordUsage } from "./usage";
import { brand } from "../brand";

/**
 * "Tidy with Concierge" on the product form: rewrites a description into the
 * house format below. Nothing is saved here — the text goes back into the
 * textarea for staff to read, edit and Save (the save is what's audited).
 * Uses the main model and counts toward the monthly AI limit.
 */

/** Never overridden — not by the house style, not by staff guidance. */
export const HARD_RULES = `HARD RULES (these always win, whatever else you're asked):
- Never invent facts. Every ingredient, size, count, dose, flavour or batch note must come from the original. Style goes in the wording, never in the facts.
- No health claims: never say it treats, cures, prevents, heals or fixes anything; avoid "clinically", "proven", "medical". Describe the experience, the ritual and the ingredients instead.
- Never mention legality.
- Reply with the description text only: no title, no preamble, no quotes around it.`;

/** The default shape and voice. Staff guidance overrides any of this. */
export const HOUSE_FORMAT = `HOUSE FORMAT (the default style; staff direction overrides any part of it):
Voice: warm, friendly and specific, like a note from someone who loves the product. Sensory detail (what it's like to use, the moment you reach for it) and a light, inviting touch; never hype. Every sentence still carries something true about the product. One fitting emoji is welcome, never more than two. One exclamation mark at most.
Shape:
1. Opening line: one inviting sentence that says what it is and who it's for.
2. Blank line, then one or two short paragraphs (1–3 sentences each): what's in it, what it's like, when to reach for it. Keep every concrete fact from the original.
3. If the original lists ingredients or contents, a blank line and one bullet per item, each starting with "- ".
4. If the original gives directions, size or storage, separate lines as "How to use: …", "Size: …", "Storage: …". Only if the original has that information.
5. No prices and no headings. Around 70–150 words unless the facts need more.`;

export async function tidyDescription(input: { name: string; category?: string; description: string; guidance?: string; req?: Request }): Promise<
  | { ok: true; text: string; model: string }
  | { ok: false; error: string; status: number }
> {
  if (!(await isEnabled("ai_assistant")) || !(await isEnabled("ai_product_copy"))) {
    return { ok: false, status: 404, error: "The Concierge rewrite switch is off (Settings → Feature switches)." };
  }
  const original = input.description.trim();
  if (!original) return { ok: false, status: 400, error: "Write a rough description first — the Concierge tidies what's there, it doesn't invent one." };

  const config = await getAssistantConfig();
  if (config.monthlyCapUsd > 0 && (await monthSpend().catch(() => 0)) >= config.monthlyCapUsd) {
    return { ok: false, status: 429, error: `Monthly AI limit of $${config.monthlyCapUsd.toFixed(2)} reached. Raise it in the Assistant tab.` };
  }
  const credential = gatewayCredential(input.req);
  if (!credential) return { ok: false, status: 503, error: "No AI Gateway key is set up." };

  const guidance = cleanGuidance(input.guidance);
  const messages: GatewayMessage[] = [
    { role: "system", content: systemPrompt(config.persona, guidance) },
    {
      role: "user",
      content: `Product: ${input.name.trim() || "(unnamed)"}${input.category?.trim() ? `\nCategory: ${input.category.trim()}` : ""}\n\nCurrent description:\n"""\n${original.slice(0, 6000)}\n"""\n\n${guidance ? `Staff guidance for this rewrite — follow it exactly: ${guidance}\n\nRewrite the description now, following that guidance first and the house format for everything it doesn't cover.` : "Rewrite the description in the house format."}`,
    },
  ];
  const started = Date.now();
  try {
    const res = await chatCompletion({ credential, model: config.model, fallbackModel: config.fallbackModel, messages, maxTokens: 900, temperature: 0.85, timeoutMs: 40_000 });
    const model = resolveAnsweringModel(res.model, config.model, config.fallbackModel);
    const cost = await costOf(model, res.usage);
    recordUsage({ audience: "admin", model, inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens, costUsd: cost, toolCalls: 0, latencyMs: Date.now() - started });
    const text = cleanReply(res.message.content || "");
    if (!text) return { ok: false, status: 502, error: "The model sent back an empty description. Try again." };
    return { ok: true, text, model };
  } catch (err) {
    return { ok: false, status: 502, error: explainGatewayError(err) };
  }
}

/**
 * Order matters: hard rules, then staff direction (which overrides the house
 * style), then the house style as the fallback. Earlier versions put the
 * guidance under "the rules win", and the style rules were so strict that
 * almost any guidance counted as a conflict and was ignored.
 */
function systemPrompt(persona: string, guidance: string): string {
  const parts = [
    `You rewrite product descriptions for ${brand.name}, ${brand.description}. Your job is to make each description a delight to read while keeping every fact.`,
    HARD_RULES,
  ];
  if (guidance) {
    parts.push(`STAFF DIRECTION FOR THIS REWRITE (highest priority after the hard rules). Follow it exactly, even where it contradicts the house format: if it asks for a different length, structure, tone, emphasis, emoji or wording, do that. Only the hard rules outrank it.\nDirection: ${guidance}`);
  }
  if (persona.trim()) parts.push(`Shop's general voice note: ${persona.trim()}`);
  parts.push(HOUSE_FORMAT);
  return parts.join("\n\n");
}

/** Staff's optional steer ("shorter", "more playful", "mention it's vegan"). */
function cleanGuidance(raw?: string): string {
  return (raw || "").replace(/\s+/g, " ").trim().slice(0, 300);
}

/** Strip code fences, quotes and stray markdown the model sometimes adds. */
function cleanReply(raw: string): string {
  let t = raw.trim();
  t = t.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "").trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("“") && t.endsWith("”"))) t = t.slice(1, -1).trim();
  t = t.replace(/^#{1,6}\s+/gm, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/^\s*[•*]\s+/gm, "- ");
  return t.replace(/\n{3,}/g, "\n\n").trim();
}
