import { NextResponse } from "next/server";
import { customerReplyTo } from "@/lib/replyTo";
import { tooMany } from "@/lib/publicLimits";
import { Resend } from "resend";
import { getProducts, effectivePrice, isExternal, asCash } from "@/lib/storage";
import { addOrder, getOrders, type Order } from "@/lib/orders";
import { priceCart, type Bundle, type CartLine } from "@/lib/bundles";
import { liveBundles } from "@/lib/bundleStore";
import { buildInvoiceEmail, escapeHtml } from "@/lib/invoiceEmail";
import { buildCashPickupEmail } from "@/lib/cashPickupEmail";
import { addSubscriber } from "@/lib/subscribers";
import { brand } from "@/lib/brand";
import { reserveForOrder, returnStock } from "@/lib/stock";
import { ambassadorCodes, creditFor } from "@/lib/ambassadors";
import { findDiscountByCode, recordDiscountUse, validateDiscount, worksInPublicShop } from "@/lib/discounts";
import { isEnabled } from "@/lib/flags";

const SHIPPING_FLAT = 10;

// Public retail checkout — no account required. Creates a guest order
// tagged source: "retail" and emails the same invoice members receive.
// With the cash_pickup switch on it can also be Local pickup, paid by invoice
// or cash at pickup (cash-pickup-only sales apply to those, as for members).
export async function POST(req: Request) {
  // Stop scripts flooding this form (lib/publicLimits.ts).
  const limited = tooMany(req, "retail-checkout", { max: 8, minutes: 10 });
  if (limited) return limited;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { items, name, email, phone, note, address, subscribe } = body;

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "Your cart is empty." }, { status: 400 });
  }
  if (!name?.trim() || !email?.trim() || !email.includes("@")) {
    return NextResponse.json({ error: "Please enter your name and a valid email." }, { status: 400 });
  }
  const pickupOn = await isEnabled("cash_pickup").catch(() => false);
  const shippingMethod: "ship" | "pickup" = pickupOn && body.shippingMethod === "pickup" ? "pickup" : "ship";
  const paymentMethod: "invoice" | "cash" = shippingMethod === "pickup" && body.paymentMethod === "cash" ? "cash" : "invoice";
  const hasAddress = !!(address?.addressLine1?.trim() && address?.city?.trim() && address?.state?.trim() && address?.postalCode?.trim());
  if (shippingMethod === "ship" && !hasAddress) {
    return NextResponse.json({ error: "A complete shipping address is required." }, { status: 400 });
  }
  const shippingCost = shippingMethod === "pickup" ? 0 : SHIPPING_FLAT;

  // Only retail-flagged products can be bought here.
  const products = await getProducts();
  const retailMap = new Map(products.filter(isExternal).map((p) => [p.id, p]));

  const orderItems: Order["items"] = [];
  const lines: CartLine[] = [];
  for (const item of items) {
    const product = retailMap.get(item.productId);
    if (!product) {
      return NextResponse.json({ error: "One of those products is no longer available." }, { status: 400 });
    }
    const quantity = Math.max(1, Math.min(999, Math.floor(Number(item.quantity) || 1)));
    // Cash-pickup-only sales apply to Local pickup + cash orders only (lib/pricing.ts).
    const priceAs = paymentMethod === "cash" ? asCash(product) : product;
    const charged = effectivePrice(priceAs);
    lines.push({ product: priceAs, quantity });
    orderItems.push({
      productId: product.id,
      productName: product.name,
      price: charged,
      quantity,
    });
  }
  // BOGO + mix-and-match bundles (the public shop has no cart-wide rule). Codes: below.
  let bundles: Bundle[];
  try {
    bundles = await liveBundles();
  } catch (err) {
    console.error("[retail checkout] couldn't read bundles", err);
    return NextResponse.json({ error: "We couldn't load today's bundle offers — please try again in a moment." }, { status: 503 });
  }
  const priced = priceCart(lines, bundles, null);
  const subtotal = priced.subtotal;
  const ambOn = await isEnabled("ambassador_pages").catch(() => false);

  // Discount code: only codes marked for the public shop, or a live ambassador's code.
  // Same rules as members: a bundle OR a code, checked here against the real cart.
  const codeIn = typeof body.discountCode === "string" ? body.discountCode.trim() : "";
  let appliedDiscount: Awaited<ReturnType<typeof findDiscountByCode>> = undefined;
  let codeAmount = 0;
  const customerId = `guest_${email.trim().toLowerCase()}`;
  if (codeIn) {
    if (priced.bundleSavings > 0) {
      return NextResponse.json({ error: `Discount codes can't be combined with bundle savings (${priced.bundles.map((b) => b.name).join(", ")}). Remove the code to keep the bundle price.` }, { status: 400 });
    }
    const found = await findDiscountByCode(codeIn);
    if (!found || !worksInPublicShop(found, ambOn ? await ambassadorCodes() : new Set())) {
      return NextResponse.json({ error: "That code isn't valid in the shop." }, { status: 400 });
    }
    const check = validateDiscount(found, Math.max(0, subtotal - priced.discount), customerId);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
    appliedDiscount = check.discount;
    codeAmount = check.amount;
  }
  const discount = Math.round((priced.discount + codeAmount) * 100) / 100;
  const total = Math.max(0, subtotal - discount + shippingCost);

  // Ambassador pages: credit the ambassador whose page they came from (attribution only).
  const ambassador = ambOn ? await creditFor({ ref: body.ambassador, discountCode: appliedDiscount?.code, email: String(email).trim(), pastOrders: getOrders }) : undefined;

  // Stock counts (switch on): take the units; lines at 0 are marked restocking.
  const stock = await reserveForOrder(orderItems, retailMap);
  const order = await addOrder({
    // Guest orders aren't tied to a member account.
    userId: customerId,
    userName: name.trim(),
    userEmail: email.trim().toLowerCase(),
    items: stock.items,
    stockTaken: stock.stockTaken,
    shippingAddress: hasAddress
      ? {
          addressLine1: address.addressLine1.trim(),
          addressLine2: address.addressLine2?.trim() || undefined,
          city: address.city.trim(),
          state: address.state.trim(),
          postalCode: address.postalCode.trim(),
        }
      : undefined,
    shippingMethod,
    shippingCost,
    subtotal,
    discount: discount > 0 ? discount : undefined,
    discountCode: appliedDiscount?.code,
    discountAmount: codeAmount > 0 ? codeAmount : undefined,
    discountType: appliedDiscount?.type,
    bundleSavings: priced.bundleSavings > 0 ? priced.bundleSavings : undefined,
    bundles: priced.bundles.length ? priced.bundles : undefined,
    total,
    note: [phone?.trim() ? `Phone: ${phone.trim()}` : "", note?.trim() || ""]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 2000) || undefined,
    isInquiry: false,
    paymentMethod,
    source: "retail",
    status: "pending",
    ...(ambassador ? { ambassador } : {}),
  }).catch(async (err) => {
    // The order didn't save: give the units back.
    if (stock.stockTaken) await returnStock(stock.stockTaken).catch(() => {});
    throw err;
  });

  if (appliedDiscount && codeAmount > 0) {
    await recordDiscountUse(appliedDiscount.id, customerId, order.id, codeAmount).catch((err) => console.error("Failed to record discount use", err));
  }

  if (subscribe) {
    try {
      await addSubscriber(email, name, "retail");
    } catch (err) {
      console.error("Failed to add subscriber", err);
    }
  }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || new URL(req.url).origin;
  const payLink = `${siteUrl}/pay/${order.paymentToken}`;

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev";
  const adminEmail = process.env.INQUIRY_TO_EMAIL;

  let emailed = false;
  if (apiKey) {
    const resend = new Resend(apiKey);
    try {
      // Resend reports a refusal (bad address, limits…) in `error` rather than throwing.
      // Cash at pickup: no invoice, a confirmation with pickup details (same as members').
      const sent = await resend.emails.send({
        from: fromEmail,
        to: order.userEmail,
        reply_to: customerReplyTo(),
        subject:
          paymentMethod === "cash"
            ? `Your order is confirmed — pickup details inside (Ref ${order.id.slice(-6).toUpperCase()})`
            : `Your order from ${brand.name} (Ref ${order.id.slice(-6).toUpperCase()})`,
        html: paymentMethod === "cash" ? buildCashPickupEmail(order, payLink, brand.name) : buildInvoiceEmail(order, payLink, order.note),
      });
      emailed = !sent.error;
      if (sent.error) console.error("Retail invoice rejected by Resend", sent.error);
    } catch (err) {
      console.error("Failed to send retail invoice", err);
    }
    if (adminEmail) {
      try {
        await resend.emails.send({
          from: fromEmail,
          to: adminEmail,
          reply_to: order.userEmail,
          subject: `${emailed ? "" : `⚠ Customer ${paymentMethod === "cash" ? "pickup confirmation" : "invoice"} NOT sent — `}🛍️ Retail order from ${order.userName} — $${total.toFixed(2)}${shippingMethod === "pickup" ? (paymentMethod === "cash" ? " (pickup, cash)" : " (pickup)") : ""}`,
          html: `${emailed ? "" : paymentMethod === "cash" ? `<p style="background:#fbe9e7;color:#9b2f1d;padding:10px 12px;border-radius:6px"><strong>The customer's pickup confirmation email did not send.</strong> Message them with the pickup details.</p>` : `<p style="background:#fbe9e7;color:#9b2f1d;padding:10px 12px;border-radius:6px"><strong>The customer's invoice email did not send.</strong> Ask the Concierge to “resend the invoice for this order” (or message them) so they know how to pay.</p>`}<p><strong>${escapeHtml(order.userName)}</strong> (${escapeHtml(order.userEmail)}) placed a retail order for $${total.toFixed(2)}.</p>
                 ${shippingMethod === "pickup" ? `<p><strong>Local pickup${paymentMethod === "cash" ? " · CASH AT PICKUP" : ""}</strong></p>` : ""}
                 <p><a href="${siteUrl}/admin?order=${order.id}">Open this order in admin</a></p>`,
        });
      } catch (err) {
        console.error("Failed to send admin retail alert", err);
      }
    }
  }

  return NextResponse.json({ ok: true, orderId: order.id, emailed });
}
