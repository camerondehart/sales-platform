"use client";

import { useEffect, useMemo, useState } from "react";
import { EVT_ESCALATIONS } from "@/lib/assistant/shared";
import { brand } from "@/lib/brand";

// "Handed to the team": customer requests the assistant passed on.
// Staff can read the chat, reply by email, and mark each one resolved.

export type EscalationItem = {
  id: string;
  at: number;
  audience: string;
  name: string;
  email: string;
  topic: string;
  summary: string;
  emailed: boolean;
  status: "open" | "resolved";
  resolvedAt?: number;
  replies: Array<{ at: number; body: string; emailed: boolean }>;
  transcript: Array<{ role: "user" | "assistant"; content: string }>;
};

type Filter = "open" | "resolved" | "all";

const AUDIENCE_LABEL: Record<string, string> = { public: "Visitor", member: "Member", admin: "Staff" };

const when = (t: number) =>
  new Date(t).toLocaleString("en-US", {
    timeZone: brand.timezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

function ago(t: number): string {
  const m = Math.round((Date.now() - t) / 60_000);
  if (m < 60) return `${Math.max(1, m)} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hr ago`;
  return `${Math.round(h / 24)} days ago`;
}

export default function EscalationsList({ initial }: { initial: EscalationItem[] }) {
  const [items, setItems] = useState<EscalationItem[]>(initial);
  const [filter, setFilter] = useState<Filter>("open");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [showChat, setShowChat] = useState<Record<string, boolean>>({});
  const [replyOpen, setReplyOpen] = useState<Record<string, boolean>>({});
  // Cards you just acted on stay put (with their confirmation) until you switch filters.
  const [sticky, setSticky] = useState<Set<string>>(new Set());

  useEffect(() => setItems(initial), [initial]);

  const openCount = items.filter((e) => e.status === "open").length;
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(EVT_ESCALATIONS, { detail: openCount }));
  }, [openCount]);

  // Oldest first while working the open queue; newest first otherwise.
  const shown = useMemo(() => {
    const list = filter === "all" ? items : items.filter((e) => e.status === filter || sticky.has(e.id));
    return list.slice().sort((a, b) => (filter === "open" ? a.at - b.at : b.at - a.at));
  }, [items, filter, sticky]);

  async function act(e: EscalationItem, payload: { action: "reply" | "resolve" | "reopen"; body?: string; resolve?: boolean }) {
    setBusy(e.id);
    setSticky((st) => new Set(st).add(e.id));
    setNotes((n) => {
      const c = { ...n };
      delete c[e.id];
      return c;
    });
    try {
      const res = await fetch(`/api/admin/assistant/escalations/${encodeURIComponent(e.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || "Something went wrong. Try again.");
      if (d.escalation) {
        const saved = d.escalation as EscalationItem;
        setItems((list) =>
          list.map((x) => (x.id === e.id ? { ...x, ...saved, replies: saved.replies || [], transcript: saved.transcript || x.transcript } : x))
        );
      }
      if (payload.action === "reply") {
        setDrafts((m) => ({ ...m, [e.id]: "" }));
        setReplyOpen((m) => ({ ...m, [e.id]: false }));
      }
      const text =
        d.warning ||
        (payload.action === "reply"
          ? `Reply emailed to ${e.email}${payload.resolve ? " and marked resolved" : ""}.`
          : payload.action === "resolve"
          ? "Marked resolved."
          : "Reopened.");
      setNotes((n) => ({ ...n, [e.id]: { ok: !d.warning, text } }));
    } catch (err) {
      setNotes((n) => ({ ...n, [e.id]: { ok: false, text: err instanceof Error ? err.message : "Something went wrong." } }));
    }
    setBusy(null);
  }

  const counts = {
    open: openCount,
    resolved: items.length - openCount,
    all: items.length,
  };

  return (
    <section className="admin-section" id="handed-to-team">
      <h2>
        Handed to the team
        {openCount > 0 && <span className="badge" title="Waiting for a reply">{openCount}</span>}
      </h2>
      <p className="field-hint" style={{ marginTop: "-0.4rem", marginBottom: "0.9rem" }}>
        When the Concierge can’t solve something, it passes it here. Reply right from this page — it emails the customer,
        and their answer comes back to your inbox.
      </p>

      <div className="esc-filters" role="tablist" aria-label="Filter requests">
        {(["open", "resolved", "all"] as const).map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            className={`esc-filter${filter === f ? " active" : ""}`}
            onClick={() => {
              setFilter(f);
              setSticky(new Set());
            }}
          >
            {f === "open" ? "Waiting" : f === "resolved" ? "Resolved" : "All"}
            <span>{counts[f]}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="empty" style={{ padding: "1.5rem 0" }}>
          {filter === "open"
            ? items.length
              ? "All caught up — nothing waiting for a reply."
              : "Nothing yet. When the Concierge can’t solve something, it shows up here and in your inbox."
            : "Nothing here."}
        </div>
      ) : (
        <div className="esc-list">
          {shown.map((e) => {
            const first = e.name.trim().split(/\s+/)[0] || "them";
            const draft = drafts[e.id] || "";
            const isBusy = busy === e.id;
            const note = notes[e.id];
            const composing = e.status === "open" || replyOpen[e.id];
            return (
              <article key={e.id} className={`esc-card${e.status === "resolved" ? " is-resolved" : ""}`}>
                <header className="esc-head">
                  <div className="esc-who">
                    <div className="esc-name">
                      {e.name} <span className="sub-tag">{e.topic}</span>
                    </div>
                    <a className="esc-email" href={`mailto:${e.email}`}>{e.email}</a>
                  </div>
                  <div className="esc-meta">
                    <span className={`esc-status ${e.status}`}>{e.status === "open" ? "Waiting" : "Resolved"}</span>
                    <span title={when(e.at)}>{ago(e.at)} · {AUDIENCE_LABEL[e.audience] || e.audience}</span>
                  </div>
                </header>

                <p className="esc-summary">{e.summary}</p>
                {!e.emailed && <div className="esc-warn">⚠ The alert email to your inbox didn’t send — this page is the only copy.</div>}

                {e.transcript.length > 0 && (
                  <>
                    <button type="button" className="ap-linkbtn" onClick={() => setShowChat((m) => ({ ...m, [e.id]: !m[e.id] }))}>
                      {showChat[e.id] ? "Hide the conversation" : `Show the conversation (${e.transcript.length} messages)`}
                    </button>
                    {showChat[e.id] && (
                      <div className="esc-chat">
                        {e.transcript.map((m, i) => (
                          <div key={i} className={`esc-bubble ${m.role}`}>
                            <span>{m.role === "user" ? e.name.split(/\s+/)[0] || "Customer" : "Concierge"}</span>
                            {m.content}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {e.replies.length > 0 && (
                  <div className="esc-replies">
                    {e.replies.map((r, i) => (
                      <div key={i} className="esc-reply">
                        <div className="esc-reply-meta">You replied · {when(r.at)}</div>
                        <div className="esc-reply-body">{r.body}</div>
                      </div>
                    ))}
                  </div>
                )}

                {composing ? (
                  <div className="esc-compose">
                    <textarea
                      rows={4}
                      maxLength={5000}
                      placeholder={`Write your reply to ${first}… (we add “Hi ${first},” and a sign-off for you)`}
                      value={draft}
                      disabled={isBusy}
                      onChange={(ev) => setDrafts((m) => ({ ...m, [e.id]: ev.target.value }))}
                    />
                    <div className="esc-actions">
                      <button
                        type="button"
                        className="esc-btn primary"
                        disabled={isBusy || !draft.trim()}
                        onClick={() => act(e, { action: "reply", body: draft, resolve: true })}
                      >
                        {isBusy ? "Sending…" : "Send & resolve"}
                      </button>
                      <button
                        type="button"
                        className="esc-btn"
                        disabled={isBusy || !draft.trim()}
                        onClick={() => act(e, { action: "reply", body: draft })}
                      >
                        Send, keep open
                      </button>
                      {e.status === "open" ? (
                        <button type="button" className="ap-linkbtn esc-quiet" disabled={isBusy} onClick={() => act(e, { action: "resolve" })}>
                          Resolve without replying
                        </button>
                      ) : (
                        <button type="button" className="ap-linkbtn esc-quiet" disabled={isBusy} onClick={() => setReplyOpen((m) => ({ ...m, [e.id]: false }))}>
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="esc-actions">
                    <span className="esc-resolved-note">✓ Resolved{e.resolvedAt ? ` ${when(e.resolvedAt)}` : ""}</span>
                    <button type="button" className="esc-btn" disabled={isBusy} onClick={() => setReplyOpen((m) => ({ ...m, [e.id]: true }))}>
                      Reply again
                    </button>
                    <button type="button" className="ap-linkbtn esc-quiet" disabled={isBusy} onClick={() => act(e, { action: "reopen" })}>
                      Reopen
                    </button>
                  </div>
                )}

                {note && <div className={note.ok ? "ap-ok esc-note" : "ap-bad esc-note"} role="status">{note.text}</div>}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
