"use client";

import type { CSSProperties, ReactNode } from "react";
import { brand } from "@/lib/brand";
import { ENTRANCE_THEMES, type EntranceKey, type EntranceTheme, type Ground } from "@/lib/entranceThemes";

/**
 * The members' entrance (plays once per visit, right after sign-in): a flat,
 * poster-style forest that's brushed aside to reveal the clearing — sunset sky
 * with a ringed sun and slow rays, the four faceted peaks (the fourth is the
 * logo's green one), mushrooms, sparkles — and the members' area name.
 * Pure SVG + CSS (en-* in globals.css): only transforms and opacity animate.
 * About 3.3 s, then it fades away; tapping skips it.
 *
 * `theme` swaps in a seasonal or holiday version (lib/entranceThemes.ts): the
 * same scene with its own colours (CSS variables) and little extras. Classic
 * (no theme) renders exactly as before.
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
const LIGHTS = ["#ff5a5a", "#ffd34d", "#6fd3ff", "#8dff8a", "#ff9ae0"];

function pine(key: string, x: number, base: number, h: number, w: number, c: string, cs: string, lights = false): ReactNode {
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
      {lights &&
        [0, 1, 2, 3].flatMap((i) => {
          const tb = base - h * 0.12 - i * h * 0.2, tw = (w * (1 - i * 0.2)) / 2;
          return [-0.6, -0.2, 0.2, 0.6].map((f, j) => (
            <circle key={`L${i}${j}`} className="en-light" cx={x + f * tw * 0.9} cy={tb - h * 0.04 - Math.abs(f) * h * 0.05} r={Math.max(4, w * 0.022)} fill={LIGHTS[(i + j) % LIGHTS.length]} style={{ animationDelay: `${((i * 4 + j) % 5) * 0.25}s` }} />
          ));
        })}
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

function forest(depth: Depth, side: "l" | "r", lights = false): ReactNode {
  const d = DEPTH[depth];
  const rnd = rng();
  // Same trees on both sides would look mirrored: offset the random sequence per layer/side.
  for (let k = 0; k < depth * 3 + (side === "r" ? 11 : 0); k++) rnd();
  const trees: ReactNode[] = [];
  for (let i = 0; i < d.n; i++) {
    const x = 80 + i * (980 / d.n) + rnd() * 50; // reaches right up to the middle seam
    const h = d.h[0] + rnd() * (d.h[1] - d.h[0]);
    const base = d.base + rnd() * 20;
    trees.push((i + depth) % 3 === 0 ? roundTree(`t${i}`, x, base, h * 0.8, d.c, d.cs) : pine(`t${i}`, x, base, h, h * 0.55, d.c, d.cs, lights));
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

const v = (o: Record<string, string>) => o as CSSProperties;

export default function ForestEntrance({ onSkip, theme = "classic" }: { onSkip: () => void; theme?: EntranceKey }) {
  const t: EntranceTheme = ENTRANCE_THEMES[theme] || ENTRANCE_THEMES.classic;
  const x = t.extras || {};
  return (
    <div className={`en-entrance en-theme-${t.key}`} aria-hidden="true" onClick={onSkip} style={v(t.vars)}>
      <div className="en-sky" />
      <div className="en-world">
        {x.stars && <Stars />}
        {!x.moon && !x.earth && <div className="en-rays" />}
        {x.rainbow && <Rainbow />}
        <div className={`en-sun${x.moon ? " is-moon" : ""}${x.earth ? " is-earth" : ""}`} />
        {CLOUDS.map(([l, t, w], i) => (
          <svg key={i} viewBox="0 0 120 50" className="en-cloud" style={{ left: `${l}%`, top: `${t}%`, width: `${w}vw`, animationDelay: `${-i * 2}s` }}>
            <path d="M10,46 C2,46 2,34 12,32 C10,20 26,14 36,22 C40,8 62,4 70,18 C80,10 98,14 98,28 C112,28 116,46 104,46 Z" />
          </svg>
        ))}
        <svg className="en-far" viewBox="0 0 1600 200" preserveAspectRatio="xMidYMax slice">
          <path d="M0,200 L0,120 L120,80 L260,118 L380,70 L520,112 L640,86 L760,120 L900,74 L1040,110 L1180,64 L1320,104 L1460,78 L1600,110 L1600,200 Z" fill="var(--en-far1, #b9a3bd)" />
          <path d="M0,200 L0,150 L160,120 L300,150 L470,112 L620,146 L800,118 L980,150 L1150,110 L1330,146 L1480,120 L1600,140 L1600,200 Z" fill="var(--en-far2, #c9a6a6)" />
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
                {x.snowcaps && (
                  <>
                    <polygon points={`${ax},${ay} ${ax - (ax - l) * 0.24},${ay + (B - ay) * 0.24} ${ax - (ax - l) * 0.12},${ay + (B - ay) * 0.18} ${ax - (ax - l) * 0.03},${ay + (B - ay) * 0.27} ${ax},${ay + (B - ay) * 0.2}`} fill="#fbfdff" />
                    <polygon points={`${ax},${ay} ${ax},${ay + (B - ay) * 0.2} ${ax + (r - ax) * 0.1},${ay + (B - ay) * 0.26} ${ax + (r - ax) * 0.17},${ay + (B - ay) * 0.19} ${ax + (r - ax) * 0.26},${ay + (B - ay) * 0.25}`} fill="#dfe8f1" />
                  </>
                )}
              </g>
            );
          })}
        </svg>
        {x.santa && <Santa />}
        <div className="en-mist" />
        <svg className="en-meadow" viewBox="0 0 1600 330" preserveAspectRatio="xMidYMin slice">
          <path d="M0,0 C300,-10 520,14 800,4 C1080,-6 1300,14 1600,2 L1600,330 L0,330 Z" fill="var(--en-meadow)" />
          <path d="M0,80 C340,60 600,92 800,76 C1040,60 1300,90 1600,72 L1600,330 L0,330 Z" fill="var(--en-meadow2)" />
          <path d="M0,170 C360,150 620,182 800,166 C1060,150 1320,180 1600,160 L1600,330 L0,330 Z" fill="var(--en-meadow3, #4b7442)" />
          <path d="M786,2 C776,60 720,160 610,330 L990,330 C880,160 824,60 814,2 Z" fill="var(--en-path)" opacity="0.9" />
          {/* Big figures stand at the meadow's edges (turkey left; snowman, leprechaun, pilgrims right): keep those sides clear. */}
          {SHROOMS.map(([gx, gy, gs], i) => (x.turkey && gx < 520) || ((x.snowman || x.leprechaun || x.pilgrims) && gx > 1080) ? null : groundItem(t.ground, gx, gy, gs, i))}
          {x.blooms && BLOOMS.map(([bx, by, bs], i) => <Flower key={`b${i}`} x={bx} y={by} s={bs} i={i} />)}
          {x.wheat && WHEAT.map(([wx, wy, ws], i) => <Wheat key={`w${i}`} x={wx} y={wy} s={ws} />)}
        </svg>
        {x.snowman && <Snowman />}
        {x.turkey && <Turkey />}
        {x.pilgrims && <Pilgrims />}
        {x.leprechaun && <PotOfGold />}
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
              background: t.burst[i % t.burst.length],
              animationDelay: `${0.55 + (i % 9) * 0.06}s`,
              ...v({ "--lx": `${(left ? -1 : 1) * (120 + (i % 5) * 70)}px`, "--ly": `${-60 + ((i * 41) % 200)}px`, "--lr": `${(left ? -1 : 1) * (180 + i * 25)}deg` }),
            }}
          />
        );
      })}
      {x.fireworks && <Fireworks colors={x.fireworkColors} />}
      {x.bats && <Bats />}
      {x.cupid && <Cupid />}
      {x.butterflies && <Butterflies />}
      {t.falling && <Falling {...t.falling} />}
      {([1, 2, 3] as Depth[]).flatMap((d) => [
        <div key={`l${d}`} className={`en-forest en-left d${d}`}>{forest(d, "l", !!x.lights)}</div>,
        <div key={`r${d}`} className={`en-forest en-right d${d}`}>{forest(d, "r", !!x.lights)}</div>,
      ])}
      <div className="en-title">
        <div className="en-kicker">{brand.name.toUpperCase()}</div>
        <div className="en-name">{brand.members.toUpperCase()}</div>
        {t.greeting && <div className="en-greet">{t.emoji} {t.greeting}</div>}
      </div>
      <div className="en-skip">Tap to skip</div>
    </div>
  );
}

