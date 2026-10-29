import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { isEnabled } from "@/lib/flags";
import { pacificDay } from "@/lib/periods";
import { acceptablePhrases, oldPasswordStatus } from "@/lib/staffPhrase";

export const dynamic = "force-dynamic";

// Settings → Steward password: today's staff phrase, for signed-in staff only
// (so nobody is locked out if the nightly email goes astray).
//   GET → { on, date, phrase, yesterday?, oldPassword: { works, until } }
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const on = await isEnabled("rotating_staff_password").catch(() => false);
  if (!on) return NextResponse.json({ on }, { headers: { "Cache-Control": "no-store" } });
  const [today, yesterday] = acceptablePhrases();
  const oldPassword = await oldPasswordStatus();
  return NextResponse.json({ on, date: pacificDay(), phrase: today, yesterday: yesterday || null, oldPassword }, { headers: { "Cache-Control": "no-store" } });
}
