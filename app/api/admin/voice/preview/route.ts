import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { familyOf, speakCached, voiceCostUsd } from "@/lib/voice";
import { recordUsage } from "@/lib/assistant/usage";
import { brand } from "@/lib/brand";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Assistant → Voice: hear a voice before choosing it. Staff only; cached, so
// replaying the same sample costs nothing.
const SAMPLE = `Hi, I'm the ${brand.shortName} Concierge. Tell me what you're looking for, and I'll help you find something that suits you.`;

export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { voiceId?: string; model?: string };
  const voice = String(b.voiceId || "");
  const model = String(b.model || "");
  // Blank voice = a Microsoft model's own default voice.
  if (!(voice ? /^[A-Za-z0-9_-]{2,64}$/.test(voice) : familyOf(model) === "microsoft") || !/^[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.:-]*$/i.test(model)) return NextResponse.json({ error: "Pick a voice and model." }, { status: 400 });
  try {
    // No fallback here: staff should see that a voice doesn't exist.
    const r = await speakCached(SAMPLE, { voice, model, req, noFallback: true });
    if (!r.cached) recordUsage({ audience: "admin", model, inputTokens: 0, outputTokens: 0, costUsd: voiceCostUsd(model, { chars: SAMPLE.length }), toolCalls: 0 });
    return NextResponse.json({ audio: r.audioB64, mediaType: r.mediaType });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't make the sample." }, { status: 502 });
  }
}
