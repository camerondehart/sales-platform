import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { addSubscribersBulk } from "@/lib/subscribers";
import { parseCsvRecords, pick, EMAIL_COLUMNS, NAME_COLUMNS, STATUS_COLUMNS } from "@/lib/csvImport";
import { audited } from "@/lib/audit";

// Bulk-add subscribers from an uploaded CSV.
//
// Only an email column is required. Common header spellings are accepted, so
// a list exported from another mailing tool or a spreadsheet usually works
// without being reformatted first.
async function POST_handler(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let csv = "";
  try {
    csv = (await req.json()).csv || "";
  } catch {
    return NextResponse.json({ error: "Could not read that file." }, { status: 400 });
  }
  if (!csv.trim()) {
    return NextResponse.json({ error: "That file looked empty." }, { status: 400 });
  }

  const records = parseCsvRecords(csv);
  if (records.length === 0) {
    return NextResponse.json(
      { error: "No rows found. The first line should be column names, and one of them should be \"email\"." },
      { status: 400 }
    );
  }

  const rows = records.map((r) => ({
    email: pick(r, ...EMAIL_COLUMNS),
    name: pick(r, ...NAME_COLUMNS),
    // Honoured if present: keeps rejected members and people who opted out
    // from being added. See addSubscribersBulk.
    status: pick(r, ...STATUS_COLUMNS),
  }));

  if (!rows.some((r) => r.email)) {
    return NextResponse.json(
      { error: "Couldn't find an email column. Name one of the columns \"email\" and try again." },
      { status: 400 }
    );
  }

  try {
    const result = await addSubscribersBulk(rows, "manual");
    return NextResponse.json({ ok: true, ...result, rows: rows.length });
  } catch (err) {
    console.error("Subscriber import failed", err);
    return NextResponse.json({ error: "Could not save the list. Please try again." }, { status: 500 });
  }
}

// One audit-log entry per request (see lib/audit.ts).
export const POST = audited("subscriber.import", "subscriber", POST_handler);
