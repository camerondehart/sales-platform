import { NextResponse } from "next/server";
import { getApprovedVisitor } from "@/lib/auth";
import { isEnabled } from "@/lib/flags";
import { tooMany } from "@/lib/publicLimits";
import { cleanConsultation, requestConsultation, takenSlots } from "@/lib/consultation";

export const dynamic = "force-dynamic";

const off = async () => !(await isEnabled("consultation_form").catch(() => false));

/** Times already asked for (no personal details), so the form can grey them out. */
export async function GET() {
  if (await off()) return NextResponse.json({ error: "Not available." }, { status: 404 });
  return NextResponse.json({ taken: await takenSlots() }, { headers: { "Cache-Control": "no-store" } });
}

/** The /consultation page: ask for a free phone consultation (switch `consultation_form`). */
export async function POST(req: Request) {
  if (await off()) return NextResponse.json({ error: "Not available." }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  // Honeypot: people never see this field, so anything in it is a bot. Pretend it worked.
  if (String(body.website || "").trim()) return NextResponse.json({ ok: true });
  const limited = tooMany(req, "consultation", { max: 10, minutes: 60 }, { key: String(body.email || ""), max: 8, minutes: 60 });
  if (limited) return limited;
  const c = cleanConsultation(body);
  if (!c.ok) return NextResponse.json({ error: c.error }, { status: 400 });
  const member = await getApprovedVisitor().catch(() => null);
  const r = await requestConsultation(c.value, { source: "form", audience: member ? "member" : "public" });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.error.startsWith("Someone just") ? 409 : 502 });
  return NextResponse.json({ ok: true });
}