/* ---------------------------------------------------------------- themed extras */

const BLOOMS: Array<[number, number, number]> = [[90, 150, 1], [240, 200, 0.8], [380, 130, 0.7], [520, 230, 1.1], [660, 110, 0.6], [940, 120, 0.6], [1080, 220, 1.1], [1220, 140, 0.7], [1360, 210, 0.9], [1520, 160, 1], [150, 270, 1.2], [1460, 280, 1.2]];
const WHEAT: Array<[number, number, number]> = [[60, 200, 1.2], [120, 230, 1], [1480, 210, 1.2], [1540, 240, 1], [250, 280, 1.3], [1350, 285, 1.3]];
const PETALS = ["#f6a1bd", "#fff1a8", "#c9a2ff", "#ffffff", "#ff8a8a"];

function groundItem(kind: Ground, x: number, y: number, s: number, i: number): ReactNode {
  if (kind === "pumpkins" || kind === "jacks") {
    const r = 26 * s;
    return (
      <g key={i}>
        <ellipse cx={x} cy={y} rx={r * 1.3} ry={8 * s} fill="rgba(40,30,20,0.25)" />
        <ellipse cx={x - r * 0.45} cy={y - r * 0.8} rx={r * 0.62} ry={r * 0.8} fill="#e07a2e" />
        <ellipse cx={x + r * 0.45} cy={y - r * 0.8} rx={r * 0.62} ry={r * 0.8} fill="#e07a2e" />
        <ellipse cx={x} cy={y - r * 0.82} rx={r * 0.62} ry={r * 0.86} fill="#f08f3c" />
        <rect x={x - 3 * s} y={y - r * 1.8} width={6 * s} height={r * 0.32} rx={2 * s} fill="#4f6b2e" />
        {kind === "jacks" && (
          <g className="en-glow" fill="#ffd34d">
            <polygon points={`${x - r * 0.42},${y - r} ${x - r * 0.18},${y - r} ${x - r * 0.3},${y - r * 1.22}`} />
            <polygon points={`${x + r * 0.18},${y - r} ${x + r * 0.42},${y - r} ${x + r * 0.3},${y - r * 1.22}`} />
            <path d={`M${x - r * 0.5},${y - r * 0.62} Q${x},${y - r * 0.2} ${x + r * 0.5},${y - r * 0.62} Q${x},${y - r * 0.42} ${x - r * 0.5},${y - r * 0.62} Z`} />
          </g>
        )}
      </g>
    );
  }
  if (kind === "candies") {
    // Conversation hearts.
    const words = ["BE MINE", "XOXO", "LOVE", "HUG ME", "CUTIE", "SWEET", "U + ME", "KISS ME"];
    const fills = ["#ffc4d6", "#fff1a8", "#c9f0d3", "#d9c8ff", "#ffd6b0", "#bfe6ff"];
    const r = 30 * s;
    return (
      <g key={i} className="en-bloom" style={{ animationDelay: `${0.9 + (i % 6) * 0.12}s` }}>
        <ellipse cx={x} cy={y} rx={r * 1.1} ry={7 * s} fill="rgba(120,60,80,0.18)" />
        <path
          d={`M${x},${y - r * 0.15} C${x - r * 1.5},${y - r * 1.1} ${x - r * 0.8},${y - r * 2.1} ${x},${y - r * 1.45} C${x + r * 0.8},${y - r * 2.1} ${x + r * 1.5},${y - r * 1.1} ${x},${y - r * 0.15} Z`}
          fill={fills[i % fills.length]}
          stroke="rgba(255,255,255,0.7)"
          strokeWidth={2 * s}
          transform={`rotate(${(i % 2 ? 1 : -1) * (6 + (i % 3) * 5)} ${x} ${y - r})`}
        />
        <text x={x} y={y - r * 0.92} textAnchor="middle" fontFamily="Helvetica, Arial, sans-serif" fontWeight={800} fontSize={r * (words[i % words.length].length > 5 ? 0.3 : 0.38)} fill="#d6336c" transform={`rotate(${(i % 2 ? 1 : -1) * (6 + (i % 3) * 5)} ${x} ${y - r})`}>
          {words[i % words.length]}
        </text>
      </g>
    );
  }
  if (kind === "flowers") return <Flower key={i} x={x} y={y} s={s * 1.3} i={i} />;
  if (kind === "sunflowers") {
    const r = 16 * s;
    return (
      <g key={i} className="en-bloom" style={{ animationDelay: `${0.9 + (i % 6) * 0.15}s` }}>
        <rect x={x - 2.5 * s} y={y - 70 * s} width={5 * s} height={70 * s} fill="#4f8a35" />
        <ellipse cx={x - 10 * s} cy={y - 30 * s} rx={10 * s} ry={4 * s} fill="#5f9a40" transform={`rotate(-30 ${x - 10 * s} ${y - 30 * s})`} />
        {Array.from({ length: 12 }).map((_, k) => (
          <ellipse key={k} cx={x} cy={y - 70 * s - r * 0.9} rx={r * 0.32} ry={r * 0.85} fill="#ffcf33" transform={`rotate(${k * 30} ${x} ${y - 70 * s})`} />
        ))}
        <circle cx={x} cy={y - 70 * s} r={r * 0.62} fill="#7a4a1e" />
      </g>
    );
  }
  if (kind === "gifts") {
    const w = 46 * s, h = 38 * s, c = ["#c62f36", "#2e7a4f", "#f4cf6a", "#4f7f9f"][i % 4];
    return (
      <g key={i}>
        <ellipse cx={x} cy={y} rx={w * 0.7} ry={7 * s} fill="rgba(40,50,60,0.18)" />
        <rect x={x - w / 2} y={y - h} width={w} height={h} rx={3 * s} fill={c} />
        <rect x={x - 4 * s} y={y - h} width={8 * s} height={h} fill="#fbf1dc" />
        <rect x={x - w / 2} y={y - h * 0.6} width={w} height={7 * s} fill="#fbf1dc" />
        <path d={`M${x},${y - h} C${x - 18 * s},${y - h - 18 * s} ${x - 22 * s},${y - h + 2 * s} ${x},${y - h} C${x + 22 * s},${y - h + 2 * s} ${x + 18 * s},${y - h - 18 * s} ${x},${y - h} Z`} fill="#fbf1dc" />
      </g>
    );
  }
  // Mushrooms (classic).
  return (
    <g key={i}>
      <ellipse cx={x} cy={y} rx={34 * s} ry={10 * s} fill="rgba(255,230,160,0.35)" />
      <rect x={x - 6 * s} y={y - 34 * s} width={12 * s} height={34 * s} rx={5 * s} fill="var(--en-cream)" />
      <path d={`M${x - 30 * s},${y - 30 * s} Q${x},${y - 70 * s} ${x + 30 * s},${y - 30 * s} Z`} fill="var(--en-cap)" />
      <circle cx={x - 9 * s} cy={y - 44 * s} r={4 * s} fill="var(--en-cream)" />
      <circle cx={x + 10 * s} cy={y - 40 * s} r={3 * s} fill="var(--en-cream)" />
    </g>
  );
}

