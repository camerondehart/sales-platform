import { NextResponse } from "next/server";
import { isEnabled } from "@/lib/flags";
import { findAdmin } from "@/lib/admins";
import { clientIp, overLimit } from "@/lib/assistant/limits";

export const dynamic = "force-dynamic";

/**
 * Member sign-in form: is the typed email on the staff list? If so the form
 * hides the password box and offers "Email me a dashboard sign-in link" — the
 * same one-time link as /admin (/api/login/link), so it still has to come
 * from that inbox. Only answers when the staff sign-in link switch is on.
 * Limited per address so nobody can script through guesses; over the limit it
 * just answers "no" and the normal form shows.
 */
export async function POST(req: Request) {
  const no = NextResponse.json({ staff: false }, { headers: { "Cache-Control": "no-store" } });
  const body = (await req.json().catch(() => ({}))) as { email?: unknown };
  const email = String(body.email || "").trim().toLowerCase().slice(0, 200);
  if (!email.includes("@")) return no;
  if (overLimit(`staffcheck:${clientIp(req)}`, 30, 15 * 60_000)) return no;
  if (!(await isEnabled("admin_magic_link"))) return no;
  const staff = await findAdmin(email);
  return NextResponse.json({ staff: !!staff }, { headers: { "Cache-Control": "no-store" } });
}
