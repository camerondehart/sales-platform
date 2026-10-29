import { NextResponse } from "next/server";
import { customerReplyTo } from "@/lib/replyTo";
import { tooMany } from "@/lib/publicLimits";
import { Resend } from "resend";
import { getApprovedVisitor, getVisitor } from "@/lib/auth";
import { getProducts, effectivePrice, asCash } from "@/lib/storage";
import { addOrder, getOrders, type Order, type OrderAddress } from "@/lib/orders";
import { buildInvoiceEmail, itemsTable, addressBlock, escapeHtml } from "@/lib/invoiceEmail";
import { buildCashPickupEmail } from "@/lib/cashPickupEmail";
import { findDiscountByCode, validateDiscount, recordDiscountUse } from "@/lib/discounts";
import { getSettings } from "@/lib/settings";
import { priceCart, type Bundle, type CartLine } from "@/lib/bundles";
import { liveBundles } from "@/lib/bundleStore";
import { validateRedemption, adjustPoints } from "@/lib/loyalty";
import { mutateUsers } from "@/lib/users";
import { askAboutItems } from "@/lib/ask";
import { brand } from "@/lib/brand";
import { reserveForOrder, returnStock } from "@/lib/stock";
import { creditFor } from "@/lib/ambassadors";
import { isEnabled } from "@/lib/flags";

const SHIPPING_FLAT = 10;

type CheckoutPayload = {
  items: Array<{ productId: string; quantity: number }>;
  shippingMethod: "ship" | "pickup";
  paymentMethod?: "invoice" | "cash";
  discountCode?: string;
  /** Ambassador page this browser came through, and when (lib/ambassadorRef.ts). */
  ambassador?: string | { slug: string; at: number };
  redeemPoints?: number;
  isInquiry?: boolean;
  note?: string;
  address?: {
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
  };
};

