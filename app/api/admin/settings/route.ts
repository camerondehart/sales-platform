import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { getSettings, getSettingsForUpdate, saveSettings, DEFAULT_SETTINGS, type SiteSettings } from "@/lib/settings";
import { audited, auditDetail } from "@/lib/audit";

// Public read — always fresh.
export const dynamic = "force-dynamic";

// Public read (the gallery needs the bundle rule to preview savings);
// writes are admin-only.
export async function GET() {
  return NextResponse.json({ settings: await getSettings() });
}

async function POST_handler(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json();
  const num = (v: any, fallback: number, min = 0) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min ? n : fallback;
  };

  const clean = {
    bundleRuleEnabled: (v: any) => !!v,
    bundleRuleMinItems: (v: any) => Math.max(2, Math.floor(num(v, 3, 2))),
    bundleRulePercent: (v: any) => Math.min(90, num(v, 10, 1)),
    loyaltyEnabled: (v: any) => !!v,
    pointsPerDollar: (v: any) => num(v, 1, 0),
    pointsPerDollarRedeemed: (v: any) => Math.max(1, num(v, 100, 1)),
    minPointsToRedeem: (v: any) => Math.max(0, num(v, 100, 0)),
    packagingOz: (v: any) => Math.min(320, num(v, 0, 0)),
  };
  type Key = keyof typeof clean;
  const keys = Object.keys(clean) as Key[];

  // `partial: true` changes only the fields sent, on top of what's saved now
  // (used by the assistant, so a confirmed change can't reset the others).
  // Without it, the dashboard form sends everything, as before.
  let base: SiteSettings = DEFAULT_SETTINGS;
  if (body.partial === true) {
    try {
      base = await getSettingsForUpdate();
    } catch (err) {
      console.error("Partial settings update aborted", err);
      return NextResponse.json({ error: "Couldn't read the current settings. Please try again." }, { status: 503 });
    }
  }
  const next: SiteSettings = { ...base, updatedAt: Date.now() };
  try {
    auditDetail({ before: body.partial === true ? base : await getSettings() });
  } catch {
    /* best effort */
  }
  // The dashboard's loyalty form doesn't send the box weight — keep what's saved.
  if (body.partial !== true && !("packagingOz" in body)) {
    try {
      next.packagingOz = (await getSettingsForUpdate()).packagingOz;
    } catch {
      return NextResponse.json({ error: "Couldn't read the current settings. Please try again." }, { status: 503 });
    }
  }
  for (const k of keys) {
    if ((body.partial === true || k === "packagingOz") && !(k in body)) continue;
    (next as any)[k] = clean[k](body[k]);
  }
  const saved = await saveSettings(next);

  return NextResponse.json({ ok: true, settings: saved });
}

// One audit-log entry per request (see lib/audit.ts).
export const POST = audited("settings.update", "settings", POST_handler);
