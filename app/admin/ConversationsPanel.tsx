"use client";

import { useEffect, useState } from "react";
import { BarList, num } from "./charts";
import { brand } from "@/lib/brand";

// Assistant tab → Conversations: every Concierge chat from the last 30 days,
// by audience, with topic insights and anything flagged as concerning.

type Flag = { kind: string; severity: "high" | "medium" | "low"; excerpt: string; at: number };
type Transcript = {
  id: string;
  audience: "public" | "member" | "admin";
  who: string;
  startedAt: number;
  lastAt: number;
  messages: Array<{ role: "user" | "assistant"; content: string; at: number; model?: string }>;
  topics: string[];
  flags: Flag[];
};
type Insights = {
  days: number;
  conversations: { public: number; member: number; admin: number };
  topics: Array<{ key: string; value: number }>;
  flags: Array<{ key: string; label: string; value: number }>;
};

const FLAG_LABELS: Record<string, string> = {
  self_harm: "Mentions self-harm",
  health_emergency: "Possible medical emergency",
  adverse_reaction: "Reaction / feeling unwell",
  legal_or_chargeback: "Legal threat or chargeback",
  harassment: "Abusive language",
  possible_minor: "May be under 21",
  manipulation_attempt: "Tried to override the assistant",
  other_customer_data: "Asked about other customers",
  angry_customer: "Very unhappy",
  off_limits_topic: "Off-limits topic",
  threat: "Possible threat",
  slur: "Slur / hateful language",
  hostile_to_business: "Hostile to the business",
  authorities: "Mentions police / regulators",
  risky_use: "Risky use or resale",
  personal_distress: "Personal distress",
  probing: "Probing / hacking",
  negative_sentiment: "Negative / frustrated",
  profanity: "Swearing",
  odd_behavior: "Odd behaviour",
};
const HIGH = new Set(["self_harm", "health_emergency", "threat"]);
const MEDIUM = new Set(["adverse_reaction", "legal_or_chargeback", "harassment", "slur", "hostile_to_business", "authorities", "possible_minor", "risky_use", "personal_distress", "manipulation_attempt", "probing", "other_customer_data"]);
const TOPIC_LABELS: Record<string, string> = {
  orders: "Orders & tracking",
  payment: "Payment",
  shipping: "Shipping & pickup",
  products: "Products",
  membership: "Membership",
  login: "Sign-in & account",
  events: "Events",
  deals: "Deals & points",
  complaint: "Complaints",
  other: "Other",
};
const AUD: Record<string, string> = { public: "Visitor", member: "Member", admin: "Staff" };

