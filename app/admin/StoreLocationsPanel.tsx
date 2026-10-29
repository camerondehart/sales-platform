"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { StoreLocation } from "@/lib/stores";
import { brand } from "@/lib/brand";

// Settings → Store locations. The pin comes from the address (looked up on
// save); drag it, tap the map or type lat/lng to place it by hand — a manual
// pin always wins and isn't overwritten by later saves.

const StoreMap = dynamic(() => import("@/app/components/StoreMap"), { ssr: false, loading: () => <div className="store-map store-map-loading">Loading map…</div> });

type Form = {
  id?: string;
  name: string; street: string; city: string; state: string; zip: string;
  phone: string; website: string; hours: string; notes: string;
  productIds: string[]; active: boolean;
  lat: string; lng: string; manualPin: boolean;
  /** Pin came from a picked address suggestion (kept on save, no second lookup). */
  suggested?: boolean;
};

type Suggestion = { label: string; street: string; city: string; state: string; zip: string; lat: number; lng: number; place?: string };

const blank: Form = { name: "", street: "", city: "", state: "", zip: "", phone: "", website: "", hours: "", notes: "", productIds: [], active: true, lat: "", lng: "", manualPin: false };

const toForm = (s: StoreLocation): Form => ({
  id: s.id, name: s.name, street: s.street, city: s.city, state: s.state, zip: s.zip,
  phone: s.phone || "", website: s.website || "", hours: s.hours || "", notes: s.notes || "",
  productIds: s.productIds || [], active: s.active,
  lat: typeof s.lat === "number" ? String(s.lat) : "", lng: typeof s.lng === "number" ? String(s.lng) : "",
  manualPin: s.pinSource === "manual",
});

