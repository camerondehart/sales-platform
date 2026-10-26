"use client";

import { useEffect, useState } from "react";

// Landing page for the emailed staff sign-in link (/admin/link#<token>).
// Nothing happens until the person taps the button, so a mail scanner that
// "opens" the link can't use it up.

export default function AdminLinkPage() {
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<"ready" | "busy" | "bad">("ready");

  useEffect(() => {
    const t = window.location.hash.replace(/^#/, "");
    setToken(t || "");
    // Take it out of the address bar and history.
    if (t) history.replaceState(null, "", window.location.pathname);
  }, []);

  async function go() {
    if (!token) return;
    setState("busy");
    const r = await fetch("/api/login/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "verify", token }) });
    if (r.ok) {
      try {
        sessionStorage.setItem("fp_just_signed_in", "1"); // Overview "Today" welcome
      } catch {}
      window.location.replace("/admin");
    }
    else setState("bad");
  }

  return (
    <div className="gate gate-admin">
      <div className="gate-card">
        <div className="gate-kicker">Administration</div>
        <h1 className="gate-title">Steward Access</h1>
        {token === null ? null : !token || state === "bad" ? (
          <>
            <p className="gate-subtitle">This sign-in link has expired or was already used.</p>
            <a className="gate-button" href="/admin" style={{ display: "block", textAlign: "center", textDecoration: "none" }}>Request a new one</a>
          </>
        ) : (
          <>
            <p className="gate-subtitle">Tap below to finish signing in.</p>
            <button type="button" className="gate-button" disabled={state === "busy"} onClick={go} autoFocus>
              {state === "busy" ? "Signing in…" : "Sign in to the dashboard"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
