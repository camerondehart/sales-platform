import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { getOrders, getOrderById, updateOrder, type OrderStatus } from "@/lib/orders";

import { awardLoyaltyPoints } from "@/lib/loyalty";
import { audited, auditDetail } from "@/lib/audit";
import { returnStock, takeStock } from "@/lib/stock";

const VALID_STATUSES: OrderStatus[] = [
  "inquiry", "pending", "paid", "completed", "cancelled",
  // Legacy values still accepted so older clients / stored data keep working
  "shipped", "picked-up",
];

export async function GET(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = new URL(req.url).searchParams.get("userId");
  let orders = await getOrders();
  if (userId) orders = orders.filter((o) => o.userId === userId);
  orders.sort((a, b) => b.createdAt - a.createdAt);
  return NextResponse.json({ orders });
}

async function PATCH_handler(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id, status } = await req.json();
  if (!id || !status || !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "invalid_fields" }, { status: 400 });
  }

  // Normalize legacy values so everything stored from now on uses "completed".
  const nextStatus = status === "shipped" || status === "picked-up" ? "completed" : status;

  // Targeted read — don't download the whole store to look at one order.
  const existing = await getOrderById(id);
  auditDetail({ targetId: id, before: existing ? { status: existing.status, total: existing.total, customer: existing.userEmail } : undefined, after: { status: nextStatus } });

  const changes: Parameters<typeof updateOrder>[1] = { status: nextStatus };
  if (nextStatus === "paid") changes.paidAt = Date.now();
  if (nextStatus === "completed") {
    // Keep the detail timestamp that matches how the order was fulfilled —
    // the status no longer distinguishes them, but the order record still does.
    if (existing?.shippingMethod === "pickup") changes.pickedUpAt = Date.now();
    else changes.shippedAt = Date.now();
    // A completed order is settled, so make sure it's marked paid too.
    if (existing && !existing.paidAt) changes.paidAt = Date.now();
  }

  // Stock counts: a cancel puts the order's units back; un-cancelling takes them again.
  let stockMoved: "returned" | "retaken" | null = null;
  if (existing?.stockTaken?.length) {
    if (nextStatus === "cancelled" && existing.status !== "cancelled" && !existing.stockReturnedAt) {
      try {
        await returnStock(existing.stockTaken);
        changes.stockReturnedAt = Date.now();
        stockMoved = "returned";
      } catch (err) {
        console.error("[orders] couldn't put stock back", err);
      }
    } else if (nextStatus !== "cancelled" && existing.stockReturnedAt) {
      try {
        await takeStock(existing.stockTaken.map((t) => ({ productId: t.productId, quantity: t.qty })), new Map());
        changes.stockReturnedAt = undefined;
        stockMoved = "retaken";
      } catch (err) {
        console.error("[orders] couldn't take stock again", err);
      }
    }
  }
  if (stockMoved) auditDetail({ after: { status: nextStatus, stock: stockMoved, units: existing!.stockTaken } });

  const order = await updateOrder(id, changes);
  if (!order) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Award loyalty points the first time an order is settled
  if (nextStatus === "paid" || nextStatus === "completed") {
    await awardLoyaltyPoints(order);
  }

  return NextResponse.json({ ok: true, order });
}

// One audit-log entry per request (see lib/audit.ts).
export const PATCH = audited("order.status_change", "order", PATCH_handler);
