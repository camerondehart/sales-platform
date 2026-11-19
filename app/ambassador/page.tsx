import { redirect } from "next/navigation";
import { getApprovedVisitor } from "@/lib/auth";
import { isEnabled } from "@/lib/flags";
import { getAmbassadorSession, panelData } from "@/lib/ambassadorPanel";
import Scene from "@/app/components/Scene";
import AmbassadorPanelClient from "./AmbassadorPanelClient";
import { brand } from "@/lib/brand";

export const metadata = {
  title: `Ambassador panel · ${brand.name}`,
  description: "Your page, your numbers and your picks.",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

/**
 * The Ambassador panel (switch ambassador_panel, lib/ambassadorPanel.ts).
 * Ambassadors sign in as the member linked to them in the Ambassadors tab
 * and land here. Signed out → the sign-in, coming back here afterwards.
 */
export default async function AmbassadorPanelPage() {
  const user = await getApprovedVisitor().catch(() => null);
  if (!user) redirect("/?next=/ambassador");
  const session = await getAmbassadorSession();
  if (!session) {
    const on = await isEnabled("ambassador_panel").catch(() => false);
    return (
      <>
        <Scene variant="soft" />
        <div className="pay-shell sp-gate">
          <div className="pay-card fade-rise wel-card">
            <div className="pay-kicker">{brand.name} · Ambassador panel</div>
            <h1 className="pay-title">{on ? "This page is for our ambassadors" : "The ambassador panel is closed right now"}</h1>
            <p className="pay-muted">
              {on
                ? <>Your account isn&rsquo;t linked to an ambassador page. If you&rsquo;re one of our ambassadors, email <a href={`mailto:${brand.supportEmail}`} style={{ color: "var(--accent-strong)", fontWeight: 600 }}>{brand.supportEmail}</a> and we&rsquo;ll link it for you.</>
                : "Please check back soon. Your page and your numbers are safe."}
            </p>
            <p style={{ marginTop: "1.2rem" }}>
              <a className="sp-btn sp-btn-primary" href="/gallery">Go to the shop</a>
            </p>
          </div>
        </div>
      </>
    );
  }
  const data = await panelData(session, "30");
  return (
    <>
      <Scene variant="soft" />
      <AmbassadorPanelClient initial={JSON.parse(JSON.stringify(data))} />
    </>
  );
}
