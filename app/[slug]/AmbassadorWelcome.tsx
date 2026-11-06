"use client";

import { useEffect, useRef, useState } from "react";
import { AMBASSADOR_LOOKS, welcomeKey, type LookKey } from "@/lib/ambassadorLooks";
import { brand } from "@/lib/brand";

/**
 * An ambassador's welcome (switch `ambassador_welcome`): about 3.5 s, once per
 * visit per ambassador, tap or any key skips. Their photo appears in a glowing
 * ring, their headline writes in and their emoji drift up, in their page's look
 * (aw-* + amb-look-* in globals.css). Only transforms and opacity animate.
 *
 * The inline script in page.tsx decides before the first paint whether it plays
 * (<html data-amb-welcome="play|skip">), so a repeat visit never flashes it and
 * the page's own reveal waits underneath until it lifts ("done").
 */

const PLAY_MS = 3300;
const LEAVE_MS = 650;

// Fixed positions so server and browser render the same thing.
const STARS = Array.from({ length: 28 }, (_, i) => ({
  left: (i * 37 + 11) % 100,
  top: (i * 53 + 7) % 100,
  size: 1 + ((i * 7) % 3),
  delay: ((i * 13) % 20) / 10,
}));
const DRIFT = Array.from({ length: 14 }, (_, i) => ({
  left: 4 + ((i * 29 + 5) % 92),
  delay: ((i * 17) % 14) / 10,
  dur: 2.6 + ((i * 11) % 9) / 10,
  size: 0.9 + ((i * 5) % 7) / 6,
  sway: (i % 2 ? 1 : -1) * (8 + ((i * 3) % 14)),
}));

export default function AmbassadorWelcome({
  slug,
  look,
  title,
  name,
  photo,
  emoji,
  force = false,
}: {
  slug: string;
  look: LookKey;
  title: string;
  name: string;
  photo?: string;
  emoji?: string | null;
  force?: boolean;
}) {
  const [phase, setPhase] = useState<"play" | "leave" | "gone">("play");
  const timers = useRef<number[]>([]);
  const first = name.split(" ")[0];
  const glyphs = AMBASSADOR_LOOKS[look].glyphs;

  const finish = () => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
    setPhase("gone");
    const h = document.documentElement;
    h.style.removeProperty("overflow");
    h.setAttribute("data-amb-welcome", "done");
  };
  const leave = () => {
    setPhase((p) => (p === "play" ? "leave" : p));
    timers.current.push(window.setTimeout(finish, LEAVE_MS));
  };

  useEffect(() => {
    const h = document.documentElement;
    let mode = h.getAttribute("data-amb-welcome");
    if (mode !== "play" && mode !== "skip") {
      // Reached without a full page load (the script didn't run): decide here.
      try {
        mode = !force && (sessionStorage.getItem(welcomeKey(slug)) || matchMedia("(prefers-reduced-motion: reduce)").matches) ? "skip" : "play";
      } catch {
        mode = "skip";
      }
    }
    if (mode === "skip") {
      setPhase("gone");
      h.setAttribute("data-amb-welcome", "done");
      return;
    }
    h.setAttribute("data-amb-welcome", "play");
    try {
      sessionStorage.setItem(welcomeKey(slug), "1");
    } catch {}
    h.style.overflow = "hidden";
    timers.current.push(window.setTimeout(leave, PLAY_MS));
    const key = () => leave();
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      timers.current.forEach((t) => clearTimeout(t));
      h.style.removeProperty("overflow");
      h.removeAttribute("data-amb-welcome");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, force]);

  if (phase === "gone") return null;
  return (
    <div className={`amb-welcome amb-look-${look}${phase === "leave" ? " is-leaving" : ""}`} onClick={leave} aria-hidden="true">
      <div className="aw-sky" />
      <div className="aw-stars">
        {STARS.map((s, i) => (
          <span key={i} style={{ left: `${s.left}%`, top: `${s.top}%`, width: s.size * 2, height: s.size * 2, animationDelay: `${s.delay}s` }} />
        ))}
      </div>
      <div className="aw-glow" />
      <div className="aw-center">
        <div className="aw-ring">
          <svg viewBox="0 0 120 120" className="aw-ring-line">
            <circle cx="60" cy="60" r="56" pathLength={100} />
          </svg>
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="" />
          ) : (
            <span className="aw-initial">{first.slice(0, 1)}</span>
          )}
          {emoji && <span className="aw-badge">{emoji}</span>}
        </div>
        <div className="aw-kicker">{brand.name} &times; {first}</div>
        <div className="aw-title">{title}</div>
        <div className="aw-sub">Hand-picked by {name}</div>
      </div>
      <div className="aw-drift">
        {DRIFT.map((d, i) => (
          <span
            key={i}
            style={{ left: `${d.left}%`, animationDelay: `${0.5 + d.delay}s`, animationDuration: `${d.dur}s`, fontSize: `${d.size}rem`, ["--sway" as string]: `${d.sway}px` }}
          >
            {emoji && i % 2 === 0 ? emoji : glyphs[i % glyphs.length]}
          </span>
        ))}
      </div>
      <span className="aw-skip">Tap to skip</span>
    </div>
  );
}
