import { NextResponse } from "next/server";
import { pacificDateTime, pacificDay } from "@/lib/periods";
import { Resend } from "resend";
import { isAdmin } from "@/lib/auth";
import { getUsers, type User } from "@/lib/users";
import { getInquiries, type Inquiry } from "@/lib/inquiries";
import { getSubscribers } from "@/lib/subscribers";
import { getProducts, type Product } from "@/lib/storage";
import { getOrders } from "@/lib/orders";
import { getInsights, money, type Insights } from "@/lib/analytics";
import { generateRevenueCSV } from "@/lib/revenueCsv";
import { escapeHtml } from "@/lib/invoiceEmail";
import { auditSystem } from "@/lib/audit";
import { brand } from "@/lib/brand";

// ==================== CSV helpers ====================
function csvCell(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return "";
  return `"${String(value).replace(/"/g, '""')}"`;
}

function formatDateISO(ts: number | undefined): string {
  if (!ts) return "";
  return pacificDateTime(ts);
}

async function generateMembersCSV(): Promise<string> {
  const users = await getUsers();
  users.sort((a, b) => b.createdAt - a.createdAt);
  const headers = ["ID", "Name", "Email", "Status", `Signup Date (${brand.timezoneLabel})`, `Approved Date (${brand.timezoneLabel})`, "Signup Message"];
  const rows = users.map((u) => [
    csvCell(u.id), csvCell(u.name), csvCell(u.email), csvCell(u.status),
    csvCell(formatDateISO(u.createdAt)), csvCell(formatDateISO(u.approvedAt)), csvCell(u.message || "")
  ]);
  return "\uFEFF" + [headers.map(csvCell).join(","), ...rows.map(row => row.join(","))].join("\r\n");
}

async function generateSubscribersCSV(): Promise<string> {
  const [subs, users] = await Promise.all([getSubscribers(), getUsers()]);
  const memberEmails = new Set(
    users.filter((u) => u.status === "approved").map((u) => u.email.toLowerCase())
  );
  subs.sort((a, b) => b.subscribedAt - a.subscribedAt);
  const headers = ["ID", "Name", "Email", "Status", "Member", "Source", "Event", `Subscribed Date (${brand.timezoneLabel})`, `Unsubscribed Date (${brand.timezoneLabel})`];
  const rows = subs.map((s) => [
    csvCell(s.id), csvCell(s.name || ""), csvCell(s.email),
    csvCell(s.unsubscribedAt ? "unsubscribed" : "active"),
    csvCell(memberEmails.has(s.email.toLowerCase()) ? "yes" : "no"),
    csvCell(s.source), csvCell(s.event || ""),
    csvCell(formatDateISO(s.subscribedAt)), csvCell(formatDateISO(s.unsubscribedAt))
  ]);
  return "\uFEFF" + [headers.map(csvCell).join(","), ...rows.map(row => row.join(","))].join("\r\n");
}

async function generateInquiriesCSV(): Promise<string> {
  const inquiries = await getInquiries();
  inquiries.sort((a, b) => b.createdAt - a.createdAt);
  const headers = ["Inquiry ID", `Date (${brand.timezoneLabel})`, "Member Name", "Member Email", "Member ID", "Product", "Product ID", "Phone", "Message"];
  const rows = inquiries.map((i) => [
    csvCell(i.id), csvCell(pacificDateTime(i.createdAt)), csvCell(i.userName), csvCell(i.userEmail), csvCell(i.userId),
    csvCell(i.productName), csvCell(i.productId), csvCell(i.phone || ""), csvCell(i.message || "")
  ]);
  return "\uFEFF" + [headers.map(csvCell).join(","), ...rows.map(row => row.join(","))].join("\r\n");
}

async function generateProductsCSV(): Promise<string> {
  const products = await getProducts();
  const headers = ["ID", "Name", "Price", "Category", "Description", "Image URL", `Created At (${brand.timezoneLabel})`];
  const rows = products.map((p) => [
    csvCell(p.id), csvCell(p.name), csvCell(p.price), csvCell(p.category || ""),
    csvCell(p.description), csvCell(p.image), csvCell(formatDateISO(p.createdAt))
  ]);
  return "\uFEFF" + [headers.map(csvCell).join(","), ...rows.map(row => row.join(","))].join("\r\n");
}

