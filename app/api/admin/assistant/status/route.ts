import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { assistantStatus } from "@/lib/assistant/engine";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await assistantStatus(req), { headers: { "Cache-Control": "no-store" } });
}