export async function POST(req: Request) {
  // Stop scripts flooding this form (lib/publicLimits.ts).
  const limited = tooMany(req, "member-checkout", { max: 12, minutes: 10 });
  if (limited) return limited;
  const user = await getApprovedVisitor();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: CheckoutPayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { items, shippingMethod, note, address } = body;

  // The "inquiry only" order is retired: a question about items now goes to
  // the team as a "Handed to the team" request, and no order is created.
  // (Kept here for any browser still running the old checkout.)
  if (body.isInquiry) {
    const asked = await askAboutItems(user, Array.isArray(items) ? items : [], note || "I'd like to ask about these items.");
    if (!asked.ok) return NextResponse.json({ error: asked.error }, { status: 400 });
    return NextResponse.json({ ok: true, asked: true });
  }
  const isInquiry = false;
  // Cash is only valid for local pickup, and never for inquiries.
  const paymentMethod: "invoice" | "cash" =
    body.paymentMethod === "cash" && shippingMethod === "pickup" && !isInquiry
      ? "cash"
      : "invoice";

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "Your cart is empty." }, { status: 400 });
  }
  if (shippingMethod !== "ship" && shippingMethod !== "pickup") {
    return NextResponse.json({ error: "Invalid shipping method." }, { status: 400 });
  }

  // Validate address: required when shipping, optional for pickup
  let shippingAddress: OrderAddress | undefined;
  const hasAddress =
    address?.addressLine1?.trim() && address?.city?.trim() &&
    address?.state?.trim() && address?.postalCode?.trim();
  if (hasAddress) {
    shippingAddress = {
      addressLine1: address!.addressLine1!.trim(),
      addressLine2: address!.addressLine2?.trim() || undefined,
      city: address!.city!.trim(),
      state: address!.state!.trim(),
      postalCode: address!.postalCode!.trim(),
    };
  } else if (shippingMethod === "ship" && !isInquiry) {
    return NextResponse.json(
      { error: "A complete shipping address is required for shipped orders." },
      { status: 400 }
    );
  }

  // Validate items against the catalog and compute totals server-side —
  // never trust client-supplied prices.
  const products = await getProducts();
  const productMap = new Map(products.map((p) => [p.id, p]));

  const orderItems: Order["items"] = [];
  const lines: CartLine[] = [];
  for (const item of items) {
    const product = productMap.get(item.productId);
    if (!product) {
      return NextResponse.json({ error: "One of the products in your cart is no longer available." }, { status: 400 });
    }
    const quantity = Math.max(1, Math.min(999, Math.floor(Number(item.quantity) || 1)));
    // Cash-pickup-only sales apply to Local pickup + cash orders only (lib/pricing.ts).
    const priceAs = paymentMethod === "cash" ? asCash(product) : product;
    const charged = effectivePrice(priceAs); // honors fixed sale price and %-off promos
    lines.push({ product: priceAs, quantity });
    orderItems.push({
      productId: product.id,
      productName: product.name,
      price: charged,
      quantity,
    });
  }

  // Mix-and-match bundles, BOGO and the "buy N, save X%" cart rule — one
  // shared calculation (lib/bundles.ts) so the cart preview and the charge match.
  let bundles: Bundle[];
  try {
    bundles = await liveBundles();
  } catch (err) {
    console.error("[checkout] couldn't read bundles", err);
    return NextResponse.json({ error: "We couldn't load today's bundle offers — please try again in a moment." }, { status: 503 });
  }
  const settings = await getSettings();
  const priced = priceCart(lines, bundles, { enabled: settings.bundleRuleEnabled, minItems: settings.bundleRuleMinItems, percent: settings.bundleRulePercent });
  const subtotal = priced.subtotal;
  const discount = priced.discount;

  // A bundle OR a discount code, never both.
  if (priced.bundleSavings > 0 && body.discountCode?.trim()) {
    return NextResponse.json(
      { error: `Discount codes can't be combined with bundle savings (${priced.bundles.map((b) => b.name).join(", ")}). Remove the code to keep the bundle price.` },
      { status: 400 }
    );
  }

  // Discount code — validated server-side against the discounted subtotal
  let appliedDiscount: Awaited<ReturnType<typeof findDiscountByCode>> = undefined;
  let codeAmount = 0;
  if (!isInquiry && body.discountCode?.trim()) {
    const found = await findDiscountByCode(body.discountCode);
    const check = validateDiscount(found, Math.max(0, subtotal - discount), user.id);
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: 400 });
    }
    appliedDiscount = check.discount;
    codeAmount = check.amount;
  }

  // Loyalty redemption — validated against the member's real balance
  let pointsRedeemed = 0;
  let pointsCredit = 0;
  if (!isInquiry && Number(body.redeemPoints) > 0) {
    const remaining = Math.max(0, subtotal - discount - codeAmount);
    const check = await validateRedemption(user, Number(body.redeemPoints), remaining);
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: 400 });
    }
    pointsRedeemed = check.points;
    pointsCredit = check.credit;
  }

  const totalDiscount = Math.round((discount + codeAmount + pointsCredit) * 100) / 100;
  const shippingCost = isInquiry ? 0 : shippingMethod === "ship" ? SHIPPING_FLAT : 0;
  const total = isInquiry ? 0 : Math.max(0, subtotal - totalDiscount + shippingCost);

  // Ambassador pages: credit an ambassador via their linked code or the page the member
  // came from (attribution only). Not for orders staff place with "Log in as".
  const visitor = await getVisitor().catch(() => null);
  const ambassador =
    !isInquiry && !visitor?.as && (await isEnabled("ambassador_pages").catch(() => false))
      ? await creditFor({ ref: body.ambassador, discountCode: appliedDiscount?.code, email: user.email, pastOrders: getOrders })
      : undefined;

  // Stock counts (switch on): take the units; lines at 0 are marked restocking.
  const stock = await reserveForOrder(orderItems, productMap);
  const order = await addOrder({
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    items: stock.items,
    stockTaken: stock.stockTaken,
    shippingAddress,
    shippingMethod,
    shippingCost,
    subtotal,
    discount: totalDiscount > 0 ? totalDiscount : undefined,
    discountCode: appliedDiscount?.code,
    discountAmount: codeAmount > 0 ? codeAmount : undefined,
    discountType: appliedDiscount?.type,
    loyaltyPointsRedeemed: pointsRedeemed > 0 ? pointsRedeemed : undefined,
    bundleSavings: priced.bundleSavings > 0 ? priced.bundleSavings : undefined,
    bundles: priced.bundles.length ? priced.bundles : undefined,
    total,
    note: note?.slice(0, 2000) || undefined,
    isInquiry,
    paymentMethod,
    source: "member",
    status: isInquiry ? "inquiry" : "pending",
    // Staff using "Log in as" — the order says who actually placed it.
    ...(await getVisitor().then((v) => (v?.as ? { placedBy: v.as } : {})).catch(() => ({}))),
    ...(ambassador ? { ambassador } : {}),
  }).catch(async (err) => {
    // The order didn't save: give the units back.
    if (stock.stockTaken) await returnStock(stock.stockTaken).catch(() => {});
    throw err;
  });

  // Deduct redeemed points now that the order exists
  if (pointsRedeemed > 0) {
    try {
      await adjustPoints(user.id, -pointsRedeemed, `Redeemed on order ${order.id.slice(-6).toUpperCase()}`, order.id);
    } catch (err) {
      console.error("Failed to deduct loyalty points", err);
    }
  }

  // Save the shipping address back to the profile, here rather than from the
  // browser. The client used to fire /api/account/address immediately after
  // this request, so two serverless invocations were read-modify-writing
  // users.json at the same moment and could undo each other's changes
  // (most visibly, wiping the loyalty points just awarded above).
  // Doing it inline keeps every write to users.json sequential.
  if (
    !isInquiry &&
    address?.addressLine1?.trim() &&
    address?.city?.trim() &&
    address?.state?.trim() &&
    address?.postalCode?.trim()
  ) {
    try {
      await mutateUsers((users) => {
        const idx = users.findIndex((u) => u.id === user.id);
        if (idx === -1) return { users: null, result: undefined };
        users[idx] = {
          ...users[idx],
          addressLine1: address.addressLine1!.trim(),
          addressLine2: address.addressLine2?.trim() || undefined,
          city: address.city!.trim(),
          state: address.state!.trim(),
          postalCode: address.postalCode!.trim(),
        };
        return { users, result: undefined };
      });
    } catch (err) {
      console.error("Failed to save address to profile", err);
    }
  }

  // Record the redemption now that the order exists
  if (appliedDiscount && codeAmount > 0) {
    try {
      await recordDiscountUse(appliedDiscount.id, user.id, order.id, codeAmount);
    } catch (err) {
      console.error("Failed to record discount use", err);
    }
  }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || new URL(req.url).origin;
  const payLink = `${siteUrl}/pay/${order.paymentToken}`;

  // Emails — invoice to customer (unless inquiry), notification to admin.
  // Email failures never fail the checkout; the order is already saved.
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev";
  const adminEmail = process.env.INQUIRY_TO_EMAIL;
  let emailed = false;

  if (apiKey) {
    const resend = new Resend(apiKey);
    if (!isInquiry && paymentMethod === "cash") {
      // Cash at pickup: no invoice, just a confirmation with pickup details.
      try {
        // Resend reports a refusal (bad address, limits…) in `error` rather than throwing.
        const sent = await resend.emails.send({
          from: fromEmail,
          to: user.email,
          reply_to: customerReplyTo(),
          subject: `Your order is confirmed — pickup details inside (Ref ${order.id.slice(-6).toUpperCase()})`,
          html: buildCashPickupEmail(order, payLink),
        });
        emailed = !sent.error;
        if (sent.error) console.error("Pickup confirmation rejected by Resend", sent.error);
      } catch (err) {
        console.error("Failed to send pickup confirmation", err);
      }
    } else if (!isInquiry) {
      try {
        const sent = await resend.emails.send({
          from: fromEmail,
          to: user.email,
          reply_to: customerReplyTo(),
          subject: `Your invoice — ${brand.name} (Ref ${order.id.slice(-6).toUpperCase()})`,
          html: buildInvoiceEmail(order, payLink, order.note),
        });
        emailed = !sent.error;
        if (sent.error) console.error("Invoice email rejected by Resend", sent.error);
      } catch (err) {
        console.error("Failed to send invoice email", err);
      }
    }
    if (adminEmail) {
      try {
        await resend.emails.send({
          from: fromEmail,
          to: adminEmail,
          reply_to: user.email,
          // If the customer's email didn't go, say so loudly so the team can resend it.
          subject: isInquiry
            ? `New inquiry from ${user.name}`
            : `${emailed ? "" : "⚠ Customer email NOT sent — "}New order from ${user.name} — $${total.toFixed(2)}`,
          html: withWarning(
            buildAdminEmail(order, payLink, `${siteUrl}/admin?order=${order.id}`),
            emailed || isInquiry
              ? ""
              : `<div style="font-family:Arial,sans-serif;background:#fbe9e7;color:#9b2f1d;padding:12px 14px;border-radius:6px;margin-bottom:12px"><strong>The customer's ${paymentMethod === "cash" ? "pickup confirmation" : "invoice"} email did not send.</strong> ${paymentMethod === "cash" ? "Message them with the pickup details." : "Ask the Concierge to “resend the invoice for this order” (or message them) so they know how to pay."}</div>`,
          ),
        });
      } catch (err) {
        console.error("Failed to send admin notification", err);
      }
    }
  }

  return NextResponse.json({ ok: true, orderId: order.id, emailed });
}

