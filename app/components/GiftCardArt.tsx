"use client";

import { useRef, type CSSProperties } from "react";
import { brand } from "@/lib/brand";
import { GIFT_OCCASIONS, giftMoney, occasionOf } from "@/lib/giftCardRules";

// The animated gift card . One card per occasion, each with
// its own still art (SVG) and a few moving particles, a slow foil shimmer and
// a gentle tilt under the pointer. `reveal` slides it out of an envelope the
// first time it's shown. Motion stops for people who ask for reduced motion.
// No backdrop-filter or blend modes (see CLAUDE.md, scrolling performance).

type Props = {
  occasion: string;
  amount: number;
  toName?: string;
  fromName?: string;
  /** Bonus credit card instead of a gift. */
  bonus?: boolean;
  /** Slide out of an envelope on first show. */
  reveal?: boolean;
  /** Tilt under the pointer (off for small thumbnails). */
  tilt?: boolean;
  size?: "full" | "small";
  className?: string;
};

// Particle positions are fixed (not random) so server and browser agree.
const BITS = [
  { x: 6, d: 0, s: 1, r: 20 }, { x: 15, d: 2.4, s: 0.8, r: -30 }, { x: 24, d: 1.1, s: 1.1, r: 60 },
  { x: 33, d: 3.3, s: 0.7, r: 10 }, { x: 42, d: 0.6, s: 1, r: -50 }, { x: 51, d: 2.9, s: 0.9, r: 80 },
  { x: 60, d: 1.7, s: 1.2, r: -15 }, { x: 69, d: 4.1, s: 0.8, r: 35 }, { x: 78, d: 0.3, s: 1, r: -70 },
  { x: 87, d: 2.2, s: 0.9, r: 45 }, { x: 94, d: 3.7, s: 1.1, r: -25 }, { x: 47, d: 4.8, s: 0.7, r: 5 },
];

