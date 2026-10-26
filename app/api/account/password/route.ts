import { NextResponse } from "next/server";
import { getApprovedVisitor } from "@/lib/auth";
import { verifyPassword, setUserPassword } from "@/lib/users";

export async function POST(req: Request) {
  const user = await getApprovedVisitor();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { currentPassword, newPassword } = (await req.json()) as {
    currentPassword: string;
    newPassword: string;
  };

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  if (newPassword.length < 8) {
    return NextResponse.json(
      { error: "Your new password must be at least 8 characters." },
      { status: 400 }
    );
  }

  if (newPassword === currentPassword) {
    return NextResponse.json(
      { error: "Your new password must be different from your current one." },
      { status: 400 }
    );
  }

  const verified = await verifyPassword(user.email, currentPassword);
  if (!verified) {
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.json(
      { error: "Your current password is incorrect." },
      { status: 401 }
    );
  }

  const result = await setUserPassword(user.id, newPassword);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
