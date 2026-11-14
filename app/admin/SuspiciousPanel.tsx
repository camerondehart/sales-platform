"use client";

import { useEffect, useState } from "react";
import type { SusCase } from "@/lib/suspicion";
import { brand } from "@/lib/brand";

type Done = SusCase & { reviewedAt: number; reviewedBy: string };
type Data = { on: boolean; cases?: SusCase[]; reviewed?: Done[]; logged?: number; recentDays?: number; keepDays?: number; error?: string };

const when = (t: number) => new Date(t).toLocaleDateString("en-US", { timeZone: brand.timezone, month: "short", day: "numeric" });
const STATUS: Record<string, string> = { pending: "Request waiting", approved: "Member", rejected: "Rejected", guest: "Guest shopper" };

function headline(c: SusCase): string {
  if (c.people.length + c.morePeople === 1) return c.people[0].name ? `${c.people[0].name} · ${c.people[0].email}` : c.people[0].email;
  return `${c.people.length + c.morePeople} accounts that look linked`;
}

/**
 * Members → Suspicious activity. Accounts and orders that look fake, each with
 * the reasons. Flags only: nothing here blocks or changes a member or an order.
 */
export default function SuspiciousPanel({ onFind }: { onFind: (email: string) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [showDone, setShowDone] = useState(false);
  // Folded by default so it stays out of the way under the requests queue; the count still shows. Remembered per device.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem("fp_sus_open") === "1") setOpen(true);
    } catch {}
  }, []);
  const toggle = () => {
    setOpen((v) => {
      try {
        localStorage.setItem("fp_sus_open", v ? "0" : "1");
      } catch {}
      return !v;
    });
  };

  const load = () =>
    fetch("/api/admin/suspicious", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: Data) => {
        setData(d);
        if (d.error) setMsg(d.error);
      })
      .catch(() => setMsg("Couldn't check for suspicious activity."));
  useEffect(() => {
    load();
  }, []);

  async function mark(c: SusCase, reviewed: boolean) {
    setBusy(c.id);
    setMsg("");
    try {
      const r = await fetch("/api/admin/suspicious", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: c.id, reviewed, summary: headline(c) }) });
      if (!r.ok) throw new Error();
      await load();
    } catch {
      setMsg("Couldn't save that. Try again.");
    }
    setBusy(null);
  }

  // Switch off (or not loaded yet): show nothing, so the Members tab looks as it always did.
  if (!data || data.on === false) return null;
  const cases = data.cases || [];
  const done = data.reviewed || [];

  const card = (c: SusCase, reviewed?: Done) => (
    <li key={c.id} className={`sus-case is-${c.level}${reviewed ? " is-reviewed" : ""}`}>
      <div className="sus-head">
        <span className={`sus-level is-${c.level}`}>{c.level === "strong" ? "Strong signs" : "Worth a look"}</span>
        <strong className="sus-title">{headline(c)}</strong>
        <span className="sus-when">Last activity {when(c.latestAt)}</span>
      </div>
      <ul className="sus-reasons">
        {c.reasons.map((r, i) => (
          <li key={`${r.code}${i}`}>{r.text}</li>
        ))}
      </ul>
      <div className="sus-people">
        {c.people.map((p) => (
          <div key={p.email} className="sus-person">
            <span className="sus-who">
              <strong>{p.name || "(no name)"}</strong> <span className="sus-email">{p.email}</span>
            </span>
            <span className={`sus-chip is-${p.status}`}>{STATUS[p.status]}</span>
            <span className="sus-meta">
              {p.joinedAt ? `Requested ${when(p.joinedAt)}` : "No account"}
              {p.orders > 0 ? ` · ${p.orders} order${p.orders === 1 ? "" : "s"} (${p.paid} paid, ${p.unpaid} unpaid)` : " · no orders"}
            </span>
            <span className="sus-go">
              {p.userId && (
                <button type="button" className="link-btn" onClick={() => onFind(p.email)}>
                  Find member
                </button>
              )}
            </span>
          </div>
        ))}
        {c.morePeople > 0 && <div className="sus-meta">…and {c.morePeople} more</div>}
      </div>
      {c.orders.length > 0 && (
        <p className="sus-orders">
          <strong>Orders:</strong>{" "}
          {c.orders.map((o) => `#${o.id.slice(-6).toUpperCase()} ${o.name} $${o.total.toFixed(2)} ${o.status} (${when(o.createdAt)})`).join(" · ")}
          {c.moreOrders > 0 ? ` · and ${c.moreOrders} more` : ""}
        </p>
      )}
      <div className="sus-actions">
        {reviewed ? (
          <>
            <span className="sus-meta">Marked fine by {reviewed.reviewedBy} on {when(reviewed.reviewedAt)}</span>
            <button type="button" className="esc-btn" disabled={busy === c.id} onClick={() => mark(c, false)}>Put back</button>
          </>
        ) : (
          <button type="button" className="esc-btn" disabled={busy === c.id} onClick={() => mark(c, true)} title="Hides this until something new turns up for the same people">
            {busy === c.id ? "Saving…" : "Looks fine"}
          </button>
        )}
      </div>
    </li>
  );

  return (
    <section className="admin-section sus">
      <button type="button" className="sus-fold" onClick={toggle} aria-expanded={open}>
        {open ? "▼" : "▶"} Suspicious activity
        {cases.length > 0 ? <span className="badge">{cases.length}</span> : " (0)"}
      </button>
      {open && (
      <>
      <p className="field-hint sus-intro">
        Accounts and orders that look fake, with the reasons. <strong>Nothing is blocked</strong>: these are only for you to check before you approve a request or ship an order. Tick <em>Looks fine</em> once you&rsquo;ve looked; it comes back only if something new turns up.
      </p>
      {msg && <p className="field-hint" role="status">{msg}</p>}
      {cases.length === 0 ? (
        <div className="empty sus-empty">Nothing looks suspicious in the last {data.recentDays || 90} days.</div>
      ) : (
        <ul className="sus-list">{cases.map((c) => card(c))}</ul>
      )}
      {done.length > 0 && (
        <div className="sus-done">
          <button type="button" className="sus-toggle" onClick={() => setShowDone(!showDone)}>
            {showDone ? "▼" : "▶"} Looked at ({done.length})
          </button>
          {showDone && <ul className="sus-list">{done.map((c) => card(c, c))}</ul>}
        </div>
      )}
      {!data.logged && (
        <p className="field-hint sus-note">
          Internet-address checks start with requests and orders made from now on. Everything else (emails, addresses, notes, unpaid orders) already covers your existing members and orders.
        </p>
      )}
      </>
      )}
    </section>
  );
}
