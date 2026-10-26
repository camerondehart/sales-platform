import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { audited, auditDetail } from "@/lib/audit";
import { inviteStats, runInvites, sendInviteTest, setJobStatus, startInvites, type InviteMode } from "@/lib/invites";
import { sendSetupLink } from "@/lib/passwordSetup";
import { getUsers } from "@/lib/users";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const siteOf = (req: Request) => process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || new URL(req.url).origin;

/** Members → Invite members to set a password: numbers + the current run. */
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await inviteStats(), { headers: { "Cache-Control": "no-store" } });
}

async function POST_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; mode?: string; userId?: string };
  const site = siteOf(req);
  switch (body.action) {
    case "test": {
      const r = await sendInviteTest(site);
      return r.ok ? NextResponse.json({ ok: true, to: r.to }) : NextResponse.json({ error: r.error }, { status: 502 });
    }
    case "start": {
      const mode: InviteMode = body.mode === "remind" ? "remind" : "never_invited";
      const r = await startInvites(mode);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
      auditDetail({ after: { mode, total: r.total } });
      // First batches straight away when it's sending hours; the cron does the rest.
      const first = await runInvites(site, { deadlineMs: 20_000 }).catch(() => ({ sent: 0, failed: 0, skipped: 0 }));
      return NextResponse.json({ ok: true, total: r.total, first, stats: await inviteStats() });
    }
    case "pause":
    case "resume":
    case "cancel": {
      const r = await setJobStatus(body.action);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
      return NextResponse.json({ ok: true, stats: await inviteStats() });
    }
    case "one": {
      const u = (await getUsers()).find((x) => x.id === body.userId);
      if (!u || u.status !== "approved") return NextResponse.json({ error: "That member isn't approved (or no longer exists)." }, { status: 404 });
      auditDetail({ targetId: u.id, after: { email: u.email } });
      const r = await sendSetupLink(u, site);
      return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: 502 });
    }
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

export const POST = audited("member.invite", "member", POST_handler);
