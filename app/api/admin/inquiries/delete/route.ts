import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { getInquiries, saveInquiries } from "@/lib/inquiries";
import { put } from "@vercel/blob";
import { audited } from "@/lib/audit";

async function DELETE_handler(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }

  const inquiries = await getInquiries();
  const inquiry = inquiries.find(i => i.id === id);
  if (!inquiry) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // ---- Backup the inquiry before deletion ----
  try {
    const backupKey = `backups/inquiries/${id}_${Date.now()}.json`;
    await put(backupKey, JSON.stringify(inquiry, null, 2), {
      access: "public",
      addRandomSuffix: true,
    });
    console.log(`[BACKUP] Inquiry ${id} backed up to ${backupKey}`);
  } catch (err) {
    console.error(`[BACKUP FAILED] Could not backup inquiry ${id}:`, err);
    // Continue deletion anyway
  }

  // ---- Permanently delete ----
  const filtered = inquiries.filter(i => i.id !== id);
  await saveInquiries(filtered);

  return NextResponse.json({ ok: true });
}

// One audit-log entry per request (see lib/audit.ts).
export const DELETE = audited("inquiry.delete", "inquiry", DELETE_handler);
