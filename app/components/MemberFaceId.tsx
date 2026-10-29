"use client";

import { useEffect, useState } from "react";
import { browserSupportsWebAuthn, platformAuthenticatorIsAvailable, startRegistration } from "@simplewebauthn/browser";
import { unlockName } from "@/lib/unlockName";

/**
 * Members' Face ID / Touch ID / fingerprint (switch `member_passkeys`).
 *  - FaceIdPrompt: the one-click popup right after a member signs in another way.
 *    "Not now" is remembered on this device (for this member) and never asked again here.
 *  - FaceIdDevices: Account → Face ID, to add this device or remove one.
 *  - FaceIdIcon: the face (Face ID) or fingerprint (everything else) mark.
 * Server: app/api/account/passkeys and app/api/login/member-passkey.
 */

/** Set by the sign-in forms just before going to the gallery: how they signed in. */
export const SIGNED_IN_KEY = "fp_member_signin";
const declinedKey = (email: string) => `fp_faceid_declined:${email.trim().toLowerCase()}`;
const addedKey = (email: string) => `fp_faceid_added:${email.trim().toLowerCase()}`;

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};

/** Called by the sign-in forms ("password", "code", "link", "passkey"). */
export function markSignedIn(how: string) {
  try {
    sessionStorage.setItem(SIGNED_IN_KEY, how);
  } catch {}
}

