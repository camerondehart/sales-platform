"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { buildMapStyle, type MapTokens } from "@/lib/mapStyle";

// The store map: MapLibre + OpenFreeMap tiles, styled from the site's theme
// tokens (lib/mapStyle.ts). Store pins are brand-coloured markers; popups use
// the site's card look. In the dashboard it follows the light/dark switch live.
// MapLibre is loaded only when a map is on screen.

export type MapStore = {
  id: string;
  name: string;
  lat?: number;
  lng?: number;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  hours?: string;
};

type Props = {
  stores: MapStore[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Admin form: one draggable pin instead of the store pins. */
  editPin?: { lat: number; lng: number } | null;
  onPinMove?: (lat: number, lng: number) => void;
  /** "admin" follows the dashboard's dark switch; "site" is the light customer look. */
  theme?: "site" | "admin";
  height?: string;
  label?: string;
};

const US_CENTER: [number, number] = [-98.5, 39.8];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function storeAddress(s: Pick<MapStore, "street" | "city" | "state" | "zip">) {
  return [s.street, [s.city, [s.state, s.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(", ");
}

/** Apple Maps on iPhone/iPad, Google Maps everywhere else. */
export function directionsUrl(s: MapStore): string {
  const ios = typeof navigator !== "undefined" && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
  const dest = typeof s.lat === "number" && typeof s.lng === "number" ? `${s.lat},${s.lng}` : storeAddress(s);
  return ios
    ? `https://maps.apple.com/?daddr=${encodeURIComponent(dest)}&q=${encodeURIComponent(s.name)}`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
}

export const telHref = (phone: string) => `tel:${phone.replace(/[^+0-9]/g, "")}`;

function readTokens(theme: "site" | "admin"): MapTokens {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  const dark = theme === "admin" && document.documentElement.getAttribute("data-admin-theme") === "dark";
  return {
    bg: v("--paper", dark ? "#15190f" : "#f9f9f8"),
    surface: v("--surface", dark ? "#1c2216" : "#f9f9f8"),
    ink: v("--ink", dark ? "#e4e8dc" : "#61676d"),
    muted: v("--ink-soft", dark ? "#a3ab9d" : "#81858b"),
    rule: v("--rule", dark ? "#3b4535" : "#abaeb2"),
    accent: v("--green", "#85ba45"),
    water: v("--mint", "#0fc7a3"),
    dark,
  };
}

function popupHtml(s: MapStore): string {
  const addr = storeAddress(s);
  return `<div class="store-popup">
    <strong>${esc(s.name)}</strong>
    ${addr ? `<span>${esc(addr)}</span>` : ""}
    ${s.hours ? `<small>${esc(s.hours)}</small>` : ""}
    <div class="store-popup-links">
      ${s.phone ? `<a href="${esc(telHref(s.phone))}">Call</a>` : ""}
      <a href="${esc(directionsUrl(s))}" rel="noopener">Directions</a>
    </div>
  </div>`;
}

export default function StoreMap({ stores, selectedId, onSelect, editPin, onPinMove, theme = "site", height = "420px", label = "Map of stores" }: Props) {
  const box = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const libRef = useRef<any>(null);
  const markers = useRef<Map<string, { marker: any; popup: any }>>(new Map());
  const pinRef = useRef<any>(null);
  const moveCb = useRef(onPinMove);
  moveCb.current = onPinMove;
  const selectCb = useRef(onSelect);
  selectCb.current = onSelect;
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let observer: MutationObserver | null = null;
    (async () => {
      try {
        const lib = (await import("maplibre-gl")).default;
        if (cancelled || !box.current) return;
        libRef.current = lib;
        const map = new lib.Map({
          container: box.current,
          style: buildMapStyle(readTokens(theme)),
          center: editPin ? [editPin.lng, editPin.lat] : US_CENTER,
          zoom: editPin ? 14 : 3,
          attributionControl: { compact: true },
          cooperativeGestures: false,
          dragRotate: false,
          pitchWithRotate: false,
        });
        map.addControl(new lib.NavigationControl({ showCompass: false }), "top-right");
        map.touchZoomRotate.disableRotation();
        map.on("error", (e: any) => {
          // Tile hiccups are normal; only give up if the style itself can't load.
          if (!map.isStyleLoaded() && /style|webgl/i.test(String(e?.error?.message || ""))) setFailed(true);
        });
        if (editPin !== undefined) {
          map.on("click", (e: any) => {
            moveCb.current?.(Math.round(e.lngLat.lat * 1e6) / 1e6, Math.round(e.lngLat.lng * 1e6) / 1e6);
          });
        }
        mapRef.current = map;
        setReady(true);
        if (theme === "admin") {
          // Follow the dashboard's light/dark switch live.
          observer = new MutationObserver(() => mapRef.current?.setStyle(buildMapStyle(readTokens(theme))));
          observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-admin-theme"] });
        }
      } catch {
        setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      observer?.disconnect();
      markers.current.forEach(({ marker }) => marker.remove());
      markers.current.clear();
      pinRef.current?.remove();
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  // Store pins.
  useEffect(() => {
    const map = mapRef.current, lib = libRef.current;
    if (!ready || !map || !lib || editPin !== undefined) return;
    markers.current.forEach(({ marker }) => marker.remove());
    markers.current.clear();
    const located = stores.filter((s) => typeof s.lat === "number" && typeof s.lng === "number");
    for (const s of located) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "store-pin";
      el.setAttribute("aria-label", s.name);
      el.innerHTML = "<span></span>";
      const popup = new lib.Popup({ offset: 26, closeButton: true, maxWidth: "260px", className: "store-popup-wrap" }).setHTML(popupHtml(s));
      const marker = new lib.Marker({ element: el, anchor: "bottom" }).setLngLat([s.lng!, s.lat!]).setPopup(popup).addTo(map);
      el.addEventListener("click", () => selectCb.current?.(s.id));
      markers.current.set(s.id, { marker, popup });
    }
    if (located.length === 1) map.jumpTo({ center: [located[0].lng!, located[0].lat!], zoom: 12 });
    else if (located.length > 1) {
      const b = new lib.LngLatBounds();
      located.forEach((s) => b.extend([s.lng!, s.lat!]));
      map.fitBounds(b, { padding: 48, maxZoom: 13, duration: 0 });
    }
  }, [ready, stores, editPin]);

  // Fly to a store chosen in the list.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !selectedId) return;
    const hit = markers.current.get(selectedId);
    const s = stores.find((x) => x.id === selectedId);
    if (!hit || !s || typeof s.lat !== "number") return;
    markers.current.forEach(({ popup }) => popup.isOpen() && popup.remove());
    map.flyTo({ center: [s.lng!, s.lat], zoom: Math.max(map.getZoom(), 13), duration: 600 });
    hit.marker.togglePopup();
  }, [ready, selectedId, stores]);

  // Admin: the draggable pin.
  useEffect(() => {
    const map = mapRef.current, lib = libRef.current;
    if (!ready || !map || !lib || editPin === undefined) return;
    if (!editPin) {
      pinRef.current?.remove();
      pinRef.current = null;
      return;
    }
    if (!pinRef.current) {
      const el = document.createElement("div");
      el.className = "store-pin is-edit";
      el.innerHTML = "<span></span>";
      pinRef.current = new lib.Marker({ element: el, anchor: "bottom", draggable: true }).setLngLat([editPin.lng, editPin.lat]).addTo(map);
      pinRef.current.on("dragend", () => {
        const p = pinRef.current.getLngLat();
        moveCb.current?.(Math.round(p.lat * 1e6) / 1e6, Math.round(p.lng * 1e6) / 1e6);
      });
      map.jumpTo({ center: [editPin.lng, editPin.lat], zoom: Math.max(map.getZoom(), 14) });
    } else {
      pinRef.current.setLngLat([editPin.lng, editPin.lat]);
      if (!map.getBounds().contains([editPin.lng, editPin.lat])) map.easeTo({ center: [editPin.lng, editPin.lat], duration: 400 });
    }
  }, [ready, editPin]);

  if (failed) {
    return (
      <div className="store-map store-map-failed" style={{ height }} role="note">
        The map couldn&rsquo;t load on this device. Every store is in the list.
      </div>
    );
  }
  return <div ref={box} className="store-map" style={{ height }} role="region" aria-label={label} />;
}
