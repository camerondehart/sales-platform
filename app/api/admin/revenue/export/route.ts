import { NextResponse } from "next/server";
import { pacificDay } from "@/lib/periods";
import { isAdmin } from "@/lib/auth";
import { generateRevenueCSV } from "@/lib/revenueCsv";

// Download the full revenue report as a CSV.
export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const csv = await generateRevenueCSV();
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="revenue-${pacificDay()}.csv"`,
    },
  });
}
