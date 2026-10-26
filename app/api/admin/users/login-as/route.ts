import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ACT_AS_MINUTES, adminActor, getVisitor, isAdmin, signActAsToken, VISITOR_COOKIE } from "@/lib/auth";
import { getUsers } from "@/lib/users";
import { audited, auditDetail } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * Members → "Log in as" (full access, clearly marked).
 *   { id }            → this browser becomes signed in as that member for 1 hour
 *   { action: "end" } → back to the dashboard (the member session is dropped)
 * The staff dashboard session is untouched. The member's password isn't
 * touched or revealed. The member pages show a "Signed in as … — Back to
 * admin" bar, orders placed say which staff member placed them, and every
 * start and end is in the Activity log.
 */
async function POST_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { id?: unknown; action?: unknown };
  const secure = process.env.NODE_ENV === "production";

  if (b.action === "end") {
    const v = await getVisitor();
    auditDetail({ action: "member.login_as_end", targetId: v?.userId, note: v?.as ? `Ended acting as this member` : "No member session was open" });
    cookies().set(VISITOR_COOKIE, "", { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 0 });
    return NextResponse.json({ ok: true });
  }

  const id = String(b.id || "");
  const user = (await getUsers()).find((u) => u.id === id);
  if (!user) return NextResponse.json({ error: "Member not found." }, { status: 404 });
  if (user.status !== "approved") return NextResponse.json({ error: "Only approved members can be signed in to — approve them first." }, { status: 400 });
  const actor = await adminActor();
  cookies().set(VISITOR_COOKIE, await signActAsToken(user.id, actor), { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: ACT_AS_MINUTES * 60 });
  auditDetail({ targetId: user.id, note: `Signed in as ${user.name} <${user.email}> for up to ${ACT_AS_MINUTES} minutes` });
  return NextResponse.json({ ok: true, name: user.name, minutes: ACT_AS_MINUTES });
}

export const POST = audited("member.login_as", "member", POST_handler);