/** A little flower that blooms open (scales up from its base). */
function Flower({ x, y, s, i }: { x: number; y: number; s: number; i: number }) {
  const r = 9 * s, c = PETALS[i % PETALS.length];
  return (
    <g className="en-bloom" style={{ animationDelay: `${0.8 + (i % 8) * 0.14}s` }}>
      <path d={`M${x},${y} Q${x - 4 * s},${y - 20 * s} ${x},${y - 34 * s}`} stroke="#4f8a35" strokeWidth={3 * s} fill="none" />
      {[0, 72, 144, 216, 288].map((a) => (
        <ellipse key={a} cx={x} cy={y - 34 * s - r * 0.8} rx={r * 0.55} ry={r * 0.9} fill={c} transform={`rotate(${a} ${x} ${y - 34 * s})`} />
      ))}
      <circle cx={x} cy={y - 34 * s} r={r * 0.45} fill="#ffd34d" />
    </g>
  );
}

function Wheat({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g>
      {[-8, 0, 8].map((dx, k) => (
        <g key={k}>
          <path d={`M${x + dx * s},${y} Q${x + dx * s * 1.4},${y - 40 * s} ${x + dx * s * 2},${y - 80 * s}`} stroke="#d9b45a" strokeWidth={2.5 * s} fill="none" />
          {[0, 1, 2, 3].map((j) => (
            <ellipse key={j} cx={x + dx * s * 2 - 0.5 * j * s} cy={y - 80 * s + j * 9 * s} rx={3 * s} ry={6 * s} fill="#e8c46a" />
          ))}
        </g>
      ))}
    </g>
  );
}

