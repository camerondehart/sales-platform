import { NextResponse } from "next/server";
import { getApprovedVisitor } from "@/lib/auth";
import { getOrdersByUser } from "@/lib/orders";

// A member's own order history (safe fields only).
export async function GET() {
  const user = await getApprovedVisitor();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const orders = await getOrdersByUser(user.id);
  return NextResponse.json({
    orders: orders.map((o) => ({
      id: o.id,
      shortId: o.id.slice(-6).toUpperCase(),
      items: o.items,
      shippingMethod: o.shippingMethod,
      shippingCost: o.shippingCost,
      subtotal: o.subtotal,
      discount: o.discount || 0,
      total: o.total,
      status: o.status,
      isInquiry: o.isInquiry,
      createdAt: o.createdAt,
      trackingNumber: o.trackingNumber || null,
      // Cash-at-pickup orders confirm collection rather than payment.
      paymentMethod: o.paymentMethod || "invoice",
      // Token lets them reach their own pay page for pending orders
      paymentToken: o.status === "pending" ? o.paymentToken : null,
    })),
  });
}
