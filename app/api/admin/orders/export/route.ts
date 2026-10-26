import { NextResponse } from "next/server";
import { pacificDateTime, pacificDay } from "@/lib/periods";
import { isAdmin } from "@/lib/auth";
import { getOrders } from "@/lib/orders";
import { brand } from "@/lib/brand";

// Download all orders as a CSV file.
export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const orders = await getOrders();
  orders.sort((a, b) => b.createdAt - a.createdAt);

  const header = [
    "Order ID", `Date (${brand.timezoneLabel})`, "Customer", "Email", "Status", "Method",
    "Items", "Subtotal", "Discount", "Shipping", "Total", `Paid At (${brand.timezoneLabel})`, `Shipped At (${brand.timezoneLabel})`,
    "Tracking", "Note",
  ];
  const rows = orders.map((o) => [
    o.id,
    pacificDateTime(o.createdAt),
    o.userName,
    o.userEmail,
    o.status,
    o.shippingMethod,
    o.items.map((i) => `${i.productName} x${i.quantity}`).join("; "),
    o.subtotal.toFixed(2),
    (o.discount || 0).toFixed(2),
    o.shippingCost.toFixed(2),
    o.total.toFixed(2),
    pacificDateTime(o.paidAt),
    pacificDateTime(o.shippedAt),
    o.trackingNumber || "",
    o.note || "",
  ]);

  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="orders-${pacificDay()}.csv"`,
    },
  });
}
