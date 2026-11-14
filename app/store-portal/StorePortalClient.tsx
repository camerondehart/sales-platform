"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import AssistantWidget from "@/app/components/assistant/AssistantWidget";
import { EVT_ADMIN_REFRESH, EVT_OPEN } from "@/lib/assistant/shared";
import { brand } from "@/lib/brand";

/**
 * Store portal screens (app/store-portal/page.tsx). Server routes:
 * /api/store-portal/auth (sign-in), /api/store-portal/passkey (Face ID),
 * /api/store-portal (data, requests, messages). No prices anywhere.
 */

const TZ = brand.timezone;
const fmtDay = (t?: number) => (t ? new Date(t).toLocaleDateString("en-US", { timeZone: TZ, month: "long", day: "numeric", year: "numeric" }) : "");
const fmtMonth = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
};

async function post(url: string, body: unknown, method = "POST") {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok && d?.ok !== false, data: d as Record<string, any> };
}

// ------------------------------------------------------------------ sign-in

export function StoreSignIn({ codesOn, faceOn, startOn }: { codesOn: boolean; faceOn: boolean; startOn?: "link" }) {
  const [view, setView] = useState<"password" | "code" | "link">(startOn || "password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [canFace, setCanFace] = useState(false);
  useEffect(() => {
    setCanFace(faceOn && browserSupportsWebAuthn());
  }, [faceOn]);

  const done = () => window.location.assign("/store-portal");
  const reset = (v: typeof view) => {
    setView(v);
    setError("");
    setMsg("");
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMsg("");
    setBusy(true);
    try {
      if (view === "password") {
        const r = await post("/api/store-portal/auth", { action: "password", email, password });
        if (r.ok) return done();
        setError(r.data.error || "That didn't work. Please try again.");
      } else if (view === "code" && !codeSent) {
        const r = await post("/api/store-portal/auth", { action: "send-code", email });
        if (r.ok) {
          setCodeSent(true);
          setMsg("If that email has a store login, a 6-digit code is on its way. It works for 10 minutes.");
        } else setError(r.data.error || "That didn't work. Please try again.");
      } else if (view === "code") {
        const r = await post("/api/store-portal/auth", { action: "verify-code", email, code });
        if (r.ok) return done();
        setError(r.data.error || "That code didn't work.");
      } else {
        const r = await post("/api/store-portal/auth", { action: "link", email });
        if (r.ok) setMsg(r.data.message || "If that email has a store login, a link is on its way.");
        else setError(r.data.error || "That didn't work. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function faceId() {
    setError("");
    setBusy(true);
    try {
      const o = await post("/api/store-portal/passkey", { action: "options" });
      if (!o.ok) throw new Error(o.data.error || "Face ID isn't available right now.");
      const response = await startAuthentication({ optionsJSON: o.data.options });
      const v = await post("/api/store-portal/passkey", { action: "verify", response });
      if (v.ok) return done();
      setError(v.data.error || "That didn't work. Try again, or sign in with your email.");
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name !== "NotAllowedError" && name !== "AbortError") setError((err as Error)?.message || "Face ID didn't work here. Sign in with your email instead.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sp-signin">
      {view !== "link" && codesOn && (
        <div className="auth-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={view === "password"} className={`auth-tab ${view === "password" ? "active" : ""}`} onClick={() => reset("password")}>
            Password
          </button>
          <button type="button" role="tab" aria-selected={view === "code"} className={`auth-tab ${view === "code" ? "active" : ""}`} onClick={() => reset("code")}>
            Email me a code
          </button>
        </div>
      )}
      <form onSubmit={submit} className="wel-form auth-form">
        <input type="email" className="gate-input" placeholder="Store login email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        {view === "password" && (
          <div className="auth-pw">
            <input type={show ? "text" : "password"} className="gate-input" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            <button type="button" className="auth-eye" onClick={() => setShow((s) => !s)}>{show ? "Hide" : "Show"}</button>
          </div>
        )}
        {view === "code" && codeSent && (
          <input inputMode="numeric" className="gate-input" placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} autoComplete="one-time-code" required style={{ marginTop: "0.55rem" }} />
        )}
        <button type="submit" className="gate-button" disabled={busy}>
          {busy ? "One moment…" : view === "password" ? "Sign in" : view === "code" ? (codeSent ? "Sign in" : "Email me a code") : "Email me a link"}
        </button>
        {error && <div className="gate-error">{error}</div>}
        {msg && <div className="gate-success" style={{ marginTop: "0.8rem", fontSize: "0.9rem" }}>{msg}</div>}
      </form>
      {canFace && view !== "link" && (
        <>
          <div className="auth-or">or</div>
          <button type="button" className="gate-button auth-secondary auth-faceid" onClick={faceId} disabled={busy}>
            Sign in with Face ID / Touch ID
          </button>
        </>
      )}
      <div className="auth-links" style={{ justifyContent: "center" }}>
        {view === "link" ? (
          <button type="button" className="auth-link" onClick={() => reset("password")}>Back to sign in</button>
        ) : (
          <button type="button" className="auth-link" onClick={() => reset("link")}>First time, or forgot your password? Email me a link</button>
        )}
      </div>
    </div>
  );
}

export function StoreSetPassword({ t, email }: { t: string; email: string }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (pw.length < 8) return setError("Please use at least 8 characters.");
    if (pw !== pw2) return setError("Those two passwords don't match.");
    setBusy(true);
    const r = await post("/api/store-portal/auth", { action: "set-password", t, password: pw });
    setBusy(false);
    if (!r.ok) return setError(r.data.error || "Something went wrong. Please try again.");
    window.location.assign("/store-portal");
  }
  return (
    <form onSubmit={submit} className="wel-form">
      <input type="email" value={email} autoComplete="username" readOnly className="gate-input wel-email" aria-label="Your email" />
      <input type={show ? "text" : "password"} className="gate-input" placeholder="New password (8+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" autoFocus required />
      <input type={show ? "text" : "password"} className="gate-input" placeholder="Type it again" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" required />
      <label className="wel-show">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show password
      </label>
      <button type="submit" className="gate-button" disabled={busy}>{busy ? "Saving…" : "Set password & sign in"}</button>
      {error && <div className="gate-error">{error}</div>}
    </form>
  );
}

// ------------------------------------------------------------------ the portal

type Item = { productId: string; name: string; qty: number; shippedQty?: number };
type Req = { id: string; ref: string; status: string; statusLabel: string; items: Item[]; note?: string; staffNote?: string; requestedBy: string; createdAt: number; shippedAt?: number; receivedAt?: number };
type Data = {
  me: { name: string; email: string };
  account: { id: string; name: string; contactName?: string; phone?: string; logins: Array<{ id: string; name: string; email: string; active: boolean }> };
  location: { name: string; address: string; phone?: string; website?: string; hours?: string; onMap: boolean } | null;
  products: Array<{ id: string; name: string; image: string; category?: string }>;
  requests: Req[];
  tracking: { totalUnits: number; shipments: number; lastShippedAt?: number; products: Array<{ productId: string; name: string; units: number; shipments: number; lastAt: number }>; months: Array<{ month: string; units: number }> };
};

export function StorePortal({ initial, faceOn }: { initial: Data; faceOn: boolean }) {
  const [data, setData] = useState<Data>(initial);
  const reload = useCallback(async () => {
    const r = await fetch("/api/store-portal", { cache: "no-store" });
    if (r.status === 401) return window.location.assign("/store-portal");
    if (r.ok) setData(await r.json());
  }, []);
  // Concierge cards confirmed in the chat reload the page's numbers.
  useEffect(() => {
    const on = () => void reload();
    window.addEventListener(EVT_ADMIN_REFRESH, on);
    return () => window.removeEventListener(EVT_ADMIN_REFRESH, on);
  }, [reload]);

  const open = data.requests.filter((r) => r.status === "pending" || r.status === "approved" || r.status === "shipped");

  async function signOut() {
    await post("/api/store-portal/auth", { action: "logout" });
    window.location.assign("/store-portal");
  }

  return (
    <div className="sp-shell">
      <header className="sp-head">
        <div>
          <div className="pay-kicker">{brand.name} · Store portal</div>
          <h1 className="sp-title">{data.account.name}</h1>
          <div className="sp-sub">Signed in as {data.me.name} · {data.me.email}</div>
        </div>
        <div className="sp-head-actions">
          <button type="button" className="sp-btn sp-btn-ghost" onClick={() => window.dispatchEvent(new CustomEvent(EVT_OPEN))}>Ask our Concierge</button>
          <button type="button" className="sp-btn sp-btn-ghost" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <div className="sp-stats">
        <div className="sp-stat"><strong>{open.length}</strong><span>open request{open.length === 1 ? "" : "s"}</span></div>
        <div className="sp-stat"><strong>{data.tracking.totalUnits.toLocaleString("en-US")}</strong><span>units shipped to you</span></div>
        <div className="sp-stat"><strong>{data.tracking.lastShippedAt ? fmtDay(data.tracking.lastShippedAt) : "—"}</strong><span>last shipment</span></div>
      </div>

      <RequestForm products={data.products} onSent={reload} />
      <RequestList requests={data.requests} onChange={reload} />
      <Tracking t={data.tracking} />
      <StoreDetails data={data} />
      {faceOn && <FaceIdDevices />}

      <AssistantWidget key="store" mode="store" />
    </div>
  );
}

function RequestForm({ products, onSent }: { products: Data["products"]; onSent: () => void }) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? products.filter((p) => p.name.toLowerCase().includes(f) || (p.category || "").toLowerCase().includes(f)) : products;
  }, [products, filter]);
  const chosen = products.filter((p) => (qty[p.id] || 0) > 0);
  const units = chosen.reduce((n, p) => n + (qty[p.id] || 0), 0);
  const set = (id: string, n: number) => setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(10000, Math.floor(n) || 0)) }));

  async function send() {
    setError("");
    setMsg("");
    if (!chosen.length) return setError("Add a quantity for at least one product.");
    setBusy(true);
    const r = await post("/api/store-portal", { items: chosen.map((p) => ({ productId: p.id, qty: qty[p.id] })), note });
    setBusy(false);
    if (!r.ok) return setError(r.data.error || "That didn't send. Please try again.");
    setQty({});
    setNote("");
    setMsg(`Sent! Your request ${r.data.request?.ref || ""} is waiting for review. We'll update it here.`);
    onSent();
  }

  return (
    <section className="sp-card" aria-labelledby="sp-req">
      <h2 id="sp-req" className="sp-h2">Request stock</h2>
      <p className="sp-muted">Enter how many units you&apos;d like of each product, then send. The team reviews every request.</p>
      {products.length > 8 && (
        <input className="gate-input sp-filter" placeholder="Find a product" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Find a product" />
      )}
      <ul className="sp-products">
        {shown.map((p) => (
          <li key={p.id} className={(qty[p.id] || 0) > 0 ? "is-on" : ""}>
            {p.image ? <img src={p.image} alt="" loading="lazy" /> : <span className="sp-noimg" aria-hidden="true" />}
            <span className="sp-pname">{p.name}</span>
            <span className="sp-qty">
              <button type="button" aria-label={`One less ${p.name}`} onClick={() => set(p.id, (qty[p.id] || 0) - 1)} disabled={!(qty[p.id] > 0)}>−</button>
              <input inputMode="numeric" aria-label={`Units of ${p.name}`} value={qty[p.id] ? String(qty[p.id]) : ""} placeholder="0" onChange={(e) => set(p.id, Number(e.target.value.replace(/\D/g, "")))} />
              <button type="button" aria-label={`One more ${p.name}`} onClick={() => set(p.id, (qty[p.id] || 0) + 1)}>+</button>
            </span>
          </li>
        ))}
        {!shown.length && <li className="sp-empty">No products match.</li>}
      </ul>
      <textarea className="gate-input sp-note" placeholder="Note for the team (optional): timing, anything else" value={note} onChange={(e) => setNote(e.target.value.slice(0, 1000))} rows={2} />
      <div className="sp-send">
        <span className="sp-muted">{units ? `${units} unit${units === 1 ? "" : "s"} · ${chosen.length} product${chosen.length === 1 ? "" : "s"}` : "Nothing chosen yet"}</span>
        <button type="button" className="sp-btn sp-btn-primary" onClick={send} disabled={busy || !units}>{busy ? "Sending…" : "Send request"}</button>
      </div>
      {error && <div className="gate-error">{error}</div>}
      {msg && <div className="gate-success sp-ok">{msg}</div>}
    </section>
  );
}

