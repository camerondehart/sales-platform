import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { audited, auditDetail } from "@/lib/audit";
import { deleteFaq, forgetFaqCache, getFaq, moveFaq, saveFaq } from "@/lib/faq";

export const dynamic = "force-dynamic";

// Settings → FAQ page. Staff only; every write is in the Activity log.
//   GET                                      → { items }
//   POST { question, answer, category?, published? } → add one
//   PUT  { id, ...fields } | { id, move: "up"|"down" } → edit or reorder
//   DELETE ?id=                              → remove one

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? b : null;
  } catch {
    return null;
  }
}

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ items: await getFaq() }, { headers: { "Cache-Control": "no-store" } });
}

async function POST_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await readBody(req);
  if (!body) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const r = await saveFaq(undefined, body);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  forgetFaqCache();
  auditDetail({ targetId: r.item.id, after: { question: r.item.question, published: r.item.published } });
  return NextResponse.json({ ok: true, item: r.item });
}

async function PUT_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await readBody(req);
  const id = typeof body?.id === "string" ? body.id : "";
  if (!body || !id) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  if (body.move === "up" || body.move === "down") {
    const moved = await moveFaq(id, body.move);
    forgetFaqCache();
    auditDetail({ targetId: id, note: `Moved ${body.move}` });
    return NextResponse.json({ ok: moved });
  }
  const r = await saveFaq(id, body);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  forgetFaqCache();
  auditDetail({
    targetId: id,
    before: r.before ? { question: r.before.question, answer: r.before.answer, category: r.before.category, published: r.before.published } : undefined,
    after: { question: r.item.question, answer: r.item.answer, category: r.item.category, published: r.item.published },
  });
  return NextResponse.json({ ok: true, item: r.item });
}

async function DELETE_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") || "";
  const gone = id ? await deleteFaq(id) : null;
  if (!gone) return NextResponse.json({ error: "Already deleted." }, { status: 404 });
  forgetFaqCache();
  auditDetail({ targetId: id, before: { question: gone.question, answer: gone.answer } });
  return NextResponse.json({ ok: true });
}

export const POST = audited("faq.create", "faq", POST_handler);
export const PUT = audited("faq.update", "faq", PUT_handler);
export const DELETE = audited("faq.delete", "faq", DELETE_handler);
