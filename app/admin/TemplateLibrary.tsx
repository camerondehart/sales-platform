"use client";

import { useEffect, useMemo, useState } from "react";
import { useAdminRefresh } from "./useAdminRefresh";
import { EVT_ASK, type AdminRefreshKey } from "@/lib/assistant/shared";
import EmailPreview from "@/app/components/EmailPreview";

// Marketing → Templates. Pick a starting point, load it into the composer,
// save the current draft as a template, duplicate or archive.
// Hidden entirely when the "Email template library" switch is off.

type Template = {
  id: string;
  name: string;
  category: string;
  subject: string;
  body: string;
  archived?: boolean;
  starter?: boolean;
  edited?: boolean;
  updatedAt: number;
};

const CATS: Array<[string, string]> = [
  ["all", "All"],
  ["fall", "Fall"],
  ["holiday", "Holiday"],
  ["winter", "Winter"],
  ["spring", "Spring"],
  ["summer", "Summer"],
  ["promo", "Promo"],
  ["event", "Event"],
  ["news", "News"],
  ["custom", "Saved"],
  ["blank", "Blank"],
];

export default function TemplateLibrary({
  subject,
  body,
  onUse,
}: {
  subject: string;
  body: string;
  onUse: (subject: string, body: string) => void;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [items, setItems] = useState<Template[]>([]);
  const [cat, setCat] = useState("all");
  const [showArchived, setShowArchived] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saveName, setSaveName] = useState("");
  const [saveCat, setSaveCat] = useState("custom");
  const [loadedId, setLoadedId] = useState<string | null>(null);
  // "Generate" box: describe an idea, the Concierge drafts it as a Save-template card.
  const [idea, setIdea] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [hiddenCount, setHiddenCount] = useState(0);

  const load = () =>
    fetch("/api/admin/templates", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setItems(d.templates || []);
        setHiddenCount(Number(d.hiddenStarters) || 0);
      })
      .catch(() => setMsg({ ok: false, text: "Couldn't load templates." }));

  useAdminRefresh(["templates"] as AdminRefreshKey[], () => load());
  useEffect(() => {
    fetch("/api/admin/flags", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const on = !!d?.flags?.find((f: { key: string; on: boolean }) => f.key === "campaigns")?.on;
        setEnabled(on);
        if (on) load();
      })
      .catch(() => setEnabled(false));
  }, []);

  const shown = useMemo(
    () =>
      items.filter((t) => {
        if (!!t.archived !== showArchived) return false;
        if (cat === "all") return true;
        if (cat === "custom") return !t.starter;
        return t.category === cat;
      }),
    [items, cat, showArchived]
  );

  async function post(payload: Record<string, unknown>, done: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "Couldn't save.");
      await load();
      setMsg({ ok: true, text: done });
      return d.template as Template;
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Couldn't save." });
      return null;
    } finally {
      setBusy(false);
    }
  }

  function use(t: Template) {
    if ((subject.trim() || body.trim()) && !confirm("Replace what's in the composer with this template?")) return;
    onUse(t.subject, t.body);
    setLoadedId(t.starter ? null : t.id);
    setSaveName(t.starter ? "" : t.name);
    setSaveCat(t.starter ? t.category : t.category);
    setMsg({ ok: true, text: `Loaded “${t.name}” into the composer below. Fill in anything in [brackets] before sending.` });
    setTimeout(() => document.getElementById("campaign-composer")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }

  async function refresh() {
    setRefreshing(true);
    setMsg(null);
    await load();
    setRefreshing(false);
    setMsg({ ok: true, text: "Templates refreshed." });
    setTimeout(() => setMsg((m) => (m?.text === "Templates refreshed." ? null : m)), 2500);
  }

  // Ask the Concierge (same as the Today buttons): it writes the template and
  // shows a "Save template" card with a preview — nothing saves until confirmed.
  function generate(e: React.FormEvent) {
    e.preventDefault();
    const t = idea.trim().slice(0, 140);
    const question = t
      ? `Write a new email template for: "${t}". Our house style, a clear subject, a [Shop now] button link. Prepare it with propose_template (best category) so I can preview and save it.`
      : "Suggest 3 fresh email template ideas for this time of year and our shop. Prepare each with propose_template (best category) so I can preview and save the ones I like.";
    window.dispatchEvent(new CustomEvent(EVT_ASK, { detail: { question } }));
    setIdea("");
    setMsg({ ok: true, text: "Asked the Concierge — the draft opens in the chat with a preview and a Save template button." });
  }

  // "✦ Redo with AI" on a card: the Concierge rewrites that template and shows a
  // Save template card (with preview) that updates it in place.
  function redo(t: Template) {
    const question = `Redo template ${t.id} ("${t.name.slice(0, 40)}") with fresh wording: same purpose and category, our house style, keep any [bracket] placeholders. Read it with list_templates first, then prepare propose_template with template_id ${t.id} so I can preview and save it.`;
    window.dispatchEvent(new CustomEvent(EVT_ASK, { detail: { question } }));
    setMsg({ ok: true, text: `Asked the Concierge to redo “${t.name}” — check the chat for the new version and its preview.` });
  }

  async function remove(t: Template) {
    const q = t.starter
      ? `Remove the built-in template “${t.name}”? You can bring built-ins back any time.`
      : `Delete “${t.name}” for good? This can't be undone from here.`;
    if (!confirm(q)) return;
    const gone = await post({ action: "delete", id: t.id }, t.starter ? `Removed “${t.name}”.` : `Deleted “${t.name}”.`);
    if (gone && loadedId === t.id) setLoadedId(null);
  }

  if (!enabled) return null;

  return (
    <div className="tpl">
      <button type="button" className="tpl-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? "▼" : "▶"} Templates ({items.filter((t) => !t.archived).length})
      </button>
      {open && (
        <>
          <form className="tpl-generate" onSubmit={generate}>
            <input
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="Idea for a new template, e.g. “cozy fall restock, 10% off this weekend” — or leave empty for suggestions"
              maxLength={140}
              aria-label="Idea for a new template"
            />
            <button type="submit" className="esc-btn primary">{idea.trim() ? "✦ Generate" : "✦ Suggest ideas"}</button>
            <button type="button" className="esc-btn" onClick={refresh} disabled={refreshing} title="Reload the template list">
              {refreshing ? "Refreshing…" : "↻ Refresh"}
            </button>
          </form>
          <div className="esc-filters" style={{ marginTop: "0.75rem" }}>
            {CATS.map(([k, l]) => (
              <button key={k} type="button" className={`esc-filter${cat === k ? " active" : ""}`} onClick={() => setCat(k)}>
                {l}
              </button>
            ))}
            <label className="al-check" style={{ marginLeft: "auto" }}>
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Archived
            </label>
          </div>
          {hiddenCount > 0 && !showArchived && (
            <button type="button" className="ap-linkbtn esc-quiet tpl-bringback" onClick={() => post({ action: "restore_starters" }, "Built-in templates are back.")} disabled={busy}>
              Bring back {hiddenCount} removed built-in template{hiddenCount === 1 ? "" : "s"}
            </button>
          )}
          {shown.length === 0 ? (
            <div className="empty" style={{ padding: "0.75rem 0" }}>{showArchived ? "Nothing archived." : "No templates here yet."}</div>
          ) : (
            <div className="tpl-grid">
              {shown.map((t) => (
                <div key={t.id} className="tpl-card">
                  <div className="tpl-top">
                    <strong>{t.name}</strong>
                    <span className="sub-tag">{t.starter ? `Starter${t.edited ? " (edited)" : ""} · ${t.category}` : t.category}</span>
                  </div>
                  <div className="tpl-subject">{t.subject || <em>No subject yet</em>}</div>
                  <div className="tpl-preview">{t.body.replace(/^#\s*/gm, "").split("\n").filter(Boolean).slice(0, 2).join(" · ")}</div>
                  <EmailPreview subject={t.subject} body={t.body} />
                  <div className="tpl-actions">
                    <button type="button" className="esc-btn primary" onClick={() => use(t)} disabled={busy}>Use</button>
                    <button type="button" className="esc-btn" onClick={() => post({ action: "duplicate", id: t.id }, `Copied “${t.name}”. Find it under Saved.`)} disabled={busy}>
                      Duplicate
                    </button>
                    {!t.archived && (
                      <button type="button" className="esc-btn tpl-redo" onClick={() => redo(t)} disabled={busy} title="The Concierge rewrites this template; you preview it and confirm before it's saved">
                        ✦ Redo with AI
                      </button>
                    )}
                    {!t.starter && (
                      <button
                        type="button"
                        className="ap-linkbtn esc-quiet"
                        onClick={() => post({ action: t.archived ? "unarchive" : "archive", id: t.id }, t.archived ? "Restored." : "Archived.")}
                        disabled={busy}
                      >
                        {t.archived ? "Restore" : "Archive"}
                      </button>
                    )}
                    {t.starter && t.edited && (
                      <button
                        type="button"
                        className="ap-linkbtn esc-quiet"
                        onClick={() => confirm(`Put “${t.name}” back to its original wording?`) && post({ action: "reset", id: t.id }, `“${t.name}” is back to the original.`)}
                        disabled={busy}
                      >
                        Reset
                      </button>
                    )}
                    <button type="button" className="ap-linkbtn esc-quiet tpl-delete" onClick={() => remove(t)} disabled={busy}>
                      {t.starter ? "Remove" : "Delete"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <form
            className="tpl-save"
            onSubmit={async (e) => {
              e.preventDefault();
              const t = await post(
                { action: "save", id: loadedId || undefined, name: saveName, category: saveCat, subject, body },
                loadedId ? "Template updated." : "Saved as a new template."
              );
              if (t) setLoadedId(t.id);
            }}
          >
            <span className="tpl-save-label">Save what's in the composer as a template:</span>
            <input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Template name" required maxLength={80} />
            <select value={saveCat} onChange={(e) => setSaveCat(e.target.value)} aria-label="Category">
              {CATS.filter(([k]) => k !== "all").map(([k, l]) => (
                <option key={k} value={k}>{k === "custom" ? "Other" : l}</option>
              ))}
            </select>
            <button type="submit" className="esc-btn" disabled={busy || !body.trim()}>
              {loadedId ? "Update template" : "Save template"}
            </button>
            {loadedId && (
              <button type="button" className="ap-linkbtn esc-quiet" onClick={() => setLoadedId(null)}>
                Save as new instead
              </button>
            )}
          </form>
        </>
      )}
      {msg && <div className={msg.ok ? "ap-ok" : "ap-bad"} style={{ marginTop: "0.5rem" }}>{msg.text}</div>}
    </div>
  );
}
