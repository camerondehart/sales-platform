"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import StoreLocationsPanel from "./StoreLocationsPanel";
import { useAdminRefresh } from "./useAdminRefresh";
import type { AdminRefreshKey } from "@/lib/assistant/shared";
import { brand } from "@/lib/brand";

/**
 * Retail tab: store accounts for the store portal (/store-portal), the stock
 * requests stores send, and the store map (the same Store locations panel as
 * Settings). Server: /api/admin/retail. Marking a request shipped ASKS whether
 * to take the units off Products → Stock counts (2026-11-10); nothing
 * comes off the counts unless staff say yes.
 */

type Login = { id: string; email: string; name: string; needsPassword?: boolean; active: boolean; createdAt: number; invitedAt?: number; lastSignInAt?: number };
type Account = { id: string; name: string; storeId?: string; contactName?: string; phone?: string; staffNotes?: string; active: boolean; logins: Login[]; createdAt: number };
type Item = { productId: string; name: string; qty: number; shippedQty?: number };
type Req = {
  id: string; ref: string; accountId: string; storeName: string; items: Item[]; note?: string; staffNote?: string; status: Status;
  requestedBy: string; createdAt: number; shippedAt?: number; receivedAt?: number; stockTaken?: Array<{ productId: string; qty: number }>;
  history: Array<{ at: number; status: Status; by: string; note?: string }>;
};
type Status = "pending" | "approved" | "shipped" | "received" | "declined" | "cancelled";
type Data = { accounts: Account[]; requests: Req[]; stores: Array<{ id: string; name: string; city: string; active: boolean }>; stockOn: boolean; portalOn: boolean; stock: Record<string, number> };

