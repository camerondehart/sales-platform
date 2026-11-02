"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { browserSupportsWebAuthn, platformAuthenticatorIsAvailable, startAuthentication } from "@simplewebauthn/browser";
import { track } from "@/lib/track";
import { brand } from "@/lib/brand";
import { unlockName } from "@/lib/unlockName";
import { FaceIdIcon, markSignedIn } from "@/app/components/MemberFaceId";

type Mode = "signin" | "signup" | "forgot" | "code" | "firsttime";

export default function AuthForms({ codeLogin = false, staffLink = false, faceId = false, consult = false }: { codeLogin?: boolean; staffLink?: boolean; faceId?: boolean; consult?: boolean }) {
  const [mode, setMode] = useState<Mode>("signin");
  // The email typed on the password form carries over to "Email me a code".
  const [typedEmail, setTypedEmail] = useState("");

  return (
    <div className="auth">
      <div className="auth-tabs" role="tablist">
        <button
          className={`auth-tab ${mode !== "signup" ? "active" : ""}`}
          onClick={() => setMode("signin")}
          type="button"
          role="tab"
          aria-selected={mode !== "signup"}
        >
          Sign in
        </button>
        <button
          className={`auth-tab ${mode === "signup" ? "active" : ""}`}
          onClick={() => setMode("signup")}
          type="button"
          role="tab"
          aria-selected={mode === "signup"}
        >
          Join {brand.members}
        </button>
      </div>

      {mode === "signin" && <SignInForm faceId={faceId} staffLink={staffLink} onForgot={() => setMode("forgot")} onCode={codeLogin ? (email: string) => { setTypedEmail(email); setMode("code"); } : undefined} onFirstTime={() => setMode("firsttime")} />}
      {mode === "firsttime" && <FirstTimeForm onBack={() => setMode("signin")} />}
      {mode === "code" && <CodeSignInForm initialEmail={typedEmail} onBack={() => setMode("signin")} />}
      {mode === "signup" && <SignUpForm consult={consult} />}
      {mode === "forgot" && <ForgotPasswordForm onBack={() => setMode("signin")} />}
    </div>
  );
}

function CodeSignInForm({ onBack, initialEmail = "" }: { onBack: () => void; initialEmail?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/login/code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send", email }),
    });
    const d = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(d.error || "Couldn't send a code. Please try your password instead.");
      return;
    }
    setStep("code");
    setCode("");
    setNote(`If ${email} has an account here, a 6-digit code is on its way. It expires in 10 minutes.`);
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/login/code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "verify", email, code }),
    });
    if (res.ok) {
      markSignedIn("code");
      router.push("/gallery");
      router.refresh();
      return;
    }
    setError("That code didn't work — it may have expired. Check the newest email, or send a new code.");
    setLoading(false);
  }

  return step === "email" ? (
    <form onSubmit={send}>
      <input
        type="email"
        className="gate-input"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
        required
      />
      <button type="submit" className="gate-button" disabled={loading}>
        {loading ? "Sending..." : "Email me a sign-in code"}
      </button>
      {error && <div className="gate-error">{error}</div>}
      <div className="gate-forgot-row">
        <button type="button" onClick={onBack} className="gate-forgot">Use my password instead</button>
      </div>
    </form>
  ) : (
    <form onSubmit={verify}>
      {note && <div className="gate-success" style={{ marginBottom: "0.7rem", fontSize: "0.9rem" }}>{note}</div>}
      <input
        className="gate-input gate-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]*"
        maxLength={7}
        placeholder="6-digit code"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
        autoFocus
        required
      />
      <button type="submit" className="gate-button" disabled={loading || code.length !== 6}>
        {loading ? "Signing in..." : "Sign in"}
      </button>
      {error && <div className="gate-error">{error}</div>}
      <div className="gate-forgot-row" style={{ justifyContent: "space-between", display: "flex" }}>
        <button type="button" onClick={() => send()} className="gate-forgot" disabled={loading}>Send a new code</button>
        <button type="button" onClick={onBack} className="gate-forgot">Use my password</button>
      </div>
    </form>
  );
}

