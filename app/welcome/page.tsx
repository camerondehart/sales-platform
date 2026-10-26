import { checkSetupToken } from "@/lib/passwordSetup";
import WelcomeForm, { LinkRequest } from "./WelcomeForm";
import { brand } from "@/lib/brand";

export const metadata = { title: `Set your password · ${brand.name}` };
export const dynamic = "force-dynamic";

// The "Set my password" link in the invite email lands here.
export default async function WelcomePage({ searchParams }: { searchParams: { t?: string } }) {
  const t = searchParams.t || "";
  const preview = t === "preview";
  const check = preview ? null : await checkSetupToken(t);
  const first = check?.ok ? check.user.name.split(" ")[0] || check.user.name : "";

  return (
    <div className="pay-shell">
      <div className="pay-card fade-rise wel-card">
        <div className="logo-mark" aria-hidden="true" style={{ margin: "0 auto 1rem" }}>
          <span></span><span></span><span></span><span></span>
        </div>
        <div className="pay-kicker">{brand.name} · {brand.members}</div>
        {preview ? (
          <>
            <h1 className="pay-title">Welcome back</h1>
            <p className="pay-muted">This is a preview of the set-password page — the real link in each member's email opens their own account.</p>
          </>
        ) : check?.ok ? (
          <>
            <h1 className="pay-title">Welcome, {first}</h1>
            <p className="pay-muted">Your account moved over from our old shop. Choose a password and you're in.</p>
            <WelcomeForm t={t} email={check.user.email} />
          </>
        ) : (
          <>
            <h1 className="pay-title">
              {check?.reason === "expired" ? "This link has expired" : check?.reason === "used" ? "This link has already been used" : "This link isn't valid"}
            </h1>
            <p className="pay-muted">
              {check?.reason === "used"
                ? "Your password has already been set. Sign in with it — or get a fresh link below if you've forgotten it."
                : "No problem — enter your email and we'll send you a fresh link to set your password."}
            </p>
            <LinkRequest />
            <p className="pay-muted" style={{ fontSize: "0.82rem", marginTop: "1rem" }}>
              <a href="/" style={{ color: "var(--accent-strong)", fontWeight: 600 }}>Go to sign in</a> · Need a hand?{" "}
              <a href={`mailto:${brand.supportEmail}`} style={{ color: "var(--accent-strong)", fontWeight: 600 }}>{brand.supportEmail}</a>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
