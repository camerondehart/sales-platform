import { NextResponse } from "next/server";
import { tooMany } from "@/lib/publicLimits";
import { Resend } from "resend";
import { getApprovedVisitor } from "@/lib/auth";
import { addInquiry } from "@/lib/inquiries";
import { brand } from "@/lib/brand";

type BulkItem = {
  productId: string;
  productName: string;
  quantity: number;
};
type BulkPayload = {
  items: BulkItem[];
  name: string;
  email: string;
  phone?: string;
  message?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
};
type SinglePayload = {
  productId: string;
  productName: string;
  name: string;
  email: string;
  phone?: string;
  message?: string;
};

export async function POST(req: Request) {
  // Stop scripts flooding this form (lib/publicLimits.ts).
  const limited = tooMany(req, "inquiry", { max: 8, minutes: 10 });
  if (limited) return limited;
  const user = await getApprovedVisitor();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const isBulk = Array.isArray(body.items) && body.items.length > 0;

  if (isBulk) {
    const bulk = body as BulkPayload;

    for (const item of bulk.items) {
      if (!item.productId || !item.productName || !item.quantity || item.quantity < 1) {
        return NextResponse.json({ error: "invalid_item" }, { status: 400 });
      }
    }

    // Save ONE inquiry with all items
    await addInquiry({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      productId: "bulk",
      productName: `📦 Bulk order (${bulk.items.length} items)`,
      phone: bulk.phone,
      message: bulk.message,
      items: bulk.items.map(i => ({
        productId: i.productId,
        productName: i.productName,
        quantity: i.quantity,
      })),
    });

    // Send bulk email
    await sendBulkEmail(
      user,
      bulk.items,
      bulk.phone,
      bulk.message,
      bulk.addressLine1,
      bulk.addressLine2,
      bulk.city,
      bulk.state,
      bulk.postalCode
    );
    return NextResponse.json({ ok: true });
  }

  // ---------- SINGLE PRODUCT ----------
  const single = body as SinglePayload;
  if (!single.productId || !single.productName) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const inquiry = await addInquiry({
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    productId: single.productId,
    productName: single.productName,
    phone: single.phone,
    message: single.message,
  });

  const apiKey = process.env.RESEND_API_KEY;
  const toEmail = process.env.INQUIRY_TO_EMAIL;
  const fromEmail = process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev";

  if (!apiKey || !toEmail) {
    console.error("Missing RESEND_API_KEY or INQUIRY_TO_EMAIL");
    return NextResponse.json({ ok: true, saved: true, emailed: false });
  }

  const resend = new Resend(apiKey);

  const html = `
    <div style="font-family: 'Optima', Candara, 'Helvetica Neue', sans-serif; max-width: 560px; margin: 0 auto; padding: 2rem; color: #61676d; background: #f9f9f8;">
      <div style="font-size: 0.7rem; letter-spacing: 0.18em; text-transform: uppercase; color: #85ba45; font-weight: 700; margin-bottom: 1rem;">New Inquiry — ${brand.members}</div>
      <h1 style="font-family: 'Libre Baskerville', Georgia, serif; font-size: 1.7rem; font-weight: 400; font-style: italic; margin: 0 0 2rem; color: #61676d;">${escapeHtml(single.productName)}</h1>

      <table style="width: 100%; border-collapse: collapse;">
        <tr><td style="padding: 0.5rem 0; color: #81858b; width: 100px;">Name</td><td style="padding: 0.5rem 0;">${escapeHtml(user.name)}</td></tr>
        <tr><td style="padding: 0.5rem 0; color: #81858b;">Email</td><td style="padding: 0.5rem 0;"><a href="mailto:${escapeHtml(user.email)}" style="color: #85ba45;">${escapeHtml(user.email)}</a></td></tr>
        ${single.phone ? `<tr><td style="padding: 0.5rem 0; color: #81858b;">Phone</td><td style="padding: 0.5rem 0;">${escapeHtml(single.phone)}</td></tr>` : ""}
        <tr><td style="padding: 0.5rem 0; color: #81858b;">Product ID</td><td style="padding: 0.5rem 0; font-size: 0.85rem; color: #81858b;">${escapeHtml(single.productId)}</td></tr>
        <tr><td style="padding: 0.5rem 0; color: #81858b;">Inquiry ID</td><td style="padding: 0.5rem 0; font-size: 0.85rem; color: #81858b;">${escapeHtml(inquiry.id)}</td></tr>
      </table>
      ${single.message ? `<div style="margin-top: 2rem; padding-top: 2rem; border-top: 1px solid #abaeb2;"><div style="font-size: 0.65rem; letter-spacing: 0.18em; text-transform: uppercase; color: #81858b; font-weight: 700; margin-bottom: 0.75rem;">Message</div><div style="white-space: pre-wrap; line-height: 1.5;">${escapeHtml(single.message)}</div></div>` : ""}
      <div style="margin-top: 2rem; font-size: 0.8rem; color: #81858b;">Sent ${new Date().toLocaleString("en-US", { timeZone: brand.timezone })} local · View full history at /admin</div>
    </div>
  `;

  try {
    await resend.emails.send({
      from: fromEmail,
      to: toEmail,
      reply_to: user.email,
      subject: `Inquiry — ${single.productName}`,
      html,
    });
    return NextResponse.json({ ok: true, saved: true, emailed: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: true, saved: true, emailed: false });
  }
}

