import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { audited, auditDetail } from "@/lib/audit";
import { getOrderById, updateOrder } from "@/lib/orders";
import { cleanReminderSettings, expireOrder, getReminderSettings, reviveOrder, runReminders, saveReminderSettings } from "@/lib/reminders";
import { getOrders } from "@/lib/orders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [settings, orders] = await Promise.all([getReminderSettings(), getOrders()]);
  return NextResponse.json(
    { settings, expired: orders.filter((o) => o.expiredAt && o.status === "pending").length },
    { headers: { "Cache-Control": "no-store" } }
  );
}

async function PUT_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const c = cleanReminderSettings(await req.json().catch(() => null));
  if (!c.ok) return NextResponse.json({ error: c.error }, { status: 400 });
  auditDetail({ before: await getReminderSettings(), after: c.value });
  await saveReminderSettings(c.value);
  return NextResponse.json({ ok: true, settings: c.value });
}

/** { action: "run" } | { action: "revive" | "expire" | "stop" | "resume", orderId } */
async function POST_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { action?: string; orderId?: string };
  auditDetail({ action: `reminders.${b.action || "unknown"}`, targetId: b.orderId });
  if (b.action === "run") {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || new URL(req.url).origin;
    const r = await runReminders(siteUrl);
    auditDetail({ after: r });
    return NextResponse.json({ ok: true, ...r });
  }
  const id = String(b.orderId || "");
  const o = await getOrderById(id);
  if (!o) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  let order;
  if (b.action === "expire") {
    if (o.status !== "pending" || o.isInquiry) return NextResponse.json({ error: "Only unpaid (Pending payment) orders can move to Expired." }, { status: 400 });
    if (o.expiredAt) return NextResponse.json({ ok: true, order: o });
    order = await expireOrder(id);
  } else if (b.action === "revive") order = await reviveOrder(id);
  else if (b.action === "stop") order = await updateOrder(id, { remindersOff: true });
  else if (b.action === "resume") order = await updateOrder(id, { remindersOff: false });
  else return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  return NextResponse.json({ ok: true, order });
}

// One audit-log entry per request (see lib/audit.ts).
export const PUT = audited("reminders.settings_update", "settings", PUT_handler);
export const POST = audited("reminders.action", "order", POST_handler);
