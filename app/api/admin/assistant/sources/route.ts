import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { audited, auditDetail } from "@/lib/audit";
import { addSource, listSources, refreshAll, removeSource } from "@/lib/assistant/sources";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await listSources(true);
  return NextResponse.json(
    {
      sources: rows.map((s) => ({ id: s.id, url: s.url, title: s.title, chars: s.text.length, preview: s.text.slice(0, 220), fetchedAt: s.fetchedAt, ok: s.ok, error: s.error })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/** { action: "add", url } | { action: "refresh" } | { action: "remove", id } */
async function POST_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let b: { action?: string; url?: string; id?: string };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  auditDetail({ action: `assistant.source_${b.action || "unknown"}`, targetId: b.url || b.id });
  if (b.action === "add") {
    const r = await addSource(String(b.url || ""));
    if (r.added === 0) return NextResponse.json({ error: r.error || "Couldn't read that page." }, { status: 400 });
    return NextResponse.json({ ok: true, ...r });
  }
  if (b.action === "refresh") return NextResponse.json({ ok: true, ...(await refreshAll()) });
  if (b.action === "remove") {
    const ok = await removeSource(String(b.id || ""));
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

// One audit-log entry per request (see lib/audit.ts).
export const POST = audited("assistant.source", "assistant", POST_handler);
