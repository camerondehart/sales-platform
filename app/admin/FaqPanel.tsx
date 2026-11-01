"use client";

import { useEffect, useMemo, useState } from "react";
import { useAdminRefresh } from "./useAdminRefresh";
import type { AdminRefreshKey } from "@/lib/assistant/shared";

// Settings → FAQ page (switch `faq_page`). The business writes and approves
// every answer here; published ones show on /faq and the Concierge answers
// from them. Every change is in the Activity log.

type Item = { id: string; question: string; answer: string; category: string; published: boolean; order: number; updatedAt: number };
const blank = { id: "", question: "", answer: "", category: "", published: true };

export default function FaqPanel() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [form, setForm] = useState<typeof blank | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () =>
    fetch("/api/admin/faq", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setItems(d?.items || []))
      .catch(() => setItems([]));
  useAdminRefresh(["faq", "flags"] as AdminRefreshKey[], () => load());
  useEffect(() => {
    load();
  }, []);

  const categories = useMemo(() => Array.from(new Set((items || []).map((i) => i.category).filter(Boolean))), [items]);
  const live = (items || []).filter((i) => i.published).length;

  async function send(method: "POST" | "PUT" | "DELETE", body?: unknown, query = "") {
    setBusy(true);
    setMsg(null);
    const r = await fetch(`/api/admin/faq${query}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) setMsg({ ok: false, text: d.error || "That didn't save. Try again." });
    await load();
    return r.ok;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const { id, ...fields } = form;
    const ok = id ? await send("PUT", { id, ...fields }) : await send("POST", fields);
    if (ok) {
      setMsg({ ok: true, text: form.published ? "Saved. It's on the FAQ page and the Concierge now uses it." : "Saved as a draft (not on the page yet)." });
      setForm(null);
    }
  }

  return (
    <section className="admin-section faq-admin">
      <h2>FAQ page</h2>
      <div className="notice">
        Questions and answers for the public <a href="/faq" target="_blank" rel="noopener">FAQ page</a> ({live} published). The Concierge answers
        customers from the published ones. <strong>You write and approve every answer, including any dosing guidance</strong>: the Concierge only
        repeats dosing word-for-word from a published answer, never more. Blank line = new paragraph; start a line with &ldquo;- &rdquo; for a bullet.
      </div>

      {form ? (
        <form className="admin-form" onSubmit={save}>
          <div className="field full">
            <label>Question</label>
            <input value={form.question} maxLength={300} required onChange={(e) => setForm({ ...form, question: e.target.value })} placeholder="How long does shipping take?" />
          </div>
          <div className="field full">
            <label>Answer</label>
            <textarea rows={7} value={form.answer} maxLength={6000} required onChange={(e) => setForm({ ...form, answer: e.target.value })} />
          </div>
          <div className="field">
            <label>Topic (optional)</label>
            <input list="faq-topics" value={form.category} maxLength={60} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Ordering, Products, Pickup…" />
            <datalist id="faq-topics">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
          <div className="field">
            <label>
              <input type="checkbox" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} /> Published (on the page and used by the Concierge)
            </label>
          </div>
          <div className="full" style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
            <button type="submit" className="submit" disabled={busy} style={{ width: "auto" }}>{busy ? "Saving…" : form.id ? "Save changes" : "Add question"}</button>
            <button type="button" className="esc-btn" onClick={() => setForm(null)} disabled={busy}>Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" className="submit" style={{ width: "auto" }} onClick={() => { setMsg(null); setForm({ ...blank }); }}>+ Add a question</button>
      )}

      {msg && <div className={msg.ok ? "ap-ok" : "ap-bad"} style={{ marginTop: "0.7rem" }}>{msg.text}</div>}

      {items && items.length === 0 && !form && <p className="field-hint" style={{ marginTop: "1rem" }}>No questions yet. The page stays hidden until you publish one.</p>}
      {items && items.length > 0 && (
        <ul className="faq-admin-list">
          {items.map((it, i) => (
            <li key={it.id} className={it.published ? "" : "is-draft"}>
              <div className="faq-admin-main">
                <strong>{it.question}</strong>
                <small>
                  {it.category || "General"} · {it.published ? "Published" : "Draft"}
                </small>
              </div>
              <div className="faq-admin-actions">
                <button type="button" onClick={() => send("PUT", { id: it.id, move: "up" })} disabled={busy || i === 0} aria-label="Move up">↑</button>
                <button type="button" onClick={() => send("PUT", { id: it.id, move: "down" })} disabled={busy || i === items.length - 1} aria-label="Move down">↓</button>
                <button type="button" onClick={() => send("PUT", { id: it.id, published: !it.published })} disabled={busy}>{it.published ? "Unpublish" : "Publish"}</button>
                <button type="button" onClick={() => { setMsg(null); setForm({ id: it.id, question: it.question, answer: it.answer, category: it.category, published: it.published }); }} disabled={busy}>Edit</button>
                <button type="button" className="danger" onClick={() => confirm(`Delete “${it.question}”?`) && send("DELETE", undefined, `?id=${encodeURIComponent(it.id)}`)} disabled={busy}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
