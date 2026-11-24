"use client";

import { useState } from "react";
import { EVT_ASK } from "@/lib/assistant/shared";
import { brand } from "@/lib/brand";

// Today panel → "Manager's take": the site manager review's briefing
// (lib/assistant/managerReview.ts). Calm by default: the headline and a few
// counts; open it for one section at a time. Suggestions ask the staff
// Concierge, which still prepares cards you confirm. Undo puts back today's
// card moves. Run now asks the manager model again.

export type Manager = {
  at: number;
  ok: boolean;
  error?: string;
  model?: string;
  wanted?: string;
  primaryError?: string;
  headline?: string;
  wins?: string[];
  concerns?: string[];
  insights?: string[];
  missed?: string[];
  actions?: Array<{ title: string; ask: string }>;
  tweaks?: Array<{ id: string; priority?: string; hide?: boolean; why: string; task?: string }>;
  undone?: boolean;
  today?: boolean;
  logEntries?: number;
  briefed?: number;
};

type Tab = "missed" | "concerns" | "insights" | "wins";
const TABS: Array<[Tab, string]> = [
  ["missed", "Missed"],
  ["concerns", "Watch"],
  ["insights", "Insights"],
  ["wins", "Going well"],
];

const short = (id?: string) => (id || "").split("/").pop() || "";
function ago(t: number): string {
  const m = Math.round((Date.now() - t) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  return new Date(t).toLocaleString("en-US", { timeZone: brand.timezone, weekday: "short", hour: "numeric", minute: "2-digit" });
}

export default function ManagerTake({ manager, onChanged }: { manager: Manager | null | undefined; onChanged: () => void }) {
  const [busy, setBusy] = useState<"" | "run" | "undo">("");
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab | null>(null);
  const [showMoves, setShowMoves] = useState(false);

  const post = async (action: "run" | "undo") => {
    setBusy(action);
    setMsg(action === "run" ? "Looking over the whole site… up to a minute." : "");
    try {
      const r = await fetch("/api/admin/manager-review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d) {
        throw new Error(
          d?.error ||
            (r.status === 504 || r.status === 524 ? "The review ran out of time before the model answered. Try a faster model, or press Run now again." : `The server stopped the review (error ${r.status}). Try again in a minute.`)
        );
      }
      setMsg(action === "undo" ? "Today's list is back as it was." : "");
      onChanged();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "That didn't work.");
    }
    setBusy("");
  };

  const m = manager;
  const lists: Record<Tab, string[]> = { missed: m?.missed || [], concerns: m?.concerns || [], insights: m?.insights || [], wins: m?.wins || [] };
  const tabs = TABS.filter(([k]) => lists[k].length > 0);
  const active: Tab | undefined = tab && lists[tab].length ? tab : tabs[0]?.[0];
  const tweaks = m?.today && !m.undone ? m.tweaks || [] : [];
  const fellBack = !!(m?.ok && m.wanted && m.model && short(m.wanted) !== short(m.model));

  return (
    <div className={`mt${open ? " is-open" : ""}`} aria-label="Manager's take">
      <div className="mt-head">
        <span className="mt-mark" aria-hidden="true">✦</span>
        <button type="button" className="mt-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="mt-kicker">
            Manager&apos;s take{m?.ok ? <span className="mt-when"> · {ago(m.at)}</span> : null}
          </span>
          <span className="mt-headline">
            {m?.ok ? m.headline || "Today's briefing" : m?.error ? "The last review didn't finish." : "No review yet."}
          </span>
          {!open && m?.ok && tabs.length > 0 && (
            <span className="mt-counts">
              {tabs.map(([k, label]) => (
                <span key={k} className={`mt-count mt-c-${k}`}>
                  {lists[k].length} {k === "missed" ? "missed" : k === "concerns" ? "to watch" : k === "wins" ? "going well" : lists[k].length === 1 ? "insight" : "insights"}
                </span>
              ))}
              <span className="mt-more">Details ▾</span>
            </span>
          )}
        </button>
        <button type="button" className="mt-run" onClick={() => post("run")} disabled={!!busy} title="Ask the manager to look over everything again" aria-label="Run now">
          <span className={busy === "run" ? "tb-spin" : ""}>↻</span>
          <span className="mt-run-text">{busy === "run" ? "Reviewing" : "Run now"}</span>
        </button>
      </div>

      {msg && <div className="mt-msg">{msg}</div>}
      {!m?.ok && m?.error && <div className="mt-msg mt-err">{m.error}</div>}

      {open && m?.ok && (
        <div className="mt-body">
          {tabs.length > 0 && active && (
            <>
              <div className="mt-tabs" role="tablist">
                {tabs.map(([k, label]) => (
                  <button key={k} type="button" role="tab" aria-selected={active === k} className={`mt-tab mt-c-${k}${active === k ? " on" : ""}`} onClick={() => setTab(k)}>
                    {label} <b>{lists[k].length}</b>
                  </button>
                ))}
              </div>
              <ul className={`mt-items mt-c-${active}`}>
                {lists[active].map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </>
          )}

          {m.actions && m.actions.length > 0 && (
            <div className="mt-suggest">
              <div className="mt-sub">Suggested next steps</div>
              {m.actions.map((a, i) => (
                <button key={i} type="button" className="mt-action" title="The Concierge prepares cards — nothing happens until you confirm each one" onClick={() => window.dispatchEvent(new CustomEvent(EVT_ASK, { detail: { question: a.ask } }))}>
                  <span className="mt-action-dot" aria-hidden="true">✦</span>
                  <span className="mt-action-text">{a.title}</span>
                  <span className="mt-action-go" aria-hidden="true">→</span>
                </button>
              ))}
            </div>
          )}

          {tweaks.length > 0 && (
            <div className="mt-moves">
              <span>
                Rearranged {tweaks.length} card{tweaks.length === 1 ? "" : "s"} on today&apos;s list.
              </span>
              <button type="button" className="mt-link" onClick={() => setShowMoves((v) => !v)} aria-expanded={showMoves}>
                {showMoves ? "Hide" : "See why"}
              </button>
              <button type="button" className="mt-link" onClick={() => post("undo")} disabled={!!busy}>
                {busy === "undo" ? "Undoing…" : "Undo"}
              </button>
              {showMoves && (
                <ul>
                  {tweaks.map((t, i) => (
                    <li key={i}>
                      <strong>{t.task || t.id}</strong> {t.hide ? "hidden for today" : `moved to “${t.priority}”`}
                      {t.why ? <span>. {t.why}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="mt-foot">
            {short(m.model)}
            {m.logEntries !== undefined ? ` · read ${m.logEntries} Activity log entries` : ""}
            {m.briefed ? ` · briefed ${m.briefed} site request${m.briefed === 1 ? "" : "s"}` : ""}
          </div>
          {fellBack && (
            <div className="mt-warn-note">
              {short(m.wanted)} didn&apos;t write this{m.primaryError ? ` (${m.primaryError})` : ""}, so your backup model {short(m.model)} did. Batch models may not answer live requests; pick a regular model if this keeps happening.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
