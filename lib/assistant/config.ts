import path from "path";
import { VersionedStore } from "../versionedStore";
import { singleton } from "./singleton";
import { brand } from "@/lib/brand";

/**
 * Assistant settings, edited from the admin's Assistant tab.
 *
 * Stored as a one-record versioned list so edits are never lost to a stale
 * read. Reads are cached in memory for a minute: the chat endpoint consults
 * the config on every message, and a Blob read per message would burn
 * through the plan's operation allowance (on Hobby, exceeding it locks the
 * whole Blob store — the entire site — for 30 days).
 */

export type AssistantConfig = {
  id: "config";
  enabledPublic: boolean;
  enabledMembers: boolean;
  enabledStaff: boolean;
  /** AI Gateway model id, e.g. "anthropic/claude-haiku-4.5". */
  model: string;
  /** Tried automatically by the gateway if the main model fails. "" = none. */
  fallbackModel: string;
  /** Monthly ceiling in US dollars. 0 = no ceiling. */
  monthlyCapUsd: number;
  assistantName: string;
  /** Tone and personality notes. */
  persona: string;
  /** Product knowledge, policies, FAQs — the assistant's training notes. */
  knowledge: string;
  /** Where escalations go. Blank = the site's INQUIRY_TO_EMAIL. */
  escalationEmail: string;
  /** Month ("2026-09") we last emailed staff that the cap was reached. */
  capAlertMonth?: string;
  updatedAt: number;
};

export const DEFAULT_MODEL = "anthropic/claude-haiku-4.5";
export const DEFAULT_FALLBACK = "anthropic/claude-sonnet-4.6";

export const DEFAULT_CONFIG: AssistantConfig = {
  id: "config",
  enabledPublic: true,
  enabledMembers: true,
  enabledStaff: true,
  model: DEFAULT_MODEL,
  fallbackModel: DEFAULT_FALLBACK,
  monthlyCapUsd: 25,
  assistantName: `${brand.shortName} Concierge`,
  persona:
    "Warm, grounded and knowledgeable, like a friendly expert behind the counter. " +
    "Short, clear answers. Never pushy.",
  knowledge: "",
  escalationEmail: "",
  updatedAt: 0,
};

export const LIMITS = {
  persona: 2000,
  knowledge: 30000,
  name: 60,
  capMax: 10000,
};

const MODEL_ID = /^[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.:-]*$/i;
export function isValidModelId(id: string): boolean {
  return typeof id === "string" && id.length <= 100 && MODEL_ID.test(id);
}

const store = new VersionedStore<AssistantConfig>({
  name: "assistant-config",
  legacyKey: "assistant-config.json",
  localFile: path.join(process.cwd(), "data", "assistant-config.json"),
  keep: 6,
  reconcileLegacy: false, // brand-new store: nothing to reconcile, save a list() per read
});

const state = singleton("config", () => ({ cache: null as { value: AssistantConfig; at: number } | null }));
const TTL_MS = 60_000;

function withDefaults(raw: Partial<AssistantConfig> | undefined): AssistantConfig {
  return { ...DEFAULT_CONFIG, ...(raw || {}), id: "config" };
}

export async function getAssistantConfig(opts?: { fresh?: boolean }): Promise<AssistantConfig> {
  if (!opts?.fresh && state.cache && Date.now() - state.cache.at < TTL_MS) return state.cache.value;
  try {
    const snap = await store.read();
    const value = withDefaults(snap.data[0]);
    state.cache = { value, at: Date.now() };
    return value;
  } catch (err) {
    console.error("[assistant] config read failed; using last known or defaults", err);
    // Keep serving the last good copy rather than flapping to defaults.
    return state.cache?.value ?? DEFAULT_CONFIG;
  }
}

/** Validate and clamp an admin edit. Returns an error message or the patch. */
export function cleanConfigPatch(
  input: Record<string, unknown>
): { ok: true; patch: Partial<AssistantConfig> } | { ok: false; error: string } {
  const patch: Partial<AssistantConfig> = {};
  const bool = (k: keyof AssistantConfig) => {
    if (k in input) (patch as Record<string, unknown>)[k] = input[k] === true;
  };
  bool("enabledPublic");
  bool("enabledMembers");
  bool("enabledStaff");

  if ("model" in input) {
    const m = String(input.model || "").trim();
    if (!isValidModelId(m)) return { ok: false, error: "That model id doesn't look right." };
    patch.model = m;
  }
  if ("fallbackModel" in input) {
    const m = String(input.fallbackModel || "").trim();
    if (m && !isValidModelId(m)) return { ok: false, error: "That fallback model id doesn't look right." };
    patch.fallbackModel = m;
  }
  if ("monthlyCapUsd" in input) {
    const n = Number(input.monthlyCapUsd);
    if (!Number.isFinite(n) || n < 0 || n > LIMITS.capMax) {
      return { ok: false, error: `Monthly limit must be between $0 and $${LIMITS.capMax}.` };
    }
    patch.monthlyCapUsd = Math.round(n * 100) / 100;
  }
  if ("assistantName" in input) {
    const s = String(input.assistantName || "").trim().slice(0, LIMITS.name);
    patch.assistantName = s || DEFAULT_CONFIG.assistantName;
  }
  if ("persona" in input) patch.persona = String(input.persona || "").slice(0, LIMITS.persona);
  if ("knowledge" in input) patch.knowledge = String(input.knowledge || "").slice(0, LIMITS.knowledge);
  if ("escalationEmail" in input) {
    const e = String(input.escalationEmail || "").trim();
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      return { ok: false, error: "Escalation email doesn't look valid." };
    }
    patch.escalationEmail = e;
  }
  return { ok: true, patch };
}

export async function updateAssistantConfig(patch: Partial<AssistantConfig>): Promise<AssistantConfig> {
  const next = await store.mutate<AssistantConfig>((rows) => {
    const merged = withDefaults({ ...rows[0], ...patch, updatedAt: Date.now() });
    return { data: [merged], result: merged };
  });
  state.cache = { value: next, at: Date.now() };
  return next;
}
