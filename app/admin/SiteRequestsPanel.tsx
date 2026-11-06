"use client";

import { useEffect, useState } from "react";
import { useAdminRefresh } from "./useAdminRefresh";
import { brand } from "@/lib/brand";
import type { AdminRefreshKey } from "@/lib/assistant/shared";

type Req = {
  number: number;
  title: string;
  size: "small" | "medium" | "large";
  status: "needs-approval" | "ready" | "in-progress" | "on-stage" | "needs-attention" | "declined" | "done";
  requestedBy: string;
  createdAt: number;
  url: string;
  details: string;
  /** Staff name from the sign-in list, when known. */
  requestedByName?: string;
};

const EDITABLE: Req["status"][] = ["needs-approval", "ready", "needs-attention"];
const SIZES: Array<[Req["size"], string]> = [
  ["small", "Small: wording, colours, layout tweak"],
  ["medium", "Medium: a new section or behaviour"],
  ["large", "Large: a new feature"],
];
const from = (r: Req) => (r.requestedByName ? `${r.requestedByName} (${r.requestedBy})` : r.requestedBy);

const STATUS: Record<Req["status"], string> = {
  "needs-approval": "Waiting for the developer",
  ready: "Queued to build",
  "in-progress": "Being built",
  "on-stage": "On stage — ready to put live",
  "needs-attention": "Needs a look",
  declined: "Declined",
  done: "Done",
};

const when = (t: number) => new Date(t).toLocaleDateString("en-US", { timeZone: brand.timezone, month: "short", day: "numeric" });

