import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { getUsers } from "@/lib/users";
import { audited } from "@/lib/audit";

// Map service tokens to partial name matches for validation
const serviceNameMap: Record<string, string> = {
  usps_ground_advantage: "ground",
  usps_priority: "priority",
  usps_priority_express: "express",
};

async function POST_handler(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { userId, productName, quantity, weightOz, serviceToken } = body;

  console.log("[Shippo] Request body:", JSON.stringify(body, null, 2));

  if (!userId || !productName) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  const users = await getUsers();
  const user = users.find((u) => u.id === userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (!user.addressLine1 || !user.city || !user.state || !user.postalCode) {
    return NextResponse.json(
      { error: "User has no complete address" },
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
  if (
    !warehouseAddress.name ||
    !warehouseAddress.street1 ||
    !warehouseAddress.city ||
    !warehouseAddress.state ||
    !warehouseAddress.zip ||
    !warehouseAddress.country ||
    !warehouseAddress.email ||
    !warehouseAddress.phone
  ) {
    return NextResponse.json(
      { error: "Missing warehouse address info (email or phone) in environment variables" },
      { status: 500 }
    );
  }

  const toAddress = {
    name: user.name,
    street1: user.addressLine1,
    street2: user.addressLine2 || "",
    city: user.city,
    state: user.state,
    zip: user.postalCode,
    country: "US",
    email: user.email,
  };

  const parcel = {
    length: 5,
    width: 5,
    height: 5,
    distance_unit: "in",
    weight: weightOz || 8,
    mass_unit: "oz",
  };

  const apiKey = process.env.SHIPPO_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing Shippo API key" }, { status: 500 });
  }

  const service = serviceToken || "usps_ground_advantage";
  console.log(`[Shippo] Requested service token: ${service}`);

  const shipmentPayload = {
    address_from: warehouseAddress,
    address_to: toAddress,
    parcels: [parcel],
    async: false,
    servicelevel: { token: service },
  };

  try {
    const shipmentRes = await fetch("https://api.goshippo.com/shipments/", {
      method: "POST",
      headers: {
        Authorization: `ShippoToken ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(shipmentPayload),
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

    // ---- Filter rates to find the one that matches the requested service ----
    const matchKeyword = serviceNameMap[service] || "";
    const matchingRate = rates.find((r) =>
      r.servicelevel?.name?.toLowerCase().includes(matchKeyword)
    );

    if (!matchingRate) {
      // Log all available services for debugging
      const available = rates.map((r) => r.servicelevel?.name).join(", ");
      console.error(`[Shippo] Requested ${service}, but available services: ${available}`);
      return NextResponse.json(
        { error: `The selected service (${service}) is not available. Available: ${available}` },
        { status: 400 }
      );
    }

    const selectedRate = matchingRate;
    console.log(`[Shippo] Selected rate: ${selectedRate.servicelevel?.name} – ${selectedRate.amount}`);

    const transactionPayload = {
      rate: selectedRate.object_id,
      async: false,
      label_file_type: "PDF",
      metadata: `Order: ${productName} x${quantity} | User: ${user.email}`,
    };

    const transactionRes = await fetch("https://api.goshippo.com/transactions/", {
      method: "POST",
      headers: {
        Authorization: `ShippoToken ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(transactionPayload),
    });

    if (!transactionRes.ok) {
      const errorText = await transactionRes.text();
      console.error("Shippo transaction error:", errorText);
      return NextResponse.json(
        { error: "Failed to purchase label" },
        { status: 500 }
      );
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

    return NextResponse.json({
      labelUrl: transaction.label_url,
      transactionId: transaction.object_id,
      selectedService: selectedRate.servicelevel?.name || "unknown",
      selectedAmount: selectedRate.amount,
      ok: true,
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
export const POST = audited("shipping.label_purchase", "shipment", POST_handler);
