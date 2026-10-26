import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { getOverrides, saveOverrides } from "@/lib/storage";
import { audited } from "@/lib/audit";

async function POST_handler(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { adminPassword } = (await req.json()) as {
    adminPassword?: string;
  };

  if (!adminPassword || !adminPassword.trim()) {
    return NextResponse.json({ error: "missing_password" }, { status: 400 });
  }

  const current = await getOverrides();
  await saveOverrides({ ...current, adminPassword: adminPassword.trim() });

  return NextResponse.json({ ok: true });
}

// One audit-log entry per request (see lib/audit.ts).
export const POST = audited("admin.password_change", "admin", POST_handler);
