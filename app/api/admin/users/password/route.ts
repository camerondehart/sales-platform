import { NextResponse } from "next/server";
import { customerReplyTo } from "@/lib/replyTo";
import { isAdmin } from "@/lib/auth";
import { setUserPassword, getUsers } from "@/lib/users";
import { Resend } from "resend";
import { audited } from "@/lib/audit";
import { brand } from "@/lib/brand";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendPasswordResetEmail(
  name: string,
  email: string,
  newPassword: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev";
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY not set" };

  try {
    const resend = new Resend(apiKey);
    const firstName = name.split(" ")[0] || name;
    const result = await resend.emails.send({
      from: fromEmail,
      to: email,
      reply_to: customerReplyTo(),
      subject: "Your password has been reset",
      html: `
        <div style="font-family: 'Optima', Candara, 'Helvetica Neue', sans-serif; max-width: 560px; margin: 0 auto; padding: 2rem; color: #61676d; background: #f9f9f8;">
          <div style="font-size: 0.7rem; letter-spacing: 0.18em; text-transform: uppercase; color: #85ba45; font-weight: 700; margin-bottom: 1rem;">Password Reset</div>
          <h1 style="font-family: 'Libre Baskerville', Georgia, serif; font-size: 1.7rem; font-weight: 400; font-style: italic; margin: 0 0 1.5rem; color: #61676d;">Hi ${escapeHtml(firstName)},</h1>
          <p style="line-height: 1.6; margin: 0 0 1rem;">
            Your password for ${brand.members} has been reset. You can now sign in with this new password:
          </p>
          <div style="margin: 1.5rem 0; padding: 1rem 1.25rem; background: #e8e5e5; border-left: 3px solid #85ba45; border-radius: 0 4px 4px 0; font-family: Consolas, monospace; font-size: 1.05rem; color: #61676d;">
            ${escapeHtml(newPassword)}
          </div>
          <p style="line-height: 1.6; margin: 0 0 1rem;">
            For your security, please sign in and change this to something only you know as soon as possible.
          </p>
          <p style="line-height: 1.6; margin: 0 0 2rem;">
            If you didn't request this reset, please reach out to ${brand.supportEmail}.
          </p>
          <div style="font-size: 0.8rem; color: #81858b; border-top: 1px solid #abaeb2; padding-top: 1rem;">
            — ${brand.name}
          </div>
        </div>
      `,
    });
    if (result.error) {
      return { ok: false, error: result.error.message ?? "Resend error" };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Password reset email failed:", err);
    return { ok: false, error: msg };
  }
}

async function POST_handler(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id, newPassword, sendEmail } = (await req.json()) as {
    id: string;
    newPassword: string;
    sendEmail?: boolean;
  };

  if (!id || !newPassword) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const result = await setUserPassword(id, newPassword);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  if (sendEmail) {
    const users = await getUsers();
    const user = users.find((u) => u.id === id);
    if (user) {
      const emailResult = await sendPasswordResetEmail(user.name, user.email, newPassword);
      return NextResponse.json({ ok: true, email: emailResult });
    }
    return NextResponse.json({ ok: true, email: { ok: false, error: "User not found after save" } });
  }

  return NextResponse.json({ ok: true, email: { ok: false, error: null } });
}

// One audit-log entry per request (see lib/audit.ts).
export const POST = audited("member.password_reset", "member", POST_handler);
