"use client";

import { useEffect, useMemo, useState } from "react";
import { msToPacificInput, pacificToMs } from "@/lib/periods";
import { useAdminRefresh } from "./useAdminRefresh";
import type { AdminRefreshKey } from "@/lib/assistant/shared";
import { bundleOfferLabel } from "@/lib/bundles";
import { effectivePrice, parsePrice, type Promo } from "@/lib/pricing";
import { brand } from "@/lib/brand";

// Marketing → Mix & match bundles. Pick products (with quantities) and a
// deal; the discount applies automatically in the cart for every full set.

type Product = { id: string; name: string; price: string; salePrice?: string; promo?: Promo; image?: string; isBundle?: boolean };
type Item = { productId: string; qty: number };
type Row = {
  id: string;
  name: string;
  items: Item[];
  type: "percent" | "price";
  value: number;
  startsAt?: number;
  endsAt?: number;
  active: boolean;
  missing: string[];
  preview: { cost: number; savings: number };
  stats: { orders: number; sets: number; savings: number; sales: number };
};
type Draft = { id?: string; name: string; items: Item[]; type: "percent" | "price"; value: string; startsAt: string; endsAt: string; active: boolean };

const EMPTY: Draft = { name: "", items: [], type: "percent", value: "20", startsAt: "", endsAt: "", active: true };
const money = (n: number) => `$${n.toFixed(2)}`;
// The start/end boxes are local time, whatever the computer's clock.
const toLocal = (t?: number) => (t ? msToPacificInput(t) : "");
const when = (t: number) => new Date(t).toLocaleDateString("en-US", { timeZone: brand.timezone, month: "short", day: "numeric" });
const unitOf = (p?: Product) => (p ? parsePrice(effectivePrice(p)) : 0);

