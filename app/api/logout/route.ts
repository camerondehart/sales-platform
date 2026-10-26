import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { VISITOR_COOKIE, ADMIN_COOKIE } from "@/lib/auth";

export async function POST() {
  cookies().delete(VISITOR_COOKIE);
  cookies().delete(ADMIN_COOKIE);
  return NextResponse.json({ ok: true });
}
