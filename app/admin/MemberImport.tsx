"use client";

import { useEffect, useState } from "react";

// Members → "Import from Shopify" (preview first, nothing saved until you
// press Import) and the "Invite to set a password" panel that follows it.

type Summary = {
  rowsInFile: number;
  newMembers: number;
  alreadyMembers: number;
  under21Skipped: number;
  noEmail: number;
  duplicatesInFile: number;
  subscribed: number;
  optedOut: number;
  alreadyOnList: number;
  withAddress: number;
  usedBefore: number;
  sample: Array<{ name: string; email: string; city?: string; orders?: number; marketing: boolean }>;
};

const n = (x: number) => x.toLocaleString("en-US");

export function ShopifyImportButton({ onImported }: { onImported: () => void }) {
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<Summary | null>(null);
  const [done, setDone] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    setDone(null);
    setBusy(true);
    try {
      const text = await file.text();
      setCsv(text);
      const r = await fetch("/api/admin/users/import-shopify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv: text, dryRun: true }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Couldn't read that file.");
      setPreview(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read that file.");
    }
    setBusy(false);
  }

  async function run() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/admin/users/import-shopify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv, dryRun: false }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "The import didn't finish.");
      setDone(d);
      setPreview(null);
      setCsv("");
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The import didn't finish.");
    }
    setBusy(false);
  }

  const close = () => {
    setPreview(null);
    setDone(null);
    setError("");
    setCsv("");
  };
  const s = done || preview;

  return (
    <>
      <label className="export-btn csv-upload">
        {busy && !s ? "Reading…" : "Import from Shopify"}
        <input type="file" accept=".csv,text/csv" disabled={busy} onChange={pick} />
      </label>
      {error && !s && <span className="ap-bad" style={{ fontSize: "0.8rem" }}>{error}</span>}
      {s && (
        <div className="modal-backdrop" onClick={close}>
          <div className="modal mi-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={close} aria-label="Close">×</button>
            <div className="modal-body" style={{ width: "100%" }}>
              <div className="mi-kicker">{done ? "Imported" : "Preview — nothing saved yet"}</div>
              <h3 className="mi-title">
                {done ? `${n(s.newMembers)} new members added` : `${n(s.newMembers)} new members to add`}
              </h3>
              <div className="mi-grid">
                <div><b>{n(s.newMembers)}</b><span>new members (approved)</span></div>
                <div><b>{n(s.alreadyMembers)}</b><span>already members — left exactly as they are</span></div>
                <div><b>{n(s.subscribed)}</b><span>join the mailing list (said yes to marketing)</span></div>
                <div><b>{n(s.optedOut)}</b><span>no marketing (said no) — account emails only</span></div>
                <div><b>{n(s.withAddress)}</b><span>with a saved address</span></div>
                <div><b>{n(s.usedBefore)}</b><span>have bought from us before</span></div>
              </div>
              <div className="mi-skips">
                {[
                  s.under21Skipped ? `${n(s.under21Skipped)} skipped (said they're under 21)` : "",
                  s.noEmail ? `${n(s.noEmail)} skipped (no email)` : "",
                  s.duplicatesInFile ? `${n(s.duplicatesInFile)} duplicate rows ignored` : "",
                  s.alreadyOnList ? `${n(s.alreadyOnList)} already on the mailing list — unchanged` : "",
                ]
                  .filter(Boolean)
                  .join(" · ") || "Nothing skipped."}
              </div>
              {!done && s.sample.length > 0 && (
                <ul className="mi-sample">
                  {s.sample.map((p) => (
                    <li key={p.email}>
                      {p.name} <span>— {p.city || "no address"}{p.orders ? ` · ${p.orders} past order${p.orders === 1 ? "" : "s"}` : ""}{p.marketing ? " · subscribed" : ""}</span>
                    </li>
                  ))}
                  {s.newMembers > s.sample.length && <li className="mi-more">…and {n(s.newMembers - s.sample.length)} more</li>}
                </ul>
              )}
              <p className="field-hint">
                {done
                  ? "No emails were sent. Next: invite them to choose a password (Invite panel just below)."
                  : "No emails are sent by the import. Addresses, phone, notes, “used before”, experience level and their old-store order history come across. Re-importing the same file is safe."}
              </p>
              {error && <div className="ap-bad">{error}</div>}
              <div className="mi-actions">
                {done ? (
                  <button className="submit" onClick={() => { close(); document.getElementById("invite-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
                    Next: invite them →
                  </button>
                ) : (
                  <>
                    <button className="submit" disabled={busy || s.newMembers === 0} onClick={run}>
                      {busy ? "Importing…" : s.newMembers ? `Import ${n(s.newMembers)} members` : "Nothing new to import"}
                    </button>
                    <button type="button" className="tb-link" onClick={close}>Cancel</button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

type Stats = {
  imported: number;
  setPassword: number;
  waiting: number;
  neverInvited: number;
  canRemind: number;
  invitedNotSet: number;
  inWindow: boolean;
  job: null | { id: string; mode: string; status: "sending" | "paused" | "done" | "cancelled"; total: number; sent: number; failed: number; skipped: number; remaining: number; createdAt: number };
};

export function InvitePanel({ refreshKey }: { refreshKey: number }) {
  const [s, setS] = useState<Stats | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () =>
    fetch("/api/admin/invites", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setS(d))
      .catch(() => {});
  useEffect(() => {
    load();
    const id = setInterval(() => document.visibilityState === "visible" && load(), 30_000);
    return () => clearInterval(id);
  }, [refreshKey]);

  async function act(action: string, mode?: string, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(action + (mode || ""));
    setMsg(null);
    const r = await fetch("/api/admin/invites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, mode }) });
    const d = await r.json().catch(() => ({}));
    setBusy("");
    if (!r.ok) return setMsg({ ok: false, text: d.error || "Couldn't do that." });
    if (action === "test") setMsg({ ok: true, text: `Test sent to ${d.to}. The button in it opens a preview page.` });
    if (action === "start") setMsg({ ok: true, text: `Started: ${n(d.total)} to send. ${d.first?.sent ? `${n(d.first.sent)} sent just now; ` : ""}the rest go out every 15 minutes (up to 200 a time, 9am–6pm local).` });
    if (d.stats) setS(d.stats);
    else load();
  }

  if (!s || (s.imported === 0 && s.waiting === 0)) return null;
  const j = s.job && (s.job.status === "sending" || s.job.status === "paused") ? s.job : null;
  const pct = s.imported ? Math.round((s.setPassword / s.imported) * 100) : 0;

  return (
    <div className="ip" id="invite-panel">
      <div className="ip-head">
        <div>
          <div className="ip-title">Invite members to set a password</div>
          <div className="ip-sub">
            {n(s.setPassword)} of {n(s.imported)} imported members have set a password ({pct}%) · {n(s.waiting)} still waiting
            {s.invitedNotSet ? ` · ${n(s.invitedNotSet)} invited but not yet` : ""}
          </div>
        </div>
        <div className="ip-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
      </div>

      {j ? (
        <div className="ip-job">
          <strong>{j.status === "paused" ? "Paused" : "Sending"}</strong> — {n(j.sent)} of {n(j.total)} sent
          {j.failed ? `, ${n(j.failed)} failed` : ""}
          {j.skipped ? `, ${n(j.skipped)} skipped (already set a password)` : ""} · {n(j.remaining)} to go
          {j.status === "sending" && !s.inWindow ? " · waiting for 9am local" : ""}
          <div className="ip-actions">
            {j.status === "sending" ? (
              <button className="export-btn" disabled={!!busy} onClick={() => act("pause")}>Pause</button>
            ) : (
              <button className="export-btn" disabled={!!busy} onClick={() => act("resume")}>Resume</button>
            )}
            <button className="export-btn" disabled={!!busy} onClick={() => act("cancel", undefined, "Stop this run? People already emailed keep their link; the rest won't be sent.")}>Cancel run</button>
          </div>
        </div>
      ) : (
        <div className="ip-actions">
          <button className="export-btn" disabled={!!busy} onClick={() => act("test")}>{busy === "test" ? "Sending…" : "1. Send a test to me"}</button>
          <button
            className="submit ip-go"
            disabled={!!busy || s.neverInvited === 0}
            onClick={() => act("start", "never_invited", `Email a set-password link to ${n(s.neverInvited)} members? It goes out in batches over the next few hours (9am–6pm local) and can be paused.`)}
          >
            {busy === "startnever_invited" ? "Starting…" : s.neverInvited ? `2. Invite ${n(s.neverInvited)} members` : "Everyone's been invited"}
          </button>
          {s.canRemind > 0 && (
            <button className="export-btn" disabled={!!busy} onClick={() => act("start", "remind", `Send a reminder link to ${n(s.canRemind)} people who were invited 5+ days ago and still haven't set a password?`)}>
              Remind {n(s.canRemind)} who haven't yet
            </button>
          )}
        </div>
      )}
      {s.job && !j && s.job.status === "done" && (
        <div className="ip-last">Last run: {n(s.job.sent)} sent{s.job.failed ? `, ${n(s.job.failed)} failed` : ""}{s.job.skipped ? `, ${n(s.job.skipped)} skipped` : ""}.</div>
      )}
      <p className="field-hint" style={{ marginBottom: 0 }}>
        Each email has a personal link (30 days, works once) to choose a password; it signs them straight in. If a link expires, they can get a new one from the
        sign-in screen (“First time here since our old shop? Email me a link”), or you can send one from their row below. “Forgot password?” works for them too.
      </p>
      {msg && <div className={msg.ok ? "ap-ok" : "ap-bad"} style={{ marginTop: "0.6rem" }}>{msg.text}</div>}
    </div>
  );
}