// Put a warning banner at the top of an email's body (or the start, if it has no <body>).
function withWarning(html: string, warning: string): string {
  if (!warning) return html;
  return /<body[^>]*>/i.test(html) ? html.replace(/<body[^>]*>/i, (m) => m + warning) : warning + html;
}

function buildAdminEmail(order: Order, payLink: string, adminLink: string): string {
  return `
  <div style="font-family: 'Optima', Candara, 'Helvetica Neue', sans-serif; max-width: 560px; margin: 0 auto; padding: 2rem; color: #61676d; background: #f9f9f8;">
    <div style="font-size: 0.7rem; letter-spacing: 0.18em; text-transform: uppercase; color: #85ba45; font-weight: 700; margin-bottom: 1rem;">
      ${order.isInquiry ? "New Inquiry" : "New Order"} — ${brand.members}
    </div>
    <h1 style="font-family: 'Libre Baskerville', Georgia, serif; font-size: 1.5rem; font-weight: 400; font-style: italic; margin: 0 0 1.5rem;">
      ${escapeHtml(order.userName)} · ${order.isInquiry ? "inquiry" : `$${order.total.toFixed(2)}`}
    </h1>
    <table style="width: 100%; border-collapse: collapse;">
      <tr><td style="padding: 0.3rem 0; color: #81858b; width: 110px;">Email</td><td><a href="mailto:${escapeHtml(order.userEmail)}">${escapeHtml(order.userEmail)}</a></td></tr>
      <tr><td style="padding: 0.3rem 0; color: #81858b;">Order ID</td><td style="font-size: 0.85rem;">${escapeHtml(order.id)}</td></tr>
      <tr><td style="padding: 0.3rem 0; color: #81858b;">Method</td><td>${order.shippingMethod === "pickup" ? "Local pickup" : "Ship ($10)"}${order.paymentMethod === "cash" ? " &middot; <strong>CASH AT PICKUP</strong>" : ""}</td></tr>
    </table>
    <div style="margin: 1.25rem 0;">${itemsTable(order)}</div>
    ${addressBlock(order)}
    ${order.note ? `<div style="margin-top: 1.25rem; padding: 1rem; background: #e8e5e5; border-left: 3px solid #85ba45;"><strong>Note:</strong><br/>${escapeHtml(order.note)}</div>` : ""}
    ${order.isInquiry ? "" : `<div style="margin-top: 1.25rem; font-size: 0.85rem; color: #81858b;">Customer pay link: <a href="${payLink}">${payLink}</a></div>`}
    <div style="text-align: center; margin-top: 1.75rem;">
      <a href="${adminLink}" style="display: inline-block; background: #85ba45; color: white; padding: 0.8rem 1.6rem; border-radius: 4px; text-decoration: none; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; font-size: 0.78rem;">Open this ${order.isInquiry ? "inquiry" : "order"} in admin</a>
    </div>
  </div>`;
}
