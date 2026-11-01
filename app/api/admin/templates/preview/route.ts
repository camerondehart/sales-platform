import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { wrapCampaign } from "@/lib/campaignEmail";
import { renderCampaign } from "@/lib/campaignRender";
import { cleanThemeChoice, resolveTheme } from "@/lib/campaignThemes";

export const dynamic = "force-dynamic";

/**
 * Staff preview of an email template or campaign draft: the exact HTML a
 * subscriber would get (house header, body, footer), with a sample first name.
 * Read-only — nothing is saved or sent. Shown in a sandboxed frame.
 */
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { subject?: unknown; body?: unknown; theme?: unknown; when?: unknown };
  const body = String(b.body || "").slice(0, 50_000);
  const subject = String(b.subject || "").slice(0, 200);
  if (!body.trim()) return NextResponse.json({ error: "Nothing to preview yet." }, { status: 400 });
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || new URL(req.url).origin;
  // With a theme (the campaign composer): the seasonal layout, exactly as it will be sent.
  if (b.theme !== undefined) {
    const theme = cleanThemeChoice(b.theme);
    const when = Number(b.when) || Date.now();
    const html = await renderCampaign({ subject, body, theme, unsubUrl: "#unsubscribe", name: "Boss", siteUrl, when });
    return NextResponse.json({ subject, html, theme: resolveTheme(theme, subject, body, when)?.key || "none" }, { headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ subject, html: wrapCampaign(body, "#unsubscribe", "Boss", { siteUrl }) }, { headers: { "Cache-Control": "no-store" } });
}
