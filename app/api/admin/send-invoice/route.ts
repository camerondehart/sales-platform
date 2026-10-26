import { NextResponse } from "next/server";
import { customerReplyTo } from "@/lib/replyTo";
import { Resend } from "resend";
import { isAdmin } from "@/lib/auth";
import { getUsers } from "@/lib/users";
import { getProducts, effectivePrice, lineDiscount } from "@/lib/storage";
import { addOrder, parsePrice, type Order } from "@/lib/orders";
import { buildInvoiceEmail } from "@/lib/invoiceEmail";
import { audited } from "@/lib/audit";
import { brand } from "@/lib/brand";

// Admin-generated invoice. Creates a REAL order (so it appears in the
// orders queue with a payment token) and sends the exact same invoice
// email customers get at checkout — payment instructions and the
// "I've sent my payment" confirmation button included.

async function POST_handler(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { userId, items, note, shippingOverride } = await req.json();
  if (!userId || !items || items.length === 0) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const users = await getUsers();
  const user = users.find((u) => u.id === userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const products = await getProducts();
  const productMap = new Map(products.map((p) => [p.id, p]));

  const orderItems: Order["items"] = [];
  let subtotal = 0;
  let discount = 0;
  for (const item of items) {
    const product = productMap.get(item.id);
    if (!product) {
      return NextResponse.json({ error: `Product ${item.id} not found` }, { status: 400 });
    }
    const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
    const charged = effectivePrice(product); // honors fixed sale price and %-off promos
    subtotal += parsePrice(charged) * quantity;
    discount += lineDiscount(product, quantity); // quantity promos (BOGO)
    orderItems.push({
      productId: product.id,
      productName: product.name,
      price: charged,
      quantity,
    });
  }
  discount = Math.round(discount * 100) / 100;

  const shippingCost =
    shippingOverride !== undefined && shippingOverride !== null ? shippingOverride : 10;
  const total = Math.max(0, subtotal - discount + shippingCost);

  // Use the member's saved address if they have one
  const shippingAddress =
    user.addressLine1 && user.city && user.state && user.postalCode
      ? {
          addressLine1: user.addressLine1,
          addressLine2: user.addressLine2,
          city: user.city,
          state: user.state,
          postalCode: user.postalCode,
        }
      : undefined;

  const order = await addOrder({
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    items: orderItems,
    shippingAddress,
    shippingMethod: "ship",
    shippingCost,
    subtotal,
    discount: discount > 0 ? discount : undefined,
    total,
    note: note || undefined,
    isInquiry: false,
    status: "pending",
  });

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || new URL(req.url).origin;
  const payLink = `${siteUrl}/pay/${order.paymentToken}`;

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev";
  if (!apiKey) {
    return NextResponse.json({ error: "Resend API key missing" }, { status: 500 });
  }

  const resend = new Resend(apiKey);
  try {
    await resend.emails.send({
      from: fromEmail,
      to: user.email,
      reply_to: customerReplyTo(),
      subject: `Your invoice — ${brand.name} (Ref ${order.id.slice(-6).toUpperCase()})`,
      html: buildInvoiceEmail(order, payLink, note || null),
    });
    return NextResponse.json({ ok: true, orderId: order.id, payLink });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      {
        error:
          "Order was created but the email failed to send. You can copy the payment link from the order in the Orders queue.",
      },
      { status: 500 }
    );
  }
}

// One audit-log entry per request (see lib/audit.ts).
export const POST = audited("invoice.create_and_send", "order", POST_handler);
