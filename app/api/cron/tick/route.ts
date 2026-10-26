import { runInvites } from "@/lib/invites";
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { auditSystem } from "@/lib/audit";
import { runReminders } from "@/lib/reminders";
import { runScheduledCampaigns } from "@/lib/campaignSchedule";
import { pruneTranscripts } from "@/lib/assistant/transcripts";
import { flushTraffic } from "@/lib/traffic";
import { runNotesReview } from "@/lib/assistant/notesReview";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The every-15-minutes job (vercel.json → crons). Runs whatever is due:
 * payment reminders, scheduled campaigns, and housekeeping. Each part is
 * independent and safe to repeat — nothing is ever sent twice.
 *
 * Who may call it: Vercel's scheduler (CRON_SECRET bearer when set, else the
 * cron header), or a signed-in admin ("Run now"). A faked call can only make
 * due work happen a little early; it can't choose recipients or content.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  const fromCron = secret ? auth === `Bearer ${secret}` : !!req.headers.get("x-vercel-cron") || /vercel-cron/i.test(req.headers.get("user-agent") || "");
  if (!fromCron && !(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || new URL(req.url).origin;
  const out: Record<string, unknown> = {};
  const failures: string[] = [];

  try {
    out.reminders = await runReminders(siteUrl);
  } catch (err) {
    failures.push(`reminders: ${err instanceof Error ? err.message : err}`);
  }
  try {
    out.campaigns = await runScheduledCampaigns(siteUrl);
  } catch (err) {
    failures.push(`campaigns: ${err instanceof Error ? err.message : err}`);
  }
  try {
    out.invites = await runInvites(siteUrl, { deadlineMs: 15_000 });
  } catch (err) {
    failures.push(`invites: ${err instanceof Error ? err.message : err}`);
  }
  // Housekeeping once an hour is plenty.
  if (new Date().getUTCMinutes() < 15) {
    try {
      out.transcriptsPruned = await pruneTranscripts();
    } catch (err) {
      failures.push(`transcripts: ${err instanceof Error ? err.message : err}`);
    }
  }
  // The Concierge's nightly notes review (switch "Concierge learns from chats";
  // once a day, 1–5am local). Logs its own Activity entry.
  try {
    const nr = await runNotesReview({ trigger: "nightly", req });
    if (!nr.skipped) out.notesReview = nr;
  } catch (err) {
    failures.push(`notes review: ${err instanceof Error ? err.message : err}`);
  }
  await flushTraffic(true).catch(() => {});

  const r = out.reminders as { sent?: number; failed?: number; expired?: number } | undefined;
  const c = out.campaigns as { sent?: number; failed?: number } | undefined;
  const iv = out.invites as { sent?: number; failed?: number } | undefined;
  const didWork = (r && (r.sent || r.failed || r.expired)) || (c && (c.sent || c.failed)) || (iv && (iv.sent || iv.failed));
  // Log runs that did something or failed; quiet runs aren't worth 96 rows a day.
  if (didWork || failures.length) {
    await auditSystem({
      action: "job.tick",
      targetType: "job",
      ok: failures.length === 0 && !(r?.failed || c?.failed),
      note: [failures.join(" · "), r ? `reminders sent ${r.sent || 0}, failed ${r.failed || 0}, expired ${r.expired || 0}` : "", c ? `campaign emails sent ${c.sent || 0}, failed ${c.failed || 0}` : "", iv && (iv.sent || iv.failed) ? `set-password invites sent ${iv.sent || 0}, failed ${iv.failed || 0}` : ""].filter(Boolean).join(" · "),
      after: out,
    });
  }
  return NextResponse.json({ ok: failures.length === 0, ...out, failures });
}
