import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { audited, auditDetail } from "@/lib/audit";
import { deleteTemplate, duplicateTemplate, hiddenStarters, listTemplates, resetStarter, restoreStarters, saveTemplate, setArchived } from "@/lib/emailTemplates";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const [templates, hidden] = await Promise.all([listTemplates(), hiddenStarters()]);
    return NextResponse.json({ templates, hiddenStarters: hidden.length }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[templates] read failed", err);
    return NextResponse.json({ error: "Couldn't load templates. Try again." }, { status: 503 });
  }
}

/** { action: "save" | "duplicate" | "archive" | "unarchive" | "delete" | "reset" | "restore_starters", ... } */
async function POST_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const action = String(b.action || "");
  auditDetail({ action: `template.${action || "unknown"}` });
  try {
    if (action === "save") {
      const t = await saveTemplate({ id: b.id ? String(b.id) : undefined, name: b.name, category: b.category, subject: b.subject, body: b.body });
      return NextResponse.json({ ok: true, template: t });
    }
    if (action === "duplicate") return NextResponse.json({ ok: true, template: await duplicateTemplate(String(b.id || "")) });
    if (action === "archive" || action === "unarchive") {
      const t = await setArchived(String(b.id || ""), action === "archive");
      if (!t) return NextResponse.json({ error: "Template not found." }, { status: 404 });
      return NextResponse.json({ ok: true, template: t });
    }
    if (action === "delete") {
      const gone = await deleteTemplate(String(b.id || ""));
      if (!gone) return NextResponse.json({ error: "Template not found." }, { status: 404 });
      // The full template goes in the Activity log, so it can be put back by hand if needed.
      auditDetail({ targetId: gone.id, before: gone });
      return NextResponse.json({ ok: true, template: gone });
    }
    if (action === "reset") {
      // A built-in template back to its original wording.
      const old = await resetStarter(String(b.id || ""));
      auditDetail({ targetId: String(b.id || ""), before: old });
      return NextResponse.json({ ok: true, reset: !!old });
    }
    if (action === "restore_starters") return NextResponse.json({ ok: true, restored: await restoreStarters() });
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't save." }, { status: 400 });
  }
}

// One audit-log entry per request (see lib/audit.ts).
export const POST = audited("template.change", "campaign", POST_handler);
