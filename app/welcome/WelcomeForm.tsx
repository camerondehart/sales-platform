"use client";

import { useState } from "react";
import { markSignedIn } from "@/app/components/MemberFaceId";

export default function WelcomeForm({ t, email }: { t: string; email: string }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (pw.length < 8) return setError("Please use at least 8 characters.");
    if (pw !== pw2) return setError("Those two passwords don't match.");
    setBusy(true);
    const r = await fetch("/api/set-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t, password: pw }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setError(d.error || "Something went wrong — please try again.");
    setDone(true);
    markSignedIn("link");
    setTimeout(() => window.location.assign("/gallery"), 1200);
  }

  if (done)
    return (
      <div className="wel-done">
        <div className="pay-check" aria-hidden="true">✓</div>
        <p className="pay-muted">All set — taking you in…</p>
      </div>
    );

  return (
    <form onSubmit={submit} className="wel-form">
      {/* Lets password managers save it against the right account. */}
      <input type="email" value={email} autoComplete="username" readOnly className="gate-input wel-email" aria-label="Your email" />
      <input
        type={show ? "text" : "password"}
        className="gate-input"
        placeholder="New password (8+ characters)"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        autoComplete="new-password"
        autoFocus
        required
      />
      <input
        type={show ? "text" : "password"}
        className="gate-input"
        placeholder="Type it again"
        value={pw2}
        onChange={(e) => setPw2(e.target.value)}
        autoComplete="new-password"
        required
      />
      <label className="wel-show">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show password
      </label>
      <button type="submit" className="gate-button" disabled={busy}>
        {busy ? "Saving…" : "Set password & sign in"}
      </button>
      {error && <div className="gate-error">{error}</div>}
    </form>
  );
}

/** "Email me a fresh link" — on an expired/used link, and from the sign-in screen. */
export function LinkRequest() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMsg("");
    const r = await fetch("/api/set-password/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) setMsg(d.message || "If there's an account for that email, a link is on its way.");
    else setError(d.error || "Something went wrong — please try again.");
  }
  return (
    <form onSubmit={submit} className="wel-form">
      <input type="email" className="gate-input" placeholder="Your email address" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
      <button type="submit" className="gate-button" disabled={busy}>
        {busy ? "Sending…" : "Email me a link"}
      </button>
      {error && <div className="gate-error">{error}</div>}
      {msg && <div className="gate-success" style={{ marginTop: "0.8rem", fontSize: "0.9rem" }}>{msg}</div>}
    </form>
  );
}
