import { NextResponse } from "next/server";
import { pacificDateTime, pacificDay } from "@/lib/periods";
import { isAdmin } from "@/lib/auth";
import { getInquiries } from "@/lib/inquiries";
import { brand } from "@/lib/brand";

function csvCell(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return "";
  return `"${String(value).replace(/"/g, '""')}"`;
}

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const inquiries = await getInquiries();
  inquiries.sort((a, b) => b.createdAt - a.createdAt);

  const headers = [
    "Inquiry ID",
    `Date (${brand.timezoneLabel})`,
    "Member Name",
    "Member Email",
    "Member ID",
    "Product",
    "Product ID",
    "Phone",
    "Message",
  ];

  const rows = inquiries.map((i) => [
    csvCell(i.id),
    csvCell(pacificDateTime(i.createdAt)),
    csvCell(i.userName),
    csvCell(i.userEmail),
    csvCell(i.userId),
    csvCell(i.productName),
    csvCell(i.productId),
    csvCell(i.phone || ""),
    csvCell(i.message || ""),
  ]);

  // BOM for Excel UTF-8 on Windows
  const csv =
    "\uFEFF" +
    [headers.map(csvCell).join(","), ...rows.map((r) => r.join(","))].join("\r\n");

  const stamp = pacificDay();
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="inquiries-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
