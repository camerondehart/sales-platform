"use client";

import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";

/**
 * A light layer of seasonal things drifting down behind the page (leaves,
 * snow, petals; hearts float up). Fixed, behind content, never clickable.
 * Not on staff pages; hidden for anyone who asks their device to reduce motion
 * (CSS). Seasonal site backgrounds: lib/seasonLooks.ts.
 */
const GLYPH: Record<string, string> = { heart: "♥", shamrock: "☘", star: "★" };
/** Mixed leaves (fall, Thanksgiving): maple, oak and the plain leaf in turn. */
const LEAF_SHAPES = [" s-maple", "", " s-oak"];

export default function SeasonDrift({ kind, colors, count, mixed }: { kind: string; colors: string[]; count: number; mixed?: boolean }) {
  const path = usePathname() || "";
  if (path.startsWith("/admin") || path.startsWith("/help")) return null;
  return (
    <div className={`season-drift k-${kind}`} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className={`season-drop${mixed && kind === "leaf" ? LEAF_SHAPES[i % 3] : ""}`}
          style={
            {
              left: `${(i * 37 + 5) % 100}%`,
              background: GLYPH[kind] ? undefined : colors[i % colors.length],
              color: colors[i % colors.length],
              animationDuration: `${14 + (i % 6) * 3}s`,
              animationDelay: `${-((i * 2.7) % 18)}s`,
              "--dx": `${(i % 2 ? 1 : -1) * (30 + (i % 5) * 22)}px`,
              "--sz": `${kind === "snow" ? 4 + (i % 4) * 2 : GLYPH[kind] ? 12 + (i % 3) * 4 : 9 + (i % 3) * 3}px`,
              "--op": `${0.35 + (i % 4) * 0.12}`,
            } as CSSProperties
          }
        >
          {GLYPH[kind] || null}
        </span>
      ))}
    </div>
  );
}
