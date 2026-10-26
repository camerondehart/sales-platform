import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { getInquiries, getInquiriesByUser } from "@/lib/inquiries";

export async function GET(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");

  if (userId) {
    const inquiries = await getInquiriesByUser(userId);
    return NextResponse.json({ inquiries });
  }

  const all = await getInquiries();
  all.sort((a, b) => b.createdAt - a.createdAt);
  return NextResponse.json({ inquiries: all });
}