/** Its own little SVG, anchored to the right of the meadow so it shows on every screen size. */
function Snowman() {
  const x = 70, y = 206;
  return (
    <svg className="en-snowman" viewBox="0 0 140 210" aria-hidden="true">
      <ellipse cx={x} cy={y - 2} rx={58} ry={8} fill="rgba(90,120,140,0.2)" />
      <circle cx={x} cy={y - 40} r={40} fill="#ffffff" stroke="#d6e2ea" strokeWidth={3} />
      <circle cx={x} cy={y - 102} r={29} fill="#ffffff" stroke="#d6e2ea" strokeWidth={3} />
      <circle cx={x} cy={y - 148} r={21} fill="#ffffff" stroke="#d6e2ea" strokeWidth={3} />
      <rect x={x - 19} y={y - 176} width={38} height={8} rx={2} fill="#2b2f36" />
      <rect x={x - 13} y={y - 202} width={26} height={28} rx={3} fill="#2b2f36" />
      <rect x={x - 13} y={y - 182} width={26} height={5} fill="#c62f36" />
      <circle cx={x - 7} cy={y - 152} r={2.6} fill="#2b2f36" />
      <circle cx={x + 7} cy={y - 152} r={2.6} fill="#2b2f36" />
      <polygon points={`${x},${y - 146} ${x + 20},${y - 142} ${x},${y - 140}`} fill="#f08a3c" />
      <path d={`M${x - 26},${y - 128} Q${x},${y - 116} ${x + 26},${y - 128} L${x + 30},${y - 118} L${x + 18},${y - 90} L${x + 9},${y - 92} L${x + 14},${y - 118} Q${x},${y - 110} ${x - 26},${y - 118} Z`} fill="#c62f36" />
      {[-1, 0, 1].map((k) => <circle key={k} cx={x} cy={y - 106 + k * 14} r={3} fill="#2b2f36" />)}
      <path d={`M${x - 28},${y - 106} L${x - 62},${y - 132} M${x - 50},${y - 123} L${x - 56},${y - 138}`} stroke="#6b4a2e" strokeWidth={4} strokeLinecap="round" />
      <path d={`M${x + 28},${y - 106} L${x + 62},${y - 130} M${x + 50},${y - 122} L${x + 60},${y - 114}`} stroke="#6b4a2e" strokeWidth={4} strokeLinecap="round" />
    </svg>
  );
}

function Stars() {
  return (
    <>
      {Array.from({ length: 36 }).map((_, i) => (
        <span key={i} className="en-star" style={{ left: `${(i * 37 + 5) % 100}%`, top: `${2 + ((i * 53) % 34)}%`, animationDelay: `${(i % 9) * 0.3}s`, width: 2 + (i % 3), height: 2 + (i % 3) }} />
      ))}
    </>
  );
}

const GLYPH: Record<string, string> = { heart: "♥", shamrock: "☘", star: "★" };

function Falling({ kind, colors, count }: { kind: string; colors: string[]; count: number }) {
  return (
    <div className={`en-falling k-${kind}`}>
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className="en-drop"
          style={{
            left: `${(i * 41 + 3) % 100}%`,
            background: GLYPH[kind] ? undefined : colors[i % colors.length],
            color: colors[i % colors.length],
            animationDelay: `${-((i * 0.37) % 3)}s`,
            animationDuration: `${2.6 + (i % 5) * 0.5}s`,
            ...v({ "--dx": `${(i % 2 ? 1 : -1) * (20 + (i % 4) * 18)}px`, "--sz": `${kind === "snow" ? 4 + (i % 4) * 2 : GLYPH[kind] ? 14 + (i % 3) * 6 : 9 + (i % 3) * 3}px` }),
          }}
        >
          {GLYPH[kind] || null}
        </span>
      ))}
    </div>
  );
}

function Bats() {
  return (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <svg key={i} viewBox="0 0 60 24" className="en-bat" style={{ top: `${10 + i * 7}%`, width: `${40 + (i % 3) * 14}px`, animationDelay: `${0.3 + i * 0.45}s` }}>
          <path d="M30,12 C26,4 18,2 8,6 C12,8 13,11 11,14 C16,12 20,14 22,17 C25,14 27,14 30,16 C33,14 35,14 38,17 C40,14 44,12 49,14 C47,11 48,8 52,6 C42,2 34,4 30,12 Z" fill="#1a1426" />
        </svg>
      ))}
    </>
  );
}