async function generateOrdersCSV(): Promise<string> {
  const orders = await getOrders();
  orders.sort((a, b) => b.createdAt - a.createdAt);
  const headers = [
    "Order ID", `Date (${brand.timezoneLabel})`, "Customer", "Email", "Member ID", "Status", "Method",
    "Items", "Subtotal", "Discount", "Shipping", "Total",
    `Paid At (${brand.timezoneLabel})`, `Shipped At (${brand.timezoneLabel})`, "Tracking", "Note",
  ];
  const rows = orders.map((o) => [
    csvCell(o.id), csvCell(pacificDateTime(o.createdAt)), csvCell(o.userName),
    csvCell(o.userEmail), csvCell(o.userId), csvCell(o.status), csvCell(o.shippingMethod),
    csvCell(o.items.map((i) => `${i.productName} x${i.quantity} @ ${i.price}`).join("; ")),
    csvCell(o.subtotal.toFixed(2)), csvCell((o.discount || 0).toFixed(2)),
    csvCell(o.shippingCost.toFixed(2)), csvCell(o.total.toFixed(2)),
    csvCell(formatDateISO(o.paidAt)), csvCell(formatDateISO(o.shippedAt)),
    csvCell(o.trackingNumber || ""), csvCell(o.note || ""), // payment token left out: it's the private part of the pay link
  ]);
  return "﻿" + [headers.map(csvCell).join(","), ...rows.map((row) => row.join(","))].join("\r\n");
}

// ==================== Email HTML builder ====================
function pct(n: number | null): string {
  if (n === null) return "";
  const sign = n >= 0 ? "+" : "";
  const color = n >= 0 ? "#6fa336" : "#c86164";
  return `<span style="color:${color};font-weight:700;">${sign}${n.toFixed(0)}%</span>`;
}

function statCard(label: string, value: string, sub = ""): string {
  return `
    <td style="padding:6px;">
      <div style="background:#f3f6ec;border-radius:8px;padding:14px;text-align:center;">
        <div style="font-size:1.6rem;font-weight:700;color:#6fa336;line-height:1.2;">${value}</div>
        <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.1em;color:#61676d;margin-top:4px;">${label}</div>
        ${sub ? `<div style="font-size:0.72rem;color:#81858b;margin-top:2px;">${sub}</div>` : ""}
      </div>
    </td>`;
}

