import { NextResponse } from "next/server";
import { Resend } from "resend";
import { escapeHtml } from "@/lib/invoiceEmail";

// Public: private workshop booking inquiry — emails the team.
export async function POST(req: Request) {
  const { name, email, phone, details } = await req.json();
  if (!name?.trim() || !email?.trim() || !email.includes("@") || !details?.trim()) {
    return NextResponse.json({ error: "Please fill in your name, email, and details." }, { status: 400 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev";
  const adminEmail = process.env.INQUIRY_TO_EMAIL;
  if (!apiKey || !adminEmail) {
    console.error("[private-inquiry] email not configured");
    return NextResponse.json({ ok: true, emailed: false });
  }

  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: fromEmail,
      to: adminEmail,
      reply_to: email.trim(),
      subject: `✨ Private workshop inquiry from ${name.trim()}`,
      html: `
      <div style="font-family:'Optima',Candara,'Helvetica Neue',sans-serif;max-width:560px;margin:0 auto;padding:2rem;color:#61676d;background:#f9f9f8;">
        <div style="font-size:0.7rem;letter-spacing:0.18em;text-transform:uppercase;color:#85ba45;font-weight:700;margin-bottom:1rem;">Private workshop inquiry</div>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:0.35rem 0;color:#81858b;width:80px;">Name</td><td style="padding:0.35rem 0;"><strong>${escapeHtml(name)}</strong></td></tr>
          <tr><td style="padding:0.35rem 0;color:#81858b;">Email</td><td style="padding:0.35rem 0;"><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></td></tr>
          ${phone ? `<tr><td style="padding:0.35rem 0;color:#81858b;">Phone</td><td style="padding:0.35rem 0;">${escapeHtml(phone)}</td></tr>` : ""}
        </table>
        <div style="margin-top:1.25rem;padding:1rem;background:white;border-left:3px solid #85ba45;border-radius:0 6px 6px 0;white-space:pre-wrap;line-height:1.6;">${escapeHtml(details)}</div>
      </div>`,
    });
    return NextResponse.json({ ok: true, emailed: true });
  } catch (err) {
    console.error("Failed to send private workshop inquiry", err);
    return NextResponse.json({ error: "Could not send your inquiry. Please email us directly." }, { status: 500 });
  }
}
