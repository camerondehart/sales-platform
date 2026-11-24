"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EVT_ASK, type AdminRefreshKey } from "@/lib/assistant/shared";
import { pacificDay } from "@/lib/periods";
import { useAdminRefresh } from "./useAdminRefresh";
import { brand } from "@/lib/brand";
import Glyph from "./Glyph";
import ManagerTake, { type Manager } from "./ManagerTake";

// Overview → "Today": a stand-in site manager. The day's to-do list plus
// proactive suggestions, refreshed on its own. Each button asks the staff
// Concierge to prepare confirm cards (nothing happens until you press
// Confirm on each card) or opens the right tab. Ticks are kept on this
// browser for today only.
//
// Gentle on arrival: right after signing in (or the first visit of the day)
// the card loads folded — just the summary chips. It pops in, the greeting
// types itself out like someone writing you a note, the ring fills, and the
// chips are set down one by one at a slightly uneven, human pace. Tap a chip
// or "Show" to open it. On phones and iPads only the most urgent group starts
// open; the rest are one-line summaries you tap to open. Motion is skipped
// for anyone with "reduce motion" switched on.

type Priority = "now" | "today" | "this week" | "campaign" | "idea";
type Task = {
  id: string;
  priority: Priority;
  task: string;
  why?: string;
  /** From the Concierge's learned notes. */
  learned?: string[];
  /** Moved here by the site manager review, and why. */
  managerWhy?: string;
  items: string[];
  ask?: string;
  tab: string;
  orderFilter?: string;
  button: string;
};
type Data = { asOf: string; allClear: boolean; tasks: Task[]; conciergeReady: boolean; done?: string[]; manager?: Manager | null };

const GROUPS: Array<[Priority, string]> = [
  ["now", "Do now"],
  ["today", "Today"],
  ["this week", "This week"],
  ["campaign", "Campaign ideas"],
  ["idea", "Ideas to grow"],
];
const POLL_MS = 3 * 60_000;
// The last list this browser saw today, shown at once on arrival so the
// panel and its welcome don't wait on the server; the fresh list replaces
// it in place a moment later (marked "updating…" until then).
const CACHE_KEY = "fp_today_last";
// Before the first paint in the browser (plain effect on the server, where it never runs).
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;
// When the folded chips start dropping in, counted from the panel's arrival.
const CHIPS_AT_MS = 800;