function Art({ occasion }: { occasion: string }) {
  switch (occasion) {
    case "birthday":
      return (
        <svg className="gc-art" viewBox="0 0 320 200" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
          <g className="gc-float gc-float-a">
            <path d="M262 112 q-4 30 6 58" stroke="#fff" strokeOpacity="0.7" strokeWidth="1.2" fill="none" />
            <ellipse cx="262" cy="78" rx="24" ry="30" fill="#ffd6e0" />
            <ellipse cx="254" cy="68" rx="6" ry="10" fill="#fff" opacity="0.55" />
            <path d="M258 108 l4 6 l4 -6 z" fill="#ffd6e0" />
          </g>
          <g className="gc-float gc-float-b">
            <path d="M226 128 q6 26 -2 52" stroke="#fff" strokeOpacity="0.7" strokeWidth="1.2" fill="none" />
            <ellipse cx="226" cy="98" rx="19" ry="24" fill="#fff1c9" />
            <ellipse cx="220" cy="90" rx="5" ry="8" fill="#fff" opacity="0.6" />
            <path d="M222 122 l4 5 l4 -5 z" fill="#fff1c9" />
          </g>
          <g className="gc-float gc-float-c">
            <path d="M296 120 q-6 26 2 60" stroke="#fff" strokeOpacity="0.7" strokeWidth="1.2" fill="none" />
            <ellipse cx="296" cy="92" rx="17" ry="22" fill="#d9c8f5" />
            <ellipse cx="291" cy="85" rx="4" ry="7" fill="#fff" opacity="0.6" />
            <path d="M292 114 l4 5 l4 -5 z" fill="#d9c8f5" />
          </g>
        </svg>
      );
    case "holidays": {
      // A pine garland swagged along the top, with ornaments hanging from it.
      const pts = Array.from({ length: 15 }, (_, i) => {
        const t = i / 14;
        const x = (1 - t) * (1 - t) * 150 + 2 * (1 - t) * t * 245 + t * t * 334;
        const y = (1 - t) * (1 - t) * -6 + 2 * (1 - t) * t * 58 + t * t * -2;
        return [x, y];
      });
      return (
        <svg className="gc-art" viewBox="0 0 320 200" preserveAspectRatio="xMaxYMin slice" aria-hidden="true">
          <g fill="none" stroke="#e9c46a" strokeWidth="1.3" strokeLinecap="round" opacity="0.9">
            <path d="M150 -6 Q245 58 334 -2" />
            {pts.map(([x, y], i) => (
              <path key={i} d={`M${x.toFixed(1)} ${y.toFixed(1)} l-6 -9 M${x.toFixed(1)} ${y.toFixed(1)} l7 -8 M${x.toFixed(1)} ${y.toFixed(1)} l-5 8 M${x.toFixed(1)} ${y.toFixed(1)} l6 8`} />
            ))}
          </g>
          <g className="gc-swing" style={{ transformOrigin: "214px 22px" }}>
            <line x1="214" y1="22" x2="214" y2="46" stroke="#e9c46a" strokeWidth="1" />
            <rect x="210" y="44" width="8" height="5" rx="1" fill="#e9c46a" />
            <circle cx="214" cy="60" r="12" fill="#b23a3a" />
            <circle cx="210" cy="56" r="3.5" fill="#fff" opacity="0.5" />
          </g>
          <g className="gc-swing gc-swing-b" style={{ transformOrigin: "258px 28px" }}>
            <line x1="258" y1="28" x2="258" y2="66" stroke="#e9c46a" strokeWidth="1" />
            <rect x="255" y="64" width="6" height="4" rx="1" fill="#c9a24a" />
            <circle cx="258" cy="76" r="9" fill="#e9c46a" />
            <circle cx="255" cy="73" r="2.6" fill="#fff" opacity="0.55" />
          </g>
          <g className="gc-swing" style={{ transformOrigin: "298px 18px", animationDelay: "-1s" }}>
            <line x1="298" y1="18" x2="298" y2="34" stroke="#e9c46a" strokeWidth="1" />
            <rect x="295" y="32" width="6" height="4" rx="1" fill="#e9c46a" />
            <circle cx="298" cy="44" r="8" fill="#f6efe0" />
            <circle cx="295" cy="41" r="2.4" fill="#fff" opacity="0.7" />
          </g>
          <path className="gc-twinkle" d="M244 96 l2.5 6.5 l6.5 2.5 l-6.5 2.5 l-2.5 6.5 l-2.5 -6.5 l-6.5 -2.5 l6.5 -2.5 z" fill="#fff4cf" />
        </svg>
      );
    }
    case "thank-you":
      // A flowering sprig reaching in from the top corner.
      return (
        <svg className="gc-art" viewBox="0 0 320 200" preserveAspectRatio="xMaxYMin slice" aria-hidden="true">
          <g className="gc-sway gc-sway-top" fill="none" stroke="#fff" strokeOpacity="0.85" strokeWidth="1.3" strokeLinecap="round">
            <path d="M334 -6 C 306 14, 284 28, 262 46" />
            <path d="M304 12 C 300 30, 302 56, 302 84" />
            <path d="M284 26 C 268 22, 250 24, 232 30" />
            <path d="M318 4 c 2 14 -4 26 -14 32 c -2 -12 4 -24 14 -32 z" fill="#fff" fillOpacity="0.2" />
            <path d="M276 34 c -4 14 -14 22 -26 22 c 4 -12 14 -20 26 -22 z" fill="#fff" fillOpacity="0.2" />
          </g>
          {[[262, 46, 1], [302, 84, 0.8], [232, 30, 0.62]].map(([x, y, k], i) => (
            <g key={i} className={`gc-bloom gc-bloom-${i}`} transform={`translate(${x} ${y}) scale(${k})`}>
              {[0, 72, 144, 216, 288].map((a) => (
                <ellipse key={a} cx="0" cy="-11" rx="7" ry="11" fill="#fff" fillOpacity="0.85" transform={`rotate(${a})`} />
              ))}
              <circle r="5" fill="#f3d38a" />
            </g>
          ))}
        </svg>
      );
    default:
      // Just because: a fern arching in from the corner, mushrooms in the moss below.
      return (
        <svg className="gc-art" viewBox="0 0 320 200" preserveAspectRatio="xMaxYMax slice" aria-hidden="true">
          <g className="gc-sway gc-sway-top" fill="none" stroke="#fffdf5" strokeOpacity="0.8" strokeWidth="1.3" strokeLinecap="round">
            <path d="M334 -6 C 306 16, 284 50, 272 100" />
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
              const t = (i + 0.5) / 8;
              const x = (1 - t) ** 3 * 334 + 3 * (1 - t) ** 2 * t * 306 + 3 * (1 - t) * t * t * 284 + t ** 3 * 272;
              const y = (1 - t) ** 3 * -6 + 3 * (1 - t) ** 2 * t * 16 + 3 * (1 - t) * t * t * 50 + t ** 3 * 100;
              const L = 18 - i * 1.6;
              return <path key={i} d={`M${x.toFixed(1)} ${y.toFixed(1)} q-${(L * 0.5).toFixed(1)} -${(L * 0.1).toFixed(1)} -${L.toFixed(1)} ${(L * 0.25).toFixed(1)} M${x.toFixed(1)} ${y.toFixed(1)} q${(L * 0.5).toFixed(1)} ${(L * 0.15).toFixed(1)} ${(L * 0.9).toFixed(1)} ${(L * 0.6).toFixed(1)}`} />;
            })}
          </g>
          <g>
            <path d="M176 202 q2 -22 -2 -38" stroke="#fffdf5" strokeWidth="7" strokeLinecap="round" fill="none" opacity="0.95" />
            <path d="M152 168 q24 -36 48 0 q-24 -7 -48 0 z" fill="#fff6e6" />
            <circle cx="168" cy="157" r="2.6" fill="#85ba45" opacity="0.7" />
            <circle cx="181" cy="152" r="2.1" fill="#85ba45" opacity="0.7" />
            <path d="M140 202 q-1 -12 2 -20" stroke="#fffdf5" strokeWidth="5" strokeLinecap="round" fill="none" opacity="0.95" />
            <path d="M128 184 q14 -22 28 0 q-14 -5 -28 0 z" fill="#fff6e6" />
            <circle cx="140" cy="178" r="1.7" fill="#85ba45" opacity="0.7" />
          </g>
        </svg>
      );
  }
}

