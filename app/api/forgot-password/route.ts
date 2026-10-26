import { NextResponse } from "next/server";
import { tooMany } from "@/lib/publicLimits";
import { requestPasswordReset } from "@/lib/passwordReset";

export async function POST(req: Request) {
  // Stop scripts flooding this form (lib/publicLimits.ts).
  const limited = tooMany(req, "forgot-password", { max: 6, minutes: 15 });
  if (limited) return limited;
  const { email } = await req.json();
  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }
  // Silent by design — same response whether or not the account exists.
  await requestPasswordReset(email);
  return NextResponse.json({ ok: true });
}
