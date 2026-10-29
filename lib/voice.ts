import path from "path";
import crypto from "crypto";
import { promises as fs } from "fs";
import { VersionedStore } from "./versionedStore";
import { gatewayCredential } from "./assistant/gateway";
import { pacificDay } from "./periods";
import { sayable } from "./sayable";

/**
 * Concierge voice: speech → text (Scribe) and text → speech (ElevenLabs),
 * both through the same Vercel AI Gateway key as the chat, so billing stays
 * in one place. Voice is only an input/output layer: the Concierge itself,
 * its tools, notes and guard rails don't change.
 *
 * Behind a small VoiceProvider interface (Gateway today, swappable later).
 * Server-side only. Plain fetch, no SDK: the Gateway's speech endpoints take
 * JSON and return base64 audio.
 */

export interface VoiceProvider {
  readonly name: string;
  transcribe(audioB64: string, mediaType: string, model: string, req?: Request): Promise<{ text: string; seconds?: number }>;
  speak(text: string, voice: string, model: string, req?: Request): Promise<{ audioB64: string; mediaType: string }>;
}

const BASE = (process.env.AI_GATEWAY_SPEECH_URL || "https://ai-gateway.vercel.sh/v4/ai").replace(/\/$/, "");

async function post(kind: "speech" | "transcription", model: string, body: Record<string, unknown>, req?: Request, timeoutMs = 30_000) {
  const key = gatewayCredential(req);
  if (!key) throw new Error("No AI Gateway key");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/${kind}-model`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "ai-gateway-protocol-version": "0.0.1",
        "ai-gateway-auth-method": process.env.AI_GATEWAY_API_KEY?.trim() ? "api-key" : "oidc",
        [`ai-${kind}-model-specification-version`]: "4",
        "ai-model-id": model,
        // Lets voice be told apart from chat in the Gateway's usage views.
        "user-agent": "StorefrontConcierge-voice/1.0",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = `Gateway ${kind} HTTP ${res.status}`;
      try {
        const j = JSON.parse(text);
        const m = j?.error?.message || j?.message;
        if (m) msg += `: ${m}`;
      } catch {
        /* not JSON */
      }
      throw new Error(msg);
    }
    return JSON.parse(text) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

/** What kind of audio a base64 clip is (MP3 from ElevenLabs, WAV from Google). */
export function audioType(b64: string): string {
  if (b64.startsWith("UklGR")) return "audio/wav";
  if (b64.startsWith("T2dn")) return "audio/ogg";
  return "audio/mpeg";
}

export const gatewayVoice: VoiceProvider = {
  name: "gateway",
  async transcribe(audioB64, mediaType, model, req) {
    const r = await post("transcription", model, { audio: audioB64, mediaType }, req, 45_000);
    return { text: String(r.text || "").trim(), seconds: typeof r.durationInSeconds === "number" ? r.durationInSeconds : undefined };
  },
  async speak(text, voice, model, req) {
    const r = await post("speech", model, { text, ...(voice ? { voice } : {}), outputFormat: familyOf(model) === "google" ? "wav" : "mp3" }, req);
    const audio = String(r.audio || "");
    if (!audio) throw new Error("The Gateway sent no audio");
    return { audioB64: audio, mediaType: audioType(audio) };
  },
};

// ------------------------------------------------------------- settings

/** ElevenLabs premade voices offered in Assistant → Voice (any voice id can be typed too). */
export type VoiceFamily = "elevenlabs" | "google" | "microsoft";
/** Which voices a speech model takes: ElevenLabs voice IDs, Google's named voices, or Microsoft's. */
export const familyOf = (model: string): VoiceFamily => (model.startsWith("google/") ? "google" : model.startsWith("microsoft/") ? "microsoft" : "elevenlabs");

/** Voices offered in Assistant → Concierge voice (any other voice ID/name can be typed too). */
export const VOICE_PRESETS: Array<{ id: string; name: string; note: string; family: VoiceFamily }> = [
  // ElevenLabs (built-in voices)
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", note: "soft, warm, reassuring", family: "elevenlabs" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", note: "friendly, upbeat", family: "elevenlabs" },
  { id: "cgSgspJ2msm6clMCkdW9", name: "Jessica", note: "playful, bright, warm", family: "elevenlabs" },
  { id: "FGY2WhTYpPnrIDTdsKH5", name: "Laura", note: "upbeat, quirky", family: "elevenlabs" },
  { id: "SAz9YHcvj6GT2YYXdXww", name: "River", note: "relaxed, calm", family: "elevenlabs" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice", note: "warm, clear (British)", family: "elevenlabs" },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", note: "warm storyteller (British)", family: "elevenlabs" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", note: "steady, polished (British)", family: "elevenlabs" },
  { id: "IKne3meq5aSn9XLyUdCD", name: "Charlie", note: "easygoing (Australian)", family: "elevenlabs" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian", note: "deep, calm, steady", family: "elevenlabs" },
  // Google Gemini TTS (prebuilt voices)
  { id: "Kore", name: "Kore", note: "firm, warm", family: "google" },
  { id: "Aoede", name: "Aoede", note: "breezy", family: "google" },
  { id: "Leda", name: "Leda", note: "youthful", family: "google" },
  { id: "Callirrhoe", name: "Callirrhoe", note: "easy-going", family: "google" },
  { id: "Autonoe", name: "Autonoe", note: "bright", family: "google" },
  { id: "Despina", name: "Despina", note: "smooth", family: "google" },
  { id: "Sulafat", name: "Sulafat", note: "warm", family: "google" },
  { id: "Vindemiatrix", name: "Vindemiatrix", note: "gentle", family: "google" },
  { id: "Achernar", name: "Achernar", note: "soft", family: "google" },
  { id: "Zephyr", name: "Zephyr", note: "bright", family: "google" },
  { id: "Puck", name: "Puck", note: "upbeat", family: "google" },
  { id: "Charon", name: "Charon", note: "informative", family: "google" },
  { id: "Fenrir", name: "Fenrir", note: "excitable", family: "google" },
  { id: "Orus", name: "Orus", note: "firm", family: "google" },
  { id: "Achird", name: "Achird", note: "friendly", family: "google" },
  { id: "Sadaltager", name: "Sadaltager", note: "knowledgeable", family: "google" },
];
export const TTS_MODELS: Array<{ id: string; name: string; family: VoiceFamily }> = [
  { id: "elevenlabs/eleven-flash-v2.5", name: "Eleven Flash v2.5 — fast, lowest cost", family: "elevenlabs" },
  { id: "elevenlabs/eleven-v4-turbo", name: "Eleven v4 Turbo — natural and quick", family: "elevenlabs" },
  { id: "elevenlabs/eleven-v4", name: "Eleven v4 — most natural, costs more", family: "elevenlabs" },
  { id: "elevenlabs/eleven-v3", name: "Eleven v3 — very expressive", family: "elevenlabs" },
  { id: "elevenlabs/eleven-multilingual-v2", name: "Eleven Multilingual v2", family: "elevenlabs" },
  { id: "elevenlabs/eleven-flash-v2", name: "Eleven Flash v2 — fast (English)", family: "elevenlabs" },
  { id: "elevenlabs/eleven-v3-conversational", name: "Eleven v3 Conversational — made for back-and-forth", family: "elevenlabs" },
  { id: "google/gemini-3.8-flash-tts", name: "Google Gemini 3.8 Flash TTS — expressive", family: "google" },
  { id: "google/gemini-3.8-flash-lite-tts", name: "Google Gemini 3.8 Flash-Lite TTS — fast, very low cost", family: "google" },
  { id: "microsoft/mai-voice-2.1-flash", name: "Microsoft MAI-Voice 2.1 Flash — quick", family: "microsoft" },
  { id: "microsoft/mai-voice-2.1", name: "Microsoft MAI-Voice 2.1 — expressive", family: "microsoft" },
];
/** The voice to fall back on for each family (a saved voice that no longer exists). */
// Microsoft: "" = the model's own default voice (no voice sent).
export const DEFAULT_VOICE_FOR: Record<VoiceFamily, string> = { elevenlabs: "EXAVITQu4vr4xnSDxMaL", google: "Kore", microsoft: "" };
export const STT_MODEL_DEFAULT = "elevenlabs/scribe-v2";

export type VoiceSettings = { id: "voice"; ttsModel: string; voiceId: string; sttModel: string; updatedAt: number };
export const DEFAULT_VOICE: VoiceSettings = { id: "voice", ttsModel: TTS_MODELS[0].id, voiceId: VOICE_PRESETS[0].id, sttModel: STT_MODEL_DEFAULT, updatedAt: 0 };

const settingsStore = new VersionedStore<VoiceSettings>({
  name: "voice-settings",
  legacyKey: "voice-settings.json",
  localFile: path.join(process.cwd(), "data", "voice-settings.json"),
  keep: 4,
  reconcileLegacy: false,
});

let settingsCache: { at: number; v: VoiceSettings } | null = null;
export async function getVoiceSettings(fresh = false): Promise<VoiceSettings> {
  if (!fresh && settingsCache && Date.now() - settingsCache.at < 60_000) return settingsCache.v;
  try {
    const v = { ...DEFAULT_VOICE, ...((await settingsStore.read()).data[0] || {}), id: "voice" as const };
    settingsCache = { at: Date.now(), v };
    return v;
  } catch {
    return settingsCache?.v ?? DEFAULT_VOICE;
  }
}

const MODEL_ID = /^[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.:-]*$/i;
export async function saveVoiceSettings(input: Record<string, unknown>): Promise<{ ok: true; settings: VoiceSettings; before: VoiceSettings } | { ok: false; error: string }> {
  const before = await getVoiceSettings(true);
  const next: VoiceSettings = { ...before, updatedAt: Date.now() };
  if ("ttsModel" in input) {
    const m = String(input.ttsModel || "").trim();
    if (!MODEL_ID.test(m) || m.length > 100) return { ok: false, error: "That speech model id doesn't look right." };
    next.ttsModel = m;
  }
  if ("sttModel" in input) {
    const m = String(input.sttModel || "").trim();
    if (!MODEL_ID.test(m) || m.length > 100) return { ok: false, error: "That listening model id doesn't look right." };
    next.sttModel = m;
  }
  if ("voiceId" in input) {
    const v = String(input.voiceId || "").trim();
    // Blank = the model's default voice (Microsoft models only).
    if (v ? !/^[A-Za-z0-9_-]{2,64}$/.test(v) : familyOf(next.ttsModel) !== "microsoft") return { ok: false, error: "That voice id doesn't look right." };
    next.voiceId = v;
  }
  // A Google voice with an ElevenLabs model (or the other way round) can't speak.
  const preset = VOICE_PRESETS.find((v) => v.id === next.voiceId);
  if (preset && preset.family !== familyOf(next.ttsModel)) {
    const fam = preset.family === "google" ? "Google" : "ElevenLabs";
    return { ok: false, error: `${preset.name} is a ${fam} voice — pick a ${fam} speech model, or another voice.` };
  }
  if (!next.voiceId && familyOf(next.ttsModel) !== "microsoft") return { ok: false, error: "Pick a voice for this speech model." };
  await settingsStore.mutate(() => ({ data: [next], result: null }), { allowShrink: true });
  settingsCache = { at: Date.now(), v: next };
  return { ok: true, settings: next, before };
}

// ---------------------------------------------------------------- cost

/**
 * Estimated dollars for voice, added to the Assistant's spend (the top number,
 * model spend cards and the monthly limit). Full ElevenLabs list prices, so
 * while the Gateway's 50%-off launch promo lasts the estimate runs high —
 * the limit never under-counts. Unknown models use the highest rate.
 */
const VOICE_PRICES: Record<string, { perMChars?: number; perHour?: number }> = {
  "elevenlabs/eleven-flash-v2.5": { perMChars: 40 },
  "elevenlabs/eleven-v4": { perMChars: 80 },
  "elevenlabs/eleven-multilingual-v2": { perMChars: 80 },
  "elevenlabs/eleven-v4-turbo": { perMChars: 40 },
  "elevenlabs/eleven-flash-v2": { perMChars: 40 },
  "elevenlabs/eleven-v3": { perMChars: 80 },
  "elevenlabs/eleven-v3-conversational": { perMChars: 80 },
  // Google: Flash-Lite lists $1/M chars at full price; Flash isn't listed yet, so counted high.
  "google/gemini-3.8-flash-lite-tts": { perMChars: 1 },
  "google/gemini-3.8-flash-tts": { perMChars: 20 },
  "elevenlabs/scribe-v2": { perHour: 0.22 },
};
export function voiceCostUsd(model: string, use: { chars?: number; seconds?: number }): number {
  const p = VOICE_PRICES[model] || {};
  const tts = use.chars ? (use.chars / 1_000_000) * (p.perMChars ?? 80) : 0;
  const stt = use.seconds ? (use.seconds / 3600) * (p.perHour ?? 0.4) : 0;
  return Math.round((tts + stt) * 1e6) / 1e6;
}

// ---------------------------------------------------------------- usage

export type VoiceUsageDay = { id: string; sttSeconds: number; sttCalls: number; ttsChars: number; ttsCalls: number; cacheHits: number; errors: number };
const usageStore = new VersionedStore<VoiceUsageDay>({
  name: "voice-usage",
  legacyKey: "voice-usage.json",
  localFile: path.join(process.cwd(), "data", "voice-usage.json"),
  keep: 6,
  reconcileLegacy: false,
});

/** Add to today's totals (Pacific day). Never throws. */
export async function recordVoice(add: Partial<Omit<VoiceUsageDay, "id">>): Promise<void> {
  const id = pacificDay(Date.now());
  await usageStore
    .mutate((rows) => {
      const cur = rows.find((r) => r.id === id) || { id, sttSeconds: 0, sttCalls: 0, ttsChars: 0, ttsCalls: 0, cacheHits: 0, errors: 0 };
      const next = { ...cur };
      for (const [k, v] of Object.entries(add)) (next as unknown as Record<string, number>)[k] = ((cur as unknown as Record<string, number>)[k] || 0) + (v as number);
      next.sttSeconds = Math.round(next.sttSeconds * 10) / 10;
      return { data: [...rows.filter((r) => r.id !== id), next].sort((a, b) => a.id.localeCompare(b.id)).slice(-120), result: null };
    })
    .catch((err) => console.error("[voice] usage not recorded", err));
}

export async function voiceUsage(days = 14): Promise<VoiceUsageDay[]> {
  try {
    return (await usageStore.read()).data.slice(-days).reverse();
  } catch {
    return [];
  }
}

/** Safety net on top of the per-visitor limits: the whole site's voice use per day. */
export const DAILY_LIMITS = { sttCalls: 600, ttsCalls: 1500 };
export async function overDailyLimit(kind: "stt" | "tts"): Promise<boolean> {
  const today = (await voiceUsage(1)).find((d) => d.id === pacificDay(Date.now()));
  if (!today) return false;
  return kind === "stt" ? today.sttCalls >= DAILY_LIMITS.sttCalls : today.ttsCalls >= DAILY_LIMITS.ttsCalls;
}

// ------------------------------------------------- what gets read aloud

export const SPEAK_MAX = 600;

/** The answer as plain speech: no markdown or links, at most ~600 characters, ending on a sentence. */
export function speakText(reply: string): string {
  const plain = reply
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[*_`#>|~]+/g, " ")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .replace(/ ([,.;:!?])(?=\s|$)/g, "$1") // "**orders**, up" left "orders , up"
    .trim();
  // Money, ranges and big numbers as words, so every model reads them the same (lib/sayable.ts).
  if (plain.length <= SPEAK_MAX) return sayable(plain);
  const cut = plain.slice(0, SPEAK_MAX);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return sayable((end > 200 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "…").trim());
}