function buildEmailHtml(i: Insights, attachments: string[]): string {
  const actions: string[] = [];
  if (i.pendingOver3Days.length > 0) {
    actions.push(
      `<strong>${i.pendingOver3Days.length} order${i.pendingOver3Days.length !== 1 ? "s" : ""} waiting on payment for 3+ days</strong> (${money(i.pendingOver3Days.reduce((n, o) => n + o.total, 0))} total). Longest: ${escapeHtml(i.pendingOver3Days[0].userName)}, ${i.pendingOver3Days[0].daysWaiting} days.`
    );
  }
  if (i.awaitingFulfillment > 0) {
    actions.push(`<strong>${i.awaitingFulfillment} paid order${i.awaitingFulfillment !== 1 ? "s" : ""}</strong> ready to ship or hand off.`);
  }
  if (i.pendingApprovals > 0) {
    actions.push(`<strong>${i.pendingApprovals} member request${i.pendingApprovals !== 1 ? "s" : ""}</strong> waiting for review.`);
  }
  if (i.revenueChangePct !== null && i.revenueChangePct <= -25) {
    actions.push(`Revenue is down ${Math.abs(i.revenueChangePct).toFixed(0)}% versus the previous week. Might be a good week for a promo or a countdown sale.`);
  }
  if (i.slowMovers.length > 0) {
    const sample = i.slowMovers.slice(0, 3).map((p) => escapeHtml(p.name)).join(", ");
    actions.push(`${i.slowMovers.length} product${i.slowMovers.length !== 1 ? "s haven't" : " hasn't"} sold in 30 days: ${sample}${i.slowMovers.length > 3 ? "…" : ""}.`);
  }
  if (actions.length === 0) actions.push("Nothing needs attention. Everything is paid, shipped, and moving.");

  const topProductRows = i.topProducts.map((p, idx) => `
    <tr style="border-bottom:1px solid #e8e5e5;">
      <td style="padding:0.5rem 0;">${idx + 1}. ${escapeHtml(p.name)}</td>
      <td style="padding:0.5rem 0;text-align:center;color:#81858b;">${p.unitsSold}</td>
      <td style="padding:0.5rem 0;text-align:right;font-weight:700;">${money(p.revenue)}</td>
    </tr>`).join("");

  const topCustomerRows = i.topCustomers.map((c) => `
    <tr style="border-bottom:1px solid #e8e5e5;">
      <td style="padding:0.5rem 0;">${escapeHtml(c.name)}</td>
      <td style="padding:0.5rem 0;text-align:center;color:#81858b;">${c.orders}</td>
      <td style="padding:0.5rem 0;text-align:right;font-weight:700;">${money(c.spend)}</td>
    </tr>`).join("");

  const categoryRows = i.categoryRevenue.slice(0, 5).map((c) => `
    <tr style="border-bottom:1px solid #e8e5e5;">
      <td style="padding:0.4rem 0;">${escapeHtml(c.category)}</td>
      <td style="padding:0.4rem 0;text-align:center;color:#81858b;">${c.units}</td>
      <td style="padding:0.4rem 0;text-align:right;">${money(c.revenue)}</td>
    </tr>`).join("");

  return `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:'Optima','Helvetica Neue',sans-serif;background:#f9f9f8;padding:20px;color:#61676d;">
  <div style="max-width:620px;margin:0 auto;background:white;border-radius:8px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.05);">
    <div style="background:#85ba45;padding:20px 24px;color:white;">
      <h1 style="margin:0;font-family:'Libre Baskerville',Georgia,serif;font-style:italic;font-weight:400;font-size:1.5rem;">${brand.name}</h1>
      <p style="margin:8px 0 0;opacity:0.85;">Nightly report &amp; backup &middot; ${new Date(i.generatedAt).toLocaleDateString("en-US", { timeZone: brand.timezone, month: "short", day: "numeric", year: "numeric" })} &middot; local time</p>
    </div>
    <div style="padding:24px;">

      <div style="font-size:0.7rem;letter-spacing:0.18em;text-transform:uppercase;color:#85ba45;font-weight:700;margin-bottom:12px;">Revenue</div>
      <table style="width:100%;border-collapse:collapse;"><tr>
        ${statCard("Yesterday", money(i.yesterday.revenue), `${i.yesterday.orders} order${i.yesterday.orders !== 1 ? "s" : ""}`)}
        ${statCard("Last 7 days", money(i.last7.revenue), `${i.last7.orders} orders ${pct(i.revenueChangePct)}`)}
        ${statCard("Last 30 days", money(i.last30.revenue), `${i.last30.orders} orders`)}
      </tr><tr>
        ${statCard("Avg order", money(i.last7.avgOrderValue), "last 7 days")}
        ${statCard("Awaiting payment", money(i.pendingValue), `${i.pendingCount} order${i.pendingCount !== 1 ? "s" : ""}`)}
        ${statCard("All time", money(i.allTime.revenue), `${i.allTime.orders} orders`)}
      </tr></table>

      <div style="margin:28px 0 12px;font-size:0.7rem;letter-spacing:0.18em;text-transform:uppercase;color:#85ba45;font-weight:700;">Needs your attention</div>
      <div style="background:#fdf6e3;border-left:4px solid #a2a434;padding:14px 16px;border-radius:0 6px 6px 0;">
        <ul style="margin:0;padding-left:18px;line-height:1.7;">
          ${actions.map((a) => `<li>${a}</li>`).join("")}
        </ul>
      </div>

      <div style="margin:28px 0 8px;font-size:0.7rem;letter-spacing:0.18em;text-transform:uppercase;color:#85ba45;font-weight:700;">Top sellers (30 days)</div>
      ${i.topProducts.length ? `<table style="width:100%;border-collapse:collapse;font-size:0.92rem;">
        <tr style="border-bottom:1px solid #abaeb2;"><th style="text-align:left;padding-bottom:4px;">Product</th><th style="text-align:center;padding-bottom:4px;">Units</th><th style="text-align:right;padding-bottom:4px;">Revenue</th></tr>
        ${topProductRows}
      </table>` : `<p style="color:#81858b;">No sales in the last 30 days.</p>`}

      ${i.categoryRevenue.length ? `
      <div style="margin:28px 0 8px;font-size:0.7rem;letter-spacing:0.18em;text-transform:uppercase;color:#85ba45;font-weight:700;">By category (30 days)</div>
      <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
        <tr style="border-bottom:1px solid #abaeb2;"><th style="text-align:left;padding-bottom:4px;">Category</th><th style="text-align:center;padding-bottom:4px;">Units</th><th style="text-align:right;padding-bottom:4px;">Revenue</th></tr>
        ${categoryRows}
      </table>` : ""}

      <div style="margin:28px 0 8px;font-size:0.7rem;letter-spacing:0.18em;text-transform:uppercase;color:#85ba45;font-weight:700;">Customers</div>
      <p style="margin:0 0 10px;line-height:1.6;">
        Last 7 days: <strong>${i.newCustomers7}</strong> new customer${i.newCustomers7 !== 1 ? "s" : ""},
        <strong>${i.repeatCustomers7}</strong> returning (<strong>${i.repeatRatePct.toFixed(0)}%</strong> repeat rate).<br/>
        Fulfillment: <strong>${i.shipCount7}</strong> shipped &middot; <strong>${i.pickupCount7}</strong> pickup.
      </p>
      ${i.topCustomers.length ? `<table style="width:100%;border-collapse:collapse;font-size:0.92rem;">
        <tr style="border-bottom:1px solid #abaeb2;"><th style="text-align:left;padding-bottom:4px;">Top customers (all time)</th><th style="text-align:center;padding-bottom:4px;">Orders</th><th style="text-align:right;padding-bottom:4px;">Spend</th></tr>
        ${topCustomerRows}
      </table>` : ""}

      <div style="margin:32px 0 0;border-top:1px solid #ddd;padding-top:18px;">
        <p style="margin:0 0 6px;"><strong>Attached backups</strong></p>
        <ul style="margin:0 0 8px 18px;line-height:1.6;">${attachments.map((a) => `<li>${a}</li>`).join("")}</ul>
        <p style="font-size:0.8rem;color:#81858b;margin:0;">Keep the latest email and you can always restore the catalog or reconstruct orders. Revenue figures count orders marked paid or shipped.</p>
      </div>

    </div>
  </div>
</body></html>`;
}

