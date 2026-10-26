"use client";

import { useEffect } from "react";

/**
 * The "there's more down here" nudge.
 *
 * Shortly after the homepage settles, the window glides down a little and
 * back up, so the top edge of the shop below physically peeks into view.
 * It reads as the page breathing rather than as an animation, and it answers
 * the question "is this sign-in box the whole site?" without any copy.
 *
 * Deliberately restrained: once per browser session, only from a standing
 * start at the top, never when the visitor has already touched the page, and
 * never for anyone who asked for reduced motion.
 */

const START_DELAY_MS = 1800; // after the sign-in card has finished arriving
const PEEK_DEPTH_PX = 68;
const SESSION_KEY = "fp_home_peeked";

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export default function ScrollHint() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Only the first visit of the session — nobody needs to be told twice.
    try {
      if (sessionStorage.getItem(SESSION_KEY)) return;
    } catch {
      /* private mode / storage disabled — just carry on */
    }
    if (window.scrollY > 4) return;

    let cancelled = false;
    let raf = 0;
    const events = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

    function cleanup() {
      events.forEach((e) => window.removeEventListener(e, cancel));
      document.body.classList.remove("is-peeking");
    }
    function cancel() {
      cancelled = true;
      cancelAnimationFrame(raf);
      cleanup();
    }

    events.forEach((e) => window.addEventListener(e, cancel, { passive: true }));

    function glide(from: number, to: number, ms: number, ease: (t: number) => number) {
      return new Promise<void>((resolve) => {
        const started = performance.now();
        const step = (now: number) => {
          if (cancelled) return resolve();
          const t = Math.min(1, (now - started) / ms);
          window.scrollTo(0, from + (to - from) * ease(t));
          if (t < 1) raf = requestAnimationFrame(step);
          else resolve();
        };
        raf = requestAnimationFrame(step);
      });
    }

    const timer = window.setTimeout(async () => {
      if (cancelled || window.scrollY > 4) return;
      try {
        sessionStorage.setItem(SESSION_KEY, "1");
      } catch {
        /* ignore */
      }
      document.body.classList.add("is-peeking");
      await glide(0, PEEK_DEPTH_PX, 430, easeOut);
      await new Promise((r) => setTimeout(r, 320));
      if (!cancelled) await glide(window.scrollY, 0, 580, easeInOut);
      cleanup();
    }, START_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      cleanup();
    };
  }, []);

  return null;
}
