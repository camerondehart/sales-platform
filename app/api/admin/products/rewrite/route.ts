import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { tidyDescription } from "@/lib/assistant/productCopy";

export const dynamic = "force-dynamic";

// Products → "Tidy with Concierge". Returns a rewritten description for the
// form; nothing is saved until staff press Save (that save is audited).
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { name?: unknown; category?: unknown; description?: unknown; guidance?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const r = await tidyDescription({
    name: String(body.name || "").slice(0, 200),
    category: String(body.category || "").slice(0, 100),
    description: String(body.description || "").slice(0, 8000),
    guidance: String(body.guidance || "").slice(0, 300),
    req,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, text: r.text, model: r.model });
}
