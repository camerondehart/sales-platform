"use client";

import { useEffect, useMemo, useState } from "react";
import type { Product } from "@/lib/storage";
import type { Order } from "@/lib/orders";
import { normalizeStatus } from "@/lib/orderStatus";
import { backorders } from "@/lib/stockMath";
import { useAdminRefresh } from "./useAdminRefresh";
import type { AdminRefreshKey } from "@/lib/assistant/shared";

// Products → Stock counts. Staff type how many of each product are on the
// shelf; every order takes its items off (lib/stock.ts). At 0 the shop says
// "Currently restocking" and people can still order. Blank = not counted.

export default function StockCounts({ products, orders }: { products: Product[]; orders: Order[] }) {
  const [open, setOpen] = useState(false);
  const [stock, setStock] = useState<Record<string, number> | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [switchOn, setSwitchOn] = useState<boolean | null>(null);
  const [showOwed, setShowOwed] = useState(false);

  const load = () => {
    fetch("/api/admin/stock", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => d?.stock && setStock(d.stock))
      .catch(() => {});
    fetch("/api/admin/flags", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const f = (d?.flags || []).find((x: { key: string; on: boolean }) => x.key === "stock_counts");
        if (f) setSwitchOn(!!f.on);
      })
      .catch(() => {});
  };
  useEffect(load, []);
  useAdminRefresh(["products", "orders"] as AdminRefreshKey[], load);

  // Bundles use the counts of the products in them, so only real items get a count.
  const items = useMemo(() => products.filter((p) => !p.isBundle).sort((a, b) => a.name.localeCompare(b.name)), [products]);
  // Units owed on open orders that the stock didn't cover (lib/stockMath.ts).
  const waiting = useMemo(() => backorders(orders.map((o) => ({ ...o, status: normalizeStatus(o.status) })), products), [orders, products]);
  const owedUnits = Array.from(waiting.values()).reduce((n, w) => n + w.units, 0);
  // Products owed to customers first.
  const shown = useMemo(() => items.slice().sort((a, b) => (waiting.get(b.id)?.units || 0) - (waiting.get(a.id)?.units || 0)), [items, waiting]);

  const saved = (p: Product) => (stock && p.id in stock ? String(stock[p.id]) : "");
  const valueOf = (p: Product) => (p.id in draft ? draft[p.id] : saved(p));
  const changed = items.filter((p) => p.id in draft && draft[p.id].trim() !== saved(p));
  const counted = stock ? items.filter((p) => p.id in stock).length : 0;
  const atZero = stock ? items.filter((p) => p.id in stock && stock[p.id] <= 0).length : 0;

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const counts = Object.fromEntries(changed.map((p) => [p.id, draft[p.id].trim() === "" ? null : Number(draft[p.id])]));
      const r = await fetch("/api/admin/stock", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ counts }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Couldn't save the counts.");
      setStock(d.stock || {});
      setDraft({});
      setMsg({ ok: true, text: "Saved." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Couldn't save." });
    }
    setBusy(false);
  }

  return (
    <section className="admin-section sw">
      <button type="button" className="sw-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>
          <h2>
            Stock counts
            {owedUnits > 0 && (
              <span
                className="stock-owed-pill"
                role="link"
                title="Show which products"
                onClick={(e) => { e.stopPropagation(); setOpen(true); setShowOwed(true); }}
              >
                {owedUnits} on backorder
              </span>
            )}
          </h2>
          <span className="sw-sub">
            {stock === null ? "Loading…" : `${counted} of ${items.length} products counted`}
            {atZero ? ` · ${atZero} currently restocking` : ""}
            {owedUnits > 0 ? ` · ${waiting.size} product${waiting.size === 1 ? "" : "s"} owed to customers` : ""}
            {switchOn === false ? " · switch is off, so the shop doesn't use them yet" : ""}
          </span>
        </span>
        <span className="sw-chev" aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className="sw-body">
          {owedUnits > 0 && (
            <details className="stock-owed-box" open={showOwed} onToggle={(e) => setShowOwed((e.target as HTMLDetailsElement).open)}>
              <summary>
                <strong>{owedUnits} on backorder</strong> across {waiting.size} product{waiting.size === 1 ? "" : "s"}: send these first when stock arrives
              </summary>
              <ul>
                {Array.from(waiting.entries())
                  .sort((a, b) => b[1].units - a[1].units)
                  .map(([id, w]) => (
                    <li key={id}>
                      <strong>{products.find((p) => p.id === id)?.name || "Removed product"}</strong>: {w.units} on backorder
                      <span className="stock-owed-orders">
                        {w.list.map((x, i) => (
                          <span key={i}>{x.orderId ? `#${x.orderId.slice(-6).toUpperCase()}` : "order"}{x.name ? ` ${x.name}` : ""} ×{x.units}</span>
                        ))}
                      </span>
                    </li>
                  ))}
              </ul>
            </details>
          )}
          <p className="field-hint" style={{ marginTop: 0 }}>
            Type how many of each product you have ready to send. Every order takes its items off. At <strong>0</strong> the shop shows
            “Currently restocking” and people can <strong>still order</strong>: those orders are marked “restocking” so you know they wait for new
            stock. Cancelling an order puts its items back. Leave a box <strong>blank</strong> to not count that product. Bundles use the counts
            of the products in them.
            {switchOn === false && <> Turn on <strong>Stock counts</strong> in Settings → Feature switches when the numbers are in.</>}
          </p>
          <div className="sw-list">
            {shown.map((p) => {
              const v = valueOf(p);
              const zero = v.trim() !== "" && Number(v) <= 0;
              const w = waiting.get(p.id);
              return (
                <label key={p.id} className={`sw-row${zero ? " is-missing" : ""}`}>
                  <span className="sw-name">
                    {p.name}
                    {zero && <span className="stock-chip">Restocking</span>}
                    {w && <span className="stock-wait is-owed">{w.units} on backorder · {w.orders} order{w.orders === 1 ? "" : "s"}</span>}
                  </span>
                  <span className="sw-input">
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      step="1"
                      value={v}
                      placeholder="—"
                      onChange={(e) => setDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                      aria-label={`How many ${p.name} in stock`}
                    />
                    <em>in stock</em>
                  </span>
                </label>
              );
            })}
          </div>
          <div className="sw-foot">
            <button type="button" className="submit" disabled={busy || !changed.length} onClick={save}>
              {busy ? "Saving…" : changed.length ? `Save ${changed.length} count${changed.length === 1 ? "" : "s"}` : "Saved"}
            </button>
            {msg && <span className={msg.ok ? "ap-ok" : "ap-bad"}>{msg.text}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
