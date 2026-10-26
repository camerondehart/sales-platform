import { NextResponse } from "next/server";
import { customerReplyTo } from "@/lib/replyTo";
import { Resend } from "resend";
import { isAdmin } from "@/lib/auth";
import {
  getUsers,
  toPublic,
  updateUserStatus,
  clearWelcomeSent,
  deleteUser,
  createMemberByAdmin,
  type UserStatus,
} from "@/lib/users";
import { put } from "@vercel/blob";
import { removeSubscriberByEmail, addSubscriber } from "@/lib/subscribers";
import { audited, auditDetail } from "@/lib/audit";
import { brand } from "@/lib/brand";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendWelcomeEmail(name: string, email: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev";
  if (!apiKey) return false;

  const siteUrl = brand.siteUrl;

  try {
    const resend = new Resend(apiKey);
    const firstName = name.split(" ")[0] || name;
    const result = await resend.emails.send({
      from: fromEmail,
      to: email,
      reply_to: customerReplyTo(),
      subject: `Welcome to ${brand.members}`,
      html: `
        <div style="font-family: 'Optima', Candara, 'Helvetica Neue', sans-serif; max-width: 560px; margin: 0 auto; padding: 2rem; color: #61676d; background: #f9f9f8;">
          <div style="font-size: 0.7rem; letter-spacing: 0.18em; text-transform: uppercase; color: #85ba45; font-weight: 700; margin-bottom: 1rem;">You're In</div>
          <h1 style="font-family: 'Libre Baskerville', Georgia, serif; font-size: 1.7rem; font-weight: 400; font-style: italic; margin: 0 0 1.5rem; color: #61676d;">Welcome, ${escapeHtml(firstName)}.</h1>
          <p style="line-height: 1.6; margin: 0 0 1rem;">
            Your access to ${brand.members} has been approved. You can now sign in any time at our member site to browse the gallery and reach out about anything that catches your eye.
          </p>
          <p style="line-height: 1.6; margin: 0 0 1.5rem;">
            Use the email and password you signed up with. If you need to reach us, please reach out to ${brand.supportEmail}.
          </p>
          <div style="text-align: center; margin: 0 0 2rem;">
            <a href="${siteUrl}" style="display: inline-block; background: #85ba45; color: white; padding: 0.85rem 1.75rem; border-radius: 4px; text-decoration: none; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; font-size: 0.8rem;">Enter the site</a>
          </div>
          <div style="font-size: 0.8rem; color: #81858b; border-top: 1px solid #abaeb2; padding-top: 1rem;">
            — ${brand.name}
          </div>
        </div>
      `,
    });
    if (result.error) {
      console.error("Welcome email rejected by Resend:", result.error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Welcome email failed:", err);
    return false;
  }
}

async function sendAccountCreatedEmail(name: string, email: string, password: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev";
  if (!apiKey) return false;
  const siteUrl = brand.siteUrl;
  try {
    const resend = new Resend(apiKey);
    const firstName = name.split(" ")[0] || name;
    const result = await resend.emails.send({
      from: fromEmail,
      to: email,
      reply_to: customerReplyTo(),
      subject: `Your ${brand.members} account is ready`,
      html: `
        <div style="font-family: 'Optima', Candara, 'Helvetica Neue', sans-serif; max-width: 560px; margin: 0 auto; padding: 2rem; color: #61676d; background: #f9f9f8;">
          <div style="font-size: 0.7rem; letter-spacing: 0.18em; text-transform: uppercase; color: #85ba45; font-weight: 700; margin-bottom: 1rem;">You're In</div>
          <h1 style="font-family: 'Libre Baskerville', Georgia, serif; font-size: 1.7rem; font-weight: 400; font-style: italic; margin: 0 0 1.5rem; color: #61676d;">Welcome, ${escapeHtml(firstName)}.</h1>
          <p style="line-height: 1.6; margin: 0 0 1rem;">
            We've set up your account for ${brand.members}, our members-only site. Sign in with this email address and the password below:
          </p>
          <div style="margin: 1.5rem 0; padding: 1rem 1.25rem; background: #e8e5e5; border-left: 3px solid #85ba45; border-radius: 0 4px 4px 0; font-family: Consolas, monospace; font-size: 1.05rem; color: #61676d;">
            ${escapeHtml(password)}
          </div>
          <p style="line-height: 1.6; margin: 0 0 1.5rem;">
            Once you're in, please change it to something only you know from your account menu.
          </p>
          <div style="text-align: center; margin: 0 0 2rem;">
            <a href="${siteUrl}" style="display: inline-block; background: #85ba45; color: white; padding: 0.85rem 1.75rem; border-radius: 4px; text-decoration: none; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; font-size: 0.8rem;">Sign in</a>
          </div>
          <div style="font-size: 0.8rem; color: #81858b; border-top: 1px solid #abaeb2; padding-top: 1rem;">
            Questions? ${brand.supportEmail}<br/>— ${brand.name}
          </div>
        </div>
      `,
    });
    if (result.error) {
      console.error("Account-created email rejected by Resend:", result.error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Account-created email failed:", err);
    return false;
  }
}

// Admin creates a member directly — approved immediately, no request step.
async function POST_handler(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { name, email, password, sendEmail, subscribe } = (await req.json()) as {
    name: string; email: string; password: string; sendEmail?: boolean; subscribe?: boolean;
  };

  let result;
  try {
    result = await createMemberByAdmin({ name: name || "", email: email || "", password: password || "" });
  } catch (err) {
    console.error("Failed to create member", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not create that member." },
      { status: 500 }
    );
  }
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  // Mailing list is opt-in from the admin form. Never blocks the creation.
  let subscribed = false;
  if (subscribe) {
    try {
      subscribed = !!(await addSubscriber(result.user.email, result.user.name, "member"));
    } catch (err) {
      console.error("Could not add new member to mailing list", err);
    }
  }

  let emailSent = false;
  if (sendEmail) {
    for (let attempt = 1; attempt <= 3 && !emailSent; attempt++) {
      emailSent = await sendAccountCreatedEmail(result.user.name, result.user.email, password);
      if (!emailSent && attempt < 3) await new Promise((r) => setTimeout(r, attempt * 400));
    }
  }

  return NextResponse.json({ ok: true, user: toPublic(result.user), emailSent, subscribed });
}

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const users = await getUsers();
  users.sort((a, b) => b.createdAt - a.createdAt);
  return NextResponse.json({ users: users.map(toPublic) });
}

async function PATCH_handler(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id, status } = (await req.json()) as {
    id: string;
    status: UserStatus;
  };

  if (!id || !["pending", "approved", "rejected"].includes(status)) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  try {
    const prev = (await getUsers()).find((u) => u.id === id);
    auditDetail({ targetId: id, before: prev ? { status: prev.status, email: prev.email } : undefined, after: { status } });
  } catch {
    /* the audit "before" is best effort */
  }

  // Surface storage failures instead of returning a hollow success — a silent
  // no-op here is what makes an approval look like it "didn't take".
  let result;
  try {
    result = await updateUserStatus(id, status);
  } catch (err) {
    console.error("Failed to update member status", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not update that member." },
      { status: 500 }
    );
  }

  // The welcome email is claimed inside updateUserStatus, in the same write
  // that flips the status. Only the request that performed the real
  // pending -> approved transition gets here, so clicking Approve twice
  // cannot send a second email.
  let welcomeEmailFailed = false;
  if (result.shouldSendWelcome) {
    // Await so Vercel doesn't kill the function before email is reached.
    // Retry a couple of times so a momentary Resend blip doesn't cost the
    // member their welcome email.
    let sent = false;
    for (let attempt = 1; attempt <= 3 && !sent; attempt++) {
      sent = await sendWelcomeEmail(result.user.name, result.user.email);
      if (!sent && attempt < 3) {
        console.warn(`Welcome email attempt ${attempt} failed for ${result.user.email}; retrying`);
        await new Promise((r) => setTimeout(r, attempt * 400));
      }
    }
    if (!sent) {
      // Don't leave them marked as emailed when nothing was delivered.
      // Clearing the stamp means simply approving again will send it.
      welcomeEmailFailed = true;
      await clearWelcomeSent(id);
      console.error(`Welcome email failed after 3 attempts for ${result.user.email}`);
    }
  }

  // Return the saved record so the dashboard can sync to server truth rather
  // than trusting a list read that may still be catching up.
  return NextResponse.json({
    ok: true,
    user: toPublic(result.user),
    welcomeEmailFailed,
  });
}

async function DELETE_handler(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }

  // Fetch the user to be deleted (to backup)
  const users = await getUsers();
  const userToDelete = users.find((u) => u.id === id);
  if (!userToDelete) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // ---- Backup the user before deletion ----
  try {
    const backupKey = `backups/users/${id}_${Date.now()}.json`;
    await put(backupKey, JSON.stringify(userToDelete, null, 2), {
      access: "public",
      addRandomSuffix: true,
    });
    console.log(`[BACKUP] User ${id} (${userToDelete.email}) backed up to ${backupKey}`);
  } catch (err) {
    console.error(`[BACKUP FAILED] Could not backup user ${id}:`, err);
    // Continue deletion – you may choose to abort by returning an error
  }

  // Proceed with deletion — say what went wrong rather than a bare 500.
  try {
    await deleteUser(id);
  } catch (err) {
    console.error(`Failed to delete member ${id}`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not delete that member." },
      { status: 500 }
    );
  }

  // Take them off the mailing list too. Deleting the account but leaving the
  // address subscribed would keep sending campaigns to someone the business
  // no longer has a record of. Never let this fail the deletion itself.
  let removedFromMailingList = false;
  try {
    removedFromMailingList = await removeSubscriberByEmail(userToDelete.email);
    if (removedFromMailingList) {
      console.log(`[DELETE] ${userToDelete.email} also removed from the mailing list`);
    }
  } catch (err) {
    console.error(`Could not remove ${userToDelete.email} from the mailing list:`, err);
  }

  return NextResponse.json({ ok: true, removedFromMailingList });
}

// One audit-log entry per request (see lib/audit.ts).
export const POST = audited("member.create", "member", POST_handler);
export const PATCH = audited("member.status_change", "member", PATCH_handler);
export const DELETE = audited("member.delete", "member", DELETE_handler);