const PILL: Record<string, string> = { pending: "wait", approved: "go", shipped: "ship", received: "done", declined: "no", cancelled: "no" };

function RequestList({ requests, onChange }: { requests: Req[]; onChange: () => void }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [all, setAll] = useState(false);
  const list = all ? requests : requests.slice(0, 8);
  async function act(r: Req, action: "cancel" | "received") {
    if (action === "cancel" && !window.confirm(`Cancel request ${r.ref}?`)) return;
    setBusy(r.id);
    setError("");
    const res = await post("/api/store-portal", { id: r.id, action }, "PATCH");
    setBusy("");
    if (!res.ok) setError(res.data.error || "That didn't work. Please try again.");
    onChange();
  }
  return (
    <section className="sp-card" aria-labelledby="sp-list">
      <h2 id="sp-list" className="sp-h2">Your requests</h2>
      {!requests.length && <p className="sp-muted">No requests yet. Your first one will show here with its progress.</p>}
      {error && <div className="gate-error">{error}</div>}
      <ul className="sp-reqs">
        {list.map((r) => (
          <li key={r.id} className="sp-req">
            <div className="sp-req-top">
              <strong>{r.ref}</strong>
              <span className={`sp-pill sp-pill-${PILL[r.status] || "wait"}`}>{r.statusLabel}</span>
              <span className="sp-muted">Sent {fmtDay(r.createdAt)}{r.shippedAt ? ` · shipped ${fmtDay(r.shippedAt)}` : ""}{r.receivedAt ? ` · received ${fmtDay(r.receivedAt)}` : ""}</span>
            </div>
            <ul className="sp-req-items">
              {r.items.map((it) => (
                <li key={it.productId}>
                  {it.name} × {it.qty}
                  {it.shippedQty !== undefined && it.shippedQty !== it.qty && <span className="sp-muted"> (shipped {it.shippedQty})</span>}
                </li>
              ))}
            </ul>
            {r.note && <div className="sp-note-line"><span>Your note:</span> {r.note}</div>}
            {r.staffNote && <div className="sp-note-line sp-note-staff"><span>From {brand.shortName}:</span> {r.staffNote}</div>}
            {(r.status === "pending" || r.status === "shipped") && (
              <div className="sp-req-actions">
                {r.status === "pending" && <button type="button" className="sp-btn sp-btn-ghost" disabled={busy === r.id} onClick={() => act(r, "cancel")}>Cancel request</button>}
                {r.status === "shipped" && <button type="button" className="sp-btn sp-btn-primary" disabled={busy === r.id} onClick={() => act(r, "received")}>It arrived</button>}
              </div>
            )}
          </li>
        ))}
      </ul>
      {requests.length > 8 && (
        <button type="button" className="auth-link" onClick={() => setAll((a) => !a)}>{all ? "Show fewer" : `Show all ${requests.length}`}</button>
      )}
    </section>
  );
}