function greeting(): string {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: brand.timezone, hourCycle: "h23", hour: "2-digit" }).format(new Date())) % 24;
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function TodayBulletin({ onOpen }: { onOpen: (tab: string, orderFilter?: string, key?: string) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Showing this browser's last copy while the fresh list loads.
  const [stale, setStale] = useState(false);
  const arrivedAt = useRef(0);
  const chipsDelay = useRef<number | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState(false);
  const [intro, setIntro] = useState(false);
  const [hello, setHello] = useState("");
  // Group open/closed: null = not chosen yet (use the device default).
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({});
  const [compact, setCompact] = useState(false);
  // The greeting types itself out on arrival (characters shown so far).
  const [typed, setTyped] = useState<number | null>(null);
  const foldRef = useRef<HTMLDivElement>(null);
  const today = pacificDay();
  const storeKey = `fp_today_${today}`;

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/today${fresh ? "?fresh=1" : ""}`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !Array.isArray(d.tasks)) throw new Error(d.error || "Couldn't load today's list.");
      setData(d);
      setStale(false);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ day: pacificDay(), data: d }));
      } catch {}
      // Ticks are shared (saved on the server), so every device sees the same.
      if (Array.isArray(d.done)) setDone(new Set(d.done));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load today's list.");
    }
    setLoading(false);
  }, []);

  // Show today's last copy straight away (same Pacific day only), then load fresh below.
  useBeforePaint(() => {
    arrivedAt.current = Date.now();
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (c && c.day === pacificDay() && c.data && Array.isArray(c.data.tasks)) {
        setData(c.data);
        if (Array.isArray(c.data.done)) setDone(new Set(c.data.done));
        setStale(true);
      } else localStorage.removeItem(CACHE_KEY);
    } catch {}
  }, []);

  // First load, then every few minutes while this tab is visible, and on return to it.
  useEffect(() => {
    load(true);
    const tick = () => {
      if (document.visibilityState === "visible") load();
    };
    const id = setInterval(tick, POLL_MS);
    const onVis = () => tick();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  // A confirmed Concierge card changed something → refresh straight away.
  useAdminRefresh(
    ["users", "orders", "products", "discounts", "banner", "events", "escalations", "flags", "assistant", "campaigns", "subscribers", "today", "settings"] as AdminRefreshKey[],
    () => load(true)
  );

  // Ticks are saved on the server (shared, reset each local day); open/closed stays per device.
  useBeforePaint(() => {
    try {
      setCollapsed(localStorage.getItem("fp_today_collapsed") === "1");
      setGroupOpen(JSON.parse(localStorage.getItem("fp_today_groups2") || "{}"));
    } catch {}
  }, [storeKey]);

  // The welcome: just signed in, or first look today on this browser.
  useBeforePaint(() => {
    setHello(greeting());
    try {
      const justIn = sessionStorage.getItem("fp_just_signed_in") === "1";
      const firstToday = localStorage.getItem("fp_today_seen") !== today;
      if (justIn || firstToday) {
        // Arrive folded: just the summary chips.
        setCollapsed(true);
        localStorage.setItem("fp_today_collapsed", "1");
        if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          setIntro(true);
          setTyped(0);
        }
      }
      sessionStorage.removeItem("fp_just_signed_in");
      localStorage.setItem("fp_today_seen", today);
    } catch {}
  }, [today]);
  // Let the welcome finish once the list has arrived (or give up after 10 s).
  useEffect(() => {
    if (!intro) return;
    const t = setTimeout(() => setIntro(false), data ? 6500 : 10_000);
    return () => clearTimeout(t);
  }, [intro, data]);
  // Type the greeting one letter at a time, at an uneven, human rhythm.
  useEffect(() => {
    if (typed === null || !hello) return;
    if (typed >= hello.length) {
      const t = setTimeout(() => setTyped(null), 900); // let the caret blink a moment, then drop it
      return () => clearTimeout(t);
    }
    const ch = hello[typed - 1] || "";
    const pause = typed === 0 ? 600 : ch === " " ? 260 : 70 + ((typed * 37) % 70); // unhurried, with a breath after each word
    const t = setTimeout(() => setTyped(typed + 1), pause);
    return () => clearTimeout(t);
  }, [typed, hello]);
  // Folded content can't be tabbed into or read out.
  useEffect(() => {
    const el = foldRef.current;
    if (el) el.toggleAttribute("inert", collapsed);
  }, [collapsed, data]);

  // Phones and iPads: start with only the most urgent group open.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1024px)");
    const on = () => setCompact(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  const toggleDone = (id: string) => {
    const nowDone = !done.has(id);
    setDone((prev) => {
      const next = new Set(prev);
      if (nowDone) next.add(id);
      else next.delete(id);
      return next;
    });
    fetch("/api/admin/today", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, done: nowDone }) })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !Array.isArray(d.done)) throw new Error("not saved");
        setDone(new Set(d.done));
      })
      .catch(() => {
        // Put it back the way it was, so the screen never claims something that wasn't saved.
        setDone((prev) => {
          const next = new Set(prev);
          if (nowDone) next.delete(id);
          else next.add(id);
          return next;
        });
      });
  };
  const openTo = (p?: Priority) => {
    if (p) {
      setGroupOpen((prev) => {
        const next = { ...prev, [p]: true };
        try {
          localStorage.setItem("fp_today_groups2", JSON.stringify(next));
        } catch {}
        return next;
      });
    }
    setCollapsed(false);
    try {
      localStorage.setItem("fp_today_collapsed", "0");
    } catch {}
  };
  const toggleCollapsed = () => {
    setCollapsed((v) => {
      try {
        localStorage.setItem("fp_today_collapsed", v ? "0" : "1");
      } catch {}
      return !v;
    });
  };

  const tasks = useMemo(() => data?.tasks || [], [data]);
  const doneCount = tasks.filter((t) => done.has(t.id)).length;
  const pct = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 100;
  const urgent = tasks.filter((t) => t.priority === "now" && !done.has(t.id)).length;

  // Which groups start open: everything on a computer; on a phone/iPad just the first group with something left to do.
  const firstOpenGroup = GROUPS.map(([p]) => p).find((p) => tasks.some((t) => t.priority === p && !done.has(t.id)));
  // "Do now" and "Today" start open; the rest are one-line summaries until opened.
  const isGroupOpen = (p: Priority) => (p in groupOpen ? groupOpen[p] : p === "now" || p === "today");
  const toggleGroup = (p: Priority) => {
    setGroupOpen((prev) => {
      const next = { ...prev, [p]: !isGroupOpen(p) };
      try {
        localStorage.setItem("fp_today_groups2", JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  // If the list arrives after the welcome has started, the chips come in right away
  // rather than waiting their full turn. Worked out once, so later refreshes never shift it.
  const chipsStart = () => {
    if (chipsDelay.current === null) chipsDelay.current = Math.max(0, CHIPS_AT_MS - (Date.now() - arrivedAt.current));
    return chipsDelay.current;
  };

  const act = (t: Task) => {
    if (t.ask) window.dispatchEvent(new CustomEvent(EVT_ASK, { detail: { question: t.ask } }));
    else onOpen(t.tab, t.orderFilter, t.id);
  };

  return (
    <section className={`admin-section tb${intro ? " tb-intro" : ""}${collapsed ? " is-folded" : ""}`}>
      <div className="tb-head">
        <div className="tb-title">
          {intro && (
            <span className="tb-floats" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
          )}
          <span className="tb-ring" style={{ ["--p" as string]: `${data ? pct : 0}%` }} aria-hidden="true">
            <span>{tasks.length ? `${doneCount}/${tasks.length}` : data ? "✓" : ""}</span>
          </span>
          <div>
            {hello && (
              <div className="tb-hello" aria-label={hello}>
                {typed === null ? (
                  <>
                    {hello} <span className="tb-leaf" aria-hidden="true"><Glyph name="leaf" /></span>
                  </>
                ) : (
                  <span aria-hidden="true">
                    {hello
                      .slice(0, typed)
                      .split("")
                      .map((c, i) => (
                        <span key={i} className="tb-letter">
                          {c}
                        </span>
                      ))}
                    <span className="tb-caret" />
                  </span>
                )}
              </div>
            )}
            <h2>Today</h2>
            <div className="tb-sub">
              {data ? (
                tasks.length === 0 ? (
                  "All clear — nothing needs you right now."
                ) : (
                  <>
                    {urgent > 0 ? <strong className="tb-urgent">{urgent} to do now</strong> : "Nothing urgent"} · {tasks.length} item{tasks.length === 1 ? "" : "s"}
                    {/* While this browser's last copy shows, the time breathes softly (and ↻ spins) until the fresh list lands; no extra text, so nothing shifts. */}
                    {data.asOf ? <span className={`tb-asof${stale && !error ? " tb-updating" : ""}`} title={stale && !error ? "Updating…" : undefined}> · as of {data.asOf}</span> : ""}
                    {stale && error && <span className="tb-asof"> · couldn&apos;t refresh, tap ↻</span>}
                  </>
                )
              ) : error ? (
                error
              ) : (
                "Checking orders, members and the shop…"
              )}
            </div>
          </div>
        </div>
        <div className="tb-tools">
          <button type="button" className="tb-icon" onClick={() => load(true)} disabled={loading} aria-label="Refresh" title="Refresh">
            <span className={loading ? "tb-spin" : ""}>↻</span>
          </button>
          {tasks.length > 0 && (
            <button type="button" className="tb-link" onClick={toggleCollapsed} aria-expanded={!collapsed}>
              {collapsed ? "Show ▾" : "Hide ▴"}
            </button>
          )}
        </div>
      </div>

      {!data && !error && (
        <div className="tb-skel" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      )}

      {data && data.manager !== undefined && <ManagerTake manager={data.manager} onChanged={() => load(true)} />}

      {/* Folded: one tappable chip per group. */}
      {collapsed && tasks.length > 0 && (
        <div className="tb-chips" style={{ ["--c0" as string]: `${chipsStart()}ms` }}>
          {GROUPS.filter(([p]) => tasks.some((t) => t.priority === p)).map(([p, label], gi) => {
            const left = tasks.filter((t) => t.priority === p && !done.has(t.id)).length;
            // Uneven gaps between chips, like a hand setting them down (ms after the first).
            const delay = [0, 320, 560, 930, 1150, 1480][gi] ?? gi * 300;
            return (
              <button
                key={p}
                type="button"
                className={`tb-chip tb-${p.replace(" ", "-")}`}
                style={{ ["--i" as string]: gi, ["--d" as string]: `${delay}ms` }}
                onClick={() => openTo(p)}
              >
                <span className="tb-chip-dot" aria-hidden="true" />
                {label}
                <b>{left > 0 ? left : "✓"}</b>
              </button>
            );
          })}
        </div>
      )}

      {tasks.length > 0 && (
        <div className={`tb-fold${collapsed ? " is-closed" : ""}`} ref={foldRef} aria-hidden={collapsed}>
        <div className="tb-fold-inner">
        <div className="tb-groups">
          {GROUPS.filter(([p]) => tasks.some((t) => t.priority === p)).map(([p, label], gi) => {
            const list = tasks.filter((t) => t.priority === p);
            const left = list.filter((t) => !done.has(t.id)).length;
            const openNow = isGroupOpen(p);
            return (
              <div key={p} className={`tb-group tb-${p.replace(" ", "-")}${openNow ? " is-open" : ""}`} style={{ ["--i" as string]: gi }}>
                <button type="button" className="tb-group-label" onClick={() => toggleGroup(p)} aria-expanded={openNow}>
                  <span className="tb-group-name">{label}</span>
                  <span className="tb-count">{left > 0 ? left : "✓"}</span>
                  {!openNow && <span className="tb-peek">{list.find((t) => !done.has(t.id))?.task || "All done"}</span>}
                  <span className="tb-chev" aria-hidden="true">▾</span>
                </button>
                {openNow && <div className="tb-rows">{list.map((t, ri) => {
                  const isDone = done.has(t.id);
                  const expanded = open.has(t.id);
                  const shown = expanded ? t.items : t.items.slice(0, 3);
                  return (
                    <div key={t.id} className={`tb-row${isDone ? " is-done" : ""}`} style={{ ["--r" as string]: ri }}>
                      <div className="tb-body">
                        <div className="tb-task">{t.task}</div>
                        {t.why && <div className="tb-why">{t.why}</div>}
                        {t.managerWhy && <div className="tb-learned"><span>✦ Manager</span> {t.managerWhy}</div>}
                        {t.learned?.map((l, i) => (
                          <div key={i} className="tb-learned"><span>✦ Learned</span> {l}</div>
                        ))}
                        {shown.length > 0 && (
                          <ul className="tb-items">
                            {shown.map((it, i) => (
                              <li key={i}>{it}</li>
                            ))}
                          </ul>
                        )}
                        {t.items.length > 3 && (
                          <button
                            type="button"
                            className="tb-link"
                            onClick={() =>
                              setOpen((prev) => {
                                const n = new Set(prev);
                                if (n.has(t.id)) n.delete(t.id);
                                else n.add(t.id);
                                return n;
                              })
                            }
                          >
                            {expanded ? "Show less" : `+${t.items.length - 3} more`}
                          </button>
                        )}
                      </div>
                      <div className="tb-actions">
                        {!isDone && (
                          <button type="button" className={`tb-go${t.ask ? " is-ask" : ""}`} onClick={() => act(t)} title={t.ask ? "The Concierge prepares cards — nothing happens until you confirm each one" : undefined}>
                            {t.ask && <span aria-hidden="true">✦ </span>}
                            {t.button}
                          </button>
                        )}
                        <label className={`tb-check${isDone ? " on" : ""}`} title={isDone ? "Undo — put it back on the list" : "Tick it off for today"}>
                          <input type="checkbox" checked={isDone} onChange={() => toggleDone(t.id)} aria-label={`Mark done: ${t.task}`} />
                          <span className="tb-box" aria-hidden="true" />
                          <span className="tb-check-text">{isDone ? "Done · undo" : "Mark done"}</span>
                        </label>
                      </div>
                    </div>
                  );
                })}</div>}
              </div>
            );
          })}
          {data && !data.conciergeReady && tasks.some((t) => t.priority !== "now") && (
            <div className="tb-note">The Concierge is off or paused, so buttons open the right tab instead of preparing cards.</div>
          )}
        </div>
        </div>
        </div>
      )}
    </section>
  );
}
