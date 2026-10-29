import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { geocodeAddress } from "@/lib/geocode";
import { addressLine } from "@/lib/stores";

export const dynamic = "force-dynamic";

// "Find on map" in the store form: look an address up (cached, rate-limited)
// so staff can see and correct the pin before saving. Changes nothing.
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let b: Record<string, unknown> = {};
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const s = (k: string) => String(b[k] ?? "").trim().slice(0, 160);
  const address = addressLine({ street: s("street"), city: s("city"), state: s("state"), zip: s("zip") });
  if (!address) return NextResponse.json({ error: "Enter an address first." }, { status: 400 });
  const g = await geocodeAddress(address);
  if (!g.point) return NextResponse.json({ found: false, error: g.error || "Not found." });
  return NextResponse.json({ found: true, lat: g.point.lat, lng: g.point.lng, label: g.point.label, cached: g.cached });
}
