import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { updateUserProfile, toPublic, ADDRESS_FIELDS, type AddressField } from "@/lib/users";
import { renameSubscriberEmail } from "@/lib/subscribers";
import { audited, auditDetail } from "@/lib/audit";

// Admin correction of a member's name / email / shipping address / phone.
// Password, status and points are untouched.

async function PATCH_handler(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id, name, email, address } = (await req.json()) as {
    id: string;
    name?: string;
    email?: string;
    address?: Partial<Record<AddressField, string>>;
  };
  if (!id || (name === undefined && email === undefined && !address)) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  let result;
  try {
    result = await updateUserProfile(id, { name, email, address: address && typeof address === "object" ? address : undefined });
  } catch (err) {
    console.error("Failed to update member profile", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not update that member." },
      { status: 500 }
    );
  }
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  const now: Partial<Record<AddressField, string>> = {};
  for (const k of ADDRESS_FIELDS) if (result.user[k]) now[k] = result.user[k];
  auditDetail({ targetId: id, before: { email: result.previousEmail, ...result.previousAddress }, after: { email: result.user.email, name: result.user.name, ...now } });

  // If the email changed, move their mailing-list row too so campaigns
  // reach the corrected inbox. Best effort — the member fix already stuck.
  let subscriberMoved = false;
  if (result.previousEmail.toLowerCase() !== result.user.email.toLowerCase()) {
    try {
      subscriberMoved = await renameSubscriberEmail(result.previousEmail, result.user.email);
    } catch (err) {
      console.error("Subscriber email rename failed", err);
    }
  }

  return NextResponse.json({ ok: true, user: toPublic(result.user), subscriberMoved });
}

// One audit-log entry per request (see lib/audit.ts).
export const PATCH = audited("member.profile_update", "member", PATCH_handler);
