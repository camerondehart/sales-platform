import { NextResponse } from "next/server";
import { pacificDateTime, pacificDay } from "@/lib/periods";
import { Resend } from "resend";
import { isAdmin } from "@/lib/auth";
import { getUsers, type User } from "@/lib/users";
import { getInquiries, type Inquiry } from "@/lib/inquiries";
import { getSubscribers } from "@/lib/subscribers";
import { getProducts, type Product } from "@/lib/storage";
import { getOrders } from "@/lib/orders";
import { getInsights, money } from "@/lib/analytics";
import { generateRevenueCSV } from "@/lib/revenueCsv";
import { auditSystem } from "@/lib/audit";
import { brand } from "@/lib/brand";
import { isEnabled } from "@/lib/flags";
import { phraseFor, phraseStartedAt } from "@/lib/staffPhrase";
import { reportExtras, buildReportHtml } from "@/lib/nightlyReport";
import { siteUrlFrom } from "@/lib/giftCardDelivery";

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
// The email itself is built in lib/nightlyReport.ts.

// Vercel Cron invokes scheduled jobs with a GET request, so the nightly
// backup needs a GET handler. Both verbs share the same implementation.
// Room for the Manager's take to finish before the scheduled report goes out.
export const maxDuration = 300;

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

  // With CRON_SECRET set (production), only Vercel's Bearer secret counts:
  // the header and user-agent can be faked by anyone. Without a secret they
  // are accepted only off Vercel (local runs and tests), never on a preview.
  // Either way a "cron" request is never trusted to choose the recipient.
  const isCron = secret
    ? authHeader === `Bearer ${secret}`
    : !process.env.VERCEL && (!!cronHeader || /vercel-cron/i.test(userAgent));

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
  // POST only: a GET can be triggered by a link a staff member clicks while
  // signed in (cookies go along with links), which must never mail the
  // member list to an address in that link.
  let recipientEmail: string | null = isAdminUser && req.method === "POST" ? url.searchParams.get("email") : null;
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

  // Today's staff password goes only to the configured inbox, never to an
  // address typed in for a one-off "send now".
  const toConfigured = recipientEmail === (process.env.EXPORT_RECIPIENT_EMAIL ?? process.env.INQUIRY_TO_EMAIL ?? null);
  let phrase: string | null = null;
  if (toConfigured && (await isEnabled("rotating_staff_password").catch(() => false))) {
    await phraseStartedAt();
    phrase = phraseFor(pacificDay());
  }
  // The scheduled report waits for tonight's Manager's take: if
  // the midnight review hasn't finished (or failed), run it now, before the email.
  if (isCron) {
    try {
      const { latestReview, runManagerReview } = await import("@/lib/assistant/managerReview");
      const { getAssistantConfig } = await import("@/lib/assistant/config");
      const last = await latestReview();
      if ((await getAssistantConfig()).managerRunsPerDay !== 0 && (!last?.ok || Date.now() - last.at > 6 * 3_600_000)) await runManagerReview({ trigger: "nightly", req, force: true, budgetMs: 180_000 });
    } catch (err) {
      console.error("[export-email] manager review before the report failed", err);
    }
  }
  // Extras are read after the backups, one at a time, so they never pile onto the order reads above.
  const extras = await reportExtras(siteUrlFrom(req));
  const emailHtml = buildReportHtml(insights, extras, attachmentLabels, phrase);

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