// Vercel Cron invokes scheduled jobs with a GET request, so the nightly
// backup needs a GET handler. Both verbs share the same implementation.
export async function GET(req: Request) {
  return logJobRun(req, "job.nightly_report");
}

export async function POST(req: Request) {
  return logJobRun(req, "report.send_now");
}

// Every run (scheduled or "send now") leaves one entry in the Activity log,
// so a failed nightly report is visible without digging through server logs.
async function logJobRun(req: Request, action: string): Promise<Response> {
  const started = Date.now();
  let res: Response;
  try {
    res = await runExport(req);
  } catch (err) {
    await auditSystem({ action, targetType: "job", ok: false, status: 500, note: err instanceof Error ? err.message.slice(0, 300) : "Crashed" });
    throw err;
  }
  if (res.status !== 401) {
    let note: string | undefined;
    try {
      const j = await res.clone().json();
      note = j?.error ? String(j.error).slice(0, 300) : undefined;
    } catch {
      /* ignore */
    }
    await auditSystem({
      action,
      targetType: "job",
      ok: res.status < 400,
      status: res.status,
      note: note || `Took ${((Date.now() - started) / 1000).toFixed(1)}s`,
      source: action.startsWith("job.") ? "system" : "human",
      actor: action.startsWith("job.") ? "vercel-cron" : "admin",
      actorType: action.startsWith("job.") ? "system" : "admin",
    });
  }
  return res;
}