// ---------- Bulk email helper ----------
async function sendBulkEmail(
  user: any,
  items: BulkItem[],
  phone?: string,
  message?: string,
  addressLine1?: string,
  addressLine2?: string,
  city?: string,
  state?: string,
  postalCode?: string
) {
  const apiKey = process.env.RESEND_API_KEY;
  const toEmail = process.env.INQUIRY_TO_EMAIL;
  const fromEmail = process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev";
  if (!apiKey || !toEmail) return;

  const resend = new Resend(apiKey);

  const itemsHtml = items.map(item => `
    <tr>
      <td style="padding: 0.5rem 0;">${escapeHtml(item.productName)}</td>
      <td style="padding: 0.5rem 0; text-align: center;">${item.quantity}</td>
    </tr>
  `).join("");

  const addressHtml = addressLine1 ? `
    <div style="margin-top: 1rem;">
      <strong>Shipping address:</strong><br/>
      ${escapeHtml(addressLine1)}<br/>
      ${addressLine2 ? escapeHtml(addressLine2) + "<br/>" : ""}
      ${escapeHtml(city || "")}, ${escapeHtml(state || "")} ${escapeHtml(postalCode || "")}
    </div>
  ` : "";

  const html = `
    <div style="font-family: 'Optima', Candara, 'Helvetica Neue', sans-serif; max-width: 560px; margin: 0 auto; padding: 2rem; color: #61676d; background: #f9f9f8;">
      <div style="font-size: 0.7rem; letter-spacing: 0.18em; text-transform: uppercase; color: #85ba45; font-weight: 700; margin-bottom: 1rem;">Bulk Inquiry — ${brand.members}</div>
      <h1 style="font-family: 'Libre Baskerville', Georgia, serif; font-size: 1.5rem; font-weight: 400; font-style: italic; margin: 0 0 2rem;">Request from ${escapeHtml(user.name)}</h1>
      <table style="width: 100%; border-collapse: collapse;">
        <tr><td style="padding: 0.3rem 0; color: #81858b;">Name</td><td style="padding: 0.3rem 0;">${escapeHtml(user.name)}</td></tr>
        <tr><td style="padding: 0.3rem 0; color: #81858b;">Email</td><td style="padding: 0.3rem 0;"><a href="mailto:${escapeHtml(user.email)}">${escapeHtml(user.email)}</a></td></tr>
        ${phone ? `<tr><td style="padding: 0.3rem 0; color: #81858b;">Phone</td><td style="padding: 0.3rem 0;">${escapeHtml(phone)}</td></tr>` : ""}
      </table>
      <div style="margin: 1.5rem 0;">
        <div style="font-size: 0.7rem; letter-spacing: 0.18em; text-transform: uppercase; color: #85ba45;">Requested items</div>
        <table style="width: 100%; border-collapse: collapse; margin-top: 0.5rem;">
          <thead><tr style="border-bottom: 1px solid #abaeb2;"><th style="text-align: left; padding: 0.5rem 0;">Product</th><th style="text-align: center; padding: 0.5rem 0;">Quantity</th></tr></thead>
          <tbody>${itemsHtml}</tbody>
        </table>
      </div>
      ${addressHtml}
      ${message ? `<div style="margin-top: 1.5rem; padding: 1rem; background: #e8e5e5; border-left: 3px solid #85ba45;"><strong>Message:</strong><br/>${escapeHtml(message)}</div>` : ""}
      <div style="margin-top: 2rem; font-size: 0.8rem; color: #81858b;">Sent ${new Date().toLocaleString("en-US", { timeZone: brand.timezone })} local · View full history at /admin</div>
    </div>
  `;

  try {
    await resend.emails.send({
      from: fromEmail,
      to: toEmail,
      reply_to: user.email,
      subject: `Bulk inquiry (${items.length} items) from ${user.name}`,
      html,
    });
  } catch (err) {
    console.error("Failed to send bulk email", err);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
