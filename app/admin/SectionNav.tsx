"use client";

import { useEffect, useState, type ReactNode } from "react";
import Glyph, { type GlyphName } from "./Glyph";

// A row of small cards that splits a long admin tab into sections (Marketing,
// Assistant). Each card shows its name and a one-line status, and only the
// chosen section is shown below. The choice is remembered per device.

export type SectionItem<K extends string> = {
  key: K;
  icon: GlyphName;
  label: string;
  /** One short line under the name, e.g. "84 active subscribers". */
  status?: ReactNode;
  /** Small count on the card, e.g. codes that are live. */
  badge?: number;
  /** Draws attention to the card (something is waiting). */
  alert?: boolean;
};

/** The chosen section, remembered in localStorage under `storeKey`. */
export function useSection<K extends string>(storeKey: string, keys: readonly K[], fallback: K): [K, (k: K) => void] {
  const [sel, setSel] = useState<K>(fallback);
  // Read after mount so the server and first client render agree.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storeKey) as K | null;
      if (saved && keys.includes(saved)) setSel(saved);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const choose = (k: K) => {
    setSel(k);
    try {
      localStorage.setItem(storeKey, k);
    } catch {}
  };
  return [sel, choose];
}

export default function SectionNav<K extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: Array<SectionItem<K>>;
  value: K;
  onChange: (k: K) => void;
  label: string;
}) {
  return (
    <nav className="secnav" role="tablist" aria-label={label}>
      {items.map((it) => {
        const on = it.key === value;
        return (
          <button
            key={it.key}
            type="button"
            role="tab"
            aria-selected={on}
            className={`secnav-card${on ? " is-on" : ""}${it.alert ? " is-alert" : ""}`}
            onClick={() => onChange(it.key)}
          >
            <span className="secnav-icon" aria-hidden="true"><Glyph name={it.icon} /></span>
            <span className="secnav-text">
              <strong>
                {it.label}
                {!!it.badge && <span className="secnav-badge">{it.badge}</span>}
              </strong>
              {it.status !== undefined && <small>{it.status}</small>}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