function Butterflies() {
  const c = ["#ff9ae0", "#ffd34d", "#7fd3ff", "#ff8a5c"];
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <svg key={i} viewBox="0 0 30 24" className="en-butterfly" style={{ left: `${15 + i * 22}%`, top: `${48 + (i % 2) * 12}%`, animationDelay: `${0.8 + i * 0.3}s` }}>
          <g className="en-wings">
            <ellipse cx="9" cy="9" rx="8" ry="7" fill={c[i]} />
            <ellipse cx="21" cy="9" rx="8" ry="7" fill={c[i]} />
            <ellipse cx="10" cy="17" rx="5" ry="5" fill={c[(i + 1) % 4]} />
            <ellipse cx="20" cy="17" rx="5" ry="5" fill={c[(i + 1) % 4]} />
          </g>
          <rect x="14" y="5" width="2" height="16" rx="1" fill="#3a2a20" />
        </svg>
      ))}
    </>
  );
}

function Fireworks({ colors }: { colors?: string[] }) {
  const base: Array<[number, number, string, number]> = [[22, 18, "#f4cf6a", 0.4], [74, 14, "#ff8fb1", 1.0], [50, 9, "#7fd3ff", 1.6], [12, 30, "#c9a2ff", 2.1], [86, 28, "#f4cf6a", 2.5]];
  const spots = colors?.length ? base.map(([l, t, , d], i) => [l, t, colors[i % colors.length], d] as [number, number, string, number]) : base;
  return (
    <>
      {spots.map(([l, t, c, d], i) => (
        <div key={i} className="en-firework" style={{ left: `${l}%`, top: `${t}%`, color: c, animationDelay: `${d}s` }}>
          {Array.from({ length: 12 }).map((_, k) => (
            <span key={k} style={{ transform: `rotate(${k * 30}deg)`, animationDelay: `${d}s` }} />
          ))}
        </div>
      ))}
    </>
  );
}

function Rainbow() {
  const bands = ["#ff6b6b", "#ffa94d", "#ffe066", "#69db7c", "#4dabf7", "#9775fa"];
  return (
    <svg className="en-rainbow" viewBox="0 0 1000 520" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
      {bands.map((c, i) => (
        <path key={c} d={`M${60 + i * 34},520 A${440 - i * 34},${440 - i * 34} 0 0 1 ${940 - i * 34},520`} stroke={c} strokeWidth={34} fill="none" opacity={0.75} />
      ))}
    </svg>
  );
}

/** A big Thanksgiving turkey that gobbles (head bobs, tail fans out), anchored left on the meadow. */
function Turkey() {
  const feathers = ["#8f3f26", "#c2662d", "#e0a03a", "#a8552a", "#d9822e", "#7a3420", "#e7b06a"];
  return (
    <svg className="en-turkey" viewBox="0 0 220 220" aria-hidden="true">
      <ellipse cx="110" cy="214" rx="78" ry="7" fill="rgba(60,40,20,0.22)" />
      <g className="en-turkey-tail">
        {Array.from({ length: 11 }).map((_, k) => {
          const a = -80 + k * 16;
          return <ellipse key={k} cx="110" cy="58" rx="17" ry="62" fill={feathers[k % feathers.length]} transform={`rotate(${a} 110 120)`} />;
        })}
        {Array.from({ length: 11 }).map((_, k) => {
          const a = -80 + k * 16;
          return <circle key={`e${k}`} cx="110" cy="10" r="7" fill="#3f2a1e" stroke="#f2c14e" strokeWidth="3" transform={`rotate(${a} 110 120)`} />;
        })}
      </g>
      <ellipse cx="110" cy="150" rx="48" ry="52" fill="#7a4a2e" />
      <ellipse cx="110" cy="160" rx="34" ry="38" fill="#9a6040" />
      <path d="M86,196 L80,212 M80,212 L72,214 M80,212 L84,216 M134,196 L140,212 M140,212 L148,214 M140,212 L136,216" stroke="#e0a03a" strokeWidth="5" strokeLinecap="round" fill="none" />
      <g className="en-turkey-head">
        <path d="M98,128 C92,104 96,88 110,84 C124,88 128,104 122,128 Z" fill="#7a4a2e" />
        <circle cx="110" cy="80" r="17" fill="#8a5636" />
        <circle cx="104" cy="76" r="5.5" fill="#fff" />
        <circle cx="116" cy="76" r="5.5" fill="#fff" />
        <circle cx="105" cy="77" r="2.8" fill="#2b2f36" />
        <circle cx="115" cy="77" r="2.8" fill="#2b2f36" />
        <polygon points="104,84 116,84 110,95" fill="#f2b33d" />
        <path className="en-wattle" d="M112,88 C120,92 120,106 113,110 C108,104 108,94 112,88 Z" fill="#d23a3a" />
      </g>
      <g className="en-gobble">
        <path d="M150,30 h58 a10,10 0 0 1 10,10 v18 a10,10 0 0 1 -10,10 h-40 l-12,10 l2,-10 h-8 a10,10 0 0 1 -10,-10 v-18 a10,10 0 0 1 10,-10 Z" fill="#fffaf0" stroke="#c2662d" strokeWidth="2.5" />
        <text x="179" y="54" textAnchor="middle" fontFamily="Helvetica, Arial, sans-serif" fontWeight="800" fontSize="15" fill="#a8552a">Gobble!</text>
      </g>
    </svg>
  );
}

