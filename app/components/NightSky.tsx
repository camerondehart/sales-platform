"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";
import { isNightAt, isNightLocal, isStaffPath } from "@/lib/nightSky";

/**
 * The night sky over the valley (switch `night_sky`, lib/nightSky.ts): a glowing
 * moon, twinkling stars and fireflies wandering over the meadow. Shown while
 * <html data-night="1">, which the <head> script sets before the first paint from
 * where the visitor is (rough area from their internet address, else their own clock); this re-checks every minute so dusk falls (and dawn
 * breaks) while the page is open. Fixed, behind the content, never clickable,
 * never on staff pages. Anyone who asks their device to reduce motion gets a
 * still sky (CSS). Only transforms and opacity animate.
 */
const STARS = 34;
const SPARKLES = 7;
const FLIES = 14;

export default function NightSky({ force, area }: { force?: "on" | "off" | null; area?: { lat: number; lon: number } | null }) {
  const path = usePathname() || "";
  const [night, setNight] = useState(false);

  useEffect(() => {
    const decide = () => (isStaffPath(location.pathname) ? false : force === "on" ? true : force === "off" ? false : area ? isNightAt(Date.now(), area.lat, area.lon) : isNightLocal(new Date()));
    const apply = () => {
      const n = decide();
      if (n) document.documentElement.setAttribute("data-night", "1");
      else document.documentElement.removeAttribute("data-night");
      setNight(n);
    };
    apply();
    const t = setInterval(apply, 60_000);
    return () => clearInterval(t);
  }, [force, path, area?.lat, area?.lon]);

  if (!night || isStaffPath(path)) return null;
  return (
    <div className="night-sky" aria-hidden="true">
      <div className="night-moon">
        <svg viewBox="0 0 100 100">
          <circle className="nm-face" cx="50" cy="50" r="50" />
          <circle className="nm-crater" cx="34" cy="38" r="8" />
          <circle className="nm-crater" cx="62" cy="62" r="10" />
          <circle className="nm-crater" cx="64" cy="30" r="5" />
          <circle className="nm-crater" cx="38" cy="70" r="4" />
        </svg>
      </div>
      {Array.from({ length: STARS }).map((_, i) => (
        <span
          key={`s${i}`}
          className="night-star"
          style={
            {
              left: `${(i * 37 + 3) % 100}%`,
              top: `${1 + ((i * 53) % 44)}%`,
              animationDuration: `${2.4 + (i % 5) * 0.9}s`,
              animationDelay: `${-((i * 0.7) % 5)}s`,
              "--sz": `${1.5 + (i % 3)}px`,
            } as CSSProperties
          }
        />
      ))}
      {Array.from({ length: SPARKLES }).map((_, i) => (
        <svg
          key={`k${i}`}
          className="night-sparkle"
          viewBox="0 0 20 20"
          style={{ left: `${(i * 29 + 9) % 92}%`, top: `${4 + ((i * 41) % 34)}%`, animationDelay: `${-(i * 1.3)}s`, width: 9 + (i % 3) * 4, height: 9 + (i % 3) * 4 }}
        >
          <path d="M10,0 C11,8 12,9 20,10 C12,11 11,12 10,20 C9,12 8,11 0,10 C8,9 9,8 10,0 Z" />
        </svg>
      ))}
      {Array.from({ length: FLIES }).map((_, i) => (
        <span
          key={`f${i}`}
          className={`night-fly nf-${i % 3}`}
          style={
            {
              left: `${(i * 43 + 6) % 96}%`,
              bottom: `${4 + ((i * 23) % 46)}vh`,
              animationDuration: `${9 + (i % 5) * 2.5}s`,
              animationDelay: `${-((i * 1.9) % 12)}s`,
            } as CSSProperties
          }
        >
          <i style={{ animationDuration: `${2.2 + (i % 4) * 0.7}s`, animationDelay: `${-((i * 0.6) % 3)}s` }} />
        </span>
      ))}
    </div>
  );
}