function SignInForm({ onForgot, onCode, onFirstTime, staffLink = false, faceId = false }: { onForgot: () => void; onCode?: (email: string) => void; onFirstTime?: () => void; staffLink?: boolean; faceId?: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  // Face ID / Touch ID: only on devices that have one built in.
  const [unlock, setUnlock] = useState<string | null>(null);
  useEffect(() => {
    if (!faceId || !browserSupportsWebAuthn()) return;
    let live = true;
    platformAuthenticatorIsAvailable()
      .then((yes) => live && yes && setUnlock(unlockName()))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [faceId]);

  async function signInWithFaceId() {
    if (!unlock) return;
    setLoading(true);
    setError("");
    try {
      const o = await fetch("/api/login/member-passkey", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "options" }) });
      const { options } = await o.json();
      if (!o.ok || !options) throw new Error();
      const response = await startAuthentication({ optionsJSON: options });
      const v = await fetch("/api/login/member-passkey", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "verify", response }) });
      if (v.ok) {
        markSignedIn("passkey");
        router.push("/gallery");
        router.refresh();
        return;
      }
      const d = await v.json().catch(() => ({}));
      setError(
        d.error === "pending"
          ? "Your request is still being reviewed. We will be in touch soon."
          : d.error === "rejected"
            ? "This account is not currently active. Please reach out if you have questions."
            : d.error || "That didn't work. Sign in with your email and password instead."
      );
    } catch (err) {
      const n = (err as { name?: string })?.name;
      setError(n === "NotAllowedError" ? `Cancelled, or ${unlock} isn't set up on this device yet. Sign in with your email below and we'll offer to set it up.` : `${unlock} isn't available here. Sign in with your email below.`);
    }
    setLoading(false);
  }
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Staff email typed? Then no password box — just the same dashboard sign-in
  // link as /admin (signs in to the dashboard only, so "Preview store" still works).
  const [staff, setStaff] = useState(false);
  const [linkSent, setLinkSent] = useState("");

  useEffect(() => {
    const e = email.trim().toLowerCase();
    if (!staffLink || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e)) {
      setStaff(false);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      fetch("/api/login/staff-check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: e }) })
        .then((r) => r.json())
        .then((d) => live && setStaff(d?.staff === true))
        .catch(() => live && setStaff(false));
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [email, staffLink]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (staff) {
      setLoading(true);
      setError("");
      const res = await fetch("/api/login/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", email: email.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      setLoading(false);
      if (res.ok) setLinkSent(email.trim());
      else setError(d.error || "Couldn't send the link. Try again from the staff page (/admin).");
      return;
    }
    setLoading(true);
    setError("");

    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "visitor", email, password }),
    });

    if (res.ok) {
      markSignedIn("password");
      router.push("/gallery");
      router.refresh();
      return;
    }

    const data = await res.json().catch(() => ({}));
    if (data.error === "pending") {
      setError("Your request is still being reviewed. We will be in touch soon.");
    } else if (data.error === "rejected") {
      setError("This account is not currently active. Please reach out if you have questions.");
    } else {
      setError("That email and password do not match. Please try again.");
    }
    setLoading(false);
  }

  if (linkSent)
    return (
      <div>
        <div className="gate-success">A sign-in link to the dashboard is on its way to {linkSent}. It works once and expires in 15 minutes.</div>
        <div className="gate-forgot-row">
          <button type="button" className="gate-forgot" onClick={() => { setLinkSent(""); setEmail(""); }}>Use a different email</button>
        </div>
      </div>
    );

  return (
    <form onSubmit={handleSubmit} className="auth-form">
      {unlock && !staff && (
        <>
          <button type="button" className="gate-button auth-faceid" onClick={signInWithFaceId} disabled={loading}>
            <FaceIdIcon unlock={unlock} />
            {loading ? "Checking…" : `Sign in with ${unlock}`}
          </button>
          <div className="auth-or"><span>or with your email</span></div>
        </>
      )}
      <input
        type="email"
        className="gate-input"
        placeholder="Email"
        aria-label="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
        required
      />
      {!staff && (
        <div className="auth-pw">
          <input
            type={showPw ? "text" : "password"}
            className="gate-input"
            placeholder="Password"
            aria-label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
          <button type="button" className="auth-eye" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? "Hide password" : "Show password"}>
            {showPw ? "Hide" : "Show"}
          </button>
        </div>
      )}
      {!staff && (
        <div className="auth-links">
          <button type="button" onClick={onForgot} className="auth-link">Forgot password?</button>
          {onCode && (
            <button type="button" onClick={() => onCode(email)} className="auth-link">Email me a code instead</button>
          )}
        </div>
      )}
      <button type="submit" className={`gate-button${unlock && !staff ? " auth-secondary" : ""}`} disabled={loading}>
        {staff ? (loading ? "Sending…" : "Email me a dashboard sign-in link") : loading ? "Signing in…" : "Sign in"}
      </button>
      {error && <div className="gate-error">{error}</div>}
      {onFirstTime && !staff && (
        <button type="button" onClick={onFirstTime} className="auth-oldshop">
          <span><strong>Shopped with us before?</strong> Your account is already here. Set your password</span>
          <span aria-hidden="true">→</span>
        </button>
      )}
    </form>
  );
}

