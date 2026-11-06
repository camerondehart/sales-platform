"use client";

import { useEffect, useRef, useState } from "react";
// react-dom ships without its own types here (@types/react-dom isn't installed); createPortal is all we use.
// @ts-expect-error no type declarations for react-dom
import { createPortal } from "react-dom";
import ForestEntrance from "./ForestEntrance";
import type { EntranceKey } from "@/lib/entranceThemes";

/** Plays one entrance full-screen (staff previews), with the members' timing. Tap to stop. */
export default function EntrancePlayer({ theme, onDone }: { theme: EntranceKey; onDone: () => void }) {
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const t = setTimeout(() => done.current(), 4000);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && done.current();
    window.addEventListener("keydown", esc);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", esc);
    };
  }, [theme]);
  // Rendered into <body> so nothing on the page (or the Concierge panel) sits above it.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(<ForestEntrance key={theme} theme={theme} onSkip={onDone} />, document.body);
}