/** Cupid flies across the sky with his bow and lets a heart-tipped arrow go. */
function Cupid() {
  return (
    <div className="en-cupid" aria-hidden="true">
      <svg viewBox="0 0 160 130">
        <g className="en-cupid-wing en-cupid-wing-back"><path d="M70,46 C40,10 8,20 14,44 C20,62 50,62 70,56 Z" fill="#ffffff" stroke="#f3c6d3" strokeWidth="2" /></g>
        <ellipse cx="80" cy="74" rx="22" ry="24" fill="#ffd8c2" />
        <path d="M58,78 C62,98 98,98 102,78 L104,90 C96,104 64,104 56,90 Z" fill="#ffffff" />
        <circle cx="80" cy="40" r="18" fill="#ffd8c2" />
        <path d="M62,38 C60,20 98,18 98,36 C92,28 70,28 62,38 Z" fill="#f2c14e" />
        <circle cx="74" cy="42" r="2.4" fill="#2b2f36" />
        <circle cx="86" cy="42" r="2.4" fill="#2b2f36" />
        <path d="M74,49 Q80,54 86,49" stroke="#d6336c" strokeWidth="2" fill="none" strokeLinecap="round" />
        <circle cx="70" cy="47" r="3" fill="#ffb3c1" opacity="0.8" />
        <circle cx="90" cy="47" r="3" fill="#ffb3c1" opacity="0.8" />
        <path d="M118,40 Q136,74 118,108" stroke="#a8552a" strokeWidth="4" fill="none" />
        <path d="M118,40 L118,108" stroke="#fff" strokeWidth="1.5" />
        <path d="M100,72 L118,74" stroke="#ffd8c2" strokeWidth="8" strokeLinecap="round" />
        <g className="en-cupid-wing"><path d="M84,50 C110,8 150,16 142,44 C136,62 106,62 86,58 Z" fill="#ffffff" stroke="#f3c6d3" strokeWidth="2" /></g>
      </svg>
      <span className="en-arrow">
        <svg viewBox="0 0 90 20"><path d="M2,10 L72,10" stroke="#a8552a" strokeWidth="3" /><path d="M2,10 L10,3 M2,10 L10,17" stroke="#f48fb1" strokeWidth="3" /><path d="M72,10 C68,2 80,0 82,6 C84,0 96,2 90,10 L82,18 Z" transform="translate(-6,0) scale(0.9)" fill="#e0457b" /></svg>
      </span>
    </div>
  );
}

/** Santa's sleigh and three reindeer (Rudolph's nose glows) flying past the peaks, with a sparkle trail. */
function Santa() {
  const deer = (dx: number, rudolph = false) => (
    <g key={dx} className="en-deer" style={{ animationDelay: `${(dx % 3) * 0.08}s` }}>
      <ellipse cx={dx + 18} cy="40" rx="17" ry="8" fill="#8a5636" />
      <path d={`M${dx + 6},44 l-6,12 M${dx + 12},45 l-2,13 M${dx + 26},45 l4,12 M${dx + 31},43 l8,10`} stroke="#6b4a2e" strokeWidth="3" strokeLinecap="round" />
      <path d={`M${dx + 32},36 q6,-10 12,-12`} stroke="#8a5636" strokeWidth="6" strokeLinecap="round" fill="none" />
      <ellipse cx={dx + 46} cy="23" rx="7" ry="5.5" fill="#8a5636" />
      <path d={`M${dx + 43},18 l-3,-9 l-4,3 M${dx + 40},11 l2,-5 M${dx + 47},18 l2,-9 l4,2 M${dx + 49},11 l4,-4`} stroke="#c9a46a" strokeWidth="2.2" strokeLinecap="round" fill="none" />
      <circle cx={dx + 53} cy="24" r={rudolph ? 3.2 : 2} fill={rudolph ? "#ff3b3b" : "#3a2a20"} className={rudolph ? "en-rudolph" : undefined} />
      <circle cx={dx + 46} cy="21" r="1.3" fill="#1f1a16" />
    </g>
  );
  return (
    <div className="en-santa" aria-hidden="true">
      <svg viewBox="0 0 330 90">
        <path d="M120,52 C150,40 180,40 205,36 M120,56 C150,48 200,44 260,36" stroke="#6b4a2e" strokeWidth="1.6" fill="none" />
        {deer(150)}
        {deer(205)}
        {deer(260, true)}
        <g className="en-sleigh">
          <path d="M10,72 C30,80 100,80 128,70 C134,68 136,74 130,76" stroke="#f4cf6a" strokeWidth="4" fill="none" strokeLinecap="round" />
          <path d="M22,70 L24,62 M96,70 L98,62" stroke="#f4cf6a" strokeWidth="3" />
          <path d="M14,34 C14,60 30,64 60,64 L112,64 C124,64 128,50 120,40 L104,46 L40,46 C34,40 24,32 14,34 Z" fill="#c62f36" />
          <path d="M40,46 L104,46" stroke="#f4cf6a" strokeWidth="3" />
          <ellipse cx="38" cy="30" rx="18" ry="16" fill="#8a5636" />
          <circle cx="32" cy="22" r="4" fill="#2e7a4f" /><circle cx="44" cy="20" r="4" fill="#f4cf6a" /><rect x="34" y="12" width="8" height="8" fill="#4f7f9f" />
          <path d="M66,46 C62,28 66,20 76,18 C88,18 92,30 88,46 Z" fill="#c62f36" />
          <circle cx="78" cy="14" r="9" fill="#ffd8c2" />
          <path d="M69,15 C70,28 86,28 87,15 C84,22 72,22 69,15 Z" fill="#ffffff" />
          <path d="M69,10 C70,0 84,-2 90,6 L96,12 L86,9 C82,7 74,7 69,10 Z" fill="#c62f36" />
          <circle cx="97" cy="13" r="3" fill="#ffffff" />
          <rect x="68" y="8" width="20" height="4" rx="2" fill="#ffffff" />
          <path d="M86,32 L104,38" stroke="#c62f36" strokeWidth="5" strokeLinecap="round" />
        </g>
      </svg>
      {Array.from({ length: 8 }).map((_, i) => (
        <span key={i} className="en-santa-spark" style={{ left: `${-4 - i * 5}%`, top: `${70 + (i % 3) * 6}%`, animationDelay: `${i * 0.09}s` }} />
      ))}
    </div>
  );
}

