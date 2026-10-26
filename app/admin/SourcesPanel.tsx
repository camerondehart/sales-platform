"use client";

import { useEffect, useState } from "react";
import { useAdminRefresh } from "./useAdminRefresh";
import type { AdminRefreshKey } from "@/lib/assistant/shared";

// Assistant tab → "Learn from web pages". Adds to (never replaces) the tone
// and notes above.

type Row = { id: string; url: string; title: string; chars: number; preview: string; fetchedAt: number; ok: boolean; error?: string };

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60_000);
  if (m < 60) return `${Math.max(1, m)} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} hr ago` : `${Math.round(h / 24)} days ago`;
};

export default function SourcesPanel() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () =>
    fetch("/api/admin/assistant/sources", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setRows(d.sources || []))
      .catch(() => setRows([]));
  useAdminRefresh(["sources"] as AdminRefreshKey[], () => load());
  useEffect(() => {
    load();
  }, []);

  async function post(body: Record<string, unknown>, done: (d: Record<string, number>) => string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/assistant/sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "Couldn't do that.");
      await load();
      setMsg({ ok: true, text: done(d) });
      return true;
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Couldn't do that." });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const total = (rows || []).reduce((n, r) => n + r.chars, 0);

  return (
    <div className="field full src">
      <label>Learn from web pages</label>
      <div className="field-hint" style={{ marginTop: 0 }}>
        Paste a page (an FAQ, a product page) or a <code>sitemap.xml</code>. The Concierge reads the page text and uses it
        alongside your notes above; if they disagree, your notes win. Refresh after you change a page.
      </div>
      <form
        className="src-add"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await post({ action: "add", url }, (d) => (d.added > 1 ? `Added ${d.added} pages.` : "Added."))) setUrl("");
        }}
      >
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.example.com/pages/faq" required />
        <button type="submit" className="esc-btn primary" disabled={busy || !url.trim()}>{busy ? "Reading…" : "Add page"}</button>
        {rows && rows.length > 0 && (
          <button type="button" className="esc-btn" disabled={busy} onClick={() => post({ action: "refresh" }, (d) => `Refreshed ${d.refreshed} page${d.refreshed === 1 ? "" : "s"}${d.failed ? `, ${d.failed} couldn't be read` : ""}.`)}>
            Refresh all
          </button>
        )}
      </form>
      {rows && rows.length > 0 && (
        <ul className="src-list">
          {rows.map((r) => (
            <li key={r.id} className={r.ok ? "" : "bad"}>
              <div className="src-main">
                <strong>{r.title}</strong>
                <a href={r.url} target="_blank" rel="noreferrer">{r.url}</a>
                <span className="src-meta">
                  {r.ok ? `${r.chars.toLocaleString()} characters · refreshed ${ago(r.fetchedAt)}` : `⚠ ${r.error || "Couldn't read it"} · last try ${ago(r.fetchedAt)}`}
                </span>
              </div>
              <button type="button" className="ap-linkbtn esc-quiet" disabled={busy} onClick={() => post({ action: "remove", id: r.id }, () => "Removed.")}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      {rows && rows.length > 0 && <div className="field-hint">{total.toLocaleString()} characters in total; the first ~24,000 are used in each chat.</div>}
      {msg && <div className={msg.ok ? "ap-ok" : "ap-bad"}>{msg.text}</div>}
    </div>
  );
}
