import { NextResponse } from "next/server";
import { adminActor, isAdmin } from "@/lib/auth";
import { audited, auditDetail } from "@/lib/audit";
import { isEnabled } from "@/lib/flags";
import { approveRequest, createRequest, declineRequest, editRequest, enforceSize, isApprover, listRequests, removeRequest, siteRequestsReady, requestOutcome } from "@/lib/siteRequests";
import { getAdmins } from "@/lib/admins";

export const dynamic = "force-dynamic";

// Settings → Site requests (switch site_requests).
//   GET                                   → { requests, canApprove, connected }
//   POST  { title, details, size, page? } → file a request (any staff)
//   PATCH { action: "approve"|"decline", number, note? } → the developer only (SITE_REQUEST_APPROVER)
//   PATCH { action: "edit", number, title, details, size } | { action: "remove", number } → the developer only

const off = async () => !(await isEnabled("site_requests").catch(() => false));

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (await off()) return NextResponse.json({ error: "Site requests are switched off." }, { status: 404 });
  const who = await adminActor();
  const base = { canApprove: isApprover(who), connected: siteRequestsReady() };
  if (!base.connected) return NextResponse.json({ ...base, requests: [] }, { headers: { "Cache-Control": "no-store" } });
  try {
    const [requests, staff] = await Promise.all([listRequests(), getAdmins().catch(() => [])]);
    const names = new Map(staff.map((a) => [a.email.toLowerCase(), a.name]));
    // Who asked, by name when they're on the staff sign-in list.
    const rows = requests.map((r) => ({ ...r, requestedByName: names.get(r.requestedBy.trim().toLowerCase()) || "" }));
    return NextResponse.json({ ...base, requests: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ ...base, requests: [], error: e instanceof Error ? e.message : "Couldn't reach GitHub." }, { status: 502 });
  }
}

async function POST_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (await off()) return NextResponse.json({ error: "Site requests are switched off." }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const title = String(b.title || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const details = String(b.details || "").trim().slice(0, 4000);
  const page = String(b.page || "").trim().slice(0, 120);
  if (title.length < 4 || details.length < 10) return NextResponse.json({ error: "Give the request a short title and describe what should change." }, { status: 400 });
  const { size, bumped } = enforceSize(String(b.size || "small"), title, details);
  const who = await adminActor();
  try {
    const r = await createRequest({ title, details, size, page: page || undefined, requestedBy: who === "admin" ? "staff (shared login)" : who, bumped });
    auditDetail({ targetId: `#${r.number}`, after: { title, size, status: r.status } });
    return NextResponse.json({ ok: true, request: r, bumped, message: requestOutcome(r.size, bumped) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't file the request." }, { status: 502 });
  }
}

async function PATCH_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (await off()) return NextResponse.json({ error: "Site requests are switched off." }, { status: 404 });
  const who = await adminActor();
  if (!isApprover(who)) return NextResponse.json({ error: "Only the developer can approve, decline, edit or remove site requests (sign in with your own Face ID or emailed link)." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { action?: string; number?: unknown; note?: unknown };
  const n = Number(b.number);
  if (!Number.isInteger(n) || n <= 0) return NextResponse.json({ error: "Which request?" }, { status: 400 });
  const note = String(b.note || "").trim().slice(0, 1000) || undefined;
  if (b.action === "edit") {
    const e = b as Record<string, unknown>;
    const title = String(e.title || "").replace(/\s+/g, " ").trim().slice(0, 120);
    const details = String(e.details || "").trim().slice(0, 4000);
    if (title.length < 4 || details.length < 10) return NextResponse.json({ error: "Give the request a short title and describe what should change." }, { status: 400 });
    const { size, bumped } = enforceSize(String(e.size || "small"), title, details);
    try {
      const r = await editRequest(n, { title, details, size, bumped }, who);
      auditDetail({ targetId: `#${n}`, after: { title, size, status: r.status } });
      return NextResponse.json({ ok: true, request: r, bumped });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't edit the request." }, { status: 502 });
    }
  }
  if (b.action === "remove") {
    try {
      await removeRequest(n, who);
      auditDetail({ targetId: `#${n}`, after: { status: "removed" } });
      return NextResponse.json({ ok: true, removed: n });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't remove the request." }, { status: 502 });
    }
  }
  try {
    const r = b.action === "approve" ? await approveRequest(n, who, note) : b.action === "decline" ? await declineRequest(n, who, note) : null;
    if (!r) return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    auditDetail({ targetId: `#${n}`, after: { status: r.status } });
    return NextResponse.json({ ok: true, request: r });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't update the request." }, { status: 502 });
  }
}

export const POST = audited("site_request.create", "site_request", POST_handler);
export const PATCH = audited("site_request.review", "site_request", PATCH_handler);
