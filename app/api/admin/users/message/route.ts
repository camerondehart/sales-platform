import { NextResponse } from "next/server";
import { Resend } from "resend";
import { isAdmin } from "@/lib/auth";
import { getUsers } from "@/lib/users";
import { escapeHtml } from "@/lib/invoiceEmail";
import { audited } from "@/lib/audit";
import { brand } from "@/lib/brand";

// Send a custom email from the admin to any member (from the members list).
async function POST_handler(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { userId, message, subject } = await req.json();
  if (!userId || !message?.trim()) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  const user = (await getUsers()).find((u) => u.id === userId);
  if (!user) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev";
  if (!apiKey) {
    return NextResponse.json({ error: "Resend API key missing" }, { status: 500 });
  }

  const html = `
  <div style="font-family: 'Optima', Candara, 'Helvetica Neue', sans-serif; max-width: 560px; margin: 0 auto; padding: 2rem; color: #61676d; background: #f9f9f8;">
    <div style="font-size: 0.7rem; letter-spacing: 0.18em; text-transform: uppercase; color: #85ba45; font-weight: 700; margin-bottom: 1rem;">A message from ${brand.members}</div>
    <h1 style="font-family: 'Libre Baskerville', Georgia, serif; font-size: 1.4rem; font-weight: 400; font-style: italic; margin: 0 0 1.5rem;">Hello, ${escapeHtml(user.name)}</h1>
    <div style="white-space: pre-wrap; line-height: 1.6; background: white; padding: 1.25rem; border-radius: 6px; border-left: 3px solid #85ba45;">${escapeHtml(message)}</div>
    <div style="margin-top: 1.5rem; font-size: 0.8rem; color: #81858b;">To get back to us, reach out to <a href="mailto:${brand.supportEmail}" style="color: #6fa336;">${brand.supportEmail}</a>.</div>
  </div>`;

  try {
    const resend = new Resend(apiKey);
    const r = await resend.emails.send({
      from: fromEmail,
      to: user.email,
      reply_to: process.env.INQUIRY_TO_EMAIL || undefined,
      subject: subject?.trim() || `A message from ${brand.members}`,
      html,
    });
    // Resend reports problems in the result rather than by throwing.
    if (r.error) {
      console.error("Resend rejected member message", r.error);
      return NextResponse.json({ error: `The email wasn't sent: ${r.error.message || "rejected by the mail service"}` }, { status: 502 });
    }
    return NextResponse.json({ ok: true, sentTo: user.email });
  } catch (err) {
    console.error("Failed to send member message", err);
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
  }
}

// One audit-log entry per request (see lib/audit.ts).
export const POST = audited("member.email_sent", "member", POST_handler);
