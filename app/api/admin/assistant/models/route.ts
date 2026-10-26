import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { gatewayCredential, listModels } from "@/lib/assistant/gateway";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const models = await listModels(gatewayCredential(req));
  return NextResponse.json({ models }, { headers: { "Cache-Control": "no-store" } });
}
