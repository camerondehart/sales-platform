"use client";

import { useMemo, useState } from "react";
import StoreMap, { directionsUrl, storeAddress, telHref } from "@/app/components/StoreMap";
import type { PublicStore } from "@/lib/stores";
import { brand } from "@/lib/brand";

// /stores: map + list. "Use my location" only asks the browser after a tap,
// and the position never leaves the device (distances are worked out here).

const miles = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 3958.8, r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};

export default function StoresClient({ stores, productNames, initialProduct }: { stores: PublicStore[]; productNames: Record<string, string>; initialProduct: string | null }) {
  const [q, setQ] = useState("");
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locMsg, setLocMsg] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [product, setProduct] = useState<string | null>(initialProduct);

  const productName = product ? productNames[product] || "this product" : "";

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = stores.filter((s) => {
      if (product && !(s.productIds || []).includes(product)) return false;
      if (!needle) return true;
      return [s.city, s.zip, s.state, s.name, s.street].some((f) => (f || "").toLowerCase().includes(needle));
    });
    const withDist = out.map((s) => ({ s, d: me && typeof s.lat === "number" && typeof s.lng === "number" ? miles(me, { lat: s.lat, lng: s.lng! }) : null }));
    if (me) withDist.sort((a, b) => (a.d ?? Infinity) - (b.d ?? Infinity));
    return withDist;
  }, [stores, q, me, product]);

  function locate() {
    if (!("geolocation" in navigator)) { setLocMsg("This browser can't share its location. Search by city or zip instead."); return; }
    setLocating(true); setLocMsg("");
    navigator.geolocation.getCurrentPosition(
      (p) => { setMe({ lat: p.coords.latitude, lng: p.coords.longitude }); setLocating(false); setLocMsg("Sorted by distance from you."); },
      () => { setLocating(false); setLocMsg("Location wasn't shared. Search by city or zip instead."); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
    );
  }

  return (
    <main className="stores">
      <div className="about-hero stores-hero">
        <div className="about-kicker">Find us in stores</div>
        <h2 className="about-title">Pick some up in person</h2>
        <p className="about-lede">Shops near you that carry {brand.shortName}. Call ahead to check what&rsquo;s on the shelf.</p>
      </div>

      {product && (
        <div className="stores-filter">
          Showing stores that carry <strong>{productName}</strong>.{" "}
          <button type="button" className="ap-linkbtn" onClick={() => setProduct(null)}>Show all stores</button>
        </div>
      )}

      <div className="stores-tools">
        <input id="stores-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by city or zip" aria-label="Search stores by city or zip" inputMode="search" />
        <button type="button" className="esc-btn" onClick={locate} disabled={locating}>{locating ? "Finding you…" : "Use my location"}</button>
      </div>
      {locMsg && <p className="field-hint stores-locmsg" role="status">{locMsg}</p>}

      <div className="stores-layout">
        <div className="stores-map-col">
          <StoreMap stores={list.map((x) => x.s)} selectedId={selected} onSelect={setSelected} theme="site" height="min(60vh, 520px)" label={`Map of stores that carry ${brand.shortName}`} />
        </div>
        <ol className="stores-list" aria-label="Stores">
          {list.length === 0 && (
            <li className="empty" style={{ padding: "1.5rem 0" }}>
              {stores.length === 0 ? "No stores listed yet. Check back soon." : product && !q ? `No stores list ${productName} yet.` : `No stores match “${q.trim()}”.`}
            </li>
          )}
          {list.map(({ s, d }) => (
            <li key={s.id} className={`store-card${selected === s.id ? " is-selected" : ""}`}>
              <button type="button" className="store-card-name" onClick={() => setSelected(s.id)} disabled={typeof s.lat !== "number"} title={typeof s.lat === "number" ? "Show on the map" : undefined}>
                {s.name}
                {d !== null && <span className="store-dist">{d < 10 ? d.toFixed(1) : Math.round(d)} mi</span>}
              </button>
              <div className="store-addr">{storeAddress(s)}</div>
              {s.hours && <div className="store-hours">{s.hours}</div>}
              {s.notes && <div className="store-notes">{s.notes}</div>}
              {(() => {
                // Public products only (productNames holds just those).
                const carries = (s.productIds || []).map((id) => productNames[id]).filter(Boolean);
                return carries.length ? (
                  <div className="store-carries">
                    <span>Carries</span>
                    <ul>{carries.map((n) => <li key={n}>{n}</li>)}</ul>
                  </div>
                ) : null;
              })()}
              <div className="store-actions">
                {s.phone && <a className="esc-btn" href={telHref(s.phone)}>Call {s.phone}</a>}
                {/* Same tab: iOS only hands a link to the Maps app on a same-tab navigation. */}
                <a className="esc-btn primary" href={directionsUrl(s)} rel="noopener">Directions</a>
                {s.website && <a className="ap-linkbtn" href={s.website} target="_blank" rel="noopener">Website ↗</a>}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </main>
  );
}