const when = (t: number) =>
  new Date(t).toLocaleString("en-US", { timeZone: brand.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function ConversationsPanel() {
  const [items, setItems] = useState<Transcript[] | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [audience, setAudience] = useState("");
  const [flagged, setFlagged] = useState(false);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const PAGE_SIZE = 20;

  async function load(withInsights = false, pageNo = page) {
    setLoading(true);
    setError("");
    const p = new URLSearchParams();
    if (audience) p.set("audience", audience);
    if (flagged) p.set("flagged", "1");
    if (q.trim()) p.set("q", q.trim());
    if (!withInsights) p.set("insights", "0");
    p.set("page", String(pageNo));
    p.set("pageSize", String(PAGE_SIZE));
    try {
      const r = await fetch(`/api/admin/assistant/conversations?${p}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setItems(d.items);
      setHasMore(!!d.hasMore);
      setTotal(typeof d.total === "number" ? d.total : null);
      setPage(pageNo);
      setOpen(null);
      if (d.insights) setInsights(d.insights);
    } catch {
      setError("Couldn't load conversations. Try again.");
    }
    setLoading(false);
  }

  // New filters start again from the first page.
  useEffect(() => {
    load(insights === null, 0);
  }, [audience, flagged]);

  const totalChats = insights ? insights.conversations.public + insights.conversations.member : 0;
  const high = (items || []).filter((t) => t.flags.some((f) => f.severity === "high")).length;

  return (
    <section className="admin-section" id="conversations">
      <h2>
        Conversations
        {high > 0 && <span className="badge" style={{ background: "#b2432f" }} title="Serious flags">{high}</span>}
      </h2>
      <p className="field-hint" style={{ marginTop: "-0.4rem", marginBottom: "0.9rem" }}>
        Every Concierge chat from the last {insights?.days || 30} days (then deleted automatically). Anything concerning is flagged, and serious flags are
        emailed to you straight away.
      </p>

      {insights && (
        <div className="cv-insights">
          <div className="cv-stat">
            <strong>{num(totalChats)}</strong>
            <span>customer chats</span>
            <small>{num(insights.conversations.public)} visitors · {num(insights.conversations.member)} members</small>
          </div>
          <div className="cv-topics">
            <div className="cv-sub">What people ask about</div>
            <BarList rows={insights.topics.slice(0, 6).map((t) => ({ label: TOPIC_LABELS[t.key] || t.key, value: t.value }))} empty="No chats yet." />
          </div>
          <div className="cv-flags">
            <div className="cv-sub">Flagged</div>
            {insights.flags.length === 0 ? (
              <div className="an-empty" style={{ padding: "0.6rem 0" }}>Nothing concerning. 🌿</div>
            ) : (
              <ul>
                {insights.flags.map((f) => (
                  <li key={f.key}>
                    <span className={`cv-dot ${HIGH.has(f.key) ? "high" : MEDIUM.has(f.key) ? "med" : "low"}`} />
                    {f.label}
                    <strong>{f.value}</strong>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="al-filters" style={{ marginTop: "1rem" }}>
        <div className="seg">
          {[["", "All"], ["public", "Visitors"], ["member", "Members"], ["admin", "Staff"]].map(([v, l]) => (
            <button key={v} type="button" className={audience === v ? "on" : ""} onClick={() => setAudience(v)}>{l}</button>
          ))}
        </div>
        <label className="al-check">
          <input type="checkbox" checked={flagged} onChange={(e) => setFlagged(e.target.checked)} /> Flagged only
        </label>
        <form className="al-search" onSubmit={(e) => { e.preventDefault(); load(false, 0); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search what was said, or a name/email" />
          <button type="submit" className="esc-btn" disabled={loading}>{loading ? "…" : "Search"}</button>
        </form>
      </div>

      {error && <div className="ap-bad">{error}</div>}
      {items && items.length === 0 && <div className="empty" style={{ padding: "1rem 0" }}>No conversations match.</div>}
      {items && items.length > 0 && (
        <div className="al-list">
          {items.map((t) => {
            const first = t.messages.find((m) => m.role === "user")?.content || "";
            const worst = t.flags.find((f) => f.severity === "high") || t.flags[0];
            return (
              <div key={t.id} className={`cv-row${worst ? ` flag-${worst.severity}` : ""}`}>
                <button type="button" className="cv-main" onClick={() => setOpen(open === t.id ? null : t.id)} aria-expanded={open === t.id}>
                  <span className="al-when">{when(t.lastAt)}</span>
                  <span className="cv-text">
                    <strong>{t.who}</strong> <span className="sub-tag">{AUD[t.audience]}</span>
                    <span className="cv-first">{first.slice(0, 120)}</span>
                  </span>
                  <span className="cv-tags">
                    {t.flags.map((f) => (
                      <span key={f.kind} className={`cv-flag ${f.severity}`}>{FLAG_LABELS[f.kind] || f.kind}</span>
                    ))}
                    {!t.flags.length && t.topics.slice(0, 2).map((x) => <span key={x} className="cv-topic">{TOPIC_LABELS[x] || x}</span>)}
                  </span>
                  <span className="cv-count">{Math.ceil(t.messages.length / 2)} msg</span>
                </button>
                {open === t.id && (
                  <div className="esc-chat" style={{ margin: "0 0.8rem 0.8rem" }}>
                    {t.messages.map((m, i) => (
                      <div key={i} className={`esc-bubble ${m.role}`}>
                        <span>
                          {m.role === "user" ? (t.audience === "admin" ? "Staff" : t.who.split(" <")[0]) : "Concierge"} · {when(m.at)}
                          {m.role === "assistant" && m.model && <em className="cv-model" title={m.model}> · {m.model.split("/").pop()}</em>}
                        </span>
                        {m.content}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {items && (page > 0 || hasMore) && (
        <div className="reg-pager cv-pager">
          <button type="button" onClick={() => load(false, page - 1)} disabled={loading || page === 0}>
            ← Newer
          </button>
          <span>
            {page * PAGE_SIZE + 1}–{page * PAGE_SIZE + items.length}
            {total !== null ? ` of ${total}` : hasMore ? " · more below" : ""}
          </span>
          <button type="button" onClick={() => load(false, page + 1)} disabled={loading || !hasMore}>
            Older →
          </button>
        </div>
      )}
    </section>
  );
}