export default function GiftCardArt({ occasion: raw, amount, toName, fromName, bonus, reveal, tilt = true, size = "full", className }: Props) {
  const occasion = occasionOf(raw);
  const line = bonus ? "Thank you" : GIFT_OCCASIONS.find((o) => o.key === occasion)?.line || "A gift for you";
  const ref = useRef<HTMLDivElement>(null);

  function move(e: React.PointerEvent) {
    if (!tilt || e.pointerType === "touch") return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty("--gc-rx", `${(-y * 10).toFixed(2)}deg`);
    el.style.setProperty("--gc-ry", `${(x * 12).toFixed(2)}deg`);
    el.style.setProperty("--gc-gx", `${((x + 0.5) * 100).toFixed(1)}%`);
  }
  function leave() {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--gc-rx", "0deg");
    el.style.setProperty("--gc-ry", "0deg");
    el.style.setProperty("--gc-gx", "50%");
  }

  const card = (
    <div
      ref={ref}
      className={`gc-card gc-${occasion}${bonus ? " gc-bonus" : ""} gc-${size}${className ? ` ${className}` : ""}`}
      onPointerMove={move}
      onPointerLeave={leave}
      role="img"
      aria-label={`${bonus ? "Bonus credit" : `${line} gift card`}, ${giftMoney(amount)}${toName ? `, for ${toName}` : ""}${fromName && !bonus ? `, from ${fromName}` : ""}`}
    >
      <Art occasion={occasion} />
      <div className="gc-bits" aria-hidden="true">
        {BITS.map((b, i) => (
          <i key={i} style={{ left: `${b.x}%`, animationDelay: `${b.d}s`, "--gc-s": b.s, "--gc-r": `${b.r}deg` } as CSSProperties} />
        ))}
      </div>
      <div className="gc-shine" aria-hidden="true" />
      <div className="gc-face">
        <div className="gc-top">
          <span className="gc-brand">{brand.shortName}</span>
          <span className="gc-peaks gc-mark" aria-hidden="true">{brand.emoji}</span>
        </div>
        <div className="gc-line">{line}</div>
        {toName && <div className="gc-to">for {toName}</div>}
        <div className="gc-bottom">
          <span className="gc-from">{bonus ? "Your bonus credit" : fromName ? `from ${fromName}` : "Gift card"}</span>
          <span className="gc-amount">{giftMoney(amount)}</span>
        </div>
      </div>
    </div>
  );

  if (!reveal) return <div className="gc-stage">{card}</div>;
  return (
    <div className="gc-stage gc-reveal">
      <div className="gc-envelope" aria-hidden="true">
        <div className="gc-env-back" />
        <div className="gc-env-flap" />
      </div>
      <div className="gc-lift">{card}</div>
      <div className="gc-env-front" aria-hidden="true" />
      <div className="gc-sparkles" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <i key={i} />)}
      </div>
    </div>
  );
}