/** The end of the rainbow: a pot of gold coins and a leprechaun dancing a jig beside it. */
function PotOfGold() {
  return (
    <div className="en-gold" aria-hidden="true">
      <svg className="en-leprechaun" viewBox="0 0 120 190">
        <ellipse cx="60" cy="186" rx="34" ry="5" fill="rgba(30,60,30,0.25)" />
        <g className="en-lep-body">
          <path d="M44,150 L40,176 L30,178 C26,180 28,184 34,184 L48,183 L52,152 Z" fill="#1f5f33" />
          <path d="M76,150 L80,176 L90,178 C94,180 92,184 86,184 L72,183 L68,152 Z" fill="#1f5f33" />
          <rect x="26" y="178" width="22" height="7" rx="3" fill="#2b2f36" />
          <rect x="72" y="178" width="22" height="7" rx="3" fill="#2b2f36" />
          <path d="M36,96 C34,130 38,156 60,158 C82,156 86,130 84,96 Z" fill="#2e9a4f" />
          <rect x="37" y="128" width="46" height="8" fill="#2b2f36" />
          <rect x="54" y="126" width="12" height="12" rx="2" fill="none" stroke="#f4cf6a" strokeWidth="3" />
          <path d="M60,98 L60,126" stroke="#f4cf6a" strokeWidth="2" strokeDasharray="2 6" />
          <path d="M36,104 C26,112 22,124 26,132" stroke="#2e9a4f" strokeWidth="11" strokeLinecap="round" fill="none" />
          <circle cx="26" cy="134" r="6" fill="#ffd8c2" />
          <g className="en-lep-wave">
            <path d="M84,104 C96,96 102,84 100,72" stroke="#2e9a4f" strokeWidth="11" strokeLinecap="round" fill="none" />
            <circle cx="100" cy="68" r="6" fill="#ffd8c2" />
          </g>
          <circle cx="60" cy="74" r="22" fill="#ffd8c2" />
          <path d="M40,78 C40,104 52,112 60,112 C68,112 80,104 80,78 C74,90 46,90 40,78 Z" fill="#e8742c" />
          <path d="M50,92 Q60,98 70,92" stroke="#b9531e" strokeWidth="2" fill="none" />
          <circle cx="52" cy="72" r="2.8" fill="#2b2f36" />
          <circle cx="68" cy="72" r="2.8" fill="#2b2f36" />
          <circle cx="60" cy="80" r="3.4" fill="#f5a98a" />
          <path d="M47,64 Q52,60 57,64 M63,64 Q68,60 73,64" stroke="#b9531e" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <circle cx="47" cy="80" r="3.5" fill="#ffb3a1" opacity="0.7" />
          <circle cx="73" cy="80" r="3.5" fill="#ffb3a1" opacity="0.7" />
          <g className="en-lep-hat">
            <rect x="30" y="52" width="60" height="8" rx="3" fill="#1f5f33" />
            <path d="M40,54 L44,18 L76,18 L80,54 Z" fill="#2e9a4f" />
            <rect x="42" y="42" width="36" height="8" fill="#2b2f36" />
            <rect x="54" y="40" width="12" height="12" rx="2" fill="none" stroke="#f4cf6a" strokeWidth="3" />
            <path d="M74,22 C84,14 90,20 86,28 C82,22 78,22 74,22 Z" fill="#5fc46a" />
          </g>
        </g>
      </svg>
      <svg className="en-pot" viewBox="0 0 150 130">
        <ellipse cx="75" cy="126" rx="56" ry="5" fill="rgba(30,60,30,0.25)" />
        {[[34, 46], [52, 36], [70, 32], [88, 34], [106, 42], [118, 52], [44, 30], [62, 24], [80, 22], [98, 28], [70, 14]].map(([cx, cy], i) => (
          <g key={i}>
            <ellipse cx={cx} cy={cy} rx="12" ry="7" fill="#e8b830" />
            <ellipse cx={cx} cy={cy - 1.5} rx="9" ry="4.5" fill="#f9d65c" />
          </g>
        ))}
        <path d="M18,58 C10,108 40,124 75,124 C110,124 140,108 132,58 Z" fill="#2b2f36" />
        <path d="M30,74 C28,96 46,108 64,110" stroke="#4a505a" strokeWidth="5" fill="none" strokeLinecap="round" />
        <rect x="12" y="50" width="126" height="14" rx="7" fill="#3a3f48" />
        <rect x="26" y="114" width="12" height="10" rx="3" fill="#2b2f36" />
        <rect x="112" y="114" width="12" height="10" rx="3" fill="#2b2f36" />
        {[[50, 30], [90, 24], [112, 46], [66, 16]].map(([cx, cy], i) => (
          <path key={`g${i}`} className="en-glint" style={{ animationDelay: `${0.3 * i}s` }} d={`M${cx},${cy - 9} C${cx + 1},${cy - 2} ${cx + 2},${cy - 1} ${cx + 9},${cy} C${cx + 2},${cy + 1} ${cx + 1},${cy + 2} ${cx},${cy + 9} C${cx - 1},${cy + 2} ${cx - 2},${cy + 1} ${cx - 9},${cy} C${cx - 2},${cy - 1} ${cx - 1},${cy - 2} ${cx},${cy - 9} Z`} fill="#fffbe0" />
        ))}
        <g className="en-coin-flip"><ellipse cx="75" cy="10" rx="10" ry="10" fill="#f9d65c" stroke="#e8b830" strokeWidth="3" /></g>
      </svg>
    </div>
  );
}

