"use client";

import type { CSSProperties, ReactNode } from "react";
import { brand } from "@/lib/brand";

/**
 * The members' entrance (plays once per visit, right after sign-in): a flat,
 * poster-style forest that's brushed aside to reveal the clearing — sunset sky
 * with a ringed sun and slow rays, the four faceted peaks (the fourth is the
 * logo's green one), mushrooms, sparkles — and the members' area name.
 * Pure SVG + CSS (en-* in globals.css): only transforms and opacity animate.
 * About 3.3 s, then it fades away; tapping skips it.
 */

const SEED_START = 7;
function rng() {
  let seed = SEED_START;
  return () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
}

type Depth = 1 | 2 | 3;
const DEPTH: Record<Depth, { c: string; cs: string; base: number; h: [number, number]; n: number }> = {
  1: { c: "var(--en-t1)", cs: "var(--en-t1s)", base: 760, h: [520, 640], n: 7 },
  2: { c: "var(--en-t2)", cs: "var(--en-t2s)", base: 830, h: [620, 760], n: 6 },
  3: { c: "var(--en-t3)", cs: "var(--en-t3s)", base: 920, h: [760, 940], n: 5 },
};

/** A flat, faceted pine: stacked tiers, a light half and a shadow half. */
function pine(key: string, x: number, base: number, h: number, w: number, c: string, cs: string): ReactNode {
  const tiers = [0, 1, 2, 3].map((i) => {
    const tb = base - h * 0.12 - i * h * 0.2, tt = tb - h * 0.36, tw = (w * (1 - i * 0.2)) / 2;
    return (
      <g key={i}>
        <polygon points={`${x - tw},${tb} ${x},${tt} ${x},${tb}`} fill={c} />
        <polygon points={`${x},${tt} ${x + tw},${tb} ${x},${tb}`} fill={cs} />
      </g>
    );
  });
  return (
    <g key={key}>
      <rect x={x - w * 0.06} y={base - h * 0.14} width={w * 0.12} height={h * 0.16} fill="var(--en-trunk)" />
      {tiers}
    </g>
  );
}

/** A round tree with a crescent of shade. */
function roundTree(key: string, x: number, base: number, h: number, c: string, cs: string): ReactNode {
  const r = h * 0.3, cy = base - h * 0.62;
  return (
    <g key={key}>
      <rect x={x - h * 0.03} y={base - h * 0.45} width={h * 0.06} height={h * 0.45} fill="var(--en-trunk)" />
      <circle cx={x} cy={cy} r={r} fill={c} />
      <path d={`M${x},${cy - r} A${r},${r} 0 0 1 ${x},${cy + r} A${r * 0.55},${r} 0 0 0 ${x},${cy - r} Z`} fill={cs} />
    </g>
  );
}

function forest(depth: Depth, side: "l" | "r"): ReactNode {
  const d = DEPTH[depth];
  const rnd = rng();
  // Same trees on both sides would look mirrored: offset the random sequence per layer/side.
  for (let k = 0; k < depth * 3 + (side === "r" ? 11 : 0); k++) rnd();
  const trees: ReactNode[] = [];
  for (let i = 0; i < d.n; i++) {
    const x = 80 + i * (980 / d.n) + rnd() * 50; // reaches right up to the middle seam
    const h = d.h[0] + rnd() * (d.h[1] - d.h[0]);
    const base = d.base + rnd() * 20;
    trees.push((i + depth) % 3 === 0 ? roundTree(`t${i}`, x, base, h * 0.8, d.c, d.cs) : pine(`t${i}`, x, base, h, h * 0.55, d.c, d.cs));
  }
  const ferns =
    depth === 3
      ? [0, 1, 2].flatMap((k) =>
          [0, 1, 2, 3, 4].map((f) => {
            const fx = 760 + k * 90;
            return <path key={`f${k}${f}`} d={`M${fx},900 Q${fx - 40 + f * 20},780 ${fx - 70 + f * 35},${700 + Math.abs(2 - f) * 30}`} stroke="var(--en-t2)" strokeWidth={14} fill="none" strokeLinecap="round" />;
          })
        )
      : null;
  return (
    <svg viewBox="0 0 1000 900" preserveAspectRatio={side === "l" ? "xMaxYMax slice" : "xMinYMax slice"}>
      <g transform={side === "r" ? "translate(1000,0) scale(-1,1)" : undefined}>
        <path d={`M0,${d.base - 40} L1000,${d.base - 10} L1000,900 L0,900 Z`} fill={d.cs} />
        {trees}
        {ferns}
      </g>
    </svg>
  );
}