/**
 * Speak the first sentence on its own so it can start playing straight away
 * while the rest is made (much less waiting before the voice starts).
 * A first sentence over ~180 characters splits at its first comma/colon after
 * ~40 characters instead; short answers stay in one part.
 */
export function speakParts(spoken: string): string[] {
  // A long first sentence splits at its first comma, colon or semicolon instead.
  const m = spoken.match(/^[\s\S]{15,180}?[.!?…](?=\s|$)/) || spoken.match(/^[\s\S]{40,160}?[,;:](?=\s)/);
  if (!m) return [spoken];
  const first = m[0].trim();
  const rest = spoken.slice(m[0].length).trim();
  return rest ? [first, rest] : [first];
}

/** Signs a Concierge answer so /api/assistant/voice only reads aloud what the Concierge actually said. */
export function signSpeech(text: string): string {
  const secret = process.env.AUTH_SECRET || "";
  return crypto.createHmac("sha256", `voice:${secret}`).update(speakText(text)).digest("base64url").slice(0, 32);
}
export function speechSigOk(text: string, sig: string): boolean {
  const want = Buffer.from(signSpeech(text));
  const got = Buffer.from(String(sig || ""));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

// ---------------------------------------------------------- audio cache

const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
const cacheKey = (model: string, voice: string, text: string) => crypto.createHash("sha256").update(`${model}|${voice}|${text}`).digest("hex").slice(0, 40);

async function cacheGet(key: string): Promise<string | null> {
  try {
    if (useBlob) {
      const { list } = await import("@vercel/blob");
      const { blobs } = await list({ prefix: `voice-cache/${key}` });
      const hit = blobs.find((b) => b.pathname.startsWith(`voice-cache/${key}`));
      if (!hit) return null;
      const r = await fetch(hit.url, { cache: "no-store" });
      return r.ok ? Buffer.from(await r.arrayBuffer()).toString("base64") : null;
    }
    return (await fs.readFile(path.join(process.cwd(), "data", "voice-cache", `${key}.mp3`))).toString("base64");
  } catch {
    return null;
  }
}
async function cachePut(key: string, audioB64: string): Promise<void> {
  try {
    const buf = Buffer.from(audioB64, "base64");
    if (useBlob) {
      const { put } = await import("@vercel/blob");
      await put(`voice-cache/${key}.mp3`, buf, { access: "public", contentType: "audio/mpeg", addRandomSuffix: true });
      return;
    }
    const dir = path.join(process.cwd(), "data", "voice-cache");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${key}.mp3`), buf);
  } catch (err) {
    console.error("[voice] audio not cached", err);
  }
}

/** Speak (cached by model + voice + text). */
export async function speakCached(
  text: string,
  opts: { voice: string; model: string; req?: Request; provider?: VoiceProvider; noCache?: boolean; noFallback?: boolean; /** false for the 2nd part of an answer (counted once). */ countAnswer?: boolean }
): Promise<{ audioB64: string; mediaType: string; cached: boolean }> {
  const key = cacheKey(opts.model, opts.voice, text);
  if (!opts.noCache) {
    const hit = await cacheGet(key);
    if (hit) {
      recordVoice({ cacheHits: 1 });
      return { audioB64: hit, mediaType: audioType(hit), cached: true };
    }
  }
  let out: { audioB64: string; mediaType: string };
  try {
    out = await (opts.provider || gatewayVoice).speak(text, opts.voice, opts.model, opts.req);
  } catch (err) {
    // A saved voice that ElevenLabs no longer has: answer in the default voice rather than not at all.
    const fallback = DEFAULT_VOICE_FOR[familyOf(opts.model)];
    if (!/voice_not_found|voice.*not (found|supported|valid)|invalid voice|unknown voice/i.test(String(err instanceof Error ? err.message : err)) || opts.voice === fallback || opts.noFallback) throw err;
    console.warn(`[voice] voice ${opts.voice} not found; using the default voice`);
    return speakCached(text, { ...opts, voice: fallback, noFallback: true });
  }
  await recordVoice({ ttsCalls: opts.countAnswer === false ? 0 : 1, ttsChars: text.length });
  if (!opts.noCache) await cachePut(key, out.audioB64);
  return { ...out, cached: false };
}
