import { NextResponse } from "next/server";
import { pacificDateTime, pacificDay } from "@/lib/periods";
import { isAdmin } from "@/lib/auth";
import { getSubscribers } from "@/lib/subscribers";
import { getUsers } from "@/lib/users";
import { brand } from "@/lib/brand";

// CSV-safe quoting: wraps a value in quotes and escapes any embedded quotes.
function csvCell(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return "";
  const s = String(value);
  // Always quote — handles commas, quotes, newlines safely
  return `"${s.replace(/"/g, '""')}"`;
}

function formatDate(ts: number | undefined): string {
  if (!ts) return "";
  return pacificDateTime(ts);
}

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [subs, users] = await Promise.all([getSubscribers(), getUsers()]);
  // "Member" = has an approved member account with this email
  const memberEmails = new Set(
    users.filter((u) => u.status === "approved").map((u) => u.email.toLowerCase())
  );
  // Sort newest first for human readability
  subs.sort((a, b) => b.subscribedAt - a.subscribedAt);

  const headers = [
    "ID",
    "Name",
    "Email",
    "Status",
    "Member",
    "Source",
    "Event",
    `Subscribed Date (${brand.timezoneLabel})`,
    `Unsubscribed Date (${brand.timezoneLabel})`,
  ];

  const rows = subs.map((s) => [
    csvCell(s.id),
    csvCell(s.name || ""),
    csvCell(s.email),
    csvCell(s.unsubscribedAt ? "unsubscribed" : "active"),
    csvCell(memberEmails.has(s.email.toLowerCase()) ? "yes" : "no"),
    csvCell(s.source),
    csvCell(s.event || ""),
    csvCell(formatDate(s.subscribedAt)),
    csvCell(formatDate(s.unsubscribedAt)),
  ]);

  // BOM (\uFEFF) so Excel opens UTF-8 correctly on Windows
  const csv =
    "\uFEFF" +
    [headers.map(csvCell).join(","), ...rows.map((r) => r.join(","))].join("\r\n");

  const stamp = pacificDay(); // YYYY-MM-DD
  const filename = `subscribers-${stamp}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
