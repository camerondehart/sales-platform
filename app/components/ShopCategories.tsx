"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ShopCategory } from "@/lib/shopCategories";

/**
 * Members' shop category filter (tablet and desktop; phones use the dropdown).
 * One quiet capsule row: All, then as many of the biggest categories as fit on one line,
 * then "More" opening a tidy panel with every category and its count.
 */
export default function ShopCategories({
  categories,
  total,
  otherCount,
  active,
  onChange,
}: {
  categories: ShopCategory[];
  total: number;
  otherCount: number;
  active: string;
  onChange: (key: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(categories.length);
  const [open, setOpen] = useState(false);

  // Work out how many category buttons fit on one line beside All and More.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const measure = measureRef.current;
    if (!wrap || !measure) return;
    const calc = () => {
      const kids = Array.from(measure.children) as HTMLElement[];
      if (kids.length < 2) return;
      const gap = 2;
      const chrome = 12; // track padding + border
      const avail = Math.min(wrap.clientWidth, 980) - chrome;
      const allW = kids[0].offsetWidth;
      const moreW = kids[kids.length - 1].offsetWidth;
      const widths = kids.slice(1, -1).map((k) => k.offsetWidth);
      const sumAll = allW + widths.reduce((s, w) => s + w + gap, 0);
      if (otherCount === 0 && sumAll <= avail) {
        setFit(widths.length);
        return;
      }
      const count = (more: number) => {
        let used = allW + gap + more;
        let n = 0;
        while (n < widths.length && used + widths[n] + gap <= avail) {
          used += widths[n] + gap;
          n++;
        }
        return n;
      };
      let n = count(moreW);
      // A chosen category tucked under More shows its own name there, so leave room for it.
      const ai = categories.findIndex((c) => c.key === active);
      if (ai >= n) n = count(Math.max(moreW, widths[ai] + 18));
      setFit(n);
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(wrap);
    // Web fonts can land after first paint and change every width.
    document.fonts?.ready.then(calc).catch(() => {});
    return () => ro.disconnect();
  }, [categories, otherCount, active]);

  // Close the panel on an outside tap or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const shown = categories.slice(0, fit);
  const hidden = categories.slice(fit);
  const hasMore = hidden.length > 0 || otherCount > 0;
  const activeHidden =
    active === "__other" ? "Other" : hidden.find((c) => c.key === active)?.label;

  function pick(key: string) {
    onChange(key);
    setOpen(false);
  }

  return (
    <div className="shop-cats" ref={wrapRef}>
      <div className="sc-track" role="group" aria-label="Filter by category">
        <button
          type="button"
          className={`sc-item${active === "all" ? " active" : ""}`}
          aria-pressed={active === "all"}
          onClick={() => pick("all")}
        >
          All
        </button>
        {shown.map((c) => (
          <button
            type="button"
            key={c.key}
            className={`sc-item${active === c.key ? " active" : ""}`}
            aria-pressed={active === c.key}
            onClick={() => pick(c.key)}
          >
            {c.label}
          </button>
        ))}
        {hasMore && (
          <button
            type="button"
            className={`sc-item sc-more${activeHidden ? " active" : ""}${open ? " open" : ""}`}
            aria-expanded={open}
            aria-haspopup="true"
            onClick={() => setOpen((v) => !v)}
          >
            <span className="sc-more-label">{activeHidden || "More"}</span>
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>

      {open && (
        <div className="sc-panel" role="menu">
          <div className="sc-panel-head">
            <span>All categories</span>
            <button type="button" className="sc-panel-all" onClick={() => pick("all")}>
              Show all {total}
            </button>
          </div>
          <div className="sc-panel-grid">
            {categories.map((c) => (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={active === c.key}
                key={c.key}
                className={`sc-opt${active === c.key ? " active" : ""}`}
                onClick={() => pick(c.key)}
              >
                <span>{c.label}</span>
                <em>{c.count}</em>
              </button>
            ))}
            {otherCount > 0 && (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={active === "__other"}
                className={`sc-opt${active === "__other" ? " active" : ""}`}
                onClick={() => pick("__other")}
              >
                <span>Other</span>
                <em>{otherCount}</em>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Off-screen copy used only to measure button widths. */}
      <div className="sc-track sc-measure" ref={measureRef} aria-hidden="true">
        <span className="sc-item">All</span>
        {categories.map((c) => (
          <span key={c.key} className="sc-item">{c.label}</span>
        ))}
        <span className="sc-item sc-more">
          <span className="sc-more-label">More</span>
          <svg viewBox="0 0 12 12" />
        </span>
      </div>
    </div>
  );
}
