"use client";

import { useEffect, useMemo, useState } from "react";
import { msToPacificInput, pacificToMs } from "@/lib/periods";
import { brand } from "@/lib/brand";
import { useAdminRefresh } from "./useAdminRefresh";
import type { AdminRefreshKey } from "@/lib/assistant/shared";
import { effectivePrice, type Promo } from "@/lib/pricing";
import { endFromMinute, lastMinute, saleCovers, saleWindow, type SiteSale, type SiteSaleScope } from "@/lib/siteSaleRules";

// Marketing → Sitewide sales (lib/siteSales.ts). One percent off every
// product, chosen products or a category, from a start to an end time in
// the shop's time zone. Prices change on the site by themselves when it starts and ends.

type Product = { id: string; name: string; price: string; salePrice?: string; promo?: Promo; cashOnly?: boolean; category?: string };
type Row = SiteSale & { state: "scheduled" | "running" | "ended" | "cancelled"; covers: number; scopeText: string };
type Draft = { id?: string; name: string; percent: string; startsAt: string; endsAt: string; scope: SiteSaleScope; productIds: string[]; category: string };

const EMPTY: Draft = { name: "", percent: "20", startsAt: "", endsAt: "", scope: "all", productIds: [], category: "" };
const STATE_LABEL: Record<Row["state"], string> = { running: "Running now", scheduled: "Scheduled", ended: "Ended", cancelled: "Cancelled" };

