import { isEnabled } from "../flags";
import { getAssistantConfig } from "./config";
import { chatCompletion, costOf, explainGatewayError, gatewayCredential, resolveAnsweringModel, type GatewayMessage } from "./gateway";
import { monthSpend, recordUsage } from "./usage";

/**
 * "Tidy with Concierge" on the product form: rewrites a description into the
 * house format below. Nothing is saved here — the text goes back into the
 * textarea for staff to read, edit and Save (the save is what's audited).
 * Uses the main model and counts toward the monthly AI limit.
 */

export const HOUSE_FORMAT = `HOUSE FORMAT for a product description (plain text, no markdown headings, no emoji):
1. First line: one short, warm sentence that says what the product is and who it's for (max 22 words). This is the lede.
2. Blank line, then one or two short paragraphs (1–3 sentences each): what it is, what it's made with, what it's like to use. Keep every concrete fact from the original — ingredients, sizes, counts, dosages, flavours, batch notes.
3. If the original lists ingredients or contents, add a blank line and bullet them, one per line starting with "- ".
4. If the original gives directions, size or storage, add them as separate lines in the form "How to use: …", "Size: …", "Storage: …" (label, colon, value). Only these labels, only if the original has that information.
5. Nothing else: no closing slogan, no call to action, no prices, no headings.

RULES:
- Never invent facts. If something isn't in the original, leave it out.
- No health claims: never say it treats, cures, prevents, heals or fixes anything; avoid "clinically", "proven", "medical". Describe the experience and the ingredients instead.
- Never mention legality.
- Plain, friendly, specific. No hype words (revolutionary, ultimate, game-changing), no exclamation marks.
- Aim for 60–140 words unless the original carries more facts than fit.
- Reply with the description text only.`;

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

  const messages: GatewayMessage[] = [
    { role: "system", content: `You tidy product descriptions for a small shop's website. ${config.persona.trim() ? `Voice: ${config.persona.trim()}` : ""}\n\n${HOUSE_FORMAT}` },
    {
      role: "user",
      content: `Product: ${input.name.trim() || "(unnamed)"}${input.category?.trim() ? `\nCategory: ${input.category.trim()}` : ""}\n\nCurrent description:\n"""\n${original.slice(0, 6000)}\n"""\n\n${guidanceLine(input.guidance)}Rewrite it in the house format.`,
    },
  ];
  const started = Date.now();
  try {
    const res = await chatCompletion({ credential, model: config.model, fallbackModel: config.fallbackModel, messages, maxTokens: 900, temperature: 0.4, timeoutMs: 40_000 });
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
 * Staff's optional steer ("shorter", "mention it's vegan"). It shapes tone and
 * emphasis only: the house format and the rules above still win, so it can't
 * add facts, health claims or legality talk.
 */
function guidanceLine(raw?: string): string {
  const g = (raw || "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!g) return "";
  return `Staff guidance for this rewrite (follow it where it fits the house format and rules; the rules win if they conflict, and it never adds facts that aren't in the description): ${g}\n\n`;
}

/** Strip code fences, quotes and stray markdown the model sometimes adds. */
function cleanReply(raw: string): string {
  let t = raw.trim();
  t = t.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "").trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("“") && t.endsWith("”"))) t = t.slice(1, -1).trim();
  t = t.replace(/^#{1,6}\s+/gm, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/^\s*[•*]\s+/gm, "- ");
  return t.replace(/\n{3,}/g, "\n\n").trim();
}