/** Settings → Site requests: changes staff asked for, and the developer's approvals. */
export default function SiteRequestsPanel() {
  const [rows, setRows] = useState<Req[] | null>(null);
  const [canApprove, setCanApprove] = useState(false);
  const [connected, setConnected] = useState(true);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [size, setSize] = useState<Req["size"]>("small");
  const [sending, setSending] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [edit, setEdit] = useState<{ number: number; title: string; details: string; size: Req["size"] } | null>(null);

  const load = () =>
    fetch("/api/admin/site-requests", { cache: "no-store" })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        setRows(d.requests || []);
        setCanApprove(!!d.canApprove);
        setConnected(d.connected !== false);
        if (!ok && d.error) setMsg(d.error);
      })
      .catch(() => setMsg("Couldn't load site requests."));
  useEffect(() => {
    load();
  }, []);
  useAdminRefresh(["site_requests"] as AdminRefreshKey[], () => load());

  async function review(n: number, action: "approve" | "decline" | "remove" | "edit", extra?: Record<string, unknown>) {
    if (action === "decline" && !confirm("Decline this request? It's closed and won't be built.")) return;
    if (action === "remove" && !confirm(`Remove #${n}? It's closed on GitHub and disappears from this list.`)) return;
    setBusy(n);
    setMsg("");
    try {
      const r = await fetch("/api/admin/site-requests", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, number: n, ...extra }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Couldn't update it.");
      setMsg(
        action === "approve" ? `Approved #${n}: it's queued and will show up on stage after the next build run.`
        : action === "decline" ? `Declined #${n}.`
        : action === "remove" ? `Removed #${n}.`
        : `Saved #${n}${d.request?.status === "needs-approval" ? ": it now waits for your approval." : "."}${d.bumped ? " (Sized up: it touches money, sign-in, customer data, emails or legal text.)" : ""}`,
      );
      if (action === "edit") setEdit(null);
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't update it.");
    }
    setBusy(null);
  }

  async function file(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setMsg("");
    try {
      const r = await fetch("/api/admin/site-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, details, size }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Couldn't send it.");
      setTitle("");
      setDetails("");
      setSize("small");
      setFormOpen(false);
      setMsg(d.message || (d.request?.status === "ready" ? "Sent. It's small, so it goes straight to the build queue." : "Sent to the developer. This one needs separate work from them, and they'll reach out to you about it."));
      load();
    } catch (e2) {
      setMsg(e2 instanceof Error ? e2.message : "Couldn't send it.");
    }
    setSending(false);
  }

  if (!connected) {
    return (
      <section className="admin-section sr">
        <h2>Site requests</h2>
        <p className="field-hint">
          Not connected yet. For the developer, in the hosting settings (e.g. Vercel → Environment Variables), then redeploy:
        </p>
        <ol className="field-hint sr-setup">
          <li><code>GITHUB_SITE_REQUESTS_REPO</code>: the site&rsquo;s repository, as <code>owner/name</code>.</li>
          <li><code>GITHUB_SITE_REQUESTS_TOKEN</code>: a fine-grained GitHub token for that repository only, with Issues: Read and write.</li>
          <li><code>SITE_REQUEST_APPROVER</code>: the developer&rsquo;s staff sign-in email (only they can approve, edit or remove requests).</li>
          <li>A scheduled worker that builds the queued requests (see the README, &ldquo;Site change requests&rdquo;).</li>
        </ol>
      </section>
    );
  }

  const waiting = (rows || []).filter((r) => r.status === "needs-approval");
  return (
    <section className="admin-section sr">
      <h2>Site requests</h2>
      <p className="field-hint sr-intro">
        Ask the Concierge or use <em>New request</em>. <strong>Small</strong> changes are built onto stage at the next build run; <strong>medium and large</strong> ones, and anything touching money, sign-in, customer data, emails or legal text, wait for the developer. Nothing goes live until the developer puts stage live.
      </p>
      {canApprove && waiting.length > 0 && <p className="sr-waiting">{waiting.length} waiting for your approval</p>}

      <details className="sr-new" open={formOpen} onToggle={(e) => setFormOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>+ New request</summary>
        <form className="sr-form" onSubmit={file}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short title, e.g. Make the shop heading bigger" maxLength={120} aria-label="Title" />
          <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={3} placeholder="What should change, and where?" maxLength={4000} aria-label="What should change" />
          <div className="sr-form-row">
            <select value={size} onChange={(e) => setSize(e.target.value as Req["size"])} aria-label="Size">
              {SIZES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button type="submit" className="esc-btn primary" disabled={sending || title.trim().length < 4 || details.trim().length < 10}>{sending ? "Sending…" : "Send request"}</button>
          </div>
        </form>
      </details>

      {msg && <p className="field-hint sr-msg" role="status">{msg}</p>}

      {rows === null ? (
        <p className="field-hint">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="field-hint">No requests yet.</p>
      ) : (
        <ul className="sr-list">
          {rows.map((r) =>
            edit?.number === r.number ? (
              <li key={r.number} className="sr-row is-editing">
                <form
                  className="sr-form sr-edit"
                  onSubmit={(e) => {
                    e.preventDefault();
                    review(r.number, "edit", { title: edit.title, details: edit.details, size: edit.size });
                  }}
                >
                  <strong className="sr-edit-head">Editing #{r.number}</strong>
                  <input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} maxLength={120} aria-label="Title" />
                  <textarea value={edit.details} onChange={(e) => setEdit({ ...edit, details: e.target.value })} rows={4} maxLength={4000} aria-label="What should change" />
                  <div className="sr-form-row">
                    <select value={edit.size} onChange={(e) => setEdit({ ...edit, size: e.target.value as Req["size"] })} aria-label="Size">
                      {SIZES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <button type="button" className="esc-btn" onClick={() => setEdit(null)}>Cancel</button>
                    <button type="submit" className="esc-btn primary" disabled={busy === r.number || edit.title.trim().length < 4 || edit.details.trim().length < 10}>{busy === r.number ? "Saving…" : "Save"}</button>
                  </div>
                </form>
              </li>
            ) : (
              <li key={r.number} className={`sr-row is-${r.status}`}>
                <div className="sr-main">
                  <div className="sr-head">
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="sr-title">#{r.number} {r.title}</a>
                    <span className={`sr-status is-${r.status}`}>{STATUS[r.status]}</span>
                  </div>
                  <span className="sr-meta">
                    From <strong>{from(r)}</strong> · {r.size} · {when(r.createdAt)}
                  </span>
                  {r.details && <p className="sr-details">{r.details.length > 260 ? `${r.details.slice(0, 260)}…` : r.details}</p>}
                </div>
                {canApprove && (
                  <div className="sr-actions">
                    {r.status === "needs-approval" && (
                      <>
                        <button type="button" className="esc-btn primary" disabled={busy === r.number} onClick={() => review(r.number, "approve")}>Approve</button>
                        <button type="button" className="esc-btn" disabled={busy === r.number} onClick={() => review(r.number, "decline")}>Decline</button>
                      </>
                    )}
                    {EDITABLE.includes(r.status) && (
                      <button type="button" className="esc-btn" disabled={busy === r.number} onClick={() => setEdit({ number: r.number, title: r.title, details: r.details, size: r.size })}>Edit</button>
                    )}
                    {r.status !== "in-progress" && (
                      <button type="button" className="esc-btn sr-remove" disabled={busy === r.number} onClick={() => review(r.number, "remove")}>Remove</button>
                    )}
                  </div>
                )}
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}
