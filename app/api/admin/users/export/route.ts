import { NextResponse } from "next/server";
import { pacificDateTime, pacificDay } from "@/lib/periods";
import { isAdmin } from "@/lib/auth";
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

  const users = await getUsers();
  // Sort newest first for human readability
  users.sort((a, b) => b.createdAt - a.createdAt);

  const headers = [
    "ID",
    "Name",
    "Email",
    "Status",
    `Signup Date (${brand.timezoneLabel})`,
    `Approved Date (${brand.timezoneLabel})`,
    "Signup Message",
  ];

  const rows = users.map((u) => [
    csvCell(u.id),
    csvCell(u.name),
    csvCell(u.email),
    csvCell(u.status),
    csvCell(formatDate(u.createdAt)),
    csvCell(formatDate(u.approvedAt)),
    csvCell(u.message || ""),
  ]);

  // BOM (\uFEFF) so Excel opens UTF-8 correctly on Windows
  const csv =
    "\uFEFF" +
    [headers.map(csvCell).join(","), ...rows.map((r) => r.join(","))].join("\r\n");

  const stamp = pacificDay(); // YYYY-MM-DD
  const filename = `members-${stamp}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
