import { NextResponse } from "next/server";
import { customerReplyTo } from "@/lib/replyTo";
import { tooMany } from "@/lib/publicLimits";
import { Resend } from "resend";
import { getEvents, addRegistration } from "@/lib/events";
import { getVisitor } from "@/lib/auth";
import { addSubscriber } from "@/lib/subscribers";
import { escapeHtml } from "@/lib/invoiceEmail";
import { brand } from "@/lib/brand";

// Public: register for an event (auto-waitlists when full).
export async function POST(req: Request) {
  // Stop scripts flooding this form (lib/publicLimits.ts).
  const limited = tooMany(req, "event-register", { max: 12, minutes: 10 });
  if (limited) return limited;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { eventId, name, email, phone, notes, subscribe } = body;
  if (!eventId || !name?.trim() || !email?.trim() || !email.includes("@")) {
    return NextResponse.json({ error: "Please enter your name and a valid email." }, { status: 400 });
  }

  const events = await getEvents();
  const event = events.find((e) => e.id === eventId && e.published);
  if (!event) {
    return NextResponse.json({ error: "That event isn't available." }, { status: 404 });
  }
  if ((event.endDate || event.date) < Date.now() - 864e5) {
    return NextResponse.json({ error: "That event has already passed." }, { status: 400 });
  }

  // Duplicate and capacity checks happen inside the save (see addRegistration).
  const cleanEmail = email.trim().toLowerCase();
  const visitor = await getVisitor();
  let added;
  try {
    added = await addRegistration(event, {
      name: name.trim(),
      email: cleanEmail,
      phone: phone?.trim() || undefined,
      notes: notes?.trim()?.slice(0, 1000) || undefined,
      userId: visitor?.userId,
    });
  } catch (err) {
    console.error("Event registration failed to save", err);
    return NextResponse.json(
      { error: "We couldn't save your registration just now. Please try again in a moment." },
      { status: 503 }
    );
  }
  if (!added.ok) {
    return NextResponse.json(
      {
        error:
          added.reason === "duplicate"
            ? "You're already on the list for this event."
            : "This event and its waitlist are both full.",
      },
      { status: 400 }
    );
  }
  const reg = added.registration;
  const status = reg.status;

  if (subscribe) {
    try { await addSubscriber(cleanEmail, name, "signup"); } catch {}
  }

  // Confirmation + admin alert (best effort)
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev";
  const adminEmail = process.env.INQUIRY_TO_EMAIL;
  const when = new Date(event.date).toLocaleString("en-US", {
    timeZone: brand.timezone,
    weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
  });

  if (apiKey) {
    const resend = new Resend(apiKey);
    try {
      await resend.emails.send({
        from: fromEmail,
        to: cleanEmail,
        reply_to: customerReplyTo(),
        subject:
          status === "registered"
            ? `You're registered — ${event.title}`
            : `You're on the waitlist — ${event.title}`,
        html: `
        <div style="font-family:'Optima',Candara,'Helvetica Neue',sans-serif;max-width:560px;margin:0 auto;padding:2rem;color:#61676d;background:#f9f9f8;">
          <div style="font-size:0.7rem;letter-spacing:0.18em;text-transform:uppercase;color:#85ba45;font-weight:700;margin-bottom:1rem;">
            ${status === "registered" ? "You're registered" : "You're on the waitlist"}
          </div>
          <h1 style="font-family:'Libre Baskerville',Georgia,serif;font-size:1.5rem;font-weight:400;font-style:italic;margin:0 0 1.25rem;">${escapeHtml(event.title)}</h1>
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:0.35rem 0;color:#81858b;width:90px;">When</td><td style="padding:0.35rem 0;"><strong>${when}</strong></td></tr>
            <tr><td style="padding:0.35rem 0;color:#81858b;">Where</td><td style="padding:0.35rem 0;">${escapeHtml(event.location)}</td></tr>
            ${event.price ? `<tr><td style="padding:0.35rem 0;color:#81858b;">Price</td><td style="padding:0.35rem 0;">${escapeHtml(event.price)}</td></tr>` : ""}
          </table>
          <p style="line-height:1.6;margin-top:1.25rem;">
            ${status === "registered"
              ? "We're looking forward to seeing you. We'll be in touch if anything changes."
              : "You're on the waitlist — we'll email you right away if a spot opens up."}
          </p>
          <div style="margin-top:2rem;font-size:0.8rem;color:#81858b;border-top:1px solid #abaeb2;padding-top:1rem;">
            Questions? Reach out to <a href="mailto:${brand.supportEmail}" style="color:#6fa336;">${brand.supportEmail}</a>.
          </div>
        </div>`,
      });
    } catch (err) {
      console.error("Failed to send registration email", err);
    }

    if (adminEmail) {
      try {
        await resend.emails.send({
          from: fromEmail,
          to: adminEmail,
          reply_to: cleanEmail,
          subject: `🎟️ ${status === "registered" ? "Registration" : "Waitlist"} — ${event.title}`,
          html: `<p><strong>${escapeHtml(name)}</strong> (${escapeHtml(cleanEmail)}${phone ? `, ${escapeHtml(phone)}` : ""}) ${status === "registered" ? "registered for" : "joined the waitlist for"} <strong>${escapeHtml(event.title)}</strong> on ${when}.</p>${notes ? `<p>Notes: ${escapeHtml(notes)}</p>` : ""}`,
        });
      } catch (err) {
        console.error("Failed to send admin registration alert", err);
      }
    }
  }

  return NextResponse.json({ ok: true, status, registrationId: reg.id });
}
