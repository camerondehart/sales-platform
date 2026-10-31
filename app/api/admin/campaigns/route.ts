import { NextResponse } from "next/server";
import { Resend } from "resend";
import { isAdmin } from "@/lib/auth";
import { audited, auditDetail } from "@/lib/audit";
import { renderCampaign } from "@/lib/campaignRender";
import { cleanThemeChoice } from "@/lib/campaignThemes";
import { AUDIENCE_GROUPS, cancelCampaign, createCampaign, inWindow, listCampaigns, processCampaign, publicCampaign, recipientsFor, updateCampaign, type Audience } from "@/lib/campaignSchedule";
import { readTraffic, pacificDay } from "@/lib/traffic";
import { brand } from "@/lib/brand";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Send an email campaign to all active subscribers.
// Each message gets a personalised unsubscribe link.

// Where customers should write back. Campaigns send from a noreply address,
// so this is also used as the Reply-To so replies actually reach someone.
const SUPPORT_EMAIL = brand.supportEmail;

async function POST_handler(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { subject, body, testOnly, audience = "subscribers", scheduledFor, customList, groups: rawGroups, theme: rawTheme } = await req.json() as {
    subject: string; body: string; testOnly?: boolean;
    /** Seasonal look: a theme key, "auto" (default) or "none". */
    theme?: string;
    /** Who gets it: everyone, only members, only non-members, or a pasted list. */
    audience?: "subscribers" | "all" | "members" | "nonmembers" | "custom" | "groups";
    /** For audience "groups": any of ms (members subscribed), mn (non-subscribed members), ls (mailing list, not member). */
    groups?: string[];
    /** When to send (ms). Omit to send now. Scheduling counts as approval. */
    scheduledFor?: number;
    /** For audience "custom": emails separated by commas/spaces/new lines. */
    customList?: string;
  };
  if (!subject?.trim() || !body?.trim()) {
    return NextResponse.json({ error: "Subject and body are required." }, { status: 400 });
  }
  // A Concierge draft whose chat photo was never added (lib/assistant/shared.ts PHOTO_SLOT).
  if (body.includes("[[PHOTO]]")) {
    return NextResponse.json({ error: "The photo from the chat hasn't been added yet. Use Upload photo, or delete the [[PHOTO]] line." }, { status: 400 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev";
  // Campaigns go out from a noreply address, so point replies somewhere real.
  const replyTo = process.env.INQUIRY_TO_EMAIL || SUPPORT_EMAIL;
  if (!apiKey) {
    return NextResponse.json({ error: "Resend API key missing" }, { status: 500 });
  }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || new URL(req.url).origin;
  const resend = new Resend(apiKey);

  // Test send goes only to the admin inbox
  if (testOnly) {
    const adminEmail = process.env.INQUIRY_TO_EMAIL;
    if (!adminEmail) {
      return NextResponse.json({ error: "No admin email configured for a test send." }, { status: 400 });
    }
    try {
      await resend.emails.send({
        from: fromEmail,
        to: adminEmail,
        reply_to: replyTo,
        subject: `[TEST] ${subject}`,
        html: await renderCampaign({ subject, body, theme: cleanThemeChoice(rawTheme), unsubUrl: `${siteUrl}/unsubscribe?token=preview`, siteUrl, when: Number(scheduledFor) || Date.now() }),
      });
      return NextResponse.json({ ok: true, sent: 1, test: true });
    } catch (err) {
      console.error("Test campaign failed", err);
      return NextResponse.json({ error: "Test send failed." }, { status: 500 });
    }
  }

  // Real send (now or scheduled) goes through the campaign queue: recipients
  // are snapshotted at send time, emails go out in batches, and nobody is
  // sent the same campaign twice (lib/campaignSchedule.ts).
  const aud: Audience = (["subscribers", "all", "members", "nonmembers", "custom", "groups"] as const).includes(audience as Audience) ? (audience as Audience) : "subscribers";
  const customEmails = aud === "custom" ? String(customList || "").split(/[\s,;]+/).filter((e) => /@/.test(e)) : undefined;
  const groups = aud === "groups" ? AUDIENCE_GROUPS.filter((g) => Array.isArray(rawGroups) && rawGroups.includes(g)) : undefined;
  if (aud === "groups" && !groups?.length) return NextResponse.json({ error: "Pick at least one group to send to." }, { status: 400 });
  const preview = await recipientsFor(aud, customEmails, groups);
  if (preview.length === 0) {
    return NextResponse.json({ error: aud === "custom" ? "None of those emails are active subscribers." : "No active subscribers in that group." }, { status: 400 });
  }
  const when = Number(scheduledFor) || 0;
  if (when && when < Date.now() - 60_000) return NextResponse.json({ error: "That time has already passed." }, { status: 400 });
  const campaign = await createCampaign({ subject, body, audience: aud, customEmails, groups, scheduledFor: when || undefined, theme: cleanThemeChoice(rawTheme) });
  auditDetail({ targetId: campaign.id, after: { subject: campaign.subject, audience: aud, groups, recipients: preview.length, scheduledFor: campaign.scheduledFor, theme: campaign.theme } });
  if (when && when > Date.now()) {
    return NextResponse.json({
      ok: true,
      scheduled: true,
      id: campaign.id,
      scheduledFor: campaign.scheduledFor,
      recipients: preview.length,
      note: inWindow(when) ? undefined : "That's outside 9am–6pm local, so it will go out at 9am the next morning.",
    });
  }
  const r = await processCampaign(campaign.id, siteUrl, Date.now() + 45_000);
  const remaining = Math.max(0, preview.length - r.sent - r.failed);
  console.log(`[campaigns] ${campaign.id} sent=${r.sent} failed=${r.failed} remaining=${remaining}`);
  return NextResponse.json({ ok: true, id: campaign.id, sent: r.sent, failed: r.failed, total: preview.length, remaining });
}

/** History with results. */
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = (await listCampaigns()).slice(0, 40);
  const oldest = rows.reduce((m, c) => Math.min(m, c.createdAt), Date.now());
  const traffic = await readTraffic(pacificDay(Math.max(oldest, Date.now() - 120 * 86_400_000)), pacificDay());
  const count = (key: string) => traffic.reduce((n, r) => n + (r.c[key] || 0), 0);
  return NextResponse.json(
    {
      campaigns: rows.map((c) => ({
        ...publicCampaign(c),
        // Staff only: a scheduled pasted-list campaign's addresses, so it can be edited.
        ...(c.status === "scheduled" && c.customEmails?.length ? { customEmails: c.customEmails } : {}),
        opens: count(`eo:${c.id}`),
        clicks: count(`ec:${c.id}`),
        visits: count(`c:${c.id}`),
        orders: count(`co:${c.id}`),
        revenue: Math.round(count(`cv:${c.id}`)) / 100,
      })),
      window: "9am–6pm local",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/**
 * { action: "cancel", id }
 * { action: "update", id, subject, body, theme?, audience, groups?, customList?, scheduledFor? }
 *   edits a scheduled campaign that hasn't started sending.
 */
async function PATCH_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as {
    action?: string; id?: string; subject?: string; body?: string; theme?: string; audience?: string; groups?: string[]; customList?: string; scheduledFor?: number;
  };
  const { action, id } = b;
  auditDetail({ action: `campaign.${action || "unknown"}`, targetId: id });
  if (action === "update") {
    if (!b.subject?.trim() || !b.body?.trim()) return NextResponse.json({ error: "Subject and body are required." }, { status: 400 });
    if (b.body.includes("[[PHOTO]]")) return NextResponse.json({ error: "The photo from the chat hasn't been added yet. Use Upload photo, or delete the [[PHOTO]] line." }, { status: 400 });
    const aud: Audience = (["subscribers", "all", "members", "nonmembers", "custom", "groups"] as const).includes(b.audience as Audience) ? (b.audience as Audience) : "groups";
    const customEmails = aud === "custom" ? String(b.customList || "").split(/[\s,;]+/).filter((e) => /@/.test(e)) : undefined;
    const groups = aud === "groups" ? AUDIENCE_GROUPS.filter((g) => Array.isArray(b.groups) && b.groups.includes(g)) : undefined;
    if (aud === "groups" && !groups?.length) return NextResponse.json({ error: "Pick at least one group to send to." }, { status: 400 });
    const when = Number(b.scheduledFor) || 0;
    if (!when || when < Date.now() - 60_000) return NextResponse.json({ error: "Pick a time in the future. To send it now, cancel this one and send a copy." }, { status: 400 });
    const recipients = (await recipientsFor(aud, customEmails, groups)).length;
    if (recipients === 0) return NextResponse.json({ error: "Nobody in that group would get it." }, { status: 400 });
    const r = await updateCampaign(String(id || ""), { subject: b.subject, body: b.body, audience: aud, customEmails, groups, scheduledFor: when, theme: cleanThemeChoice(b.theme) });
    if (!r) return NextResponse.json({ error: "Only a scheduled campaign that hasn't started sending can be edited." }, { status: 400 });
    auditDetail({
      before: { subject: r.before.subject, audience: r.before.audience, groups: r.before.groups, scheduledFor: r.before.scheduledFor, theme: r.before.theme, bodyLength: r.before.body.length },
      after: { subject: r.after.subject, audience: r.after.audience, groups: r.after.groups, scheduledFor: r.after.scheduledFor, theme: r.after.theme, bodyLength: r.after.body.length, recipients },
    });
    return NextResponse.json({
      ok: true,
      campaign: publicCampaign(r.after),
      recipients,
      note: inWindow(r.after.scheduledFor) ? undefined : "That's outside 9am–6pm local time, so it will go out at 9am the next morning.",
    });
  }
  if (action !== "cancel") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const c = await cancelCampaign(String(id || ""));
  if (!c) return NextResponse.json({ error: "Only a scheduled campaign that hasn't started can be cancelled." }, { status: 400 });
  return NextResponse.json({ ok: true, campaign: publicCampaign(c) });
}

// One audit-log entry per request (see lib/audit.ts).
export const POST = audited("campaign.send", "campaign", POST_handler);
export const PATCH = audited("campaign.change", "campaign", PATCH_handler);
