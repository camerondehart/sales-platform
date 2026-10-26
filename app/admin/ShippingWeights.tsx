"use client";

import { useEffect, useMemo, useState } from "react";
import type { Product } from "@/lib/storage";
import { useAdminRefresh } from "./useAdminRefresh";
import { DEFAULT_PACKAGING_OZ, packagingOzOf } from "@/lib/shippingWeight";
import type { AdminRefreshKey } from "@/lib/assistant/shared";

// Products → Shipping weights. Staff enter each product's packed weight
// once (and the box & padding); shipping labels then use the real weight of
// each order automatically instead of a guess.

export default function ShippingWeights({ products, onSaved }: { products: Product[]; onSaved: (updated: Product[]) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [pack, setPack] = useState("");
  const [packSaved, setPackSaved] = useState<number | null>(null);
  // True while the box weight is still the built-in default (nobody has saved one).
  const [packIsDefault, setPackIsDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadPack = () =>
    fetch("/api/admin/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const raw = d?.settings?.packagingOz;
        const v = packagingOzOf(raw);
        setPackIsDefault(raw === undefined || raw === null);
        setPackSaved(v);
        setPack(String(v));
      })
      .catch(() => {});
  useEffect(() => {
    loadPack();
  }, []);
  useAdminRefresh(["settings"] as AdminRefreshKey[], () => loadPack());

  // Bundles made of other products weigh the sum of their parts, so only real items need a weight.
  const items = useMemo(() => products.filter((p) => !p.isBundle).sort((a, b) => a.name.localeCompare(b.name)), [products]);
  const withWeight = items.filter((p) => (p.weightOz || 0) > 0).length;
  const valueOf = (p: Product) => (p.id in draft ? draft[p.id] : p.weightOz ? String(p.weightOz) : "");
  const changed = items.filter((p) => p.id in draft && (Number(draft[p.id]) || 0) !== (p.weightOz || 0));
  // Saving the default as-is counts too: it confirms the box weight.
  const packChanged = packSaved !== null && (packIsDefault || (Number(pack) || 0) !== packSaved);

  const confirmingDefault = packIsDefault && (Number(pack) || 0) === DEFAULT_PACKAGING_OZ;
  const nW = changed.length ? `${changed.length} weight${changed.length === 1 ? "" : "s"}` : "";
  const saveLabel = !changed.length && !packChanged
    ? "Saved"
    : changed.length && packChanged
      ? `Save ${nW} + box`
      : changed.length
        ? `Save ${nW}`
        : confirmingDefault
          ? "Confirm box weight"
          : "Save box weight";

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      if (changed.length) {
        const weights = Object.fromEntries(changed.map((p) => [p.id, Number(draft[p.id]) || 0]));
        const r = await fetch("/api/admin/products", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ weights }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "Couldn't save the weights.");
        onSaved(d.products || []);
      }
      if (packChanged) {
        const r = await fetch("/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ partial: true, packagingOz: Number(pack) || 0 }) });
        if (!r.ok) throw new Error("Couldn't save the box weight.");
        setPackSaved(Number(pack) || 0);
        setPackIsDefault(false);
      }
      setDraft({});
      setMsg({ ok: true, text: "Saved. New shipping labels will use these weights." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Couldn't save." });
    }
    setBusy(false);
  }

  return (
    <section className="admin-section sw">
      <button type="button" className="sw-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>
          <h2>Shipping weights</h2>
          <span className="sw-sub">
            {withWeight} of {items.length} products weighed
            {packIsDefault ? ` · box & packing ${DEFAULT_PACKAGING_OZ} oz (default — check it)` : ` · box & packing ${packSaved ?? 0} oz`}
            {withWeight < items.length ? " — labels for the rest still need a weight typed in" : " — labels weigh themselves"}
          </span>
        </span>
        <span className="sw-chev" aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className="sw-body">
          <p className="field-hint" style={{ marginTop: 0 }}>
            Weigh one of each product <strong>as it goes in the box</strong> (bottle, jar or pouch, plus any wrap), in ounces. Then weigh an empty
            box with its padding and enter that once below. A label's weight is then: each item × quantity + the box. You can still change it
            on the order before buying.
          </p>
          <div className="sw-pack">
            <label>
              Box &amp; packing (oz)
              <input type="number" inputMode="decimal" min="0" step="0.1" value={pack} placeholder="e.g. 4" onChange={(e) => setPack(e.target.value)} />
            </label>
            {packIsDefault && <span className="sw-default">Default {DEFAULT_PACKAGING_OZ} oz — weigh an empty box with its padding, adjust, then Save.</span>}
          </div>
          <div className="sw-list">
            {items.map((p) => (
              <label key={p.id} className={`sw-row${valueOf(p) ? "" : " is-missing"}`}>
                <span className="sw-name">{p.name}</span>
                <span className="sw-input">
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.1"
                    value={valueOf(p)}
                    placeholder="—"
                    onChange={(e) => setDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                    aria-label={`Shipping weight of ${p.name} in ounces`}
                  />
                  <em>oz</em>
                </span>
              </label>
            ))}
          </div>
          <div className="sw-foot">
            <button type="button" className="submit" disabled={busy || (!changed.length && !packChanged)} onClick={save}>
              {busy ? "Saving…" : saveLabel}
            </button>
            {msg && <span className={msg.ok ? "ap-ok" : "ap-bad"}>{msg.text}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
