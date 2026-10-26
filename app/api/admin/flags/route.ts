import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { audited, auditDetail } from "@/lib/audit";
import { currentEnv, FLAG_KEYS, FLAGS, getFlags, setFlag, type FlagKey } from "@/lib/flags";
import { startVersionedProducts, stopVersionedProducts } from "@/lib/storage";
import { startVersionedDiscounts, stopVersionedDiscounts } from "@/lib/discounts";

export const dynamic = "force-dynamic";

/** Feature switches for this environment (production or stage). */
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const values = await getFlags({ fresh: true });
  const env = currentEnv();
  return NextResponse.json(
    {
      env,
      flags: FLAG_KEYS.map((key) => ({
        key,
        ...FLAGS[key],
        on: values[key],
        default: FLAGS[key].defaults[env],
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

async function POST_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { key?: string; on?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const key = String(body.key || "") as FlagKey;
  if (!FLAG_KEYS.includes(key)) return NextResponse.json({ error: "Unknown switch." }, { status: 400 });
  if (typeof body.on !== "boolean") return NextResponse.json({ error: "Say on or off." }, { status: 400 });
  try {
    // Safe storage switch: carry the current data across BEFORE flipping, so
    // nothing saved the other way in the meantime is left behind.
    if (key === "versioned_catalog") {
      const was = (await getFlags({ fresh: true }))[key];
      if (body.on && !was) await Promise.all([startVersionedProducts(), startVersionedDiscounts()]);
      if (!body.on && was) await Promise.all([stopVersionedProducts(), stopVersionedDiscounts()]);
    }
    const { before, after } = await setFlag(key, body.on);
    auditDetail({ targetId: `${FLAGS[key].shared ? "shared" : currentEnv()}:${key}`, before: { on: before }, after: { on: after } });
    return NextResponse.json({ ok: true, key, on: after });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't save." }, { status: 400 });
  }
}

// One audit-log entry per request (see lib/audit.ts).
export const POST = audited("flag.set", "flag", POST_handler);
