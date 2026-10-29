"use client";

import { useEffect, useState } from "react";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { useAdminRefresh } from "./useAdminRefresh";
import type { AdminRefreshKey } from "@/lib/assistant/shared";
import { unlockName } from "@/lib/unlockName";

// Settings → Staff sign-in → Face ID. Each staff member adds Face ID / Touch ID
// (a passkey) once per device, then taps "Sign in with Face ID" on the sign-in
// page. An extra option: the password and emailed link keep working.

type Key = { id: string; email: string; device: string; rpID: string; createdAt: number; lastUsedAt?: number };
type Data = { on: boolean; rpID: string; you: string; staff: Array<{ email: string; name: string }>; passkeys: Key[] };

const day = (t: number) => new Date(t).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric" });

export default function PasskeysPanel() {
  const [d, setD] = useState<Data | null>(null);
  const [supported, setSupported] = useState(true);
  const [unlock, setUnlock] = useState("Face ID");
  const [forEmail, setForEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () =>
    fetch("/api/admin/passkeys", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((x: Data | null) => x && setD(x))
      .catch(() => {});
  useAdminRefresh(["staff", "flags"] as AdminRefreshKey[], () => load());
  useEffect(() => {
    setSupported(browserSupportsWebAuthn());
    setUnlock(unlockName());
    load();
  }, []);

  if (!d) return null;
  const shared = d.you === "admin";
  const here = d.passkeys.filter((k) => k.rpID === d.rpID);
  const name = (email: string) => d.staff.find((s) => s.email === email)?.name || email;

  async function add() {
    setBusy(true);
    setMsg(null);
    try {
      const o = await fetch("/api/admin/passkeys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "options", email: shared ? forEmail : undefined }) });
      const od = await o.json().catch(() => ({}));
      if (!o.ok) throw new Error(od.error || "Couldn't start.");
      const response = await startRegistration({ optionsJSON: od.options });
      const v = await fetch("/api/admin/passkeys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "verify", response }) });
      const vd = await v.json().catch(() => ({}));
      if (!v.ok) throw new Error(vd.error || "Couldn't add it.");
      setMsg({ ok: true, text: `${unlock[0].toUpperCase()}${unlock.slice(1)} added for ${name(vd.for)} on this ${vd.device}. Next time, tap “Sign in with ${unlock}”.` });
      load();
    } catch (err) {
      const n = (err as { name?: string })?.name;
      setMsg({ ok: false, text: n === "InvalidStateError" ? "This device is already set up for them." : n === "NotAllowedError" ? "Cancelled." : err instanceof Error && err.message ? err.message : "Couldn't add Face ID." });
    }
    setBusy(false);
  }

  async function remove(k: Key) {
    if (!confirm(`Remove ${name(k.email)}'s sign-in on ${k.device}? They can still sign in with their email link or the password.`)) return;
    setBusy(true);
    const r = await fetch(`/api/admin/passkeys?id=${encodeURIComponent(k.id)}`, { method: "DELETE" });
    setMsg(r.ok ? { ok: true, text: "Removed." } : { ok: false, text: "Couldn't remove it." });
    setBusy(false);
    load();
  }

  return (
    <div className="pk-panel">
      <h3>Face ID, Touch ID &amp; fingerprint</h3>
      {!d.on ? (
        <p className="field-hint">Off. Switch on <strong>Staff sign-in with Face ID</strong> under Feature switches.</p>
      ) : (
        <>
          <p className="field-hint">
            Add it once on each phone or computer, then tap <strong>Sign in with {unlock}</strong> on the sign-in page: no password or email needed. Works with Face ID
            and Touch ID on Apple devices (iCloud Keychain shares it between them), fingerprint or face unlock on Android, and Windows Hello. The password and
            emailed link keep working. Set up on the live site and stage separately.
          </p>
          {here.length > 0 && (
            <ul className="pk-list">
              {here.map((k) => (
                <li key={k.id}>
                  <span><strong>{name(k.email)}</strong> · {k.device} · added {day(k.createdAt)}{k.lastUsedAt ? ` · last used ${day(k.lastUsedAt)}` : ""}</span>
                  <button type="button" className="ap-linkbtn esc-quiet" onClick={() => remove(k)} disabled={busy}>Remove</button>
                </li>
              ))}
            </ul>
          )}
          {!supported ? (
            <p className="field-hint">This browser can&rsquo;t use Face ID, Touch ID or fingerprint sign-in. Try Safari or Chrome on your phone or computer.</p>
          ) : (
            <div className="pk-add">
              {shared && (
                <select value={forEmail} onChange={(e) => setForEmail(e.target.value)} aria-label="Who is this for">
                  <option value="">Who is this for?</option>
                  {d.staff.map((s) => <option key={s.email} value={s.email}>{s.name} ({s.email})</option>)}
                </select>
              )}
              <button type="button" className="esc-btn primary" onClick={add} disabled={busy || (shared && !forEmail)}>
                {busy ? `Waiting for ${unlock}…` : `Add ${unlock} for this device`}
              </button>
            </div>
          )}
          {shared && <p className="field-hint">You signed in with the shared password, so choose whose sign-in this is (they must be on the staff list above).</p>}
        </>
      )}
      {msg && <div className={msg.ok ? "ap-ok" : "ap-bad"} style={{ marginTop: "0.5rem" }}>{msg.text}</div>}
    </div>
  );
}
