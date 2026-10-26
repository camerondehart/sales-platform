import { NextResponse } from "next/server";
import { tooMany } from "@/lib/publicLimits";
import { createUser } from "@/lib/users";
import { addSubscriber, recordOptOut } from "@/lib/subscribers";
import { Resend } from "resend";
import { brand } from "@/lib/brand";

export async function POST(req: Request) {
  // Stop scripts flooding this form (lib/publicLimits.ts).
  const limited = tooMany(req, "signup", { max: 6, minutes: 60 });
  if (limited) return limited;
  const body = (await req.json()) as {
    name: string;
    email: string;
    password: string;
    message?: string;
    ageVerified?: boolean;
    priorCustomer?: boolean;
    subscribe?: boolean;
  };

  // Enforce the age gate here too — the form check can be bypassed by
  // posting directly, and these are age-restricted products.
  if (body.ageVerified !== true) {
    return NextResponse.json(
      { error: "You must confirm you are 21 or over to request access." },
      { status: 400 }
    );
  }

  const result = await createUser(body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // Mailing list opt-in from the sign-up form. Ticked by default, so only an
  // explicit `false` keeps them off the list. Never blocks the sign-up.
  if (body.subscribe !== false) {
    try {
      await addSubscriber(body.email, body.name, "signup");
    } catch (err) {
      console.error("Failed to add signup subscriber", err);
    }
  } else {
    // Unticked "Keep me posted": members get campaigns unless they opt out
    // (Terms §9), so remember the opt-out now.
    try {
      await recordOptOut(body.email, body.name, "signup");
    } catch (err) {
      console.error("Failed to record signup opt-out", err);
    }
  }

  // Notify admin by email that there's a new signup pending review.
  const apiKey = process.env.RESEND_API_KEY;
  const toEmail = process.env.INQUIRY_TO_EMAIL;
  const fromEmail = process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev";

  if (apiKey && toEmail) {
    try {
      const resend = new Resend(apiKey);
      await resend.emails.send({
        from: fromEmail,
        to: toEmail,
        subject: `New member request — ${body.name}`,
        html: `
          <div style="font-family: 'Optima', Candara, 'Helvetica Neue', sans-serif; max-width: 560px; padding: 2rem; color: #61676d; background: #f9f9f8;">
            <div style="font-size: 0.7rem; letter-spacing: 0.18em; text-transform: uppercase; color: #85ba45; font-weight: 700;">Member Request — ${brand.members}</div>
            <h1 style="font-family: 'Libre Baskerville', Georgia, serif; font-size: 1.5rem; font-weight: 400; font-style: italic; margin: 0.5rem 0 2rem; color: #61676d;">${escapeHtml(body.name)}</h1>
            <table>
              <tr><td style="padding: 0.3rem 1rem 0.3rem 0; color: #81858b;">Email</td><td><a href="mailto:${escapeHtml(body.email)}" style="color: #85ba45;">${escapeHtml(body.email)}</a></td></tr>
              <tr><td style="padding: 0.3rem 1rem 0.3rem 0; color: #81858b;">21 or over</td><td>${body.ageVerified ? "Yes" : "No"}</td></tr>
              <tr><td style="padding: 0.3rem 1rem 0.3rem 0; color: #81858b;">Prior customer</td><td>${body.priorCustomer ? "Yes" : "No"}</td></tr>
              <tr><td style="padding: 0.3rem 1rem 0.3rem 0; color: #81858b;">Mailing list</td><td>${body.subscribe !== false ? "Yes" : "No"}</td></tr>
            </table>
            ${
              body.message
                ? `<div style="margin-top: 1.5rem; padding: 1rem 1.25rem; background: #e8e5e5; border-left: 3px solid #0fc7a3; font-style: italic; color: #61676d; white-space: pre-wrap;">${escapeHtml(body.message)}</div>`
                : ""
            }
            <div style="margin-top: 2rem; font-size: 0.9rem;">
              Review at <a href="${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : ""}/admin" style="color: #85ba45;">/admin</a>
            </div>
          </div>
        `,
      });
    } catch (err) {
      console.error("Signup notification email failed:", err);
    }
  }

  return NextResponse.json({ ok: true });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
