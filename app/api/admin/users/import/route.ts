import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { addUsersBulk } from "@/lib/users";
import { parseCsvRecords, pick, EMAIL_COLUMNS, NAME_COLUMNS } from "@/lib/csvImport";
import { audited } from "@/lib/audit";

// Bulk-add members from an uploaded CSV.
//
// Needs an email column; a name column is used when present. Imported members
// are approved by default so they can sign in straight away. They set their
// own password using "Forgot password?" on the sign-in page, which emails
// them one — the site never stores a password anyone else has seen.
async function POST_handler(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let csv = "";
  let asPending = false;
  try {
    const body = await req.json();
    csv = body.csv || "";
    asPending = !!body.asPending;
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
  }));

  if (!rows.some((r) => r.email)) {
    return NextResponse.json(
      { error: "Couldn't find an email column. Name one of the columns \"email\" and try again." },
      { status: 400 }
    );
  }

  try {
    const result = await addUsersBulk(rows, asPending ? "pending" : "approved");
    return NextResponse.json({ ok: true, ...result, rows: rows.length });
  } catch (err) {
    console.error("Member import failed", err);
    return NextResponse.json({ error: "Could not save those members. Please try again." }, { status: 500 });
  }
}

// One audit-log entry per request (see lib/audit.ts).
export const POST = audited("member.import", "member", POST_handler);
