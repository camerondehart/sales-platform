"use client";

import { useEffect, useState } from "react";
import type { PointsCheckRow } from "@/lib/loyalty";

type Check = { members: number; ok: number; rows: PointsCheckRow[]; rate: number; enabled: boolean };
type Done = { name: string; ref: string; earned: number; takenBack: number };

const money = (n: number) => `$${n.toFixed(2)}`;

/**
 * Settings → Sales & loyalty rules → Points check. The sanity check for the
 * points rule: every $1 of products in a completed order since Nov 1 is one
 * point. Lists any order that doesn't match and fixes them after staff confirm.
 */
export default function PointsCheckPanel() {
  const [data, setData] = useState<Check | null>(null);
  const [done, setDone] = useState<Done[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = () =>
    fetch("/api/admin/loyalty/check", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: Check) => setData(d))
      .catch(() => setMsg("Couldn't run the points check."));
  useEffect(() => {
    load();
  }, []);

  const wrongOrders = data ? data.rows.reduce((n, r) => n + r.wrong.length, 0) : 0;

  async function fix() {
    if (!wrongOrders) return;
    if (!confirm(`Fix points on ${wrongOrders} order${wrongOrders === 1 ? "" : "s"}? Each change shows in the member's points history.`)) return;
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/admin/loyalty/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const d = await r.json();
      if (!r.ok) throw new Error();
      setDone(d.done || []);
      setData(d.check);
    } catch {
      setMsg("Couldn't fix those. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field full points-check" style={{ borderTop: "1px solid var(--rule-soft)", paddingTop: "1rem" }}>
      <label>Points check</label>
      <p style={{ margin: "0.3rem 0 0.6rem", color: "var(--ink-soft)" }}>
        The rule: every $1 of products (not shipping) in an order since Nov 1, 2026 that has been <strong>completed for over an hour</strong> is {data?.rate === 1 || !data ? "one point" : `${data.rate} points`}.
        Pending and paid orders earn nothing, and an order that stops being completed gives its points back. The site runs this check every 15 minutes and fixes what it finds; the button does it now.
      </p>
      {!data && !msg && <p style={{ fontStyle: "italic" }}>Checking…</p>}
      {data && !data.enabled && <p>Loyalty points are switched off, so nothing is checked.</p>}
      {data && data.enabled && data.rows.length === 0 && (
        <p className="points-check-ok">✓ All {data.members} member{data.members === 1 ? "" : "s"} with orders since Nov 1 match the rule.</p>
      )}
      {data && data.enabled && data.rows.length > 0 && (
        <>
          <p>{data.rows.length} member{data.rows.length === 1 ? "" : "s"} don&rsquo;t match:</p>
          <ul className="points-check-list">
            {data.rows.map((r) => (
              <li key={r.userId}>
                <strong>{r.name}</strong> · balance {r.balance}
                <ul>
                  {r.wrong.map((w) => (
                    <li key={w.orderId}>
                      #{w.ref} · {w.status} · {money(w.total)}: holds {w.has} points, should be {w.should}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <button type="button" className="submit" disabled={busy} onClick={fix}>
            {busy ? "Fixing…" : `Fix ${wrongOrders} order${wrongOrders === 1 ? "" : "s"}`}
          </button>
        </>
      )}
      {done && (
        <p className="points-check-done">
          {done.length
            ? `Fixed: ${done.map((d) => `${d.name} #${d.ref} ${d.earned ? `+${d.earned}` : `−${d.takenBack}`}`).join("; ")}.`
            : "Nothing needed changing."}
        </p>
      )}
      {msg && <p style={{ fontStyle: "italic" }}>{msg}</p>}
      <p style={{ margin: "0.6rem 0 0", fontSize: "0.9em", color: "var(--ink-soft)" }}>
        Points from staff credits, older orders (before Nov 1) and points spent at checkout are separate and aren&rsquo;t changed here.
      </p>
    </div>
  );
}
