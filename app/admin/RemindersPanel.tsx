"use client";

import { useEffect, useState } from "react";
import { useAdminRefresh } from "./useAdminRefresh";
import type { AdminRefreshKey } from "@/lib/assistant/shared";

// Settings → Payment reminders: timing and wording of each reminder,
// when unpaid invoices move to Expired, and a "Run now" button.

type Stage = { afterHours: number; subject: string; message: string };
type Settings = { stages: Stage[]; expireAfterHours: number };

const toLabel = (h: number) => (h % 24 === 0 ? `${h / 24} day${h === 24 ? "" : "s"}` : `${h} hours`);

export default function RemindersPanel() {
  const [s, setS] = useState<Settings | null>(null);
  const [expired, setExpired] = useState(0);
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState(false);

  const load = async () => {
    const [r, f] = await Promise.all([
      fetch("/api/admin/reminders", { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)),
      fetch("/api/admin/flags", { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)),
    ]);
    if (r) {
      setS({ stages: r.settings.stages, expireAfterHours: r.settings.expireAfterHours });
      setExpired(r.expired || 0);
    }
    setOn(!!f?.flags?.find((x: { key: string; on: boolean }) => x.key === "invoice_reminders")?.on);
  };
  useAdminRefresh(["reminders","flags"] as AdminRefreshKey[], () => load());
  useEffect(() => {
    load().catch(() => {});
  }, []);

  if (!s) return null;
  const setStage = (i: number, patch: Partial<Stage>) => setS({ ...s, stages: s.stages.map((x, j) => (j === i ? { ...x, ...patch } : x)) });

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/reminders", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Couldn't save.");
      setMsg({ ok: true, text: "Saved." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Couldn't save." });
    }
    setBusy(false);
  }

  async function runNow() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/reminders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "run" }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Couldn't run.");
      setMsg({ ok: true, text: `Checked ${d.checked} unpaid order${d.checked === 1 ? "" : "s"}: ${d.sent} reminder${d.sent === 1 ? "" : "s"} sent, ${d.expired} moved to Expired${d.failed ? `, ${d.failed} failed` : ""}.` });
      await load();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Couldn't run." });
    }
    setBusy(false);
  }

  return (
    <section className="admin-section">
      <h2>
        <button type="button" className="flag-fold" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          Payment reminders
          {expired > 0 && <span className="badge" title="Expired unpaid orders">{expired}</span>}
          <span className="flag-fold-hint">{open ? "Hide" : "Show"} <span aria-hidden="true">{open ? "▴" : "▾"}</span></span>
        </button>
      </h2>
      {open && (<>
      <p className="field-hint" style={{ marginTop: "-0.4rem" }}>
        {on
          ? "On. Unpaid invoices get these emails automatically (checked every 15 minutes on the live site), then move to Orders → Expired, where you can revive them. Cash-at-pickup orders are never chased."
          : "Off. Switch on under Feature switches → Automatic payment reminders. Only orders placed after you switch it on are chased."}
      </p>
      <div className="rem-stages">
        {s.stages.map((st, i) => (
          <div key={i} className="rem-stage">
            <div className="rem-when">
              <strong>Reminder {i + 1}</strong>
              <label>
                after{" "}
                <input
                  type="number"
                  min={1}
                  value={st.afterHours}
                  onChange={(e) => setStage(i, { afterHours: Math.max(1, Math.round(Number(e.target.value) || 0)) })}
                  style={{ width: 80 }}
                />{" "}
                hours
              </label>
              <span className="field-hint" style={{ margin: 0 }}>= {toLabel(st.afterHours)}</span>
            </div>
            <div>
              <input value={st.subject} onChange={(e) => setStage(i, { subject: e.target.value })} placeholder="Subject" />
              <textarea rows={3} value={st.message} onChange={(e) => setStage(i, { message: e.target.value })} style={{ marginTop: "0.4rem" }} />
            </div>
          </div>
        ))}
      </div>
      <div className="field-hint">
        Use <code>{"{name}"}</code>, <code>{"{ref}"}</code> and <code>{"{total}"}</code> — they're filled in for each customer. Every email includes the order,
        a “View &amp; pay” button, and replies come to your inbox. Amounts are never changed.
      </div>
      <div className="rem-line" style={{ marginTop: "0.8rem" }}>
        <label>
          Move to Expired after{" "}
          <input type="number" min={1} value={s.expireAfterHours} onChange={(e) => setS({ ...s, expireAfterHours: Math.max(1, Math.round(Number(e.target.value) || 0)) })} style={{ width: 80 }} />{" "}
          hours ({toLabel(s.expireAfterHours)})
        </label>
      </div>
      <div className="rem-line" style={{ marginTop: "0.9rem" }}>
        <button type="button" className="esc-btn primary" disabled={busy} onClick={save}>Save reminders</button>
        <button type="button" className="esc-btn" disabled={busy || !on} onClick={runNow} title={on ? "" : "Switch reminders on first"}>Run now</button>
        {msg && <span className={msg.ok ? "ap-ok" : "ap-bad"}>{msg.text}</span>}
      </div>
      </>)}
    </section>
  );
}
