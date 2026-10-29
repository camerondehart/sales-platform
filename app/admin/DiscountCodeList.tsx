"use client";

import { useEffect, useMemo, useState } from "react";

// Marketing → Discount codes list. Codes file themselves by state, worked out
// on the fly (nothing about a code is changed):
//   Live   — switched on, not past its last day, not used up
//   Inactive — switched off by staff (Deactivate)
//   Ended  — past its last day, or every allowed use taken (the archive)
// Search by code or label, 10 at a time with "Show more".

type Code = {
  id: string;
  code: string;
  type: "percentage" | "fixed";
  value: number;
  label?: string;
  expiresAt?: number;
  maxUses?: number;
  minOrderAmount?: number;
  publicShop?: boolean;
  active: boolean;
  uses: number;
  usedBy?: Array<{ amount?: number }>;
  createdAt?: number;
};

type State = "live" | "inactive" | "ended";
type Filter = State | "all";

const PAGE = 10;
const SOON_MS = 7 * 86_400_000;
const FILTER_KEY = "fp_dc_filter";

export function codeState(d: Code, now = Date.now()): State {
  if ((d.expiresAt && d.expiresAt < now) || (d.maxUses && d.uses >= d.maxUses)) return "ended";
  return d.active ? "live" : "inactive";
}

export default function DiscountCodeList({
  discounts,
  onToggle,
  onTogglePublic,
  onDelete,
  formatDate,
}: {
  discounts: Code[];
  onToggle: (id: string, active: boolean) => void;
  /** Whether a code also works in the public shop. */
  onTogglePublic?: (id: string, publicShop: boolean) => void;
  onDelete: (id: string, code: string) => void;
  formatDate: (t: number) => string;
}) {
  const [filter, setFilter] = useState<Filter>("live");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const now = Date.now();

  useEffect(() => {
    try {
      const f = localStorage.getItem(FILTER_KEY);
      if (f === "live" || f === "inactive" || f === "ended" || f === "all") setFilter(f);
    } catch {}
  }, []);
  const pick = (f: Filter) => {
    setFilter(f);
    setShown(PAGE);
    try { localStorage.setItem(FILTER_KEY, f); } catch {}
  };

  const counts = useMemo(() => {
    const c = { live: 0, inactive: 0, ended: 0, all: discounts.length };
    for (const d of discounts) c[codeState(d, now)]++;
    return c;
  }, [discounts, now]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const hits = discounts.filter((d) => {
      if (filter !== "all" && codeState(d, now) !== filter) return false;
      if (!needle) return true;
      return d.code.toLowerCase().includes(needle) || (d.label || "").toLowerCase().includes(needle);
    });
    // In Live, codes ending within a week come first so the warning is never on a later page.
    if (filter !== "live") return hits;
    const soon = (d: Code) => (d.expiresAt && d.expiresAt - now < SOON_MS ? d.expiresAt : Infinity);
    return [...hits].sort((x, y) => soon(x) - soon(y));
  }, [discounts, filter, q, now]);

  if (discounts.length === 0) return null;
  const page = list.slice(0, shown);
  const searching = q.trim().length > 0;

  return (
    <div className="dc-list">
      <div className="dc-toolbar">
        <div className="esc-filters" role="tablist" aria-label="Which codes">
          {(["live", "inactive", "ended", "all"] as const).map((f) => (
            <button key={f} type="button" role="tab" aria-selected={filter === f} className={`esc-filter${filter === f ? " active" : ""}`} onClick={() => pick(f)}>
              {f === "live" ? "Live" : f === "inactive" ? "Inactive" : f === "ended" ? "Ended" : "All"} <span>{counts[f]}</span>
            </button>
          ))}
        </div>
        <input
          id="dc-search"
          className="dc-search"
          type="search"
          value={q}
          onChange={(e) => { setQ(e.target.value); setShown(PAGE); }}
          placeholder="Search code or label…"
          aria-label="Search discount codes"
        />
      </div>
      {filter === "ended" && !searching && (
        <p className="field-hint" style={{ margin: "0 0 0.6rem" }}>Codes past their last day or with every use taken file here automatically. They no longer work at checkout; their history stays.</p>
      )}

      {list.length === 0 ? (
        <div className="empty" style={{ padding: "1.4rem 0" }}>
          {searching ? `No ${filter === "all" ? "" : filter + " "}codes match “${q.trim()}”.` : filter === "live" ? "No live codes right now." : filter === "inactive" ? "No inactive codes." : filter === "ended" ? "Nothing has ended yet." : "No codes yet."}
          {searching && filter !== "all" && (
            <> <button type="button" className="ap-linkbtn" onClick={() => pick("all")}>Search all codes</button></>
          )}
        </div>
      ) : (
        <div className="admin-list">
          {page.map((d) => {
            const st = codeState(d, now);
            const revenue = (d.usedBy || []).reduce((n, u) => n + (u.amount || 0), 0);
            const endsSoon = st === "live" && d.expiresAt && d.expiresAt - now < SOON_MS;
            const daysLeft = d.expiresAt ? Math.max(0, Math.ceil((d.expiresAt - now) / 86_400_000)) : 0;
            const usedUp = d.maxUses ? d.uses >= d.maxUses : false;
            return (
              <div key={d.id} className={`user-row dc-row is-${st}`}>
                <div className="user-main">
                  <div className="name dc-name">
                    <span className="dc-code">{d.code}</span>
                    <span className="dc-value">{d.type === "percentage" ? `${d.value}% off` : `$${d.value} off`}</span>
                    {st === "inactive" && <span className="dc-chip inactive">Inactive</span>}
                    {st === "ended" && <span className="dc-chip ended">{usedUp ? "Used up" : "Expired"}</span>}
                    {d.publicShop && <span className="dc-chip public">Public shop too</span>}
                    {endsSoon && <span className="dc-chip soon">{daysLeft <= 1 ? "Ends today" : `Ends in ${daysLeft} days`}</span>}
                  </div>
                  {d.label && <div className="email">{d.label}</div>}
                  <div className="user-meta">
                    Used {d.uses}{d.maxUses ? ` / ${d.maxUses}` : ""} time{d.uses === 1 ? "" : "s"}
                    {revenue > 0 ? ` · $${revenue.toFixed(2)} discounted` : ""}
                    {d.minOrderAmount ? ` · min $${d.minOrderAmount}` : ""}
                    {d.expiresAt ? ` · ${d.expiresAt < now ? "ended" : "last day"} ${formatDate(d.expiresAt)}` : ""}
                  </div>
                </div>
                <div className="user-actions">
                  {st !== "ended" && (
                    <button onClick={() => onToggle(d.id, !d.active)}>{d.active ? "Deactivate" : "Activate"}</button>
                  )}
                  {st !== "ended" && onTogglePublic && (
                    <button onClick={() => onTogglePublic(d.id, !d.publicShop)} title="Whether this code also works in the public shop">{d.publicShop ? "Members only" : "Public shop too"}</button>
                  )}
                  <button className="danger" onClick={() => onDelete(d.id, d.code)}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {list.length > shown && (
        <div className="dc-more">
          <button type="button" className="esc-btn" onClick={() => setShown((n) => n + PAGE)}>
            Show {Math.min(PAGE, list.length - shown)} more
          </button>
          <span className="field-hint" style={{ margin: 0 }}>Showing {shown} of {list.length}</span>
        </div>
      )}
    </div>
  );
}
