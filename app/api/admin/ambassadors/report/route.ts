import { NextResponse } from "next/server";
import { Resend } from "resend";
import { isAdmin } from "@/lib/auth";
import { audited, auditDetail } from "@/lib/audit";
import { getAmbassadors, markReported, termsOf } from "@/lib/ambassadors";
import { ambassadorStatsFor } from "@/lib/ambassadorData";
import { buildAmbassadorReport, REPORT_PERIODS, type ReportPeriod } from "@/lib/ambassadorReport";
import { customerReplyTo } from "@/lib/replyTo";
import { pacificDay, pacificMidnight } from "@/lib/periods";

export const dynamic = "force-dynamic";

// Dashboard → Ambassadors → Email a progress report. Staff only.
// { id, period, note?, signoff?, send?: false } → a preview (subject + html)
// { …, send: true }                            → emailed to the ambassador
// { …, send: true, testTo: "me@…" }             → a test copy to staff instead

const monthName = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
const longDay = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });

/** The period's time range and how it reads in the email. */
function periodRange(period: ReportPeriod, startDate: string, now = Date.now()): { from: number; to: number; label: string } {
  const today = pacificDay(now);
  const thisMonth = `${today.slice(0, 7)}-01`;
  if (period === "last-month") {
    const [y, m] = thisMonth.split("-").map(Number);
    const prev = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
    return { from: pacificMidnight(prev), to: pacificMidnight(thisMonth) - 1, label: monthName(prev) };
  }
  if (period === "30-days") return { from: now - 30 * 86_400_000, to: now, label: "the last 30 days" };
  if (period === "since-start") return { from: pacificMidnight(startDate), to: now, label: `since ${longDay(startDate)}` };
  return { from: pacificMidnight(thisMonth), to: now, label: `${monthName(thisMonth)} so far` };
}

async function POST_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const id = String(body?.id || "");
  const a = (await getAmbassadors()).find((x) => x.id === id);
  if (!a) return NextResponse.json({ error: "That ambassador no longer exists." }, { status: 404 });
  const period = (Object.keys(REPORT_PERIODS) as ReportPeriod[]).includes(body?.period as ReportPeriod) ? (body!.period as ReportPeriod) : "this-month";
  const range = periodRange(period, termsOf(a).startDate);
  const stats = (await ambassadorStatsFor([a], { from: range.from, to: range.to }))[a.id];
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || new URL(req.url).origin;
  const note = String(body?.note ?? "").slice(0, 3000);
  const signoff = String(body?.signoff ?? "").slice(0, 300);
  const { subject, html } = buildAmbassadorReport({ ambassador: a, period, periodLabel: range.label, stats, siteUrl, note, signoff });

  if (!body?.send) return NextResponse.json({ ok: true, subject, html, to: a.email || null });

  const testTo = String(body.testTo || "").trim().toLowerCase();
  const to = testTo || a.email;
  if (!to) return NextResponse.json({ error: `Add ${a.name}'s email address first (Edit).` }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return NextResponse.json({ error: "That email address doesn't look right." }, { status: 400 });
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Email isn't set up (no Resend key)." }, { status: 500 });
  try {
    const r = await new Resend(apiKey).emails.send({
      from: process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev",
      to,
      reply_to: customerReplyTo(),
      subject: testTo ? `[Test] ${subject}` : subject,
      html,
    });
    if (r.error) return NextResponse.json({ error: `The email wasn't sent: ${r.error.message || "rejected by the mail service"}` }, { status: 502 });
  } catch (err) {
    console.error("[ambassadors] report not sent", err);
    return NextResponse.json({ error: "The email couldn't be sent. Try again in a moment." }, { status: 502 });
  }
  if (!testTo) await markReported(a.id);
  auditDetail({ targetId: a.id, after: { name: a.name, to, test: !!testTo, period, orders: stats.orders, earned: stats.earned, owed: stats.owed } });
  return NextResponse.json({ ok: true, sentTo: to });
}

export const POST = audited("ambassador.report", "ambassador", POST_handler);
