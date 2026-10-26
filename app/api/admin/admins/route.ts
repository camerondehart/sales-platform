import { NextResponse } from "next/server";
import { adminActor, isAdmin } from "@/lib/auth";
import { audited, auditDetail } from "@/lib/audit";
import { cleanAdmins, getAdmins, saveAdmins } from "@/lib/admins";
import { forgetAdminsCache } from "@/lib/adminsCache";

export const dynamic = "force-dynamic";

/** Staff who can sign in with an emailed link (Settings → Staff sign-in). */
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ admins: await getAdmins(), you: await adminActor() }, { headers: { "Cache-Control": "no-store" } });
}

async function PUT_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { admins?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const c = cleanAdmins(body.admins);
  if (!c.ok) return NextResponse.json({ error: c.error }, { status: 400 });
  const me = await adminActor();
  if (me !== "admin" && !c.value.some((a) => a.email === me)) {
    return NextResponse.json({ error: "You can't remove yourself — ask another admin, or sign in with the shared password." }, { status: 400 });
  }
  const { before, after } = await saveAdmins(c.value);
  forgetAdminsCache();
  auditDetail({ targetId: "staff-list", before: before.map((a) => a.email), after: after.map((a) => a.email) });
  return NextResponse.json({ ok: true, admins: after });
}

export const PUT = audited("staff.update", "admin", PUT_handler);