const LABEL: Record<Status, string> = { pending: "Waiting for review", approved: "Approved", shipped: "Shipped", received: "Received", declined: "Declined", cancelled: "Cancelled by store" };
const CHIP: Record<Status, string> = { pending: "soon", approved: "active", shipped: "active", received: "inactive", declined: "ended", cancelled: "ended" };
const TZ = brand.timezone;
const day = (t?: number) => (t ? new Date(t).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" }) : "");

async function call(method: string, body?: unknown, query = "") {
  const r = await fetch(`/api/admin/retail${query}`, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok && d?.ok !== false, data: d as Record<string, any> };
}

export default function RetailPanel({ onPending }: { onPending?: (n: number) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(async () => {
    const r = await fetch("/api/admin/retail", { cache: "no-store" });
    if (r.ok) setData(await r.json());
  }, []);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);
  useAdminRefresh(["retail"] as AdminRefreshKey[], load);
  const pending = data ? data.requests.filter((r) => r.status === "pending").length : 0;
  useEffect(() => {
    if (data) onPending?.(pending);
  }, [data, pending, onPending]);

  if (!data) return <div className="empty" style={{ padding: "1rem 0" }}>Loading…</div>;
  return (
    <div className="retail-panel">
      {!data.portalOn && (
        <div className="rt-banner" role="status">
          The store portal is switched off, so stores can&apos;t sign in yet. You can set up accounts now; switch on <strong>Retail store portal</strong> in Settings → Feature switches when you&apos;re ready.
        </div>
      )}
      {msg && <div className={msg.ok ? "ap-ok" : "ap-bad"} style={{ margin: "0 0 0.8rem" }} role="status">{msg.text}</div>}
      <Requests data={data} reload={load} say={setMsg} />
      <Accounts data={data} reload={load} say={setMsg} />
      <StoreLocationsPanel />
    </div>
  );
}

// ------------------------------------------------------------------ stock requests

function Requests({ data, reload, say }: { data: Data; reload: () => Promise<void>; say: (m: { ok: boolean; text: string } | null) => void }) {
  const [view, setView] = useState<"open" | "all">("open");
  const [ship, setShip] = useState<{ id: string; qty: Record<string, string>; note: string; ask: boolean } | null>(null);
  const [busy, setBusy] = useState("");
  const list = view === "open" ? data.requests.filter((r) => r.status === "pending" || r.status === "approved" || r.status === "shipped") : data.requests;
  const tracked = (r: Req) => data.stockOn && r.items.some((i) => Object.prototype.hasOwnProperty.call(data.stock, i.productId));

  async function move(r: Req, status: Status, extra: Record<string, unknown> = {}, done?: string) {
    setBusy(r.id);
    say(null);
    const res = await call("PATCH", { requestId: r.id, status, ...extra });
    setBusy("");
    if (!res.ok) return say({ ok: false, text: res.data.error || "That didn't save." });
    say({ ok: true, text: [done || `${r.storeName} ${r.ref}: ${LABEL[status]}.`, res.data.stockNote].filter(Boolean).join(" ") });
    setShip(null);
    await reload();
  }

  function decline(r: Req) {
    const note = window.prompt(`Decline ${r.storeName}'s request ${r.ref}? Add a note for the store (optional):`, r.staffNote || "");
    if (note === null) return;
    void move(r, "declined", { staffNote: note });
  }
  function noteOnly(r: Req) {
    const note = window.prompt(`Note to ${r.storeName} (they see it on this request):`, r.staffNote || "");
    if (note === null) return;
    void move(r, r.status, { staffNote: note }, "Note saved.");
  }
  function unship(r: Req) {
    if (r.stockTaken?.length) {
      const n = r.stockTaken.reduce((a, t) => a + t.qty, 0);
      const back = window.confirm(`Move ${r.ref} back to Approved.\n\n${n} unit${n === 1 ? " was" : "s were"} taken off stock counts when it shipped. Put ${n === 1 ? "it" : "them"} back on the counts?\n\nOK = put them back · Cancel = leave the counts as they are`);
      void move(r, "approved", back ? { stock: "return" } : {});
    } else void move(r, "approved");
  }

  function startShip(r: Req) {
    setShip({ id: r.id, qty: Object.fromEntries(r.items.map((i) => [i.productId, String(i.shippedQty ?? i.qty)])), note: r.staffNote || "", ask: false });
  }
  function confirmShip(r: Req) {
    if (!ship) return;
    if (tracked(r) && !ship.ask) return setShip({ ...ship, ask: true });
    void finishShip(r, false);
  }
  async function finishShip(r: Req, takeStock: boolean) {
    if (!ship) return;
    const shippedQty = Object.fromEntries(Object.entries(ship.qty).map(([k, v]) => [k, Math.max(0, Math.floor(Number(v) || 0))]));
    await move(r, "shipped", { shippedQty, staffNote: ship.note, ...(takeStock ? { stock: "take" } : {}) });
  }

  const shipUnits = ship ? Object.values(ship.qty).reduce((n, v) => n + Math.max(0, Math.floor(Number(v) || 0)), 0) : 0;

  return (
    <section className="admin-section" id="retail-requests">
      <h2>Stock requests</h2>
      <p className="field-hint" style={{ marginTop: "-0.4rem" }}>
        Requests stores send from the <a href="/store-portal" target="_blank" rel="noopener">store portal</a> (or through its Concierge). Each one emails the team. Stores see the status and your note.
      </p>
      <div className="seg" style={{ marginBottom: "0.8rem" }}>
        <button type="button" className={view === "open" ? "on" : ""} onClick={() => setView("open")}>Open</button>
        <button type="button" className={view === "all" ? "on" : ""} onClick={() => setView("all")}>All ({data.requests.length})</button>
      </div>
      {!list.length ? (
        <div className="empty" style={{ padding: "0.6rem 0" }}>{view === "open" ? "No open requests." : "No requests yet."}</div>
      ) : (
        <div className="admin-list">
          {list.map((r) => {
            const units = r.items.reduce((n, i) => n + i.qty, 0);
            const shipping = ship?.id === r.id ? ship : null;
            return (
              <div key={r.id} className="user-row rt-req">
                <div className="user-main">
                  <div className="name dc-name">
                    {r.storeName} <span className="rt-ref">{r.ref}</span>
                    <span className={`dc-chip ${CHIP[r.status]}`}>{LABEL[r.status]}</span>
                    {r.stockTaken?.length ? <span className="dc-chip inactive" title="Units were taken off Stock counts when it shipped">Off stock counts</span> : null}
                  </div>
                  <div className="email">{units} unit{units === 1 ? "" : "s"} · sent {day(r.createdAt)} by {r.requestedBy}{r.shippedAt ? ` · shipped ${day(r.shippedAt)}` : ""}{r.receivedAt ? ` · received ${day(r.receivedAt)}` : ""}</div>
                  <ul className="rt-items">
                    {r.items.map((i) => (
                      <li key={i.productId}>
                        {i.name} × <strong>{i.qty}</strong>
                        {i.shippedQty !== undefined && i.shippedQty !== i.qty && <span className="rt-muted"> (shipped {i.shippedQty})</span>}
                        {data.stockOn && data.stock[i.productId] !== undefined && (r.status === "pending" || r.status === "approved") && <span className="rt-muted"> · {data.stock[i.productId]} on hand</span>}
                      </li>
                    ))}
                  </ul>
                  {r.note && <div className="rt-note"><span>Store&apos;s note:</span> {r.note}</div>}
                  {r.staffNote && <div className="rt-note rt-note-staff"><span>Your note to them:</span> {r.staffNote}</div>}

                  {shipping && (
                    <div className="rt-ship">
                      {!shipping.ask ? (
                        <>
                          <div className="rt-ship-title">Mark as shipped: how many of each went out?</div>
                          {r.items.map((i) => (
                            <label key={i.productId} className="rt-ship-row">
                              <span>{i.name} <span className="rt-muted">(asked for {i.qty})</span></span>
                              <input inputMode="numeric" value={shipping.qty[i.productId] ?? ""} onChange={(e) => setShip({ ...shipping, qty: { ...shipping.qty, [i.productId]: e.target.value.replace(/\D/g, "").slice(0, 5) } })} aria-label={`Units of ${i.name} shipped`} />
                            </label>
                          ))}
                          <div className="field" style={{ marginTop: "0.5rem" }}>
                            <label htmlFor={`rt-note-${r.id}`}>Note to the store (optional)</label>
                            <input id={`rt-note-${r.id}`} value={shipping.note} onChange={(e) => setShip({ ...shipping, note: e.target.value })} placeholder="e.g. Tracking 1Z… or arriving Thursday" maxLength={1000} />
                          </div>
                          <div className="rt-ship-actions">
                            <button type="button" className="esc-btn primary" disabled={busy === r.id || shipUnits === 0} onClick={() => confirmShip(r)}>Mark shipped ({shipUnits} units)</button>
                            <button type="button" className="esc-btn" onClick={() => setShip(null)}>Cancel</button>
                          </div>
                        </>
                      ) : (
                        <div className="rt-ask" role="alertdialog" aria-label="Stock counts">
                          <div className="rt-ship-title">Take these {shipUnits} units off Stock counts too?</div>
                          <p className="rt-muted" style={{ margin: "0 0 0.6rem" }}>
                            Products → Stock counts tracks what&apos;s on hand for the website. Say yes if these came out of that stock; no if they came from somewhere else. Products that aren&apos;t counted are skipped either way.
                          </p>
                          <div className="rt-ship-actions">
                            <button type="button" className="esc-btn primary" disabled={busy === r.id} onClick={() => finishShip(r, true)}>Yes, take them off</button>
                            <button type="button" className="esc-btn" disabled={busy === r.id} onClick={() => finishShip(r, false)}>No, leave the counts</button>
                            <button type="button" className="ap-linkbtn" onClick={() => setShip({ ...shipping, ask: false })}>Back</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {!shipping && (
                  <div className="user-actions">
                    {r.status === "pending" && <button disabled={busy === r.id} onClick={() => move(r, "approved")}>Approve</button>}
                    {(r.status === "pending" || r.status === "approved") && <button disabled={busy === r.id} onClick={() => startShip(r)}>Mark shipped</button>}
                    {r.status === "shipped" && <button disabled={busy === r.id} onClick={() => move(r, "received")}>Mark received</button>}
                    {r.status === "shipped" && <button disabled={busy === r.id} onClick={() => unship(r)}>Not shipped yet</button>}
                    {(r.status === "declined" || r.status === "cancelled") && <button disabled={busy === r.id} onClick={() => move(r, "pending")}>Reopen</button>}
                    <button disabled={busy === r.id} onClick={() => noteOnly(r)}>Note</button>
                    {(r.status === "pending" || r.status === "approved") && <button className="danger" disabled={busy === r.id} onClick={() => decline(r)}>Decline</button>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ accounts

type LoginDraft = { name: string; email: string };
const blankAccount = { name: "", storeId: "", contactName: "", phone: "", staffNotes: "", logins: [{ name: "", email: "" }] as LoginDraft[], invite: true };

function Accounts({ data, reload, say }: { data: Data; reload: () => Promise<void>; say: (m: { ok: boolean; text: string } | null) => void }) {
  const [form, setForm] = useState<(typeof blankAccount & { id?: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [addFor, setAddFor] = useState<{ id: string; name: string; email: string; invite: boolean } | null>(null);
  const storeName = useMemo(() => new Map(data.stores.map((s) => [s.id, `${s.name}, ${s.city}`])), [data.stores]);
  const usedStores = new Set(data.accounts.filter((a) => a.id !== form?.id).map((a) => a.storeId).filter(Boolean));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    say(null);
    const body = form.id
      ? { id: form.id, name: form.name, storeId: form.storeId, contactName: form.contactName, phone: form.phone, staffNotes: form.staffNotes }
      : { ...form, logins: form.logins.filter((l) => l.email.trim()) };
    const r = await call(form.id ? "PUT" : "POST", body);
    setBusy(false);
    if (!r.ok) return say({ ok: false, text: r.data.error || "That didn't save." });
    const invited = !form.id && form.invite && form.logins.some((l) => l.email.trim());
    say({ ok: !r.data.warning, text: r.data.warning || (form.id ? "Saved." : `${form.name} added.${invited ? " Set-password emails sent." : ""}`) });
    setForm(null);
    await reload();
  }

  async function put(body: Record<string, unknown>, done: string) {
    say(null);
    const r = await call("PUT", body);
    if (!r.ok) return say({ ok: false, text: r.data.error || "That didn't save." });
    say({ ok: !r.data.warning, text: r.data.warning || done });
    await reload();
  }

  async function remove(a: Account) {
    if (!window.confirm(`Delete the store account for ${a.name}? Its logins stop working at once. Its past requests stay in the list. The store map isn't changed.`)) return;
    const r = await call("DELETE", undefined, `?id=${encodeURIComponent(a.id)}`);
    if (!r.ok) return say({ ok: false, text: r.data.error || "That didn't delete." });
    say({ ok: true, text: `${a.name}'s account deleted.` });
    await reload();
  }

  const loginState = (l: Login) =>
    !l.active ? "Switched off" : !l.needsPassword ? (l.lastSignInAt ? `Last signed in ${day(l.lastSignInAt)}` : "Password set") : l.invitedAt ? `Link sent ${day(l.invitedAt)}, no password yet` : "Not invited yet";

  return (
    <section className="admin-section" id="retail-accounts">
      <h2>Store accounts</h2>
      <p className="field-hint" style={{ marginTop: "-0.4rem" }}>
        Each store gets one account with a login for each person there. They choose a password from the emailed link, then can also use an emailed code or Face ID, just like members. Store logins can&apos;t open the members&apos; site or this dashboard.
      </p>
      {!form && (
        <button type="button" className="esc-btn primary" onClick={() => { setForm({ ...blankAccount, logins: [{ name: "", email: "" }] }); say(null); }} style={{ marginBottom: "0.9rem" }}>
          + Add a store account
        </button>
      )}
      {form && (
        <form className="rt-form" onSubmit={save}>
          <div className="rt-form-grid">
            <div className="field"><label htmlFor="rt-name">Store name</label><input id="rt-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={120} /></div>
            <div className="field">
              <label htmlFor="rt-store">On the store map</label>
              <select id="rt-store" value={form.storeId} onChange={(e) => { const id = e.target.value; const s = data.stores.find((x) => x.id === id); setForm({ ...form, storeId: id, name: form.name || s?.name || "" }); }}>
                <option value="">Not linked</option>
                {data.stores.map((s) => (
                  <option key={s.id} value={s.id} disabled={usedStores.has(s.id)}>{s.name}, {s.city}{usedStores.has(s.id) ? " (has an account)" : ""}</option>
                ))}
              </select>
            </div>
            <div className="field"><label htmlFor="rt-contact">Main contact person</label><input id="rt-contact" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} maxLength={120} /></div>
            <div className="field"><label htmlFor="rt-phone">Phone</label><input id="rt-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} maxLength={30} /></div>
            <div className="field full"><label htmlFor="rt-notes">Staff notes (the store never sees these)</label><textarea id="rt-notes" rows={2} value={form.staffNotes} onChange={(e) => setForm({ ...form, staffNotes: e.target.value })} /></div>
          </div>
          {!form.id && (
            <>
              <div className="rt-form-sub">Logins</div>
              {form.logins.map((l, i) => (
                <div key={i} className="rt-login-row">
                  <input placeholder="Name" value={l.name} onChange={(e) => setForm({ ...form, logins: form.logins.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} aria-label={`Login ${i + 1} name`} />
                  <input type="email" placeholder="Email" value={l.email} onChange={(e) => setForm({ ...form, logins: form.logins.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)) })} aria-label={`Login ${i + 1} email`} />
                  {form.logins.length > 1 && <button type="button" className="ap-linkbtn" onClick={() => setForm({ ...form, logins: form.logins.filter((_, j) => j !== i) })}>Remove</button>}
                </div>
              ))}
              {form.logins.length < 10 && <button type="button" className="ap-linkbtn" onClick={() => setForm({ ...form, logins: [...form.logins, { name: "", email: "" }] })}>+ Another login</button>}
              <label className="check-row" style={{ marginTop: "0.6rem" }}>
                <input type="checkbox" checked={form.invite} onChange={(e) => setForm({ ...form, invite: e.target.checked })} /> <span>Email each login a link to set their password now</span>
              </label>
            </>
          )}
          <div className="store-form-actions">
            <button type="submit" className="esc-btn primary" disabled={busy}>{busy ? "Saving…" : form.id ? "Save changes" : "Add store account"}</button>
            <button type="button" className="esc-btn" onClick={() => setForm(null)} disabled={busy}>Cancel</button>
          </div>
        </form>
      )}

      {!data.accounts.length && !form ? (
        <div className="empty" style={{ padding: "0.6rem 0" }}>No store accounts yet.</div>
      ) : (
        <div className="admin-list">
          {data.accounts.map((a) => (
            <div key={a.id} className="user-row rt-acct">
              <div className="user-main">
                <div className="name dc-name">
                  {a.name}
                  {!a.active && <span className="dc-chip inactive">Switched off</span>}
                  {a.storeId && <span className="dc-chip soon" title="Linked to this store map listing">{storeName.get(a.storeId) ? "On the map" : "Map listing missing"}</span>}
                </div>
                <div className="email">
                  {[a.contactName, a.phone, a.storeId ? storeName.get(a.storeId) : ""].filter(Boolean).join(" · ") || "No contact details"}
                  {" · "}
                  {data.requests.filter((r) => r.accountId === a.id).length} request(s)
                </div>
                {a.staffNotes && <div className="rt-note"><span>Notes:</span> {a.staffNotes}</div>}
                <ul className="rt-logins">
                  {a.logins.map((l) => (
                    <li key={l.id}>
                      <span className="rt-login-who"><strong>{l.name}</strong> {l.email}</span>
                      <span className="rt-muted">{loginState(l)}</span>
                      <span className="rt-login-actions">
                        {l.active && a.active && <button type="button" className="ap-linkbtn" onClick={() => put({ id: a.id, loginId: l.id, invite: true }, `Set-password link sent to ${l.email}.`)}>{l.needsPassword ? "Send link" : "Send reset link"}</button>}
                        <button type="button" className="ap-linkbtn" onClick={() => put({ id: a.id, loginId: l.id, active: !l.active }, l.active ? `${l.email} can't sign in now.` : `${l.email} can sign in again.`)}>{l.active ? "Switch off" : "Switch on"}</button>
                        <button type="button" className="ap-linkbtn rt-danger" onClick={() => window.confirm(`Remove ${l.email}'s login?`) && put({ id: a.id, loginId: l.id, remove: true }, `${l.email} removed.`)}>Remove</button>
                      </span>
                    </li>
                  ))}
                  {!a.logins.length && <li className="rt-muted">No logins yet.</li>}
                </ul>
                {addFor?.id === a.id ? (
                  <div className="rt-login-row">
                    <input placeholder="Name" value={addFor.name} onChange={(e) => setAddFor({ ...addFor, name: e.target.value })} aria-label="New login name" />
                    <input type="email" placeholder="Email" value={addFor.email} onChange={(e) => setAddFor({ ...addFor, email: e.target.value })} aria-label="New login email" />
                    <label className="check-row"><input type="checkbox" checked={addFor.invite} onChange={(e) => setAddFor({ ...addFor, invite: e.target.checked })} /> <span>Email the link</span></label>
                    <button type="button" className="esc-btn primary" onClick={async () => { await put({ id: a.id, addLogin: { name: addFor.name, email: addFor.email }, invite: addFor.invite }, `${addFor.email} added${addFor.invite ? " and emailed" : ""}.`); setAddFor(null); }}>Add</button>
                    <button type="button" className="esc-btn" onClick={() => setAddFor(null)}>Cancel</button>
                  </div>
                ) : (
                  a.logins.length < 10 && <button type="button" className="ap-linkbtn" onClick={() => setAddFor({ id: a.id, name: "", email: "", invite: true })}>+ Add a login</button>
                )}
              </div>
              <div className="user-actions">
                <button onClick={() => setForm({ id: a.id, name: a.name, storeId: a.storeId || "", contactName: a.contactName || "", phone: a.phone || "", staffNotes: a.staffNotes || "", logins: [], invite: false })}>Edit</button>
                <button onClick={() => put({ id: a.id, active: !a.active }, a.active ? `${a.name} can't sign in now.` : `${a.name} can sign in again.`)}>{a.active ? "Switch off" : "Switch on"}</button>
                <button className="danger" onClick={() => remove(a)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
