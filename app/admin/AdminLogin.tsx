"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { brand } from "@/lib/brand";
import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import { unlockName } from "@/lib/unlockName";

export default function AdminLogin({ linkLogin = false, passkeys = false, dailyPhrase = false }: { linkLogin?: boolean; passkeys?: boolean; dailyPhrase?: boolean }) {
  const [mode, setMode] = useState<"link" | "password">(linkLogin ? "link" : "password");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  // Face ID / Touch ID / fingerprint (a passkey added in Settings → Staff sign-in). Only shown where the browser supports it.
  const [canPasskey, setCanPasskey] = useState(false);
  const [unlock, setUnlock] = useState("Face ID");
  useEffect(() => {
    setCanPasskey(passkeys && browserSupportsWebAuthn());
    setUnlock(unlockName());
  }, [passkeys]);

  function signedIn() {
    // Lets the Overview "Today" card play its little welcome.
    try {
      sessionStorage.setItem("fp_just_signed_in", "1");
    } catch {}
    router.refresh();
  }

  async function faceId() {
    setLoading(true);
    setError("");
    try {
      const o = await fetch("/api/login/passkey", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "options" }) });
      const { options } = await o.json();
      if (!o.ok || !options) throw new Error();
      const response = await startAuthentication({ optionsJSON: options });
      const v = await fetch("/api/login/passkey", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "verify", response }) });
      if (v.ok) return signedIn();
      const d = await v.json().catch(() => ({}));
      setError(d.error || "That didn't work. Use your email link or the password.");
    } catch (err) {
      // Cancelled, or nothing set up on this device for this site.
      const name = (err as { name?: string })?.name;
      setError(name === "NotAllowedError" ? `Cancelled, or ${unlock} isn't set up for this site on this device yet. Sign in another way, then add it in Settings → Staff sign-in.` : `${unlock} isn't available here. Use your email link or the password.`);
    }
    setLoading(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, role: "admin" }),
    });

    if (res.ok) {
      signedIn();
    } else {
      setError("Incorrect admin password.");
      setLoading(false);
    }
  }

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/login/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send", email }),
    });
    const d = await res.json().catch(() => ({}));
    setLoading(false);
    if (res.ok) setSent(true);
    else setError(d.error || "Couldn't send the link. Use the password instead.");
  }

  return (
    <div className="gate gate-admin">
      <div className="gate-card">
        <div className="gate-kicker">Administration</div>
        <h1 className="gate-title">Steward Access</h1>
        <div className="gate-ornament" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
          <span></span>
        </div>
        <p className="gate-subtitle">{brand.name} staff only.</p>
        {canPasskey && (
          <>
            <button type="button" className="gate-button gate-faceid" onClick={faceId} disabled={loading}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                {unlock === "Face ID" ? (
                  <>
                    <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
                    <path d="M9 9.5v1M15 9.5v1M12 9v4h-1M9.5 15.5c1.4 1 3.6 1 5 0" />
                  </>
                ) : (
                  // A fingerprint (Touch ID, Android, Windows Hello, passkeys)
                  <path d="M7 5.5A8 8 0 0 1 19.5 12M4.5 9A8 8 0 0 0 4 12v1M12 8a4 4 0 0 1 4 4c0 3-.5 5-1.5 7M8 12a4 4 0 0 1 1.2-2.9M8 12c0 2.5-.6 4.5-1.8 6M12 12c0 3.5-.8 6.3-2.3 8.5M16.3 16.5c-.3 1.4-.7 2.6-1.2 3.6" />
                )}
              </svg>
              {loading ? "Checking…" : `Sign in with ${unlock}`}
            </button>
            <div className="gate-or"><span>or</span></div>
          </>
        )}
        {mode === "link" ? (
          sent ? (
            <div>
              <div className="gate-success">If {email} is on the staff list, a sign-in link is on its way. It works once and expires in 15 minutes.</div>
              <div className="gate-forgot-row">
                <button type="button" className="gate-forgot" onClick={() => { setSent(false); setEmail(""); }}>Use a different email</button>
              </div>
            </div>
          ) : (
            <form onSubmit={sendLink}>
              <input
                type="email"
                className="gate-input"
                placeholder="Your staff email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                autoFocus
                required
              />
              <button type="submit" className="gate-button" disabled={loading}>
                {loading ? "Sending…" : "Email me a sign-in link"}
              </button>
              {error && <div className="gate-error">{error}</div>}
            </form>
          )
        ) : (
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            className="gate-input"
            placeholder={dailyPhrase ? "Today's staff password" : "Admin password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            required
          />
          {dailyPhrase && <p className="gate-hint">It&rsquo;s in this morning&rsquo;s report email, e.g. maple-otter-42.</p>}
          <button type="submit" className="gate-button" disabled={loading}>
            {loading ? "Verifying…" : "Sign in"}
          </button>
          {error && <div className="gate-error">{error}</div>}
        </form>
        )}
        {linkLogin && (
          <div className="gate-forgot-row">
            <button type="button" className="gate-forgot" onClick={() => { setMode(mode === "link" ? "password" : "link"); setError(""); }}>
              {mode === "link" ? "Use the admin password instead" : "Email me a sign-in link instead"}
            </button>
          </div>
        )}
        <a href="/" className="gate-home">← Back to the homepage</a>
      </div>
    </div>
  );
}
