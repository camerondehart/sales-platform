"use client";

import { useEffect, useState } from "react";
import { brand } from "@/lib/brand";

// Assistant tab → Concierge notes: the lessons the Concierge writes for itself
// from past chats (nightly review), plus any staff add. Edit, pin, delete.

type Scope = "staff" | "customer" | "today";
type Note = { id: string; scope: Scope; todayKey?: string; text: string; source: "ai" | "staff"; pinned?: boolean; updatedAt: number };
type Run = { id: string; at: number; ok: boolean; trigger: string; model?: string; costUsd?: number; chats?: number; added?: number; removed?: number; kept?: number; rejected?: number; error?: string };

const SCOPES: Array<[Scope, string, string]> = [
  ["staff", "Staff Concierge", "Daily cards, campaigns and site insights in the admin chat."],
  ["customer", "Customer Concierge", "General lessons for shoppers and members. Never about a specific person."],
  ["today", "Today list", "Shown as a “Learned” line on that Today item and used when its button prepares cards."],
];

const when = (t: number) => new Date(t).toLocaleString("en-US", { timeZone: brand.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function ConciergeNotes() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ on: boolean; notes: Note[]; runs: Run[]; maxChars: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [adding, setAdding] = useState<{ scope: Scope; text: string; todayKey: string } | null>(null);

  const load = () =>
    fetch("/api/admin/concierge-notes", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setMsg({ ok: false, text: "Couldn't load the notes." }));
  useEffect(() => {
    load();
  }, []);

  async function post(payload: Record<string, unknown>, done: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/concierge-notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Couldn't save.");
      await load();
      setMsg({ ok: true, text: typeof done === "string" ? done : "Saved." });
      return d;
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Couldn't save." });
      load(); // e.g. a failed review is still listed under "Last"
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function runNow() {
    const d = await post({ action: "run" }, "Review finished.");
    if (d) setMsg({ ok: true, text: `Review finished: ${d.added ?? 0} added, ${d.removed ?? 0} removed, ${d.kept ?? 0} kept${d.rejected ? `, ${d.rejected} rejected by the safety checks` : ""}.${d.summary ? ` ${d.summary}` : ""}` });
  }

  const last = data?.runs?.[0];
  const notes = data?.notes || [];

  return (
    <section className="admin-section cn">
      <button type="button" className="cn-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>
          <h2>Concierge notes</h2>
          <span className="cn-sub">
            {!data ? "Loading…" : !data.on ? "Off — switch on “Concierge learns from chats” in Settings → Feature switches" : `${notes.length} note${notes.length === 1 ? "" : "s"} in use`}
            {last ? ` · last review ${when(last.at)}${last.ok ? "" : " (didn't finish)"}` : data?.on ? " · first review tonight" : ""}
          </span>
        </span>
        <span className="cn-chev" aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>

      {open && data && (
        <div className="cn-body">
          <p className="field-hint" style={{ marginTop: 0 }}>
            Every night the Concierge reads the last week of chats, which of its cards you confirmed or dismissed, and what got ticked off on the Today list, then rewrites these notes. They take effect straight away. Notes are habits, never rules, and the safety rules always win. Each note is checked for personal details and rule-changing wording first. Edit or delete anything; <strong>Pin</strong> keeps a note exactly as it is.
          </p>
          <div className="cn-actions">
            <button type="button" className="esc-btn primary" onClick={runNow} disabled={busy || !data.on}>{busy ? "Working…" : "✦ Review chats now"}</button>
            {last && (
              <span className="cn-last">
                Last: {when(last.at)} · {last.ok ? `${last.chats ?? 0} chats, +${last.added ?? 0} / −${last.removed ?? 0}${last.costUsd ? ` · $${last.costUsd.toFixed(3)}` : ""}` : last.error || "didn't finish"}
              </span>
            )}
          </div>
          {msg && <div className={msg.ok ? "ap-ok" : "ap-bad"} style={{ marginTop: "0.5rem" }}>{msg.text}</div>}

          {SCOPES.map(([scope, label, hint]) => {
            const list = notes.filter((n) => n.scope === scope);
            return (
              <div key={scope} className="cn-group">
                <div className="cn-group-head">
                  <strong>{label}</strong> <span className="cn-count">{list.length}</span>
                  <span className="cn-hint">{hint}</span>
                  <button type="button" className="link-btn" onClick={() => setAdding({ scope, text: "", todayKey: "" })}>+ Add</button>
                </div>
                {list.length === 0 && <div className="cn-empty">No notes yet.</div>}
                {list.map((n) => (
                  <div key={n.id} className="cn-note">
                    {editing?.id === n.id ? (
                      <form
                        className="cn-edit"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (await post({ action: "edit", id: n.id, text: editing.text }, "Note saved.")) setEditing(null);
                        }}
                      >
                        <textarea value={editing.text} maxLength={data.maxChars} rows={2} onChange={(e) => setEditing({ id: n.id, text: e.target.value })} />
                        <span className="cn-edit-actions">
                          <button type="button" className="esc-btn" onClick={() => setEditing(null)}>Cancel</button>
                          <button type="submit" className="esc-btn primary" disabled={busy}>Save</button>
                        </span>
                      </form>
                    ) : (
                      <>
                        <div className="cn-text">
                          {n.todayKey && <span className="sub-tag">{n.todayKey}</span>} {n.text}
                        </div>
                        <div className="cn-meta">
                          {n.source === "ai" ? "Learned" : "Added by staff"} · {when(n.updatedAt)}
                          {n.pinned && <span className="cn-pin"> · 📌 pinned</span>}
                          <span className="cn-note-actions">
                            <button type="button" className="link-btn" onClick={() => setEditing({ id: n.id, text: n.text })}>Edit</button>
                            <button type="button" className="link-btn" disabled={busy} onClick={() => post({ action: "pin", id: n.id, pinned: !n.pinned }, n.pinned ? "Unpinned." : "Pinned — the review will keep it as is.")}>
                              {n.pinned ? "Unpin" : "Pin"}
                            </button>
                            <button type="button" className="link-btn cn-del" disabled={busy} onClick={() => confirm("Delete this note?") && post({ action: "delete", id: n.id }, "Note deleted.")}>Delete</button>
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                ))}
                {adding?.scope === scope && (
                  <form
                    className="cn-edit"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (await post({ action: "add", scope, text: adding.text, todayKey: adding.todayKey }, "Note added (pinned).")) setAdding(null);
                    }}
                  >
                    {scope === "today" && (
                      <input value={adding.todayKey} onChange={(e) => setAdding({ ...adding, todayKey: e.target.value })} placeholder="Today item, e.g. unpaid, lapsed, fulfil" required />
                    )}
                    <textarea value={adding.text} maxLength={data.maxChars} rows={2} onChange={(e) => setAdding({ ...adding, text: e.target.value })} placeholder="e.g. The fulfilment team prefers shipping cards grouped by pickup vs ship" required />
                    <span className="cn-edit-actions">
                      <button type="button" className="esc-btn" onClick={() => setAdding(null)}>Cancel</button>
                      <button type="submit" className="esc-btn primary" disabled={busy}>Add note</button>
                    </span>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
