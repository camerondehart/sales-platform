import { NextResponse } from "next/server";
import { getApprovedVisitor } from "@/lib/auth";
import { askAboutItems } from "@/lib/ask";
import { overLimit } from "@/lib/assistant/limits";

/** Members: ask a question about the items in their cart (no order is created). */
export async function POST(req: Request) {
  const user = await getApprovedVisitor();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  if (overLimit(`ask:${user.id}`, 5, 3600_000)) {
    return NextResponse.json({ error: "You've sent a few questions already — we'll be in touch soon." }, { status: 429 });
  }
  let body: { items?: Array<{ productId: string; quantity: number }>; question?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const r = await askAboutItems(user, body.items || [], String(body.question || ""));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
