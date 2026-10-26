import { unsubscribeByToken } from "@/lib/subscribers";
import { brand } from "@/lib/brand";

export const metadata = { title: `Unsubscribe · ${brand.name}` };
export const dynamic = "force-dynamic";

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const token = searchParams.token || "";
  const isPreview = token === "preview";
  const result = isPreview ? null : await unsubscribeByToken(token);
  const ok = isPreview || !!result;

  return (
    <div className="pay-shell">
      <div className="pay-card fade-rise">
        <div className="logo-mark" aria-hidden="true" style={{ margin: "0 auto 1rem" }}>
          <span></span><span></span><span></span><span></span>
        </div>
        <div className="pay-kicker">{brand.name}</div>

        {ok ? (
          <>
            <div className="pay-check" aria-hidden="true">✓</div>
            <h1 className="pay-title">You've been unsubscribed</h1>
            <p className="pay-muted">
              {isPreview
                ? "This is a preview link — no changes were made."
                : `${result?.email} won't receive any more marketing emails from us. Order and account emails will still come through as usual.`}
            </p>
            <p className="pay-muted" style={{ fontSize: "0.82rem", marginTop: "1rem" }}>
              Changed your mind? Just reach out to{" "}
              <a href={`mailto:${brand.supportEmail}`} style={{ color: "var(--accent-strong)", fontWeight: 600 }}>
                {brand.supportEmail}
              </a>{" "}
              and we'll add you back.
            </p>
          </>
        ) : (
          <>
            <h1 className="pay-title">We couldn't find that subscription</h1>
            <p className="pay-muted">
              This link may be out of date, or you may already be unsubscribed. If you're still
              receiving emails you don't want, email{" "}
              <a href={`mailto:${brand.supportEmail}`} style={{ color: "var(--accent-strong)", fontWeight: 600 }}>
                {brand.supportEmail}
              </a>{" "}
              and we'll take care of it.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