/** Members who came over from the old shop: email a link to choose a password. */
function FirstTimeForm({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    const res = await fetch("/api/set-password/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setMessage(data.message || "If there's an account for that email, a link is on its way.");
    else setError(data.error || "Something went wrong. Please try again.");
    setLoading(false);
  }
  return (
    <form onSubmit={handleSubmit}>
      <p style={{ fontSize: "0.9rem", color: "var(--ink-soft)", margin: "0 0 0.8rem", lineHeight: 1.5 }}>
        Had an account with our old shop? It's here already — we'll email you a link to choose your password.
      </p>
      <input type="email" className="gate-input" placeholder="Your email address" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
      <button type="submit" className="gate-button" disabled={loading}>
        {loading ? "Sending..." : "Email me a link"}
      </button>
      {error && <div className="gate-error">{error}</div>}
      {message && <div className="gate-success" style={{ marginTop: "1rem", fontSize: "0.9rem" }}>{message}</div>}
      <div style={{ marginTop: "1rem", textAlign: "center", fontSize: "0.85rem" }}>
        <button type="button" onClick={onBack} className="masthead-link" style={{ color: "var(--ink-soft)" }}>
          ← Back to sign in
        </button>
      </div>
    </form>
  );
}

function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    const res = await fetch("/api/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setMessage("If an account exists with that email, you will receive a new password shortly.");
    } else {
      setError(data.error || "Something went wrong. Please try again.");
    }
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        className="gate-input"
        placeholder="Your email address"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
        required
      />
      <button type="submit" className="gate-button" disabled={loading}>
        {loading ? "Sending..." : "Reset password"}
      </button>
      {error && <div className="gate-error">{error}</div>}
      {message && <div className="gate-success" style={{ marginTop: "1rem", fontSize: "0.9rem" }}>{message}</div>}
      <div style={{ marginTop: "1rem", textAlign: "center", fontSize: "0.85rem" }}>
        <button type="button" onClick={onBack} className="masthead-link" style={{ color: "var(--ink-soft)" }}>
          ← Back to sign in
        </button>
      </div>
    </form>
  );
}

