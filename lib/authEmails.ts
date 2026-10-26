import { Resend } from "resend";
import { customerReplyTo } from "@/lib/replyTo";
import { brand } from "@/lib/brand";

// Sign-in emails: the member's 6-digit code and the staff sign-in link.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function frame(kicker: string, title: string, inner: string) {
  return `
  <div style="font-family:'Optima',Candara,'Helvetica Neue',sans-serif;max-width:520px;margin:0 auto;padding:2rem;color:#61676d;background:#f9f9f8;">
    <div style="font-size:0.7rem;letter-spacing:0.18em;text-transform:uppercase;color:#85ba45;font-weight:700;margin-bottom:1rem;">${kicker}</div>
    <h1 style="font-family:'Libre Baskerville',Georgia,serif;font-size:1.5rem;font-weight:400;font-style:italic;margin:0 0 1.2rem;">${title}</h1>
    ${inner}
    <div style="margin-top:1.6rem;font-size:0.8rem;color:#81858b;border-top:1px solid #abaeb2;padding-top:1rem;">
      Didn't ask for this? You can ignore it — nobody can sign in without it. Questions: ${brand.supportEmail}
    </div>
  </div>`;
}

async function send(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[auth email] RESEND_API_KEY missing");
    return false;
  }
  try {
    const r = await new Resend(apiKey).emails.send({ from: process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev", to, subject, html, reply_to: customerReplyTo() });
    if (r.error) console.error("[auth email] rejected", r.error);
    return !r.error;
  } catch (err) {
    console.error("[auth email] failed", err);
    return false;
  }
}

export function sendMemberCode(to: string, name: string, code: string) {
  const first = esc(name.split(/\s+/)[0] || "there");
  return send(
    to,
    `${code} is your sign-in code`,
    frame(
      "Sign-in code",
      `Hi ${first},`,
      `<p style="line-height:1.6;margin:0 0 1rem;">Here's your code to sign in to ${brand.members}:</p>
       <div style="font-family:Consolas,monospace;font-size:2rem;letter-spacing:0.3em;color:#61676d;background:white;border-left:3px solid #85ba45;padding:0.9rem 1.2rem;border-radius:0 6px 6px 0;">${code}</div>
       <p style="line-height:1.6;margin:1rem 0 0;">It works once and expires in 10 minutes.</p>`
    )
  );
}

/** Staff who typed their email on the member sign-in: a code that opens the dashboard. */
export function sendStaffCode(to: string, name: string, code: string) {
  return send(
    to,
    `${code} is your sign-in code`,
    frame(
      "Staff sign-in",
      `Hi ${esc(name.split(/\s+/)[0] || "there")},`,
      `<p style="line-height:1.6;margin:0 0 1rem;">Here's your code to sign in to the ${brand.shortName} dashboard:</p>
       <div style="font-family:Consolas,monospace;font-size:2rem;letter-spacing:0.3em;color:#61676d;background:white;border-left:3px solid #85ba45;padding:0.9rem 1.2rem;border-radius:0 6px 6px 0;">${code}</div>
       <p style="line-height:1.6;margin:1rem 0 0;">It works once and expires in 10 minutes.</p>`
    )
  );
}

export function sendAdminLink(to: string, name: string, link: string) {
  return send(
    to,
    "Your dashboard sign-in link",
    frame(
      "Staff sign-in",
      `Hi ${esc(name.split(/\s+/)[0] || "there")},`,
      `<p style="line-height:1.6;margin:0 0 1.2rem;">Tap the button to sign in to the ${brand.shortName} dashboard. It works once and expires in 15 minutes.</p>
       <div style="text-align:center;"><a href="${esc(link)}" style="display:inline-block;background:#85ba45;color:white;padding:0.85rem 1.6rem;border-radius:6px;text-decoration:none;font-weight:700;">Sign in to the dashboard</a></div>`
    )
  );
}
