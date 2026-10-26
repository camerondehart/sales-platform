import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { getBanner, getBannerForUpdate, saveBanner, DEFAULT_BANNER, type Banner } from "@/lib/banner";
import { audited, auditDetail } from "@/lib/audit";

// Public read — always fresh.
export const dynamic = "force-dynamic";

// Public read so the banner can render for everyone; writes are admin-only.
export async function GET() {
  return NextResponse.json({ banner: await getBanner() });
}

async function POST_handler(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const countdownOf = (v: any) => {
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const clean: Record<keyof Omit<Banner, "updatedAt">, (v: any) => any> = {
    enabled: (v) => !!v,
    message: (v) => String(v || "").slice(0, 500),
    linkUrl: (v) => (typeof v === "string" && v.trim()) || undefined,
    linkLabel: (v) => (typeof v === "string" && v.trim().slice(0, 60)) || undefined,
    background: (v) => String(v || DEFAULT_BANNER.background).slice(0, 32),
    textColor: (v) => String(v || DEFAULT_BANNER.textColor).slice(0, 32),
    countdownTo: countdownOf,
    countdownLabel: (v) => (typeof v === "string" && v.trim().slice(0, 60)) || undefined,
  };

  // `partial: true` changes only the fields sent, on top of the saved banner
  // (the assistant uses this so colours etc. stay as they are). Without it,
  // the dashboard form sends the whole banner, as before.
  let base: Banner = DEFAULT_BANNER;
  if (body.partial === true) {
    try {
      base = await getBannerForUpdate();
    } catch (err) {
      console.error("Partial banner update aborted", err);
      return NextResponse.json({ error: "Couldn't read the current banner. Please try again." }, { status: 503 });
    }
  }
  const banner: Banner = { ...base, updatedAt: Date.now() };
  try {
    auditDetail({ before: body.partial === true ? base : await getBanner() });
  } catch {
    /* best effort */
  }
  for (const k of Object.keys(clean) as Array<keyof typeof clean>) {
    if (body.partial === true && !(k in body)) continue;
    (banner as any)[k] = clean[k](body[k]);
  }

  const saved = await saveBanner(banner);
  return NextResponse.json({ ok: true, banner: saved });
}

// One audit-log entry per request (see lib/audit.ts).
export const POST = audited("banner.update", "banner", POST_handler);
