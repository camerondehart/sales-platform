import { NextResponse } from "next/server";
import { customerReplyTo } from "@/lib/replyTo";
import { isAdmin } from "@/lib/auth";
import { getUsers } from "@/lib/users";
import { getOrders, updateOrder } from "@/lib/orders";
import { hrefSafe } from "@/lib/invoiceEmail";
import { audited } from "@/lib/audit";
import { getProducts } from "@/lib/storage";
import { getSettings } from "@/lib/settings";
import { orderWeight, packagingOzOf } from "@/lib/shippingWeight";
import { brand } from "@/lib/brand";

// Create a Shippo label for a specific order. Uses the order's shipping
// address (falling back to the member's saved address), with a service
// override just like the legacy /api/admin/shipping-label route.

function escapeHtmlLocal(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const serviceNameMap: Record<string, string> = {
  usps_ground_advantage: "ground",
  usps_priority: "priority",
  usps_priority_express: "express",
};

async function POST_handler(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { orderId, weightOz, serviceToken, force } = await req.json();
  if (!orderId) {
    return NextResponse.json({ error: "missing orderId" }, { status: 400 });
  }

  const orders = await getOrders();
  const order = orders.find((o) => o.id === orderId);
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Never buy a second label by accident (double click, retry, two tabs).
  // Buying another on purpose needs force: true (the dashboard asks first).
  if (order.labelUrl && force !== true) {
    return NextResponse.json(
      {
        error: `This order already has a label${order.trackingNumber ? ` (tracking ${order.trackingNumber})` : ""}. Buying another charges Shippo again.`,
        alreadyHasLabel: true,
        labelUrl: order.labelUrl,
      },
      { status: 409 }
    );
  }
  if (LABELS_IN_PROGRESS.has(order.id)) {
    return NextResponse.json({ error: "A label for this order is already being bought — wait a moment, then refresh." }, { status: 409 });
  }
  // No weight given: work it out from the products' shipping weights + box.
  let weight = Number(weightOz) > 0 ? Number(weightOz) : undefined;
  if (!weight) {
    try {
      const [products, settings] = await Promise.all([getProducts(), getSettings()]);
      weight = orderWeight(order.items || [], products, packagingOzOf(settings.packagingOz)).oz ?? undefined;
    } catch (err) {
      console.error("[label] couldn't work out the weight", err);
    }
  }
  LABELS_IN_PROGRESS.add(order.id);
  try {
    return await buyLabel(order, weight, serviceToken);
  } finally {
    LABELS_IN_PROGRESS.delete(order.id);
  }
}

// Orders with a label purchase running right now (this server instance).
const LABELS_IN_PROGRESS: Set<string> = ((globalThis as unknown as { __fpLabels?: Set<string> }).__fpLabels ??= new Set<string>());

async function buyLabel(order: Awaited<ReturnType<typeof getOrders>>[number], weightOz: number | undefined, serviceToken: string | undefined): Promise<Response> {

  // Prefer the address captured at checkout; fall back to the member profile.
  let address = order.shippingAddress;
  if (!address) {
    const user = (await getUsers()).find((u) => u.id === order.userId);
    if (user?.addressLine1 && user.city && user.state && user.postalCode) {
      address = {
        addressLine1: user.addressLine1,
        addressLine2: user.addressLine2,
        city: user.city,
        state: user.state,
        postalCode: user.postalCode,
      };
    }
  }
  if (!address) {
    return NextResponse.json(
      { error: "This order has no shipping address and the member has none saved." },
      { status: 400 }
    );
  }

  const warehouseAddress = {
    name: process.env.SHIPPO_FROM_NAME,
    street1: process.env.SHIPPO_FROM_STREET,
    city: process.env.SHIPPO_FROM_CITY,
    state: process.env.SHIPPO_FROM_STATE,
    zip: process.env.SHIPPO_FROM_ZIP,
    country: process.env.SHIPPO_FROM_COUNTRY,
    email: process.env.SHIPPO_FROM_EMAIL,
    phone: process.env.SHIPPO_FROM_PHONE,
  };
  if (Object.values(warehouseAddress).some((v) => !v)) {
    return NextResponse.json(
      { error: "Missing warehouse address info in environment variables" },
      { status: 500 }
    );
  }

  const apiKey = process.env.SHIPPO_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing Shippo API key" }, { status: 500 });
  }

  const toAddress = {
    name: order.userName,
    street1: address.addressLine1,
    street2: address.addressLine2 || "",
    city: address.city,
    state: address.state,
    zip: address.postalCode,
    country: "US",
    email: order.userEmail,
  };

  const parcel = {
    length: 5,
    width: 5,
    height: 5,
    distance_unit: "in",
    weight: weightOz || 8,
    mass_unit: "oz",
  };

  const service = serviceToken || "usps_ground_advantage";

  try {
    const shipmentRes = await fetch("https://api.goshippo.com/shipments/", {
      method: "POST",
      headers: {
        Authorization: `ShippoToken ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        address_from: warehouseAddress,
        address_to: toAddress,
        parcels: [parcel],
        async: false,
        servicelevel: { token: service },
      }),
    });

    let rates: any[] = [];
    if (shipmentRes.ok) {
      const shipment = await shipmentRes.json();
      rates = shipment.rates || [];
    } else {
      const errorData = await shipmentRes.json().catch(() => ({}));
      if (errorData.rates && Array.isArray(errorData.rates)) {
        rates = errorData.rates;
      } else {
        console.error("Shippo shipment error:", errorData);
        return NextResponse.json(
          { error: `Failed to create shipment – ${errorData.detail || "no rates available"}` },
          { status: 500 }
        );
      }
    }

    if (!rates || rates.length === 0) {
      return NextResponse.json(
        { error: `The selected service (${service}) is not available for this address.` },
        { status: 400 }
      );
    }

    const matchKeyword = serviceNameMap[service] || "";
    const selectedRate = rates.find((r) =>
      r.servicelevel?.name?.toLowerCase().includes(matchKeyword)
    );
    if (!selectedRate) {
      const available = rates.map((r) => r.servicelevel?.name).join(", ");
      return NextResponse.json(
        { error: `The selected service (${service}) is not available. Available: ${available}` },
        { status: 400 }
      );
    }

    const itemsSummary = order.items.map((i) => `${i.productName} x${i.quantity}`).join(", ");
    const transactionRes = await fetch("https://api.goshippo.com/transactions/", {
      method: "POST",
      headers: {
        Authorization: `ShippoToken ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        rate: selectedRate.object_id,
        async: false,
        label_file_type: "PDF",
        metadata: `Order ${order.id} | ${itemsSummary.slice(0, 80)} | ${order.userEmail}`.slice(0, 100),
      }),
    });

    if (!transactionRes.ok) {
      console.error("Shippo transaction error:", await transactionRes.text());
      return NextResponse.json({ error: "Failed to purchase label" }, { status: 500 });
    }

    const transaction = await transactionRes.json();
    console.log(`[Shippo] Transaction status: ${transaction.status}, label_url: ${transaction.label_url ? "present" : "MISSING"}`);

    if (!transaction.object_id) {
      throw new Error("Shippo did not return a valid transaction");
    }

    // Shippo can return a transaction with status ERROR/QUEUED and no label.
    // Surface the real reason instead of silently returning an empty URL.
    if (transaction.status !== "SUCCESS" || !transaction.label_url) {
      const messages = (transaction.messages || [])
        .map((m: any) => m.text || m.message || "")
        .filter(Boolean)
        .join(" | ");
      console.error(`[Shippo] Purchase failed (${transaction.status}): ${messages}`);
      return NextResponse.json(
        {
          error:
            `Shippo did not issue the label (status: ${transaction.status}). ` +
            (messages || "Check your Shippo account balance and billing at goshippo.com."),
        },
        { status: 502 }
      );
    }

    // Persist label details on the order
    await updateOrder(order.id, {
      labelUrl: transaction.label_url,
      trackingNumber: transaction.tracking_number || undefined,
      shippoTransactionId: transaction.object_id,
      shippedService: selectedRate.servicelevel?.name || service,
    });

    // Automatically email the customer their tracking link (best-effort —
    // a failed email never fails the label).
    if (transaction.tracking_number && process.env.RESEND_API_KEY) {
      try {
        const { Resend } = await import("resend");
        const resend = new Resend(process.env.RESEND_API_KEY);
        const trackingUrl = `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(transaction.tracking_number)}`;
        await resend.emails.send({
          from: process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev",
          to: order.userEmail,
          reply_to: customerReplyTo(),
          subject: `Your package is on its way — ${brand.name} (Ref ${order.id.slice(-6).toUpperCase()})`,
          html: `
          <div style="font-family: 'Optima', Candara, 'Helvetica Neue', sans-serif; max-width: 560px; margin: 0 auto; padding: 2rem; color: #61676d; background: #f9f9f8;">
            <div style="font-size: 0.7rem; letter-spacing: 0.18em; text-transform: uppercase; color: #85ba45; font-weight: 700; margin-bottom: 1rem;">On Its Way — ${brand.name}</div>
            <h1 style="font-family: 'Libre Baskerville', Georgia, serif; font-size: 1.5rem; font-weight: 400; font-style: italic; margin: 0 0 1.25rem;">Good news, ${escapeHtmlLocal(order.userName.split(" ")[0])}.</h1>
            <p style="line-height: 1.6; margin: 0 0 1.25rem;">Your package (Ref ${order.id.slice(-6).toUpperCase()}) has shipped via ${escapeHtmlLocal(selectedRate.servicelevel?.name || "USPS")}.</p>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 1.5rem;">
              <tr><td style="padding: 0.4rem 0; color: #81858b; width: 120px;">Tracking #</td><td style="padding: 0.4rem 0; font-family: Consolas, monospace;">${escapeHtmlLocal(transaction.tracking_number)}</td></tr>
            </table>
            <div style="text-align: center; margin-bottom: 1.75rem;">
              <a href="${hrefSafe(trackingUrl)}" style="display: inline-block; background: #85ba45; color: white; padding: 0.85rem 1.75rem; border-radius: 4px; text-decoration: none; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; font-size: 0.8rem;">Track your package</a>
            </div>
            <div style="font-size: 0.8rem; color: #81858b; border-top: 1px solid #abaeb2; padding-top: 1rem;">
              Questions? Reach out to <a href="mailto:${brand.supportEmail}" style="color: #6fa336;">${brand.supportEmail}</a>.
            </div>
          </div>`,
        });
      } catch (err) {
        console.error("Failed to send tracking email", err);
      }
    }

    return NextResponse.json({
      ok: true,
      labelUrl: transaction.label_url,
      trackingNumber: transaction.tracking_number || null,
      transactionId: transaction.object_id,
      selectedService: selectedRate.servicelevel?.name || "unknown",
      selectedAmount: selectedRate.amount,
    });
  } catch (error: any) {
    console.error("Shippo API error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create shipping label" },
      { status: 500 }
    );
  }
}

// One audit-log entry per request (see lib/audit.ts).
export const POST = audited("order.label_purchase", "order", POST_handler);
