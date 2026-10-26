import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { escapeHtml } from "@/lib/invoiceEmail";
import { getAssistantConfig } from "@/lib/assistant/config";
import { sendMail, staffInbox } from "@/lib/assistant/tools";
import { recentEscalations, updateEscalation, type Escalation } from "@/lib/assistant/usage";
import { audited, auditDetail } from "@/lib/audit";
import { brand, TEAM } from "@/lib/brand";

export const dynamic = "force-dynamic";

const MAX_REPLY = 5000;

function replyHtml(e: Escalation, body: string, assistantName: string): string {
  const first = e.name.trim().split(/\s+/)[0] || "there";
  const paragraphs = escapeHtml(body)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, "<br/>")}</p>`)
    .join("");
  // Quote what was actually passed to the team (the request summary), not the
  // customer's last chat message — that's often just "sure" or "yes please".
  const asked = e.summary?.trim() || e.transcript?.filter((m) => m.role === "user").slice(-1)[0]?.content;
  return `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;color:#2b2f27;font-size:15px;line-height:1.6">
      <p style="margin:0 0 14px">Hi ${escapeHtml(first)},</p>
      ${paragraphs}
      <p style="margin:18px 0 0">Warmly,<br/>${TEAM}</p>
      ${
        asked
          ? `<div style="margin-top:26px;padding:12px 14px;background:#f3f6ec;border-left:3px solid #85ba45;font-size:13px;color:#5b6152">
               <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#6fa336;font-weight:700;margin-bottom:4px">Your request to our ${escapeHtml(assistantName)}</div>
               ${escapeHtml(asked.slice(0, 600))}
             </div>`
          : ""
      }
      <p style="font-size:12px;color:#81858b;margin-top:20px">Just reply to this email if you have more questions.</p>
    </div>`;
}

/**
 * Staff actions on one "handed to the team" request.
 *   { action: "reply", body, resolve?: boolean }  → emails the customer
 *   { action: "resolve" } / { action: "reopen" }
 */
async function POST_handler(req: Request, { params }: { params: { id: string } }) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let input: { action?: string; body?: string; resolve?: boolean };
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const id = String(params.id || "");
  auditDetail({ action: `escalation.${String(input.action || "unknown").slice(0, 20)}`, targetId: id });
  const existing = (await recentEscalations()).find((e) => e.id === id);
  if (!existing) return NextResponse.json({ error: "That request no longer exists." }, { status: 404 });

  try {
    if (input.action === "resolve" || input.action === "reopen") {
      const saved = await updateEscalation(id, (e) =>
        input.action === "resolve"
          ? { ...e, status: "resolved", resolvedAt: Date.now() }
          : { ...e, status: "open", resolvedAt: undefined }
      );
      if (!saved) return NextResponse.json({ error: "That request no longer exists." }, { status: 404 });
      return NextResponse.json({ ok: true, escalation: saved });
    }

    if (input.action === "reply") {
      const body = String(input.body || "").trim();
      if (!body) return NextResponse.json({ error: "Write a reply first." }, { status: 400 });
      if (body.length > MAX_REPLY) return NextResponse.json({ error: `Keep replies under ${MAX_REPLY.toLocaleString()} characters.` }, { status: 400 });

      const config = await getAssistantConfig();
      // Customer replies go to the team inbox, not back to the no-reply sender.
      const emailed = await sendMail(
        existing.email,
        `A reply from the ${brand.shortName} team`,
        replyHtml(existing, body, config.assistantName || "Concierge"),
        staffInbox(config)
      );
      if (!emailed) {
        return NextResponse.json(
          { error: "The email couldn't be sent, so nothing was recorded. Check the Resend settings, or email the customer directly." },
          { status: 502 }
        );
      }
      try {
        const saved = await updateEscalation(id, (e) => ({
          ...e,
          replies: [...(e.replies || []), { at: Date.now(), body, emailed: true }],
          ...(input.resolve ? { status: "resolved" as const, resolvedAt: Date.now() } : {}),
        }));
        return NextResponse.json({ ok: true, escalation: saved });
      } catch (err) {
        // The email went; only the record failed. Say so, so nobody sends it twice.
        console.error("[assistant] reply sent but not recorded", err);
        return NextResponse.json({
          ok: true,
          warning: "Your reply was emailed, but the dashboard couldn't record it. Don't send it again — refresh in a minute.",
        });
      }
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    console.error("[assistant] escalation update failed", err);
    return NextResponse.json({ error: "Couldn't save that change. Try again." }, { status: 500 });
  }
}

// One audit-log entry per request (see lib/audit.ts).
export const POST = audited("escalation.update", "escalation", POST_handler);