/** A pilgrim couple waving hello (Thanksgiving), anchored right on the meadow. */
function Pilgrims() {
  return (
    <svg className="en-pilgrims" viewBox="0 0 200 200" aria-hidden="true">
      <ellipse cx="100" cy="196" rx="86" ry="6" fill="rgba(60,40,20,0.22)" />
      {/* Him: tall buckled hat, black coat, white collar */}
      <g className="en-pilgrim">
        <rect x="40" y="168" width="10" height="24" fill="#2b2f36" />
        <rect x="58" y="168" width="10" height="24" fill="#2b2f36" />
        <rect x="36" y="188" width="17" height="7" rx="3" fill="#1d1f24" />
        <rect x="55" y="188" width="17" height="7" rx="3" fill="#1d1f24" />
        <path d="M30,100 C28,140 32,172 54,172 C76,172 80,140 78,100 Z" fill="#33363d" />
        <path d="M40,98 L54,118 L68,98 Z" fill="#ffffff" />
        <circle cx="54" cy="136" r="2.5" fill="#d9b45a" /><circle cx="54" cy="150" r="2.5" fill="#d9b45a" />
        <path d="M30,108 C22,124 22,140 26,150" stroke="#33363d" strokeWidth="11" strokeLinecap="round" fill="none" />
        <circle cx="26" cy="152" r="6" fill="#ffd8c2" />
        <g className="en-pilgrim-wave">
          <path d="M78,106 C90,98 96,86 94,74" stroke="#33363d" strokeWidth="11" strokeLinecap="round" fill="none" />
          <circle cx="94" cy="70" r="6" fill="#ffd8c2" />
        </g>
        <circle cx="54" cy="78" r="19" fill="#ffd8c2" />
        <circle cx="47" cy="76" r="2.5" fill="#2b2f36" /><circle cx="61" cy="76" r="2.5" fill="#2b2f36" />
        <path d="M47,85 Q54,91 61,85" stroke="#b9531e" strokeWidth="2" fill="none" strokeLinecap="round" />
        <circle cx="42" cy="83" r="3" fill="#ffb3a1" opacity="0.7" /><circle cx="66" cy="83" r="3" fill="#ffb3a1" opacity="0.7" />
        <path d="M36,74 C36,62 44,58 54,58 C64,58 72,62 72,74 C66,66 42,66 36,74 Z" fill="#7a4a2e" />
        <rect x="26" y="58" width="56" height="7" rx="3" fill="#1d1f24" />
        <path d="M37,60 L40,26 L68,26 L71,60 Z" fill="#2b2f36" />
        <rect x="38" y="48" width="32" height="7" fill="#7a4a2e" />
        <rect x="48" y="46" width="12" height="11" rx="1.5" fill="none" stroke="#f4cf6a" strokeWidth="3" />
      </g>
      {/* Her: white bonnet and apron, holding a little pie */}
      <g className="en-pilgrim en-pilgrim-2">
        <path d="M116,104 C110,150 104,180 140,184 C176,180 170,150 164,104 Z" fill="#4a4f63" />
        <path d="M126,112 C124,150 126,174 140,176 C154,174 156,150 154,112 Z" fill="#f8f4ea" />
        <path d="M126,102 L140,118 L154,102 Z" fill="#ffffff" />
        <rect x="130" y="182" width="9" height="10" fill="#2b2f36" /><rect x="142" y="182" width="9" height="10" fill="#2b2f36" />
        <path d="M118,112 C112,124 114,134 124,138" stroke="#4a4f63" strokeWidth="10" strokeLinecap="round" fill="none" />
        <path d="M162,112 C168,124 166,134 156,138" stroke="#4a4f63" strokeWidth="10" strokeLinecap="round" fill="none" />
        <ellipse cx="140" cy="138" rx="20" ry="6" fill="#d9a25a" />
        <path d="M120,136 C124,128 156,128 160,136 Z" fill="#c2662d" />
        <path d="M128,132 l6,-3 M138,131 l6,-3 M148,132 l6,-3" stroke="#f2c14e" strokeWidth="2" strokeLinecap="round" />
        <circle cx="140" cy="82" r="18" fill="#ffd8c2" />
        <circle cx="134" cy="81" r="2.4" fill="#2b2f36" /><circle cx="146" cy="81" r="2.4" fill="#2b2f36" />
        <path d="M134,89 Q140,94 146,89" stroke="#b9531e" strokeWidth="2" fill="none" strokeLinecap="round" />
        <circle cx="129" cy="87" r="3" fill="#ffb3a1" opacity="0.7" /><circle cx="151" cy="87" r="3" fill="#ffb3a1" opacity="0.7" />
        <path d="M119,88 C114,62 128,56 140,56 C152,56 166,62 161,88 C158,74 150,68 140,68 C130,68 122,74 119,88 Z" fill="#ffffff" stroke="#e3ddd0" strokeWidth="2" />
        <path d="M122,90 C120,98 124,102 128,100 M158,90 C160,98 156,102 152,100" stroke="#ffffff" strokeWidth="4" fill="none" strokeLinecap="round" />
      </g>
    </svg>
  );
}