// [left foot, apex x, apex y, right foot, lit, lit2, shade, shade2]
const PEAKS: Array<[number, number, number, number, string, string, string, string]> = [
  [40, 330, 150, 640, "#d9a08c", "#c98a83", "#9c7495", "#87678c"],
  [380, 640, 70, 930, "#eab07e", "#dc9a74", "#b97d79", "#a06d78"],
  [700, 980, 20, 1290, "#e59b72", "#d4876a", "#a46e83", "#8d6079"],
  [1080, 1320, 130, 1580, "#a8c874", "#93b865", "#6f9858", "#5f854d"],
];

const SHROOMS: Array<[number, number, number]> = [[300, 70, 1.1], [420, 46, 0.7], [700, 34, 0.45], [910, 30, 0.4], [1170, 50, 0.75], [1300, 80, 1.2], [180, 120, 1.5], [1430, 128, 1.4]];
const CLOUDS: Array<[number, number, number]> = [[12, 10, 15], [64, 7, 12], [80, 20, 9], [30, 22, 8]];
const LEAF_COLORS = ["#3f6c5e", "#5d8a4d", "#85ba45", "#2f5f4d", "#e0a074"];

const v = (o: Record<string, string>) => o as CSSProperties;

export default function ForestEntrance({ onSkip }: { onSkip: () => void }) {
  return (
    <div className="en-entrance" aria-hidden="true" onClick={onSkip}>
      <div className="en-sky" />
      <div className="en-world">
        <div className="en-rays" />
        <div className="en-sun" />
        {CLOUDS.map(([l, t, w], i) => (
          <svg key={i} viewBox="0 0 120 50" className="en-cloud" style={{ left: `${l}%`, top: `${t}%`, width: `${w}vw`, animationDelay: `${-i * 2}s` }}>
            <path d="M10,46 C2,46 2,34 12,32 C10,20 26,14 36,22 C40,8 62,4 70,18 C80,10 98,14 98,28 C112,28 116,46 104,46 Z" />
          </svg>
        ))}
        <svg className="en-far" viewBox="0 0 1600 200" preserveAspectRatio="xMidYMax slice">
          <path d="M0,200 L0,120 L120,80 L260,118 L380,70 L520,112 L640,86 L760,120 L900,74 L1040,110 L1180,64 L1320,104 L1460,78 L1600,110 L1600,200 Z" fill="#b9a3bd" />
          <path d="M0,200 L0,150 L160,120 L300,150 L470,112 L620,146 L800,118 L980,150 L1150,110 L1330,146 L1480,120 L1600,140 L1600,200 Z" fill="#c9a6a6" />
        </svg>
        <svg className="en-peaks" viewBox="0 0 1600 460" preserveAspectRatio="xMidYMax meet">
          {PEAKS.map(([l, ax, ay, r, lit, lit2, sh1, sh2], i) => {
            const B = 460, mx = ax + (r - ax) * 0.18, my = ay + (B - ay) * 0.45, ll = ax - (ax - l) * 0.15;
            return (
              <g key={i}>
                <polygon points={`${l},${B} ${ax},${ay} ${ll},${B}`} fill={lit} />
                <polygon points={`${ax},${ay} ${ll},${B} ${mx},${B}`} fill={lit2} />
                <polygon points={`${ax},${ay} ${mx},${B} ${mx},${my}`} fill={lit2} />
                <polygon points={`${ax},${ay} ${mx},${my} ${r},${B}`} fill={sh1} />
                <polygon points={`${mx},${my} ${mx},${B} ${r},${B}`} fill={sh2} />
                <polygon points={`${ax},${ay} ${ax - (ax - l) * 0.32},${ay + (B - ay) * 0.42} ${ax - (ax - l) * 0.08},${ay + (B - ay) * 0.3}`} fill="rgba(255,238,205,0.4)" />
              </g>
            );
          })}
        </svg>
        <div className="en-mist" />
        <svg className="en-meadow" viewBox="0 0 1600 330" preserveAspectRatio="xMidYMin slice">
          <path d="M0,0 C300,-10 520,14 800,4 C1080,-6 1300,14 1600,2 L1600,330 L0,330 Z" fill="var(--en-meadow)" />
          <path d="M0,80 C340,60 600,92 800,76 C1040,60 1300,90 1600,72 L1600,330 L0,330 Z" fill="var(--en-meadow2)" />
          <path d="M0,170 C360,150 620,182 800,166 C1060,150 1320,180 1600,160 L1600,330 L0,330 Z" fill="#4b7442" />
          <path d="M786,2 C776,60 720,160 610,330 L990,330 C880,160 824,60 814,2 Z" fill="var(--en-path)" opacity="0.9" />
          {SHROOMS.map(([x, y, s], i) => (
            <g key={i}>
              <ellipse cx={x} cy={y} rx={34 * s} ry={10 * s} fill="rgba(255,230,160,0.35)" />
              <rect x={x - 6 * s} y={y - 34 * s} width={12 * s} height={34 * s} rx={5 * s} fill="var(--en-cream)" />
              <path d={`M${x - 30 * s},${y - 30 * s} Q${x},${y - 70 * s} ${x + 30 * s},${y - 30 * s} Z`} fill="var(--en-cap)" />
              <circle cx={x - 9 * s} cy={y - 44 * s} r={4 * s} fill="var(--en-cream)" />
              <circle cx={x + 10 * s} cy={y - 40 * s} r={3 * s} fill="var(--en-cream)" />
            </g>
          ))}
        </svg>
        {Array.from({ length: 14 }).map((_, i) => {
          const size = 10 + (i % 4) * 6;
          return (
            <svg key={`s${i}`} viewBox="0 0 20 20" className="en-spark" style={{ left: `${8 + ((i * 37) % 84)}%`, top: `${58 + ((i * 23) % 34)}%`, width: size, height: size, animationDelay: `${1.1 + (i % 7) * 0.22}s` }}>
              <path d="M10,0 C11,8 12,9 20,10 C12,11 11,12 10,20 C9,12 8,11 0,10 C8,9 9,8 10,0 Z" />
            </svg>
          );
        })}
        {Array.from({ length: 12 }).map((_, i) => (
          <span key={`f${i}`} className="en-fly" style={{ left: `${10 + ((i * 53) % 80)}%`, top: `${55 + ((i * 31) % 35)}%`, animationDelay: `${0.9 + (i % 6) * 0.3}s` }} />
        ))}
      </div>
      {Array.from({ length: 26 }).map((_, i) => {
        const left = i % 2 === 0;
        return (
          <span
            key={`l${i}`}
            className="en-leaf"
            style={{
              left: `${left ? 36 + (i % 7) * 2 : 56 + (i % 7) * 2}%`,
              top: `${18 + ((i * 29) % 60)}%`,
              background: LEAF_COLORS[i % LEAF_COLORS.length],
              animationDelay: `${0.55 + (i % 9) * 0.06}s`,
              ...v({ "--lx": `${(left ? -1 : 1) * (120 + (i % 5) * 70)}px`, "--ly": `${-60 + ((i * 41) % 200)}px`, "--lr": `${(left ? -1 : 1) * (180 + i * 25)}deg` }),
            }}
          />
        );
      })}
      {([1, 2, 3] as Depth[]).flatMap((d) => [
        <div key={`l${d}`} className={`en-forest en-left d${d}`}>{forest(d, "l")}</div>,
        <div key={`r${d}`} className={`en-forest en-right d${d}`}>{forest(d, "r")}</div>,
      ])}
      <div className="en-title">
        <div className="en-kicker">{brand.name.toUpperCase()}</div>
        <div className="en-name">{brand.members.toUpperCase()}</div>
      </div>
      <div className="en-skip">Tap to skip</div>
    </div>
  );
}
