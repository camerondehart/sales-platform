"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { brand } from "@/lib/brand";

export default function AdminLogin({ linkLogin = false }: { linkLogin?: boolean }) {
  const [mode, setMode] = useState<"link" | "password">(linkLogin ? "link" : "password");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

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
      // Lets the Overview "Today" card play its little welcome.
      try {
        sessionStorage.setItem("fp_just_signed_in", "1");
      } catch {}
      router.refresh();
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
            placeholder="Admin password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            required
          />
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
      </div>
    </div>
  );
}