export function FaceIdIcon({ unlock, size = 20 }: { unlock: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      {unlock === "Face ID" ? (
        <>
          <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
          <path d="M9 9.5v1M15 9.5v1M12 9v4h-1M9.5 15.5c1.4 1 3.6 1 5 0" />
        </>
      ) : (
        <path d="M7 5.5A8 8 0 0 1 19.5 12M4.5 9A8 8 0 0 0 4 12v1M12 8a4 4 0 0 1 4 4c0 3-.5 5-1.5 7M8 12a4 4 0 0 1 1.2-2.9M8 12c0 2.5-.6 4.5-1.8 6M12 12c0 3.5-.8 6.3-2.3 8.5M16.3 16.5c-.3 1.4-.7 2.6-1.2 3.6" />
      )}
    </svg>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Adds a passkey for this device to the signed-in member's account. */
async function addThisDevice(email: string): Promise<{ ok: true; device: string } | { ok: false; error: string; cancelled?: boolean }> {
  try {
    const o = await fetch("/api/account/passkeys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "options" }) });
    const od = await o.json().catch(() => ({}));
    if (!o.ok || !od.options) return { ok: false, error: od.error || "Couldn't start. Please try again." };
    const response = await startRegistration({ optionsJSON: od.options });
    const v = await fetch("/api/account/passkeys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "verify", response }) });
    const vd = await v.json().catch(() => ({}));
    if (!v.ok) return { ok: false, error: vd.error || "It couldn't be added. Please try again." };
    store.set(addedKey(email), "1");
    return { ok: true, device: vd.device || "device" };
  } catch (err) {
    const n = (err as { name?: string })?.name;
    if (n === "InvalidStateError") {
      store.set(addedKey(email), "1");
      return { ok: false, error: "This device is already set up. Next time, just tap the button on the sign-in page." };
    }
    return { ok: false, cancelled: n === "NotAllowedError", error: n === "NotAllowedError" ? "Cancelled." : "This device couldn't be set up." };
  }
}

/** Should the post-sign-in popup show? (once per sign-in, never after "Not now" on this device) */
export function useFaceIdPrompt({ email, enabled, ready }: { email: string; enabled: boolean; ready: boolean }) {
  const [show, setShow] = useState(false);
  const [how, setHow] = useState<string | null>(null);
  useEffect(() => {
    // Read the "just signed in" note once, on arrival.
    try {
      setHow(sessionStorage.getItem(SIGNED_IN_KEY));
      sessionStorage.removeItem(SIGNED_IN_KEY);
    } catch {}
  }, []);
  useEffect(() => {
    if (!enabled || !ready || !how || how === "passkey" || !email) return;
    if (store.get(declinedKey(email)) || store.get(addedKey(email))) return;
    if (!browserSupportsWebAuthn()) return;
    let live = true;
    platformAuthenticatorIsAvailable()
      .then((yes) => live && yes && setShow(true))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [enabled, ready, how, email]);
  return { show, close: () => setShow(false) };
}

export function FaceIdPrompt({ email, onClose }: { email: string; onClose: () => void }) {
  const [unlock, setUnlock] = useState("Face ID");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => setUnlock(unlockName()), []);
  const name = unlock === "a passkey" ? "a passkey" : unlock;

  function notNow() {
    store.set(declinedKey(email), String(Date.now()));
    onClose();
  }
  async function add() {
    setBusy(true);
    setMsg(null);
    const r = await addThisDevice(email);
    setBusy(false);
    if (r.ok) {
      setMsg({ ok: true, text: `All set! Next time, tap “Sign in with ${name}” on the sign-in page.` });
      setTimeout(onClose, 2200);
    } else if (!r.cancelled) setMsg({ ok: false, text: r.error });
  }

  return (
    <div className="fid-backdrop" role="dialog" aria-modal="true" aria-labelledby="fid-title">
      <div className="fid-card">
        <div className="fid-mark"><FaceIdIcon unlock={unlock} size={30} /></div>
        <h2 id="fid-title">Sign in faster next time?</h2>
        <p>Use {name} on this device instead of typing your password. Your face or fingerprint never leaves your device.</p>
        {msg && <div className={msg.ok ? "fid-ok" : "fid-bad"}>{msg.text}</div>}
        {!msg?.ok && (
          <div className="fid-actions">
            <button type="button" className="fid-primary" onClick={add} disabled={busy}>
              {busy ? `Waiting for ${name}…` : `Use ${name}`}
            </button>
            <button type="button" className="fid-quiet" onClick={notNow} disabled={busy}>Not now</button>
          </div>
        )}
      </div>
    </div>
  );
}

type Key = { id: string; device: string; createdAt: number; lastUsedAt?: number };
const day = (t: number) => new Date(t).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "long", day: "numeric", year: "numeric" });

/** Account → Face ID: this member's devices, add this one, remove one. */
export function FaceIdDevices({ email }: { email: string }) {
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [unlock, setUnlock] = useState("Face ID");
  const [supported, setSupported] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = () =>
    fetch("/api/account/passkeys", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setKeys(d?.passkeys || []))
      .catch(() => setKeys([]));
  useEffect(() => {
    setUnlock(unlockName());
    setSupported(browserSupportsWebAuthn());
    load();
  }, []);
  const name = unlock === "a passkey" ? "a passkey" : unlock;

  async function add() {
    setBusy(true);
    setMsg(null);
    const r = await addThisDevice(email);
    setBusy(false);
    if (r.ok) setMsg({ ok: true, text: `${cap(name)} is set up on this ${r.device}.` });
    else if (!r.cancelled) setMsg({ ok: false, text: r.error });
    load();
  }
  async function remove(k: Key) {
    if (!confirm(`Remove sign-in with ${name} on ${k.device}? You can still sign in with your password.`)) return;
    setBusy(true);
    const r = await fetch(`/api/account/passkeys?id=${encodeURIComponent(k.id)}`, { method: "DELETE" });
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: "Removed." } : { ok: false, text: "Couldn't remove it." });
    load();
  }

  return (
    <div className="fid-devices">
      <p className="fid-lede">
        Sign in with one tap using Face ID, Touch ID or your fingerprint. Set it up once on each phone or computer. Your face or fingerprint never leaves your device, and your password keeps working.
      </p>
      {keys && keys.length > 0 && (
        <ul className="fid-list">
          {keys.map((k) => (
            <li key={k.id}>
              <span>
                <strong>{k.device}</strong>
                <small>Added {day(k.createdAt)}{k.lastUsedAt ? ` · last used ${day(k.lastUsedAt)}` : ""}</small>
              </span>
              <button type="button" onClick={() => remove(k)} disabled={busy}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      {keys && keys.length === 0 && <p className="fid-empty">No devices set up yet.</p>}
      {supported ? (
        <button type="button" className="fid-primary" onClick={add} disabled={busy}>
          <FaceIdIcon unlock={unlock} size={18} /> {busy ? `Waiting for ${name}…` : `Set up ${name} on this device`}
        </button>
      ) : (
        <p className="fid-empty">This browser can&rsquo;t use Face ID, Touch ID or fingerprint sign-in. Try Safari or Chrome on your phone.</p>
      )}
      {msg && <div className={msg.ok ? "fid-ok" : "fid-bad"}>{msg.text}</div>}
    </div>
  );
}
