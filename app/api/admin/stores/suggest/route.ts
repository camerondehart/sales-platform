import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { suggestAddresses, suggestPlaces } from "@/lib/addressSuggest";

export const dynamic = "force-dynamic";

// Store form: suggestions as staff type the store name (businesses) or street (addresses). Changes nothing.
export async function GET(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const q = sp.get("q") || "";
  try {
    // kind=place: businesses by name ("Main Street Market"); otherwise addresses.
    return NextResponse.json({ suggestions: sp.get("kind") === "place" ? await suggestPlaces(q) : await suggestAddresses(q) });
  } catch {
    // The form just carries on without suggestions.
    return NextResponse.json({ suggestions: [], unavailable: true });
  }
}
