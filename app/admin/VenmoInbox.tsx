"use client";

import { useEffect, useMemo, useState } from "react";
import { useAdminRefresh } from "./useAdminRefresh";
import type { AdminRefreshKey } from "@/lib/assistant/shared";

// Orders → Venmo payments. Venmo's "paid you" emails, checked and matched to
// unpaid orders (lib/venmoInbox.ts). Nothing is marked paid until staff tap
// "Mark paid". Shown only while the "Venmo payment matching" switch is on.

type Match = { strength: "strong" | "medium" | "weak" | "none"; orderId?: string; candidates: string[]; why: string; amountDiffers?: boolean };
type Payment = {
  id: string;
  receivedAt: number;
  subject: string;
  verified: boolean;
  reason?: string;
  payer?: string;
  amount?: number;
  note?: string;
  txnId?: string;
  state: "new" | "confirmed" | "rejected" | "dismissed";
  orderId?: string;
  notOrders?: string[];
  decidedBy?: string;
  decidedAt?: number;
  match?: Match;
};
type OpenOrder = { id: string; ref: string; name: string; email: string; total: number; createdAt: number; expired: boolean };
type SetupMsg = { id: string; receivedAt: number; from: string; subject: string; text: string };

const money = (n?: number) => (typeof n === "number" ? `$${n.toFixed(2)}` : "—");
const when = (t: number) => new Date(t).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function VenmoInbox({ onPaid }: { onPaid: () => void }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ payments: Payment[]; orders: OpenOrder[]; setup: SetupMsg[]; accountEmailSet: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [showSetup, setShowSetup] = useState(false);

  const load = () => {
    fetch("/api/admin/flags", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const f = (d?.flags || []).find((x: { key: string; on: boolean }) => x.key === "venmo_matching");
        setOn(!!f?.on);
        if (f?.on) return fetch("/api/admin/venmo", { cache: "no-store" }).then((r) => r.json()).then((v) => v?.payments && setData(v));
      })
      .catch(() => {});
  };
  useEffect(load, []);
  useAdminRefresh(["orders"] as AdminRefreshKey[], load);

  const orderById = useMemo(() => new Map((data?.orders || []).map((o) => [o.id, o])), [data]);
  const fresh = (data?.payments || []).filter((p) => p.state === "new");
  const suggested = fresh.filter((p) => p.verified && p.match?.orderId && (p.match.strength === "strong" || p.match.strength === "medium") && orderById.has(p.match.orderId));
  const toSort = fresh.filter((p) => p.verified && !suggested.includes(p));
  const quarantined = fresh.filter((p) => !p.verified);
  const done = (data?.payments || []).filter((p) => p.state !== "new").slice(0, 15);
  const sure = suggested.filter((p) => p.match!.strength === "strong" && !p.match!.amountDiffers);

  async function act(body: Record<string, unknown>, key: string, ok: string) {
    setBusy(key);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/venmo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "That didn't work.");
      setMsg({ ok: true, text: body.action === "confirm_strong" ? `${d.confirmed} marked paid.${d.skipped?.length ? ` ${d.skipped.length} skipped.` : ""}` : ok });
      if (String(body.action).startsWith("confirm")) onPaid();
      load();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "That didn't work." });
    }
    setBusy(null);
  }

  function confirm(p: Payment, orderId: string) {
    const o = orderById.get(orderId);
    if (!o) return;
    const differs = typeof p.amount === "number" && Math.abs(p.amount - o.total) >= 0.005;
    if (differs && !window.confirm(`They paid ${money(p.amount)} but order #${o.ref} is ${money(o.total)}. Mark it paid anyway?`)) return;
    act({ action: "confirm", paymentId: p.id, orderId }, p.id, `Order #${o.ref} marked paid.`);
  }

  if (!on) return null;
  const head = data === null ? "Loading…" : [
    suggested.length ? `${suggested.length} to confirm` : "",
    toSort.length ? `${toSort.length} to sort by hand` : "",
    quarantined.length ? `${quarantined.length} quarantined` : "",
  ].filter(Boolean).join(" · ") || "All caught up";

  const line = (p: Payment) => (
    <span className="vi-pay">
      <strong>{money(p.amount)}</strong> from <strong>{p.payer || "?"}</strong>
      {p.note && <span className="vi-note">“{p.note}”</span>}
      <small>{when(p.receivedAt)}</small>
    </span>
  );

  return (
    <section className="admin-section sw vi" id="venmo-inbox">
      <button type="button" className="sw-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>
          <h2>Venmo payments{suggested.length ? <span className="badge">{suggested.length}</span> : null}</h2>
          <span className="sw-sub">{head}</span>
        </span>
        <span className="sw-chev" aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>

      {open && data && (
        <div className="sw-body">
          {!data.accountEmailSet && (
            <p className="vi-warn">VENMO_ACCOUNT_EMAIL isn&rsquo;t set in Vercel yet, so every Venmo email is quarantined. See Setup below.</p>
          )}
          {msg && <p className={msg.ok ? "ap-ok" : "ap-bad"}>{msg.text}</p>}

          {suggested.length > 0 && (
            <>
              <div className="vi-title">
                <h3>Matches to confirm</h3>
                {sure.length > 1 && (
                  <button type="button" className="submit vi-all" disabled={!!busy} onClick={() => act({ action: "confirm_strong", paymentIds: sure.map((p) => p.id) }, "all", "")}>
                    Mark all {sure.length} sure matches paid
                  </button>
                )}
              </div>
              <ul className="vi-list">
                {suggested.map((p) => {
                  const o = orderById.get(p.match!.orderId!)!;
                  return (
                    <li key={p.id} className={`vi-row is-${p.match!.strength}${p.match!.amountDiffers ? " is-differs" : ""}`}>
                      {line(p)}
                      <span className="vi-arrow" aria-hidden="true">→</span>
                      <span className="vi-order">
                        Order <strong>#{o.ref}</strong> · {o.name} · {money(o.total)}
                        <small>
                          <span className={`vi-chip is-${p.match!.strength}`}>{p.match!.strength === "strong" ? "Sure" : "Likely"}</span> {p.match!.why}
                        </small>
                      </span>
                      <span className="vi-actions">
                        <button type="button" className="submit" disabled={!!busy} onClick={() => confirm(p, o.id)}>{busy === p.id ? "Saving…" : "Mark paid"}</button>
                        <button type="button" disabled={!!busy} onClick={() => act({ action: "reject", paymentId: p.id, orderId: o.id }, p.id, "Noted. It's under “Sort by hand” now.")}>Not a match</button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {toSort.length > 0 && (
            <>
              <h3>Sort by hand</h3>
              <p className="field-hint">No sure match. Pick the order it pays for, or dismiss it if it isn&rsquo;t for an order.</p>
              <ul className="vi-list">
                {toSort.map((p) => {
                  const cands = (p.match?.candidates || []).filter((id) => orderById.has(id));
                  const rest = data.orders.filter((o) => !cands.includes(o.id) && !(p.notOrders || []).includes(o.id));
                  const chosen = pick[p.id] || "";
                  return (
                    <li key={p.id} className="vi-row is-weak">
                      {line(p)}
                      <span className="vi-order">
                        <select value={chosen} onChange={(e) => setPick((m) => ({ ...m, [p.id]: e.target.value }))} aria-label={`Order for the Venmo payment from ${p.payer}`}>
                          <option value="">Choose the order…</option>
                          {cands.length > 0 && (
                            <optgroup label="Same amount">
                              {cands.map((id) => { const o = orderById.get(id)!; return <option key={id} value={id}>#{o.ref} · {o.name} · {money(o.total)}</option>; })}
                            </optgroup>
                          )}
                          <optgroup label="Other unpaid orders">
                            {rest.map((o) => <option key={o.id} value={o.id}>#{o.ref} · {o.name} · {money(o.total)}{o.expired ? " · expired" : ""}</option>)}
                          </optgroup>
                        </select>
                        <small>{p.match?.why}</small>
                      </span>
                      <span className="vi-actions">
                        <button type="button" className="submit" disabled={!!busy || !chosen} onClick={() => confirm(p, chosen)}>{busy === p.id ? "Saving…" : "Mark paid"}</button>
                        <button type="button" disabled={!!busy} onClick={() => act({ action: "dismiss", paymentId: p.id }, p.id, "Dismissed.")}>Dismiss</button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {quarantined.length > 0 && (
            <>
              <h3>Quarantined</h3>
              <p className="field-hint">These didn&rsquo;t pass the security check (they may not really be from Venmo), so they can&rsquo;t be matched. Check Venmo itself before marking any order paid.</p>
              <ul className="vi-list">
                {quarantined.map((p) => (
                  <li key={p.id} className="vi-row is-quarantined">
                    <span className="vi-pay">
                      <strong>{p.subject || "(no subject)"}</strong>
                      <small>{when(p.receivedAt)} · {p.reason}</small>
                    </span>
                    <span className="vi-actions">
                      <button type="button" disabled={!!busy} onClick={() => act({ action: "dismiss", paymentId: p.id }, p.id, "Dismissed.")}>Dismiss</button>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {!suggested.length && !toSort.length && !quarantined.length && <p className="field-hint">Nothing waiting. New Venmo payments show up here within a minute or two.</p>}

          {done.length > 0 && (
            <details className="vi-done">
              <summary>Recently done</summary>
              <ul>
                {done.map((p) => (
                  <li key={p.id}>
                    {money(p.amount)} from {p.payer || p.subject} — {p.state === "confirmed" ? `paid order #${(p.orderId || "").slice(-6).toUpperCase()}` : p.state}
                    {p.decidedBy ? ` by ${p.decidedBy}` : ""}{p.decidedAt ? `, ${when(p.decidedAt)}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <details className="vi-setup" open={showSetup} onToggle={(e) => setShowSetup((e.target as HTMLDetailsElement).open)}>
            <summary>Setup</summary>
            <ol>
              <li>Resend → <strong>Receiving</strong>: copy your receiving address (it ends in <code>.resend.app</code>).</li>
              <li>Resend → <strong>Webhooks</strong>: on the existing <code>/api/webhooks/resend</code> endpoint, also tick <strong>email.received</strong>.</li>
              <li>Vercel (Production): add <code>VENMO_ACCOUNT_EMAIL</code> = the email the business&rsquo;s Venmo notifications go to. {data.accountEmailSet ? "✓ Set." : "Not set yet."}</li>
              <li>Gmail (whoever gets the Venmo emails): Settings → Forwarding → <strong>Add a forwarding address</strong> → the Resend address. Gmail emails a code: it appears just below.</li>
              <li>Gmail: create a filter <strong>From: venmo@venmo.com</strong> → <strong>Forward it to</strong> the Resend address. (Use the filter: forwarding by hand breaks Venmo&rsquo;s signature.)</li>
            </ol>
            {data.setup.length > 0 ? (
              <ul className="vi-codes">
                {data.setup.map((m) => (
                  <li key={m.id}>
                    <strong>{m.subject}</strong> <small>{when(m.receivedAt)} · {m.from}</small>
                    <pre>{m.text.slice(0, 900)}</pre>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="field-hint">No message from Gmail yet.</p>
            )}
          </details>
        </div>
      )}
    </section>
  );
}