function Tracking({ t }: { t: Data["tracking"] }) {
  return (
    <section className="sp-card" aria-labelledby="sp-track">
      <h2 id="sp-track" className="sp-h2">Shipped to you</h2>
      {!t.totalUnits ? (
        <p className="sp-muted">Nothing shipped yet. Once a request ships, its units add up here.</p>
      ) : (
        <div className="sp-track">
          <table className="sp-table">
            <thead>
              <tr><th>Product</th><th className="num">Units</th><th>Last shipped</th></tr>
            </thead>
            <tbody>
              {t.products.map((p) => (
                <tr key={p.productId}><td>{p.name}</td><td className="num">{p.units.toLocaleString("en-US")}</td><td>{fmtDay(p.lastAt)}</td></tr>
              ))}
            </tbody>
          </table>
          <div>
            <h3 className="sp-h3">By month</h3>
            <ul className="sp-months">
              {t.months.slice(0, 12).map((m) => {
                const max = Math.max(...t.months.map((x) => x.units), 1);
                return (
                  <li key={m.month}>
                    <span>{fmtMonth(m.month)}</span>
                    <span className="sp-bar" aria-hidden="true"><span style={{ width: `${Math.max(4, (m.units / max) * 100)}%` }} /></span>
                    <strong>{m.units.toLocaleString("en-US")}</strong>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

function StoreDetails({ data }: { data: Data }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  async function send() {
    setError("");
    setMsg("");
    setBusy(true);
    const r = await post("/api/store-portal", { message: text }, "PUT");
    setBusy(false);
    if (!r.ok) return setError(r.data.error || "That didn't send. Please try again.");
    setText("");
    setMsg(`Sent to the ${brand.shortName} team. They'll reply by email.`);
  }
  const loc = data.location;
  return (
    <section className="sp-card" aria-labelledby="sp-store">
      <h2 id="sp-store" className="sp-h2">Your store</h2>
      <dl className="sp-dl">
        {loc ? (
          <>
            <dt>On our store map</dt>
            <dd>{loc.onMap ? "Listed on the public “Find us in stores” map" : "Not shown on the map right now"}</dd>
            <dt>Address</dt>
            <dd>{loc.address || "—"}</dd>
            {loc.hours && (<><dt>Hours</dt><dd style={{ whiteSpace: "pre-line" }}>{loc.hours}</dd></>)}
            {loc.phone && (<><dt>Phone</dt><dd>{loc.phone}</dd></>)}
            {loc.website && (<><dt>Website</dt><dd>{loc.website.replace(/^https?:\/\//, "")}</dd></>)}
          </>
        ) : (
          <>
            <dt>On our store map</dt>
            <dd>Not linked yet. Ask us below if you&apos;d like to be listed.</dd>
          </>
        )}
        {data.account.contactName && (<><dt>Contact</dt><dd>{data.account.contactName}{data.account.phone ? ` · ${data.account.phone}` : ""}</dd></>)}
        <dt>Logins</dt>
        <dd>{data.account.logins.filter((l) => l.active).map((l) => `${l.name} (${l.email})`).join(", ")}</dd>
      </dl>
      <h3 className="sp-h3">Need something changed, or have a question?</h3>
      <textarea className="gate-input sp-note" rows={3} placeholder="e.g. Our hours changed to 10–6, or please add a login for our new manager" value={text} onChange={(e) => setText(e.target.value.slice(0, 2000))} />
      <div className="sp-send">
        <span />
        <button type="button" className="sp-btn sp-btn-primary" onClick={send} disabled={busy || text.trim().length < 2}>{busy ? "Sending…" : "Message the team"}</button>
      </div>
      {error && <div className="gate-error">{error}</div>}
      {msg && <div className="gate-success sp-ok">{msg}</div>}
    </section>
  );
}

function FaceIdDevices() {
  const [list, setList] = useState<Array<{ id: string; device: string; createdAt: number; lastUsedAt?: number }> | null>(null);
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    const r = await fetch("/api/store-portal/passkey", { cache: "no-store" });
    const d = await r.json().catch(() => null);
    if (r.ok && d?.on) setList(d.passkeys || []);
  }, []);
  useEffect(() => {
    setSupported(browserSupportsWebAuthn());
    void load();
  }, [load]);
  if (!list) return null;
  async function add() {
    setBusy(true);
    setMsg("");
    try {
      const o = await post("/api/store-portal/passkey", { action: "add-options" });
      if (!o.ok) throw new Error(o.data.error || "Couldn't start.");
      const response = await startRegistration({ optionsJSON: o.data.options });
      const v = await post("/api/store-portal/passkey", { action: "add-verify", response });
      setMsg(v.ok ? `Added. Next time, sign in with one tap on this ${v.data.device || "device"}.` : v.data.error || "Face ID couldn't be added.");
      await load();
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name !== "NotAllowedError" && name !== "AbortError") setMsg((err as Error)?.message || "Face ID couldn't be added here.");
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    await fetch(`/api/store-portal/passkey?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await load();
  }
  return (
    <section className="sp-card" aria-labelledby="sp-face">
      <h2 id="sp-face" className="sp-h2">Face ID</h2>
      <p className="sp-muted">Sign in with one tap on your phone or computer. Your password and emailed codes keep working.</p>
      {list.length > 0 && (
        <ul className="sp-devices">
          {list.map((p) => (
            <li key={p.id}>
              <span>{p.device} · added {fmtDay(p.createdAt)}{p.lastUsedAt ? ` · last used ${fmtDay(p.lastUsedAt)}` : ""}</span>
              <button type="button" className="auth-link" onClick={() => remove(p.id)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      {supported ? (
        <button type="button" className="sp-btn sp-btn-ghost" onClick={add} disabled={busy}>{busy ? "One moment…" : "Add Face ID for this device"}</button>
      ) : (
        <p className="sp-muted">This browser can&apos;t use Face ID.</p>
      )}
      {msg && <div className="sp-muted" style={{ marginTop: "0.6rem" }}>{msg}</div>}
    </section>
  );
}
