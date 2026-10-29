"use client";

import { useEffect, useRef, useState } from "react";

// A "More ▾" menu for list rows: the everyday actions stay as buttons, the
// rest live here. Closes on choosing, clicking outside, or Esc. Each item runs
// exactly the handler its old button did.

export type RowMenuItem = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Shown under the label, e.g. why it's disabled. */
  hint?: string;
  danger?: boolean;
  /** Draws a divider above this item. */
  separated?: boolean;
  title?: string;
};

export default function RowMenu({ items, label = "More" }: { items: RowMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const btn = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent | TouchEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); btn.current?.focus(); }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    if (!open && btn.current) {
      // Open upwards when there isn't room below (rows near the bottom of the screen).
      const r = btn.current.getBoundingClientRect();
      setUp(window.innerHeight - r.bottom < 60 + items.length * 44);
    }
    setOpen((o) => !o);
  }

  return (
    <div className="row-menu" ref={wrap}>
      <button ref={btn} type="button" className="row-menu-btn" aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
        {label} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className={`row-menu-list${up ? " is-up" : ""}`} role="menu">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={`row-menu-item${it.danger ? " is-danger" : ""}${it.separated ? " is-sep" : ""}`}
              disabled={it.disabled}
              title={it.title}
              onClick={() => { setOpen(false); it.onSelect(); }}
            >
              <span>{it.label}</span>
              {it.hint && <small>{it.hint}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
