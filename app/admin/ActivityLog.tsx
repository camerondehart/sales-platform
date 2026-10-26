"use client";

import { useEffect, useState } from "react";
import { useAdminRefresh } from "./useAdminRefresh";
import type { AdminRefreshKey } from "@/lib/assistant/shared";
import { brand } from "@/lib/brand";

// Settings → Activity log: every admin change, who/what made it, and whether
// it worked. Changes approved from a Concierge card are marked "Concierge".

type Entry = {
  id: string;
  at: number;
  action: string;
  actor: string;
  actorType: string;
  source: "human" | "ai" | "system";
  targetType?: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
  ok: boolean;
  status?: number;
  note?: string;
  ip?: string;
  userAgent?: string;
  proposal?: string;
};

const AREAS: Array<[string, string]> = [
  ["", "Everything"],
  ["order", "Orders"],
  ["member", "Members"],
  ["product", "Products"],
  ["discount", "Discount codes"],
  ["campaign", "Emails & campaigns"],
  ["event", "Events"],
  ["settings", "Settings & banner"],
  ["flag", "Feature switches"],
  ["assistant", "Assistant"],
  ["job", "Scheduled jobs"],
];

const when = (t: number) =>
  new Date(t).toLocaleString("en-US", { timeZone: brand.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const pretty = (a: string) => a.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export default function ActivityLog({ fold = true }: { fold?: boolean }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState("");
  const [area, setArea] = useState("");
  const [source, setSource] = useState("");
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState("");
  const [months, setMonths] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Folded away until opened (it's long); 30 rows a page.
  const [expanded, setExpanded] = useState(!fold);
  const [page, setPage] = useState(0);
  const PAGE = 30;

  async function load() {
    setLoading(true);
    setError("");
    const p = new URLSearchParams({ months: String(months), limit: "300" });
    if (source) p.set("source", source);
    if (failed) p.set("failed", "1");
    if (q.trim()) p.set("q", q.trim());
    try {
      const r = await fetch(`/api/admin/audit?${p}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setEntries(d.entries || []);
    } catch {
      setError("Couldn't load the activity log. Try again.");
    }
    setLoading(false);
  }

  useAdminRefresh(["users","orders","products","discounts","settings","banner","events","subscribers","bundles","campaigns","templates","flags","staff","reminders","assistant","sources","escalations"] as AdminRefreshKey[], () => expanded && load());
  useEffect(() => {
    if (expanded) load();
    setPage(0);
  }, [source, failed, months, expanded]);
  useEffect(() => setPage(0), [area]);

  // Area filter is applied here so switching areas is instant.
  const shown = (entries || []).filter((e) => {
    if (!area) return true;
    if (area === "settings") return e.targetType === "settings" || e.targetType === "banner";
    if (area === "campaign") return e.targetType === "campaign" || e.action.endsWith("email_sent") || e.targetType === "subscriber";
    if (area === "event") return e.targetType === "event" || e.targetType === "registration";
    if (area === "assistant") return e.targetType === "assistant" || e.targetType === "escalation" || e.action.startsWith("assistant.");
    return e.targetType === area;
  });

  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const safePage = Math.min(page, pages - 1);
  const pageRows = shown.slice(safePage * PAGE, (safePage + 1) * PAGE);

  return (
    <section className="admin-section">
      {fold ? (
        <button type="button" className="al-toggle" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          <h2 style={{ margin: 0 }}>Activity log</h2>
          <span className="al-toggle-hint">{expanded ? "Hide ▴" : "Show ▾"}</span>
        </button>
      ) : (
        <h2>Activity log</h2>
      )}
      {!expanded ? (
        <p className="field-hint" style={{ margin: "0.4rem 0 0" }}>Every change made in the dashboard, with who did it and what changed. Open it to search or filter.</p>
      ) : (
      <>
      <p className="field-hint" style={{ marginTop: "0.4rem", marginBottom: "0.9rem" }}>
        Every change made in the dashboard, newest first. <strong>Concierge</strong> means the assistant proposed it and someone signed in pressed the button.
      </p>
      <div className="al-filters">
        <select value={area} onChange={(e) => setArea(e.target.value)} aria-label="Area">
          {AREAS.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Made by">
          <option value="">Anyone</option>
          <option value="human">Staff</option>
          <option value="ai">Concierge</option>
          <option value="system">Scheduled jobs</option>
        </select>
        <select value={months} onChange={(e) => setMonths(Number(e.target.value))} aria-label="Period">
          <option value={1}>This month</option>
          <option value={3}>Last 3 months</option>
          <option value={6}>Last 6 months</option>
        </select>
        <label className="al-check">
          <input type="checkbox" checked={failed} onChange={(e) => setFailed(e.target.checked)} /> Failed only
        </label>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
          className="al-search"
        >
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search (email, order ref, product…)" />
          <button type="submit" className="esc-btn" disabled={loading}>{loading ? "…" : "Search"}</button>
        </form>
      </div>

      {error && <div className="ap-bad">{error}</div>}
      {!entries && !error && <div className="empty" style={{ padding: "1rem 0" }}>Loading…</div>}
      {entries && shown.length === 0 && <div className="empty" style={{ padding: "1rem 0" }}>Nothing matches.</div>}
      {shown.length > 0 && (
        <div className="al-list">
          {pageRows.map((e) => (
            <div key={e.id} className={`al-row${e.ok ? "" : " is-failed"}`}>
              <button type="button" className="al-main" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
                <span className="al-when">{when(e.at)}</span>
                <span className="al-what">
                  {pretty(e.action)}
                  {e.targetId ? <span className="al-target"> · {e.targetId}</span> : null}
                </span>
                <span className={`al-who al-${e.source}`}>{e.source === "ai" ? "Concierge" : e.source === "system" ? "Scheduled" : "Staff"}</span>
                <span className={`al-ok${e.ok ? "" : " bad"}`}>{e.ok ? "✓" : "✕ Failed"}</span>
              </button>
              {open === e.id && (
                <div className="al-detail">
                  {e.note && <div><strong>Note:</strong> {e.note}</div>}
                  {e.before !== undefined && (
                    <div><strong>Before:</strong> <code>{JSON.stringify(e.before)}</code></div>
                  )}
                  {e.after !== undefined && (
                    <div><strong>{e.ok ? "Change" : "Attempted"}:</strong> <code>{JSON.stringify(e.after)}</code></div>
                  )}
                  <div className="al-meta">
                    {e.actor}
                    {e.proposal ? ` · approved a “${e.proposal.replace(/_/g, " ")}” card` : ""}
                    {e.status ? ` · HTTP ${e.status}` : ""}
                    {e.ip ? ` · ${e.ip}` : ""}
                    {e.userAgent ? ` · ${e.userAgent.slice(0, 80)}` : ""}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {shown.length > PAGE && (
        <div className="al-pager">
          <button type="button" className="esc-btn" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>← Newer</button>
          <span>
            {safePage * PAGE + 1}–{Math.min((safePage + 1) * PAGE, shown.length)} of {shown.length}
          </span>
          <button type="button" className="esc-btn" disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)}>Older →</button>
        </div>
      )}
      </>
      )}
    </section>
  );
}