export default function SiteSalesPanel({ products }: { products: Product[] }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [on, setOn] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showPast, setShowPast] = useState(false);
  const categories = useMemo(
    () => Array.from(new Set(products.map((p) => (p.category || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [products]
  );
  const sorted = useMemo(() => products.slice().sort((a, b) => a.name.localeCompare(b.name)), [products]);

  const load = async () => {
    const r = await fetch("/api/admin/site-sales", { cache: "no-store" });
    if (!r.ok) return;
    const d = await r.json();
    setRows(d.sales);
    setOn(d.on !== false);
  };
  useAdminRefresh(["sales", "products", "flags"] as AdminRefreshKey[], () => load());
  useEffect(() => {
    load().catch(() => setRows([]));
  }, []);

  async function call(method: string, body?: unknown, query = "") {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/admin/site-sales${query}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
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
    const start = pacificToMs(draft.startsAt);
    const end = pacificToMs(draft.endsAt);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      setMsg({ ok: false, text: "Set when the sale starts and its last minute." });
      return;
    }
    const payload = {
      id: draft.id,
      name: draft.name,
      percent: Number(draft.percent),
      startsAt: start,
      // The box is the last minute the sale runs, e.g. 11:59 pm.
      endsAt: endFromMinute(end),
      scope: draft.scope,
      productIds: draft.scope === "products" ? draft.productIds : undefined,
      category: draft.scope === "category" ? draft.category : undefined,
    };
    if (await call(draft.id ? "PUT" : "POST", payload)) {
      setMsg({ ok: true, text: draft.id ? "Sale updated." : "Sale scheduled. Prices change by themselves when it starts and ends." });
      setDraft(null);
    }
  }

  /** Start at midnight and run through 11:59 pm of the start day. */
  function wholeDay() {
    if (!draft) return;
    const day = (draft.startsAt || msToPacificInput(Date.now())).slice(0, 10);
    setDraft({ ...draft, startsAt: `${day}T00:00`, endsAt: `${day}T23:59` });
  }

  // Live preview while editing.
  const pct = Math.round(Number(draft?.percent) || 0);
  const scopeSale = draft ? ({ scope: draft.scope, productIds: draft.productIds, category: draft.category } as SiteSale) : null;
  const covered = scopeSale ? products.filter((p) => saleCovers(scopeSale, p)) : [];
  const keepsOwn = covered.filter((p) => p.promo?.type === "bogo" || effectivePrice(p) === effectivePrice({ ...p, sitePromo: pct }));

  if (!rows) return null;
  const current = rows.filter((r) => r.state === "running" || r.state === "scheduled").sort((a, b) => a.startsAt - b.startsAt);
  const past = rows.filter((r) => r.state === "ended" || r.state === "cancelled");

  const rowView = (r: Row) => (
    <div key={r.id} className={`bd-row ${r.state === "running" ? "" : r.state === "scheduled" ? "" : "off"}`}>
      <div className="bd-main">
        <strong>{r.name}</strong>
        <span className="bd-offer">{r.percent}% off</span>
        <div className="bd-meta" style={{ marginTop: "0.35rem" }}>
          <span className={`ss-state ss-${r.state}`}>{STATE_LABEL[r.state]}</span> · {saleWindow(r)}
        </div>
        <div className="bd-meta">
          {r.scopeText} · {r.covers} product{r.covers === 1 ? "" : "s"} today
        </div>
      </div>
      <div className="bd-actions">
        {(r.state === "running" || r.state === "scheduled") && (
          <>
            <button
              type="button"
              className="esc-btn"
              disabled={busy}
              onClick={() => {
                setMsg(null);
                setDraft({ id: r.id, name: r.name, percent: String(r.percent), startsAt: msToPacificInput(r.startsAt), endsAt: msToPacificInput(lastMinute(r.endsAt)), scope: r.scope, productIds: r.productIds || [], category: r.category || "" });
              }}
            >
              Edit
            </button>
            <button
              type="button"
              className="ap-linkbtn esc-quiet"
              disabled={busy}
              onClick={() =>
                confirm(r.state === "running" ? `End "${r.name}" now? Prices go back to normal straight away.` : `Cancel "${r.name}"? It won't start.`) &&
                call("PATCH", { id: r.id, action: "end" }).then((ok) => ok && setMsg({ ok: true, text: r.state === "running" ? "Sale ended." : "Sale cancelled." }))
              }
            >
              {r.state === "running" ? "End now" : "Cancel"}
            </button>
          </>
        )}
        {r.state !== "running" && r.state !== "scheduled" && (
          <button type="button" className="ap-linkbtn esc-quiet" disabled={busy} onClick={() => confirm(`Remove "${r.name}" from this list? Past orders keep their prices.`) && call("DELETE", undefined, `?id=${encodeURIComponent(r.id)}`)}>
            Remove
          </button>
        )}
      </div>
    </div>
  );

  return (
    <section className="admin-section secnav-pane" id="site-sales">
      <h2>
        Sitewide sales
        {current.length > 0 && <span className="badge">{current.length}</span>}
      </h2>
      <p className="field-hint" style={{ marginTop: "-0.4rem" }}>
        {on
          ? "One percent off every product, chosen products or a category, from a start time to an end time (" + brand.timezoneLabel + " time). Prices change on the site by themselves, no product editing. Customers get the better of this and a product's own sale price (never both); BOGO products keep their BOGO; at most $100 off one item. Discount codes, bundles and points work as they do with any sale."
          : "Off. You can schedule sales now; they only change prices while Feature switches → Scheduled sitewide sales is on."}
      </p>

      {current.length > 0 ? <div className="bd-list">{current.map(rowView)}</div> : !draft && <p className="field-hint">No sale scheduled.</p>}

      {draft ? (
        <div className="bd-editor">
          <div className="bd-grid">
            <label>
              Name
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Black Friday" />
            </label>
            <label>
              Percent off
              <input type="number" min={1} max={90} step={1} value={draft.percent} onChange={(e) => setDraft({ ...draft, percent: e.target.value })} />
            </label>
            <label>
              Starts ({brand.timezoneLabel})
              <input type="datetime-local" value={draft.startsAt} onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })} />
            </label>
            <label>
              Last minute ({brand.timezoneLabel})
              <input type="datetime-local" value={draft.endsAt} onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })} />
            </label>
          </div>
          <div className="rem-line" style={{ marginTop: "0.5rem" }}>
            <button type="button" className="ap-linkbtn esc-quiet" onClick={wholeDay}>
              Whole day (12:00 am to 11:59 pm{draft.startsAt ? " of the start day" : " today"})
            </button>
          </div>
          <div className="bd-grid" style={{ marginTop: "0.6rem" }}>
            <label>
              Applies to
              <select value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value as SiteSaleScope })}>
                <option value="all">All products</option>
                <option value="products">Chosen products</option>
                {categories.length > 0 && <option value="category">One category</option>}
              </select>
            </label>
            {draft.scope === "category" && (
              <label>
                Category
                <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
                  <option value="">Choose…</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {draft.scope === "products" && (
            <div className="ss-picks">
              <div className="rem-line">
                <button type="button" className="ap-linkbtn esc-quiet" onClick={() => setDraft({ ...draft, productIds: products.map((p) => p.id) })}>Select all</button>
                <button type="button" className="ap-linkbtn esc-quiet" onClick={() => setDraft({ ...draft, productIds: [] })}>Clear</button>
              </div>
              {sorted.map((p) => (
                <label key={p.id} className="ss-pick">
                  <input
                    type="checkbox"
                    checked={draft.productIds.includes(p.id)}
                    onChange={(e) => setDraft({ ...draft, productIds: e.target.checked ? [...draft.productIds, p.id] : draft.productIds.filter((x) => x !== p.id) })}
                  />
                  <span>{p.name}</span>
                  <span className="bd-unit">{p.price}</span>
                </label>
              ))}
            </div>
          )}
          {pct > 0 && covered.length > 0 && (
            <div className="bd-preview">
              {covered.length} product{covered.length === 1 ? "" : "s"} at {pct}% off
              {covered.slice(0, 3).map((p) => ` · ${p.name} ${effectivePrice(p)} → ${effectivePrice({ ...p, sitePromo: pct })}`).join("")}
              {keepsOwn.length > 0 && (
                <span className="field-hint" style={{ display: "block", margin: "0.3rem 0 0" }}>
                  {keepsOwn.length} keep{keepsOwn.length === 1 ? "s" : ""} {keepsOwn.length === 1 ? "its" : "their"} own deal (already as low, or BOGO): {keepsOwn.slice(0, 4).map((p) => p.name).join(", ")}
                  {keepsOwn.length > 4 ? "…" : ""}
                </span>
              )}
            </div>
          )}
          <div className="rem-line" style={{ marginTop: "0.8rem" }}>
            <button type="button" className="esc-btn primary" disabled={busy} onClick={save}>{draft.id ? "Save sale" : "Schedule sale"}</button>
            <button type="button" className="ap-linkbtn esc-quiet" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" className="esc-btn primary" onClick={() => { setDraft({ ...EMPTY }); setMsg(null); }}>New sitewide sale</button>
      )}
      {msg && <div className={msg.ok ? "ap-ok" : "ap-bad"} style={{ marginTop: "0.5rem" }}>{msg.text}</div>}

      {past.length > 0 && (
        <div style={{ marginTop: "1.2rem" }}>
          <button type="button" className="ap-linkbtn esc-quiet" onClick={() => setShowPast(!showPast)}>
            {showPast ? "Hide" : "Show"} past sales ({past.length})
          </button>
          {showPast && <div className="bd-list">{past.map(rowView)}</div>}
        </div>
      )}
    </section>
  );
}
