import { NextResponse } from "next/server";
import { handleChat, resolveAudience } from "@/lib/assistant/engine";
import { clientIp } from "@/lib/assistant/limits";
import { FLAG_LABELS, markAlerted, saveTurn } from "@/lib/assistant/transcripts";
import { getAssistantConfig } from "@/lib/assistant/config";
import { sendMail, staffInbox } from "@/lib/assistant/tools";
import { escapeHtml } from "@/lib/invoiceEmail";
import type { WidgetMode } from "@/lib/assistant/shared";
import { isEnabled } from "@/lib/flags";
import { signSpeech } from "@/lib/voice";
import { END_MARK } from "@/lib/assistant/engine";

export const dynamic = "force-dynamic";
// A tool-using turn can take several model calls; leave generous headroom.
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: { mode?: unknown; messages?: unknown; conversationId?: unknown; conversation?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ reply: "I didn't catch that.", degraded: true }, { status: 400 });
  }
  try {
    const { status, reply, model } = await handleChat(req, body);
    // Conversation mode: the Concierge marks a finished chat; the widget then stops listening.
    if (typeof reply.reply === "string" && reply.reply.toLowerCase().includes(END_MARK)) {
      reply.reply = reply.reply.split(END_MARK).join("").replace(/\[\[end\]\]/gi, "").trim() || "Bye for now!";
      reply.endConversation = true;
    }
    if (status === 200 && !reply.offline) await keepTranscript(req, body, reply.reply, model);
    // Voice: a signature so the answer (and only Concierge answers) can be read aloud.
    const voiceSig = status === 200 && !reply.offline && reply.reply && (await isEnabled("voice_concierge").catch(() => false)) ? signSpeech(reply.reply) : undefined;
    return NextResponse.json(voiceSig ? { ...reply, voiceSig } : reply, { status, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    // Last-resort guard: the widget always gets a readable answer.
    console.error("[assistant] unhandled chat error", err);
    return NextResponse.json(
      { reply: "Sorry — something went wrong on my side. Please try again.", degraded: true },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  }
}

/** Save the turn to the 30-day transcript; alert the team about serious flags. Never throws. */
async function keepTranscript(req: Request, body: { mode?: unknown; messages?: unknown; conversationId?: unknown }, replyText: string, model?: string) {
  try {
    const convId = typeof body.conversationId === "string" ? body.conversationId : "";
    if (!convId) return;
    const msgs = Array.isArray(body.messages) ? (body.messages as Array<{ role?: string; content?: string }>) : [];
    const last = [...msgs].reverse().find((m) => m?.role === "user");
    if (!last?.content) return;
    const mode: WidgetMode = body.mode === "admin" ? "admin" : "site";
    const who = await resolveAudience(mode);
    if (!who) return;
    const label = who.audience === "admin" ? "Staff" : who.user ? `${who.user.name} <${who.user.email}>` : "Visitor";
    const saved = await saveTurn({
      convId,
      owner: who.user ? `u:${who.user.id}` : who.audience === "admin" ? "admin" : `ip:${clientIp(req)}`,
      audience: who.audience,
      who: label,
      userMessage: String(last.content),
      reply: replyText,
      model,
    });
    if (saved && saved.newHighFlags.length && !saved.transcript.alerted) {
      const config = await getAssistantConfig();
      const f = saved.newHighFlags[0];
      const html = `
        <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:620px;color:#2b2f27">
          <div style="font-size:12px;letter-spacing:.15em;text-transform:uppercase;color:#b2432f;font-weight:700">Concierge chat needs a look</div>
          <h2 style="font-family:Georgia,serif;font-weight:400;font-style:italic;margin:8px 0 14px">${escapeHtml(FLAG_LABELS[f.kind])}</h2>
          <p><strong>From:</strong> ${escapeHtml(label)}</p>
          <p style="background:#fbeeea;padding:12px 14px;border-left:3px solid #b2432f">“${escapeHtml(f.excerpt)}”</p>
          <p>The Concierge answered with care and pointed them to the right help. Read the whole conversation in the dashboard: Assistant → Conversations (Flagged).</p>
        </div>`;
      const ok = await sendMail(staffInbox(config), `⚠ Concierge chat flagged: ${FLAG_LABELS[f.kind]}`, html);
      if (ok) await markAlerted(saved.transcript);
    }
  } catch (err) {
    console.error("[assistant] transcript save failed", err);
  }
}
