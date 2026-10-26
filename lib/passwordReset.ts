import { Resend } from "resend";
import { customerReplyTo } from "@/lib/replyTo";
import { findUserByEmail, setUserPassword } from "@/lib/users";
import { brand } from "@/lib/brand";

// The "Forgot password?" flow, shared by the sign-in form and the site
// assistant so both behave identically.
//
// Always resolves silently: whether or not the address belongs to an approved
// member, the caller shows the same "if that's an account, check your inbox"
// message. Revealing which emails have accounts would leak member identities.

function generateRandomPassword(): string {
  const adjectives = [
    "Ember", "Mountain", "Forest", "River", "Sage", "Cedar", "Pine",
    "Maple", "Coastal", "Quiet", "Sunlit", "Misty", "Dawn", "Dusk",
  ];
  const nouns = [
    "Wolf", "Cabin", "Trail", "Stone", "Bloom", "Path", "Fern",
    "Acorn", "Brook", "Ridge", "Glade", "Lantern", "Falcon", "Heron",
  ];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${adj}${noun}-${num}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function requestPasswordReset(email: string): Promise<void> {
  if (!email || typeof email !== "string") return;

  // Find user (case‑insensitive)
  const user = await findUserByEmail(email);
  if (!user) return; // Do NOT reveal that the email doesn't exist (security)

  // Only approved members can reset password
  if (user.status !== "approved") return;

  const newPassword = generateRandomPassword();
  const result = await setUserPassword(user.id, newPassword);
  if (!result.ok) {
    console.error("Failed to set new password for", user.email);
    return;
  }

  // Send email with new password
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev";
  const toEmail = user.email;

  if (!apiKey) {
    console.error("RESEND_API_KEY missing, cannot send password reset email");
    return;
  }

  const resend = new Resend(apiKey);
  const firstName = user.name.split(" ")[0] || user.name;

  try {
    await resend.emails.send({
      from: fromEmail,
      to: toEmail,
      reply_to: customerReplyTo(),
      subject: "Your password has been reset",
      html: `
        <div style="font-family: 'Optima', Candara, 'Helvetica Neue', sans-serif; max-width: 560px; margin: 0 auto; padding: 2rem; color: #61676d; background: #f9f9f8;">
          <div style="font-size: 0.7rem; letter-spacing: 0.18em; text-transform: uppercase; color: #85ba45; font-weight: 700; margin-bottom: 1rem;">Password Reset</div>
          <h1 style="font-family: 'Libre Baskerville', Georgia, serif; font-size: 1.7rem; font-weight: 400; font-style: italic; margin: 0 0 1.5rem; color: #61676d;">Hi ${escapeHtml(firstName)},</h1>
          <p style="line-height: 1.6; margin: 0 0 1rem;">
            You requested a password reset for your ${brand.members} account. Your new password is:
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
  } catch (err) {
    console.error("Failed to send password reset email:", err);
  }

}
