import { isEnabled } from "@/lib/flags";
import { getStoreSession, checkStoreSetupToken } from "@/lib/retailAuth";
import { portalData } from "@/lib/retailPortal";
import { StoreSignIn, StoreSetPassword, StorePortal } from "./StorePortalClient";
import { brand } from "@/lib/brand";

export const metadata = {
  title: `Store portal · ${brand.name}`,
  description: `For shops that carry ${brand.shortName}: request stock and track deliveries.`,
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

/**
 * The store portal (switch retail_portal). Signed out: sign-in (password,
 * emailed code, Face ID, "email me a link"). With ?t=: choose a password.
 * Signed in: request stock, follow requests, see what's been shipped.
 */
export default async function StorePortalPage({ searchParams }: { searchParams: { t?: string } }) {
  const [on, codesOn, faceOn] = await Promise.all([
    isEnabled("retail_portal").catch(() => false),
    isEnabled("email_code_login").catch(() => false),
    isEnabled("member_passkeys").catch(() => false),
  ]);
  if (!on) {
    return (
      <div className="pay-shell sp-gate">
        <div className="pay-card fade-rise wel-card">
          <div className="pay-kicker">{brand.name} · Store portal</div>
          <h1 className="pay-title">The store portal is closed right now</h1>
          <p className="pay-muted">
            Please email <a href={`mailto:${brand.supportEmail}`} style={{ color: "var(--accent-strong)", fontWeight: 600 }}>{brand.supportEmail}</a> for anything you need.
          </p>
        </div>
      </div>
    );
  }

  const t = searchParams.t || "";
  if (t) {
    const check = await checkStoreSetupToken(t);
    return (
      <div className="pay-shell sp-gate">
        <div className="pay-card fade-rise wel-card">
          <div className="pay-kicker">{brand.name} · Store portal</div>
          {check.ok ? (
            <>
              <h1 className="pay-title">Welcome, {check.login.name.split(" ")[0] || check.login.name}</h1>
              <p className="pay-muted">Choose a password for {check.account.name}&apos;s store portal and you&apos;re in.</p>
              <StoreSetPassword t={t} email={check.login.email} />
            </>
          ) : (
            <>
              <h1 className="pay-title">{check.reason === "expired" ? "This link has expired" : check.reason === "used" ? "This link has already been used" : "This link isn't valid"}</h1>
              <p className="pay-muted">{check.reason === "used" ? "Your password is already set. Sign in below, or ask for a fresh link if you've forgotten it." : "No problem: sign in below, or ask for a fresh link."}</p>
              <StoreSignIn codesOn={codesOn} faceOn={faceOn} startOn="link" />
            </>
          )}
        </div>
      </div>
    );
  }

  const session = await getStoreSession();
  if (!session) {
    return (
      <div className="pay-shell sp-gate">
        <div className="pay-card fade-rise wel-card">
          <div className="logo-mark" aria-hidden="true" style={{ margin: "0 auto 1rem" }}>
            <span></span><span></span><span></span><span></span>
          </div>
          <div className="pay-kicker">{brand.name} · Store portal</div>
          <h1 className="pay-title">Store sign-in</h1>
          <p className="pay-muted">For shops that carry {brand.shortName}. Request stock and follow your deliveries.</p>
          <StoreSignIn codesOn={codesOn} faceOn={faceOn} />
        </div>
      </div>
    );
  }
  const data = await portalData(session.account, session.login);
  return <StorePortal initial={JSON.parse(JSON.stringify(data))} faceOn={faceOn} />;
}