function SignUpForm({ consult = false }: { consult?: boolean }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [ageVerified, setAgeVerified] = useState<boolean | null>(null);
  const [priorCustomer, setPriorCustomer] = useState<boolean | null>(null);
  // Every new member joins the mailing list; they can unsubscribe from any email.
  const subscribe = true;
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (ageVerified === null || priorCustomer === null) {
      setError("Please answer both questions below.");
      setLoading(false);
      return;
    }
    // These are age-restricted products, so this is a real gate, not a survey.
    if (ageVerified === false) {
      setError(
        "You must be 21 or over to request access. If you entered this by mistake, change your answer and try again."
      );
      setLoading(false);
      return;
    }

    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, message, ageVerified, priorCustomer, subscribe }),
    });

    if (res.ok) {
      track("join_request");
      setDone(true);
      setLoading(false);
      return;
    }

    const data = await res.json().catch(() => ({}));
    switch (data.error) {
      case "email_taken":
        setError("An account with this email already exists. Try signing in.");
        break;
      case "password_too_short":
        setError("Password must be at least 8 characters.");
        break;
      case "invalid_email":
        setError("Please enter a valid email address.");
        break;
      case "missing_fields":
        setError("All required fields must be filled in.");
        break;
      default:
        // Show the server's own wording when it sent a readable message
        // (e.g. the age check), otherwise fall back to something generic.
        setError(
          typeof data.error === "string" && data.error.includes(" ")
            ? data.error
            : "Something went wrong. Please try again."
        );
    }
    setLoading(false);
  }

  if (done) {
    return (
      <div className="gate-success">
        <p>Thank you for reaching out.</p>
        <p style={{ marginTop: "1rem", color: "var(--ink-soft)", fontSize: "0.95rem" }}>
          We will review your request personally and be in touch soon. Once approved, you will be able to sign in with your email and password.
        </p>
        <div className="approval-notice">
          <strong>Approval timeline:</strong> requests are typically processed during
          normal business hours (Monday&ndash;Friday, 8:00&nbsp;AM&ndash;5:00&nbsp;PM) and can
          take up to 24 hours, though we strive to complete them sooner.
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <p className="auth-hint">Request access to the members&rsquo; shop. We review every request personally, usually within 24 hours.</p>
      <input
        type="text"
        className="gate-input"
        placeholder="Full name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoComplete="name"
        required
      />
      <input
        type="email"
        className="gate-input"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
        required
        style={{ marginTop: "0.5rem" }}
      />
      <input
        type="password"
        className="gate-input"
        placeholder="Password (8+ characters)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
        minLength={8}
        required
        style={{ marginTop: "0.5rem" }}
      />
      <textarea
        className="gate-input gate-textarea"
        placeholder="Tell us a little about yourself (optional)"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={3}
        style={{ marginTop: "0.5rem" }}
      />

      <div className="gate-question">
        <div className="gate-question-label">Are you 21 or over?</div>
        <div className="gate-question-options">
          <label className={`gate-radio ${ageVerified === true ? "selected" : ""}`}>
            <input
              type="radio"
              name="ageVerified"
              checked={ageVerified === true}
              onChange={() => setAgeVerified(true)}
            />
            Yes
          </label>
          <label className={`gate-radio ${ageVerified === false ? "selected" : ""}`}>
            <input
              type="radio"
              name="ageVerified"
              checked={ageVerified === false}
              onChange={() => setAgeVerified(false)}
            />
            No
          </label>
        </div>
      </div>

      <div className="gate-question">
        <div className="gate-question-label">Have you bought from {brand.name} before?</div>
        <div className="gate-question-options">
          <label className={`gate-radio ${priorCustomer === true ? "selected" : ""}`}>
            <input
              type="radio"
              name="priorCustomer"
              checked={priorCustomer === true}
              onChange={() => setPriorCustomer(true)}
            />
            Yes
          </label>
          <label className={`gate-radio ${priorCustomer === false ? "selected" : ""}`}>
            <input
              type="radio"
              name="priorCustomer"
              checked={priorCustomer === false}
              onChange={() => setPriorCustomer(false)}
            />
            No
          </label>
        </div>
      </div>

      <p className="auth-hint auth-optin-note">
        Members get our emails about new arrivals, sales and classes. You can unsubscribe from any email. See our{" "}
        <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.
      </p>

      {consult ? (
        <div className="gate-consultation">
          <strong>Interested in a free phone consultation?</strong>
          <span>
            {" "}<a href="/consultation">Pick a time that suits you</a>.
          </span>
        </div>
      ) : brand.consultationFormUrl ? (
        <div className="gate-consultation">
          <strong>Interested in a consultation?</strong>
          <span>
            {" "}If yes,{" "}
            <a href={brand.consultationFormUrl} target="_blank" rel="noopener noreferrer">
              fill out this form
            </a>.
          </span>
        </div>
      ) : null}

      <button type="submit" className="gate-button" disabled={loading}>
        {loading ? "Submitting..." : "Request to join"}
      </button>
      <div className="approval-notice">
        Approvals are typically processed during normal business hours
        (Monday&ndash;Friday, 8:00&nbsp;AM&ndash;5:00&nbsp;PM) and can take up to 24 hours,
        though we strive to complete them sooner.
      </div>
      {error && <div className="gate-error">{error}</div>}
    </form>
  );
}