export default function BundlesPanel({ products }: { products: Product[] }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [on, setOn] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const choosable = products.filter((p) => !p.isBundle).sort((a, b) => a.name.localeCompare(b.name));

  const load = async () => {
    const [b, f] = await Promise.all([
      fetch("/api/admin/bundles", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/admin/flags", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
    ]);
    if (b) setRows(b.bundles);
    setOn(!!f?.flags?.find((x: { key: string; on: boolean }) => x.key === "bundles_specific_products")?.on);
  };
  useAdminRefresh(["bundles","products","flags"] as AdminRefreshKey[], () => load());
  useEffect(() => {
    load().catch(() => setRows([]));
  }, []);

  async function call(method: string, body?: unknown, query = "") {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/admin/bundles${query}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Couldn't save.");
      await load();
      return true;
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Couldn't save." });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft) return;
    const payload = {
      id: draft.id,
      name: draft.name,
      items: draft.items,
      type: draft.type,
      value: Number(draft.value),
      // The boxes are local time.
      startsAt: draft.startsAt ? pacificToMs(draft.startsAt) : undefined,
      endsAt: draft.endsAt ? pacificToMs(draft.endsAt) : undefined,
      active: draft.active,
    };
    if (await call(draft.id ? "PATCH" : "POST", payload)) {
      setMsg({ ok: true, text: draft.id ? "Bundle updated." : "Bundle created." });
      setDraft(null);
    }
  }

  // Live preview of one set while editing.
  const setCost = draft ? draft.items.reduce((n, i) => n + unitOf(byId.get(i.productId)) * i.qty, 0) : 0;
  const v = Number(draft?.value) || 0;
  const setPrice = draft ? (draft.type === "percent" ? setCost * (1 - Math.min(90, v) / 100) : Math.min(setCost, v)) : 0;

  if (!rows) return null;
  return (
    <section className="admin-section">
      <h2>
        Mix &amp; match bundles
        {rows.filter((r) => r.active).length > 0 && <span className="badge">{rows.filter((r) => r.active).length}</span>}
      </h2>
      <p className="field-hint" style={{ marginTop: "-0.4rem" }}>
        {on
          ? "Buy the whole set, save automatically — once per full set in the cart. Sale prices are respected; bundle items don't also get BOGO or the “buy N, save X%” rule, and a bundle can't be combined with a discount code. Points still work."
          : "Off. You can set bundles up now; they start pricing carts when you switch on Feature switches → Mix-and-match bundle discounts."}
      </p>

      {rows.length > 0 && (
        <div className="bd-list">
          {rows.map((r) => {
            const live = r.active && (!r.startsAt || r.startsAt <= Date.now()) && (!r.endsAt || r.endsAt > Date.now());
            return (
              <div key={r.id} className={`bd-row ${live ? "" : "off"}`}>
                <div className="bd-main">
                  <strong>{r.name}</strong>
                  <span className="bd-offer">{bundleOfferLabel(r)}</span>
                  <div className="bd-items">
                    {r.items.map((i) => (
                      <span key={i.productId} className={`bd-chip ${r.missing.includes(i.productId) ? "gone" : ""}`}>
                        {i.qty > 1 ? `${i.qty}× ` : ""}
                        {byId.get(i.productId)?.name || "Deleted product"}
                      </span>
                    ))}
                  </div>
                  <div className="bd-meta">
                    Set {money(r.preview.cost)} → <strong>{money(r.preview.cost - r.preview.savings)}</strong>
                    {r.preview.savings <= 0 && <span className="ap-bad"> · no saving at today's prices</span>}
                    {r.startsAt ? ` · from ${when(r.startsAt)}` : ""}
                    {r.endsAt ? ` · until ${when(r.endsAt)}` : ""}
                    {!r.active ? " · paused" : !live ? " · not running now" : ""}
                  </div>
                </div>
                <div className="bd-stats">
                  <span><strong>{r.stats.orders}</strong>orders</span>
                  <span><strong>{money(r.stats.savings)}</strong>saved</span>
                  <span><strong>{money(r.stats.sales)}</strong>sales</span>
                </div>
                <div className="bd-actions">
                  <button type="button" className="esc-btn" disabled={busy} onClick={() => call("PATCH", { id: r.id, active: !r.active })}>
                    {r.active ? "Pause" : "Resume"}
                  </button>
                  <button
                    type="button"
                    className="ap-linkbtn esc-quiet"
                    onClick={() => setDraft({ id: r.id, name: r.name, items: r.items.filter((i) => byId.has(i.productId)), type: r.type, value: String(r.value), startsAt: toLocal(r.startsAt), endsAt: toLocal(r.endsAt), active: r.active })}
                  >
                    Edit
                  </button>
                  <button type="button" className="ap-linkbtn esc-quiet" disabled={busy} onClick={() => confirm(`Delete "${r.name}"? Past orders keep their savings.`) && call("DELETE", undefined, `?id=${encodeURIComponent(r.id)}`)}>
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {draft ? (
        <div className="bd-editor">
          <div className="bd-grid">
            <label>
              Name
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Immunity Foundations" />
            </label>
            <label>
              Deal
              <div className="bd-deal">
                <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as Draft["type"] })}>
                  <option value="percent">% off the set</option>
                  <option value="price">Set price ($)</option>
                </select>
                <input type="number" min={draft.type === "percent" ? 1 : 0.01} max={draft.type === "percent" ? 90 : undefined} step={draft.type === "percent" ? 1 : 0.01} value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} style={{ width: 100 }} />
              </div>
            </label>
            <label>
              Starts (local, optional)
              <input type="datetime-local" value={draft.startsAt} onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })} />
            </label>
            <label>
              Ends (local, optional)
              <input type="datetime-local" value={draft.endsAt} onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })} />
            </label>
          </div>
          <div className="bd-picked">
            {draft.items.map((i) => (
              <div key={i.productId} className="bd-pick-row">
                <span>{byId.get(i.productId)?.name}</span>
                <span className="bd-unit">{money(unitOf(byId.get(i.productId)))}</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={i.qty}
                  onChange={(e) => setDraft({ ...draft, items: draft.items.map((x) => (x.productId === i.productId ? { ...x, qty: Math.max(1, Math.min(20, Math.floor(Number(e.target.value) || 1))) } : x)) })}
                  style={{ width: 60 }}
                  aria-label="Quantity"
                />
                <button type="button" className="ap-linkbtn esc-quiet" onClick={() => setDraft({ ...draft, items: draft.items.filter((x) => x.productId !== i.productId) })}>
                  Remove
                </button>
              </div>
            ))}
            <div className="bd-pick-row">
              <select value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Add a product…</option>
                {choosable.filter((p) => !draft.items.some((i) => i.productId === p.id)).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <button type="button" className="esc-btn" disabled={!pick} onClick={() => { setDraft({ ...draft, items: [...draft.items, { productId: pick, qty: 1 }] }); setPick(""); }}>
                Add
              </button>
            </div>
          </div>
          {draft.items.length > 0 && (
            <div className="bd-preview">
              One set: {money(setCost)} → <strong>{money(setPrice)}</strong>
              {setCost > setPrice ? ` (saves ${money(setCost - setPrice)})` : " — no saving"}
              <span className="field-hint" style={{ margin: 0 }}> at today's prices, including any sale prices.</span>
            </div>
          )}
          <div className="rem-line" style={{ marginTop: "0.8rem" }}>
            <label style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
              <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Active
            </label>
            <button type="button" className="esc-btn primary" disabled={busy} onClick={save}>{draft.id ? "Save bundle" : "Create bundle"}</button>
            <button type="button" className="ap-linkbtn esc-quiet" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" className="esc-btn primary" onClick={() => { setDraft({ ...EMPTY }); setMsg(null); }}>New bundle</button>
      )}
      {msg && <div className={msg.ok ? "ap-ok" : "ap-bad"} style={{ marginTop: "0.5rem" }}>{msg.text}</div>}
    </section>
  );
}