// ==================== Main handler ====================
async function runExport(req: Request) {
  // Identify legitimate cron invocations. Vercel sends the x-vercel-cron
  // header on scheduled runs and an Authorization: Bearer <CRON_SECRET>
  // header when CRON_SECRET is set, but the dashboard "Run" button does
  // not always include the header — so check the user agent too.
  const cronHeader = req.headers.get("x-vercel-cron");
  const userAgent = req.headers.get("user-agent") || "";
  const authHeader = req.headers.get("authorization") || "";
  const secret = process.env.CRON_SECRET;

  // NOTE: the header and user-agent checks can be faked by anyone, so a
  // "cron" request is never trusted to choose the recipient (see below).
  const isCron =
    !!cronHeader ||
    /vercel-cron/i.test(userAgent) ||
    (!!secret && authHeader === `Bearer ${secret}`);

  const isAdminUser = await isAdmin();

  console.log(
    `[export-email] invoked — cronHeader=${cronHeader ?? "none"} ua="${userAgent.slice(0, 60)}" ` +
    `isCron=${isCron} isAdmin=${isAdminUser}`
  );

  if (!isAdminUser && !isCron) {
    console.warn("[export-email] rejected: neither admin session nor recognized cron request");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  // Default to everything — this is a full nightly backup.
  let type = url.searchParams.get("type") || "all";
  if (!["members", "inquiries", "products", "orders", "revenue", "both", "all"].includes(type)) type = "all";
  const includeMembers = type === "members" || type === "both" || type === "all";
  const includeSubscribers = type === "subscribers" || type === "all";
  const includeInquiries = type === "inquiries" || type === "both" || type === "all";
  const includeProducts = type === "products" || type === "all";
  const includeOrders = type === "orders" || type === "all";
  const includeRevenue = type === "revenue" || type === "all";

  // Only a signed-in admin may choose where the export goes. A cron run
  // always sends to the configured inbox, so a faked cron request can never
  // mail the member list to someone else.
  let recipientEmail: string | null = isAdminUser ? url.searchParams.get("email") : null;
  if (!recipientEmail) {
    recipientEmail = process.env.EXPORT_RECIPIENT_EMAIL ?? process.env.INQUIRY_TO_EMAIL ?? null;
  }
  if (!recipientEmail) {
    console.error("[export-email] no recipient: set EXPORT_RECIPIENT_EMAIL or INQUIRY_TO_EMAIL");
    return NextResponse.json({ error: "No recipient email configured" }, { status: 500 });
  }

  const [insights, membersCSV, inquiriesCSV, productsCSV, ordersCSV, revenueCSV, subscribersCSV] = await Promise.all([
    getInsights(),
    includeMembers ? generateMembersCSV() : Promise.resolve(null),
    includeInquiries ? generateInquiriesCSV() : Promise.resolve(null),
    includeProducts ? generateProductsCSV() : Promise.resolve(null),
    includeOrders ? generateOrdersCSV() : Promise.resolve(null),
    includeRevenue ? generateRevenueCSV() : Promise.resolve(null),
    includeSubscribers ? generateSubscribersCSV() : Promise.resolve(null),
  ]);

  const stamp = pacificDay();
  const attachments: Array<{ filename: string; content: string }> = [];
  const attachmentLabels: string[] = [];
  if (revenueCSV) {
    attachments.push({ filename: `revenue-${stamp}.csv`, content: revenueCSV });
    attachmentLabels.push("<strong>revenue.csv</strong> — daily, monthly, product, category &amp; customer totals, plus outstanding balances");
  }
  if (ordersCSV) {
    attachments.push({ filename: `orders-${stamp}.csv`, content: ordersCSV });
    attachmentLabels.push("<strong>orders.csv</strong> — every order with status, totals, tracking &amp; payment links");
  }
  if (membersCSV) {
    attachments.push({ filename: `members-${stamp}.csv`, content: membersCSV });
    attachmentLabels.push("<strong>members.csv</strong> — full member list");
  }
  if (productsCSV) {
    attachments.push({ filename: `products-${stamp}.csv`, content: productsCSV });
    attachmentLabels.push("<strong>products.csv</strong> — current catalog");
  }
  if (inquiriesCSV) {
    attachments.push({ filename: `inquiries-${stamp}.csv`, content: inquiriesCSV });
    attachmentLabels.push("<strong>inquiries.csv</strong> — legacy inquiry history");
  }
  if (subscribersCSV) {
    attachments.push({ filename: `subscribers-${stamp}.csv`, content: subscribersCSV });
    attachmentLabels.push("<strong>subscribers.csv</strong> — mailing list, active &amp; unsubscribed");
  }

  const emailHtml = buildEmailHtml(insights, attachmentLabels);

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev";
  if (!apiKey) {
    return NextResponse.json({ error: "Resend API key missing" }, { status: 500 });
  }

  const resend = new Resend(apiKey);
  const attachmentPayloads = attachments.map(att => ({
    filename: att.filename,
    content: Buffer.from(att.content).toString("base64"),
  }));

  try {
    const result = await resend.emails.send({
      from: fromEmail,
      to: recipientEmail,
      subject: `📊 ${brand.shortName} nightly report — ${money(insights.yesterday.revenue)} yesterday, ${money(insights.last7.revenue)} last 7 days`,
      html: emailHtml,
      attachments: attachmentPayloads,
    });
    if (result.error) {
      // Resend returns errors in the payload rather than throwing
      console.error("[export-email] Resend rejected the message:", result.error);
      return NextResponse.json({ error: `Resend: ${result.error.message}` }, { status: 502 });
    }
    console.log(
      `[export-email] sent to ${recipientEmail} with ${attachmentPayloads.length} attachment(s), id=${result.data?.id}`
    );
    return NextResponse.json({ ok: true, sent: true, id: result.data?.id });
  } catch (err) {
    console.error("[export-email] send threw:", err);
    return NextResponse.json({ error: "Email sending failed" }, { status: 500 });
  }
}
