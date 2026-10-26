import { NextResponse } from "next/server";
import { getApprovedVisitor } from "@/lib/auth";
import { mutateUsers } from "@/lib/users";

export async function GET() {
  const user = await getApprovedVisitor();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({
    addressLine1: user.addressLine1 || "",
    addressLine2: user.addressLine2 || "",
    city: user.city || "",
    state: user.state || "",
    postalCode: user.postalCode || "",
  });
}

export async function POST(req: Request) {
  const user = await getApprovedVisitor();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { addressLine1, addressLine2, city, state, postalCode } = await req.json();
  const found = await mutateUsers<boolean>((users) => {
    const index = users.findIndex((u) => u.id === user.id);
    if (index === -1) return { users: null, result: false };
    users[index] = {
      ...users[index],
      addressLine1: addressLine1 || undefined,
      addressLine2: addressLine2 || undefined,
      city: city || undefined,
      state: state || undefined,
      postalCode: postalCode || undefined,
    };
    return { users, result: true };
  });
  if (!found) return NextResponse.json({ error: "user not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
