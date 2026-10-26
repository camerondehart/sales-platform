"use client";

import { useEffect, useRef, useState } from "react";
import { track } from "@/lib/track";

// Built for a phone in someone's hand at a booth, or an iPad on the table.
// After a successful sign-up it shows a thank-you, then resets itself so the
// next person can step up without anyone touching the screen.
const RESET_AFTER_MS = 9000;

export default function JoinForm({ event }: { event: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot — stays empty for humans
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => {
      setDone(null);
      setName("");
      setEmail("");
      // Booth iPad: if someone wandered into the shop below, bring the form back for the next person.
      window.scrollTo({ top: 0, behavior: "smooth" });
      nameRef.current?.focus();
    }, RESET_AFTER_MS);
    return () => clearTimeout(t);
  }, [done]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, event, website }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        track("subscribe");
        setDone(name.trim().split(/\s+/)[0] || "you");
      } else {
        setError(data.error || "Something went wrong — please try again.");
      }
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    }
    setLoading(false);
  }

  if (done) {
    return (
      <div className="join-done" role="status">
        <div className="pay-check" aria-hidden="true">✓</div>
        <h2 className="join-done-title">Thanks, {done}!</h2>
        <p className="join-done-text">You're on the list. Keep an eye on your inbox.</p>
        <button
          type="button"
          className="gate-button"
          onClick={() => { setDone(null); setName(""); setEmail(""); }}
        >
          Sign up someone else
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="join-form">
      <input
        ref={nameRef}
        className="gate-input"
        placeholder="Your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoComplete="name"
        autoCapitalize="words"
        required
      />
      <input
        type="email"
        className="gate-input"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
        inputMode="email"
        required
        style={{ marginTop: "0.5rem" }}
      />
      {/* Honeypot: hidden from people, irresistible to bots */}
      <input
        className="join-hp"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        placeholder="Website"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
      />
      <button type="submit" className="gate-button" disabled={loading}>
        {loading ? "Adding you…" : "Join the mailing list"}
      </button>
      {error && <div className="gate-error">{error}</div>}
    </form>
  );
}