export default function StoreLocationsPanel() {
  const [stores, setStores] = useState<StoreLocation[] | null>(null);
  const [products, setProducts] = useState<Array<{ id: string; name: string }>>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pq, setPq] = useState("");
  // Address suggestions while typing the street (Photon, via our server).
  const [typed, setTyped] = useState("");
  const [sugs, setSugs] = useState<Suggestion[]>([]);
  const [sugOpen, setSugOpen] = useState(false);
  // Which box the list belongs to: the store name (businesses) or the street (addresses).
  const [sugFor, setSugFor] = useState<"name" | "street">("street");
  useEffect(() => {
    const q = typed.trim();
    if (q.length < (sugFor === "name" ? 3 : 4)) { setSugs([]); return; }
    let live = true;
    const t = setTimeout(() => {
      const near = form?.city ? `${q}, ${form.city}${form.state ? ` ${form.state}` : ""}` : q;
      fetch(`/api/admin/stores/suggest?q=${encodeURIComponent(near)}${sugFor === "name" ? "&kind=place" : ""}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { suggestions: [] }))
        .then((d) => { if (live) { setSugs(d.suggestions || []); setSugOpen(true); } })
        .catch(() => {});
    }, 350);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed, sugFor]);
  function pickSuggestion(x: Suggestion) {
    set({ ...(x.place && sugFor === "name" ? { name: x.place } : {}), street: x.street, city: x.city, state: x.state, zip: x.zip, lat: String(x.lat), lng: String(x.lng), manualPin: false, suggested: true });
    setSugs([]); setSugOpen(false); setTyped("");
    setMsg({ ok: true, text: x.place && sugFor === "name" ? "Store filled in and pinned. Check the details and drag the pin if it's a little off." : "Address filled in and pinned. Drag the pin if it's a little off." });
  }
  const sugList = (forBox: "name" | "street") =>
    sugOpen && sugFor === forBox && sugs.length > 0 ? (
      <ul id={`st-sugs-${forBox}`} className="st-sugs" role="listbox">
        {sugs.map((x) => (
          <li key={x.label} role="option" aria-selected="false">
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pickSuggestion(x)}>
              {x.place && forBox === "name" ? (
                <><strong>{x.place}</strong> <span>{[x.street, x.city, [x.state, x.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")}</span></>
              ) : (
                <><strong>{x.street}</strong> <span>{[x.city, [x.state, x.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")}</span></>
              )}
            </button>
          </li>
        ))}
        <li className="st-sugs-credit">Suggestions © OpenStreetMap contributors</li>
      </ul>
    ) : null;

  async function load() {
    const [s, p] = await Promise.all([
      fetch("/api/admin/stores", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { stores: [] })),
      fetch("/api/admin/products", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { products: [] })),
    ]);
    setStores(s.stores || []);
    setProducts((p.products || []).map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })));
  }
  useEffect(() => { load().catch(() => setStores([])); }, []);

  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  // "38.91876, -119.99515" pasted into either box fills both (as Google Maps copies them).
  const setCoord = (which: "lat" | "lng", v: string) => {
    const m = v.match(/^\s*\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?\s*$/);
    if (m) set({ lat: String(Math.round(+m[1] * 1e6) / 1e6), lng: String(Math.round(+m[2] * 1e6) / 1e6), manualPin: true, suggested: false });
    else set({ [which]: v, manualPin: true, suggested: false } as Partial<Form>);
  };
  const pin = form && form.lat !== "" && form.lng !== "" && Number.isFinite(+form.lat) && Number.isFinite(+form.lng) ? { lat: +form.lat, lng: +form.lng } : null;

  async function findOnMap() {
    if (!form) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/admin/stores/geocode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Couldn't look that up.");
      if (!d.found) setMsg({ ok: false, text: `${d.error || "Not found."} Tap the map or drag the pin to place it by hand.` });
      else { set({ lat: String(d.lat), lng: String(d.lng), manualPin: false }); setMsg({ ok: true, text: "Found it. Drag the pin if it's a little off." }); }
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't look that up." });
    }
    setBusy(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true); setMsg(null);
    try {
      const keepPin = form.manualPin || form.suggested;
      const body = { ...form, lat: keepPin ? form.lat : "", lng: keepPin ? form.lng : "", suggestedPin: !form.manualPin && !!form.suggested };
      const r = await fetch("/api/admin/stores", { method: form.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.store) throw new Error(d.error || "Couldn't save.");
      await load();
      if (d.store.geocodeError) { setForm(toForm(d.store)); setMsg({ ok: false, text: typeof d.store.lat === "number" ? `Saved. ${d.store.geocodeError}` : `Saved, but without a map pin: ${d.store.geocodeError}` }); }
      else { setForm(null); setMsg({ ok: true, text: `Saved ${d.store.name}.` }); }
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Couldn't save." });
    }
    setBusy(false);
  }

  // ↑ ↓ on each row: one tap moves the store up or down the list (and the public page).
  const [moving, setMoving] = useState<string | null>(null);
  async function move(s: StoreLocation, dir: "up" | "down") {
    setMoving(s.id);
    try {
      await fetch("/api/admin/stores", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: s.id, move: dir }) });
      await load();
    } finally {
      setMoving(null);
    }
  }

  async function quick(s: StoreLocation, patch: Record<string, unknown>, done: string) {
    setMsg(null);
    const r = await fetch("/api/admin/stores", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...toForm(s), lat: s.pinSource === "manual" ? s.lat : "", lng: s.pinSource === "manual" ? s.lng : "", ...patch, id: s.id }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg({ ok: false, text: d.error || "Couldn't save." }); return; }
    await load();
    setMsg({ ok: true, text: done });
  }

  async function remove(s: StoreLocation) {
    if (!confirm(`Delete ${s.name}? It disappears from the map straight away.`)) return;
    const r = await fetch(`/api/admin/stores?id=${encodeURIComponent(s.id)}`, { method: "DELETE" });
    if (!r.ok) { setMsg({ ok: false, text: "Couldn't delete it." }); return; }
    await load();
    setMsg({ ok: true, text: `Deleted ${s.name}.` });
  }

  const shownProducts = useMemo(() => {
    const n = pq.trim().toLowerCase();
    return products.filter((p) => !n || p.name.toLowerCase().includes(n) || form?.productIds.includes(p.id));
  }, [products, pq, form?.productIds]);

  return (
    <section className="admin-section">
      <h2>Store locations</h2>
      <p className="field-hint" style={{ marginTop: "-0.4rem" }}>
        Shops that carry {brand.shortName}, shown on the public <a href="/stores" target="_blank" rel="noopener">Find us in stores</a> page once the
        <strong> Store locator</strong> switch is on. The pin comes from the address; drag it if it&rsquo;s off.
      </p>

      {!form && (
        <button type="button" className="esc-btn primary" onClick={() => { setForm({ ...blank }); setMsg(null); }} style={{ marginBottom: "0.9rem" }}>+ Add a store</button>
      )}
      {msg && <div className={msg.ok ? "ap-ok" : "ap-bad"} style={{ margin: "0 0 0.8rem" }} role="status">{msg.text}</div>}

      {form && (
        <form className="store-form" onSubmit={save}>
          <div className="store-form-fields">
            <div className="field full st-street">
              <label htmlFor="st-name">Store name</label>
              <input
                id="st-name"
                value={form.name}
                onChange={(e) => { set({ name: e.target.value }); setSugFor("name"); setTyped(e.target.value); }}
                onFocus={() => sugFor === "name" && sugs.length && setSugOpen(true)}
                onBlur={() => setTimeout(() => setSugOpen(false), 150)}
                onKeyDown={(e) => { if (e.key === "Escape") setSugOpen(false); }}
                required
                maxLength={120}
                autoComplete="off"
                placeholder="Start typing the business name — pick it to fill in the address"
                aria-autocomplete="list"
                aria-controls="st-sugs-name"
              />
              {sugList("name")}
            </div>
            <div className="field full st-street">
              <label htmlFor="st-street">Street</label>
              <input
                id="st-street"
                value={form.street}
                onChange={(e) => { set({ street: e.target.value, manualPin: form.manualPin, suggested: false }); setSugFor("street"); setTyped(e.target.value); }}
                onFocus={() => sugFor === "street" && sugs.length && setSugOpen(true)}
                onBlur={() => setTimeout(() => setSugOpen(false), 150)}
                onKeyDown={(e) => { if (e.key === "Escape") setSugOpen(false); }}
                autoComplete="off"
                placeholder="Start typing — pick the address from the list"
                aria-autocomplete="list"
                aria-controls="st-sugs-street"
              />
              {sugList("street")}
            </div>
            <div className="store-form-row">
              <div className="field"><label htmlFor="st-city">City</label><input id="st-city" value={form.city} onChange={(e) => set({ city: e.target.value, suggested: false })} required /></div>
              <div className="field"><label htmlFor="st-state">State</label><input id="st-state" value={form.state} onChange={(e) => set({ state: e.target.value, suggested: false })} maxLength={40} /></div>
              <div className="field"><label htmlFor="st-zip">Zip</label><input id="st-zip" value={form.zip} onChange={(e) => set({ zip: e.target.value, suggested: false })} inputMode="numeric" maxLength={12} /></div>
            </div>
            <div className="store-form-row">
              <div className="field"><label htmlFor="st-phone">Phone</label><input id="st-phone" type="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} /></div>
              <div className="field"><label htmlFor="st-web">Website</label><input id="st-web" value={form.website} onChange={(e) => set({ website: e.target.value })} placeholder="example.com" /></div>
            </div>
            <div className="field full"><label htmlFor="st-hours">Hours</label><textarea id="st-hours" rows={2} value={form.hours} onChange={(e) => set({ hours: e.target.value })} placeholder="Mon–Sat 10–6, Sun 11–4" /></div>
            <div className="field full"><label htmlFor="st-notes">Notes (customers see this)</label><textarea id="st-notes" rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="e.g. On the wellness shelf by the register" /></div>
            <div className="field full">
              <label>Products carried (optional)</label>
              <input id="st-pq" type="search" value={pq} onChange={(e) => setPq(e.target.value)} placeholder="Filter products…" className="store-pq" />
              <div className="store-products">
                {shownProducts.map((p) => (
                  <label key={p.id} className={`store-product${form.productIds.includes(p.id) ? " on" : ""}`}>
                    <input type="checkbox" checked={form.productIds.includes(p.id)} onChange={(e) => set({ productIds: e.target.checked ? [...form.productIds, p.id] : form.productIds.filter((x) => x !== p.id) })} />
                    {p.name}
                  </label>
                ))}
              </div>
            </div>
            <label className="check-row"><input type="checkbox" checked={form.active} onChange={(e) => set({ active: e.target.checked })} /> <span>Show on the public map</span></label>
          </div>

          <div className="store-form-map">
            <div className="store-form-maptools">
              <button type="button" className="esc-btn" onClick={findOnMap} disabled={busy || !form.city}>Find on map</button>
              <span className="field-hint" style={{ margin: 0 }}>{form.manualPin ? "Pin placed by hand — kept on save." : form.suggested ? "Pin from the picked address — kept on save." : pin ? "Pin from the address." : "Tap the map to drop a pin."}</span>
            </div>
            <StoreMap stores={[]} editPin={pin} onPinMove={(lat, lng) => set({ lat: String(lat), lng: String(lng), manualPin: true })} theme="admin" height="300px" label="Store position" />
            <div className="store-form-row">
              <div className="field"><label htmlFor="st-lat">Latitude</label><input id="st-lat" inputMode="decimal" value={form.lat} onChange={(e) => setCoord("lat", e.target.value)} placeholder="38.918760, -119.995158" /></div>
              <div className="field"><label htmlFor="st-lng">Longitude</label><input id="st-lng" inputMode="decimal" value={form.lng} onChange={(e) => setCoord("lng", e.target.value)} /></div>
            </div>
            <div className="field-hint" style={{ marginTop: "-0.2rem" }}>Tip: paste both from Google Maps (right-click the spot → copy “38.91876, -119.99515”) into either box.</div>
            {form.manualPin && <button type="button" className="ap-linkbtn" onClick={() => set({ manualPin: false, lat: "", lng: "" })}>Use the address instead</button>}
          </div>

          <div className="store-form-actions">
            <button type="submit" className="esc-btn primary" disabled={busy}>{busy ? "Saving…" : form.id ? "Save changes" : "Add store"}</button>
            <button type="button" className="esc-btn" onClick={() => { setForm(null); setMsg(null); }} disabled={busy}>Cancel</button>
          </div>
        </form>
      )}

      {stores === null ? (
        <div className="empty" style={{ padding: "1rem 0" }}>Loading…</div>
      ) : stores.length === 0 && !form ? (
        <div className="empty" style={{ padding: "1rem 0" }}>No stores yet. Add the first one above.</div>
      ) : (
        <div className="admin-list">
          {stores.map((s, i) => (
            <div key={s.id} className="user-row">
              <div className="user-main">
                <div className="name dc-name">
                  {s.name}
                  {!s.active && <span className="dc-chip inactive">Hidden</span>}
                  {typeof s.lat !== "number" && <span className="dc-chip ended">No pin</span>}
                  {typeof s.lat === "number" && s.geocodeError && s.pinSource !== "manual" && <span className="dc-chip ended" title={s.geocodeError}>Pin approximate</span>}
                  {s.pinSource === "manual" && <span className="dc-chip soon">Pin by hand</span>}
                </div>
                <div className="email">{[s.street, s.city, s.state, s.zip].filter(Boolean).join(", ")}</div>
                <div className="user-meta">{s.productIds?.length ? `${s.productIds.length} product${s.productIds.length === 1 ? "" : "s"} listed` : "No products listed"}{s.phone ? ` · ${s.phone}` : ""}</div>
              </div>
              <div className="user-actions">
                <div className="prod-move">
                  <button onClick={() => move(s, "up")} disabled={i === 0 || !!moving} title="Move up" aria-label={`Move ${s.name} up`}>↑</button>
                  <button onClick={() => move(s, "down")} disabled={i === stores.length - 1 || !!moving} title="Move down" aria-label={`Move ${s.name} down`}>↓</button>
                </div>
                <button onClick={() => { setForm(toForm(s)); setMsg(null); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Edit</button>
                <button onClick={() => quick(s, { active: !s.active }, s.active ? `${s.name} is hidden from the map.` : `${s.name} is on the map.`)}>{s.active ? "Hide" : "Show"}</button>
                <button className="danger" onClick={() => remove(s)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
