import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { getOrderById } from "@/lib/orders";
import { resendInvoice } from "@/lib/invoiceResend";
import { audited, auditDetail } from "@/lib/audit";

/** Re-send the original invoice email for an unpaid order. */
async function POST_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let orderId = "";
  try {
    orderId = String((await req.json())?.orderId || "");
  } catch {
    /* handled below */
  }
  if (!orderId) return NextResponse.json({ error: "Missing orderId." }, { status: 400 });
  const order = await getOrderById(orderId);
  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  const r = await resendInvoice(order, new URL(req.url).origin);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  auditDetail({ targetId: order.id, after: { sentTo: r.sentTo, total: order.total } });
  return NextResponse.json({ ok: true, sentTo: r.sentTo });
}

// One audit-log entry per request (see lib/audit.ts).
export const POST = audited("invoice.resend", "order", POST_handler);
