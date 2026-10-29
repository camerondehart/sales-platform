import { NextResponse } from "next/server";
import { tooMany } from "@/lib/publicLimits";
import { isEnabled } from "@/lib/flags";
import { resolveAudience } from "@/lib/assistant/engine";
import { getVoiceSettings, gatewayVoice, overDailyLimit, recordVoice, speakCached, speakParts, speakText, speechSigOk, voiceCostUsd } from "@/lib/voice";
import { capReached } from "@/lib/assistant/engine";
import { getAssistantConfig } from "@/lib/assistant/config";
import { recordUsage } from "@/lib/assistant/usage";
import type { WidgetMode } from "@/lib/assistant/shared";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The Concierge's ears and voice (lib/voice.ts):
//   { action: "transcribe", mode, audio: base64, mediaType }  → { text }
//   { action: "speak", mode, text, sig, part? }                → { audio: base64, mediaType, parts }
//     part 0 = the first sentence, part 1 = the rest (so playback starts sooner);
//     no part = the whole answer in one clip
// "speak" only reads a Concierge answer (signed by /api/assistant/chat).

const MAX_AUDIO_B64 = 3_000_000; // ~60 s of compressed speech, with room to spare
const AUDIO_TYPES = /^audio\/(webm|ogg|mp4|mpeg|mp3|wav|x-m4a|aac)(;.*)?$/i;

export async function POST(req: Request) {
  let body: { action?: string; mode?: string; audio?: string; mediaType?: string; text?: string; sig?: string; part?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  if (!(await isEnabled("voice_concierge").catch(() => false))) return NextResponse.json({ error: "Voice is off." }, { status: 404 });
  const mode: WidgetMode = body.mode === "admin" ? "admin" : "site";
  const who = await resolveAudience(mode);
  if (!who) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  // Voice counts toward the Assistant's monthly limit, like chat.
  if (await capReached(await getAssistantConfig())) return NextResponse.json({ error: "Voice is resting for now. Please type instead." }, { status: 429 });

  if (body.action === "transcribe") {
    const limited = tooMany(req, "voice-listen", { max: 20, minutes: 10 });
    if (limited) return limited;
    const audio = String(body.audio || "");
    const mediaType = String(body.mediaType || "");
    if (!audio || audio.length > MAX_AUDIO_B64) return NextResponse.json({ error: "That recording is too long. Keep it under a minute." }, { status: 413 });
    if (!AUDIO_TYPES.test(mediaType)) return NextResponse.json({ error: "Unsupported recording type." }, { status: 400 });
    if (await overDailyLimit("stt")) return NextResponse.json({ error: "Voice is resting for today. Please type instead." }, { status: 429 });
    const settings = await getVoiceSettings();
    try {
      const started = Date.now();
      const r = await gatewayVoice.transcribe(audio, mediaType.split(";")[0], settings.sttModel, req);
      const seconds = r.seconds ?? Math.min(60, audio.length / 16000);
      await recordVoice({ sttCalls: 1, sttSeconds: seconds });
      recordUsage({ audience: who.audience, model: settings.sttModel, inputTokens: 0, outputTokens: 0, costUsd: voiceCostUsd(settings.sttModel, { seconds }), toolCalls: 0, latencyMs: Date.now() - started });
      return NextResponse.json({ text: r.text.slice(0, 2000) }, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      console.error("[voice] transcribe failed", err);
      await recordVoice({ errors: 1 });
      return NextResponse.json({ error: "Couldn't hear that. Please type instead." }, { status: 502 });
    }
  }

  if (body.action === "speak") {
    const limited = tooMany(req, "voice-speak", { max: 80, minutes: 10 });
    if (limited) return limited;
    const text = String(body.text || "").slice(0, 8000);
    if (!text || !speechSigOk(text, String(body.sig || ""))) return NextResponse.json({ error: "Only Concierge answers can be read aloud." }, { status: 403 });
    if (await overDailyLimit("tts")) return NextResponse.json({ error: "Voice is resting for today." }, { status: 429 });
    const settings = await getVoiceSettings();
    try {
      const started = Date.now();
      const whole = speakText(text);
      const parts = speakParts(whole);
      const part = typeof body.part === "number" && Number.isInteger(body.part) ? body.part : -1;
      if (part >= parts.length || part < -1) return NextResponse.json({ error: "No such part." }, { status: 400 });
      const spoken = part === -1 ? whole : parts[part];
      const r = await speakCached(spoken, { voice: settings.voiceId, model: settings.ttsModel, req, countAnswer: part <= 0 });
      // Replays from the cache cost nothing.
      if (!r.cached) recordUsage({ audience: who.audience, model: settings.ttsModel, inputTokens: 0, outputTokens: 0, costUsd: voiceCostUsd(settings.ttsModel, { chars: spoken.length }), toolCalls: 0, latencyMs: Date.now() - started });
      return NextResponse.json({ audio: r.audioB64, mediaType: r.mediaType, cached: r.cached, parts: part === -1 ? 1 : parts.length }, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      console.error("[voice] speak failed", err);
      await recordVoice({ errors: 1 });
      return NextResponse.json({ error: "Couldn't read that aloud right now." }, { status: 502 });
    }
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
