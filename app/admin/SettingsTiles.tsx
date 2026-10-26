"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// Settings → compact tiles. Each setting is a small card; clicking one grows it
// into a full-width panel in place (the other tiles flow around it), and ✕
// shrinks it back. Which tile is open is remembered per device.

export type SettingsTile = {
  key: string;
  icon: string;
  title: string;
  summary: string;
  /** Small count shown on the tile, e.g. expired orders. */
  badge?: number;
  render: () => ReactNode;
};

const STORE_KEY = "fp_settings_open";

export default function SettingsTiles({ tiles }: { tiles: SettingsTile[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const openRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      if (saved && tiles.some((t) => t.key === saved)) setOpen(saved);
    } catch {}
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function show(key: string | null) {
    setOpen(key);
    try {
      if (key) localStorage.setItem(STORE_KEY, key);
      else localStorage.removeItem(STORE_KEY);
    } catch {}
    if (key) {
      // Let the panel render, then bring it into view (it may have opened below the fold).
      requestAnimationFrame(() => openRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }

  // Esc closes the open panel, like the other dialogs in the dashboard.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) show(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className={`settings-grid${ready ? " is-ready" : ""}`}>
      {tiles.map((t) =>
        open === t.key ? (
          <div key={t.key} className="settings-open" ref={openRef}>
            <button type="button" className="settings-close" onClick={() => show(null)} aria-label={`Close ${t.title}`} title="Close (Esc)">
              ×
            </button>
            {t.render()}
          </div>
        ) : (
          <button key={t.key} type="button" className="settings-tile" onClick={() => show(t.key)} aria-expanded={false}>
            <span className="settings-tile-icon" aria-hidden="true">{t.icon}</span>
            <span className="settings-tile-text">
              <strong>
                {t.title}
                {!!t.badge && <span className="settings-tile-badge">{t.badge}</span>}
              </strong>
              <small>{t.summary}</small>
            </span>
            <span className="settings-tile-go" aria-hidden="true">Open ↗</span>
          </button>
        )
      )}
    </div>
  );
}
