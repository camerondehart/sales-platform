"use client";

import { useEffect, useState } from "react";
import { useAdminRefresh } from "./useAdminRefresh";
import type { AdminRefreshKey } from "@/lib/assistant/shared";

// Settings → Feature switches. Each switch applies to THIS site only
// (production or stage) and takes effect within about 15 seconds.

type Flag = {
  key: string;
  label: string;
  description: string;
  built: boolean;
  on: boolean;
  default: boolean;
  shared?: boolean;
};

export default function FlagsPanel() {
  const [env, setEnv] = useState("");
  const [flags, setFlags] = useState<Flag[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState(false);

  const load = () =>
    fetch("/api/admin/flags", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        setEnv(d.env);
        setFlags(d.flags);
      })
      .catch(() => setMsg({ ok: false, text: "Couldn't load the switches. Refresh to try again." }));

  useAdminRefresh(["flags"] as AdminRefreshKey[], () => load());
  useEffect(() => {
    load();
  }, []);

  async function toggle(f: Flag) {
    if (!f.built) return;
    const next = !f.on;
    if (f.key === "ai_assistant" && !next && !confirm("Turn the Concierge off for everyone (visitors, members and staff)?")) return;
    if (f.shared && !confirm(`This switch is shared: it changes stage AND the live site.\n\n${f.description}\n\nTurn it ${next ? "on" : "off"}?`)) return;
    setBusy(f.key);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: f.key, on: next }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "Couldn't save.");
      setFlags((list) => (list ? list.map((x) => (x.key === f.key ? { ...x, on: next } : x)) : list));
      setMsg({ ok: true, text: `${f.label}: ${next ? "on" : "off"}. Takes effect within about 15 seconds.` });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Couldn't save." });
    }
    setBusy(null);
  }

  const envLabel = env === "production" ? "the live site" : env === "preview" ? "stage" : "this local copy";

  return (
    <section className="admin-section">
      <h2>
        <button type="button" className="flag-fold" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          Feature switches
          <span className="flag-fold-hint">{open ? "Hide" : "Show"} <span aria-hidden="true">{open ? "▴" : "▾"}</span></span>
        </button>
      </h2>
      {open && (<>
      <p className="field-hint" style={{ marginTop: "-0.4rem" }}>
        Turn features on or off without a redeploy. These apply to <strong>{envLabel}</strong> only — stage and the live site
        have separate switches (except any marked <em>Stage + live</em>).
      </p>
      {!flags ? (
        <div className="empty" style={{ padding: "1rem 0" }}>{msg?.text || "Loading…"}</div>
      ) : (
        <div className="flag-list">
          {flags.map((f) => (
            <label key={f.key} className={`flag-row${f.built ? "" : " is-pending"}`}>
              <span className="flag-text">
                <strong>
                  {f.label}
                  {!f.built && <span className="flag-chip">Needs a decision</span>}
                  {f.shared && <span className="flag-chip">Stage + live</span>}
                </strong>
                <small>{f.description}</small>
              </span>
              <span className={`ap-toggle flag-toggle${f.on ? " on" : ""}`}>
                <input
                  type="checkbox"
                  checked={f.on}
                  disabled={!f.built || busy === f.key}
                  onChange={() => toggle(f)}
                  aria-label={f.label}
                />
                <span className="ap-switch" aria-hidden="true" />
              </span>
            </label>
          ))}
        </div>
      )}
      </>)}
      {msg && flags && <div className={msg.ok ? "ap-ok" : "ap-bad"} style={{ marginTop: "0.75rem" }}>{msg.text}</div>}
    </section>
  );
}
