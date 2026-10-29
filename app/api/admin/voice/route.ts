import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { audited, auditDetail } from "@/lib/audit";
import { isEnabled } from "@/lib/flags";
import { DAILY_LIMITS, STT_MODEL_DEFAULT, TTS_MODELS, VOICE_PRESETS, getVoiceSettings, saveVoiceSettings, voiceUsage } from "@/lib/voice";

// Assistant → Voice: which voice and models the Concierge uses, and daily use.
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [settings, usage, on] = await Promise.all([getVoiceSettings(true), voiceUsage(14), isEnabled("voice_concierge").catch(() => false)]);
  return NextResponse.json({ settings, usage, on, presets: VOICE_PRESETS, ttsModels: TTS_MODELS, sttModel: STT_MODEL_DEFAULT, limits: DAILY_LIMITS }, { headers: { "Cache-Control": "no-store" } });
}

async function PUT_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = await saveVoiceSettings(body);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  auditDetail({ before: r.before, after: r.settings });
  return NextResponse.json({ ok: true, settings: r.settings });
}

export const PUT = audited("assistant.voice_settings", "assistant", PUT_handler);
