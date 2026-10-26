import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { audited, auditDetail } from "@/lib/audit";
import { isEnabled } from "@/lib/flags";
import { addNote, deleteNote, getNotes, getRuns, NOTE_LIMITS, NOTE_MAX_CHARS, updateNote } from "@/lib/assistant/learnedNotes";
import { runNotesReview } from "@/lib/assistant/notesReview";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Assistant tab → Concierge notes. */
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [notes, runs, on] = await Promise.all([getNotes(true), getRuns().catch(() => []), isEnabled("concierge_learning")]);
  return NextResponse.json({ on, notes, runs: runs.slice(0, 10), limits: NOTE_LIMITS, maxChars: NOTE_MAX_CHARS }, { headers: { "Cache-Control": "no-store" } });
}

/** { action: "add" | "edit" | "pin" | "delete" | "run", ... } */
async function POST_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(b.action || "");
  auditDetail({ action: `concierge_note.${action || "unknown"}` });
  try {
    if (action === "add") {
      const note = await addNote({ scope: b.scope, text: b.text, todayKey: b.todayKey, pinned: b.pinned });
      auditDetail({ targetId: note.id, after: note });
      return NextResponse.json({ ok: true, note });
    }
    if (action === "edit" || action === "pin") {
      const r = await updateNote(String(b.id || ""), action === "edit" ? { text: b.text } : { pinned: b.pinned });
      if (!r) return NextResponse.json({ error: "Note not found." }, { status: 404 });
      auditDetail({ targetId: r.after.id, before: r.before, after: r.after });
      return NextResponse.json({ ok: true, note: r.after });
    }
    if (action === "delete") {
      const gone = await deleteNote(String(b.id || ""));
      if (!gone) return NextResponse.json({ error: "Note not found." }, { status: 404 });
      auditDetail({ targetId: gone.id, before: gone });
      return NextResponse.json({ ok: true });
    }
    if (action === "run") {
      const r = await runNotesReview({ trigger: "manual", req });
      if (r.skipped) return NextResponse.json({ error: r.skipped }, { status: 400 });
      if (!r.ok) return NextResponse.json({ error: r.error || "The review didn't finish." }, { status: 502 });
      return NextResponse.json({ ...r, ok: true });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't save." }, { status: 400 });
  }
}

export const POST = audited("concierge_note.change", "assistant", POST_handler);
