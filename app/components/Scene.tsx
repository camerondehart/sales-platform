import { brand } from "@/lib/brand";
/**
 * The illustrated valley that sits behind the whole site.
 *
 * It is a fixed-position decorative layer, which means it stays put while the
 * page scrolls over it — the sign-in card, the public shop below it and the
 * member gallery all float above the same landscape.
 *
 * `variant="soft"` dims the whole thing for content-heavy pages (the gallery)
 * so it reads as atmosphere rather than as artwork competing with products.
 */
export default function Scene({ variant = "full" }: { variant?: "full" | "soft" }) {
  if (brand.decor === "plain") return null;
  return (
    <div className={`scene scene-${variant}`} aria-hidden="true">
      <div className="scene-sky" />
      <div className="scene-sun" />

      {/* Northern lights (winter only; shown by CSS when <body data-season="winter">) */}
      <div className="scene-aurora">
        <span /><span /><span />
      </div>

      {/* Slow clouds, drifting the long way across */}
      <div className="scene-cloud scene-cloud-1" />
      <div className="scene-cloud scene-cloud-2" />
      <div className="scene-cloud scene-cloud-3" />

      {/* Mistiest ridge, furthest back — pure atmosphere */}
      <svg className="scene-ridge scene-ridge-haze" viewBox="0 0 1440 380" preserveAspectRatio="none">
        <path d="M0,380 L0,300 C90,290 150,250 230,180 C290,128 330,112 380,150 C440,196 480,244 560,250 C650,257 700,180 780,110 C830,66 880,58 925,105 C985,167 1030,232 1110,238 C1190,244 1240,175 1315,120 C1360,88 1400,96 1440,140 L1440,380 Z" />
      </svg>

      {/* Far ridge */}
      <svg className="scene-ridge scene-ridge-far" viewBox="0 0 1440 320" preserveAspectRatio="none">
        <path d="M0,320 L0,240 C60,235 110,210 170,150 C210,110 235,95 260,120 C300,160 330,200 380,205 C440,211 470,150 530,90 C570,50 600,40 630,75 C680,135 710,190 770,196 C830,202 860,140 915,85 C950,50 980,45 1010,80 C1060,140 1090,185 1150,192 C1210,199 1245,150 1300,105 C1340,72 1380,80 1410,120 C1425,140 1435,160 1440,170 L1440,320 Z" />
      </svg>

      {/* Little forests on the far peaks' lower slopes (hazy, small) */}
      <div className="scene-trees scene-trees-far">
        {FAR_TREES.map(([x, f, s, kind], i) => <Tree key={i} x={x} f={f} s={s} kind={kind} thin={i % 3 === 1} />)}
      </div>

      {/* A soft band of valley haze sitting in front of the peaks */}
      <div className="scene-haze" />

      {/* Near ridge, softer */}
      <svg className="scene-ridge scene-ridge-near" viewBox="0 0 1440 200" preserveAspectRatio="none">
        <path d="M0,200 L0,150 C120,120 240,160 380,140 C520,120 640,90 780,110 C920,130 1040,100 1160,115 C1280,130 1370,110 1440,125 L1440,200 Z" />
      </svg>

      {/* Stands of trees along the near ridge, riding its contour */}
      <div className="scene-trees scene-trees-near">
        {/* Easter egg (winter only): a little yeti who now and then peeks out from behind the trees and waves */}
        <span className="scene-yeti-hole">
        <svg className="scene-yeti" viewBox="0 0 60 64">
          <g className="scene-yeti-arm"><path d="M44,30 C52,24 54,16 52,10" stroke="#f4f9ff" strokeWidth="7" strokeLinecap="round" fill="none" /><circle cx="52" cy="9" r="4" fill="#cfe3f5" /></g>
          <path d="M10,64 C6,40 12,18 30,16 C48,18 54,40 50,64 Z" fill="#f4f9ff" stroke="#c9dcef" strokeWidth="1.5" />
          <path d="M14,24 l-4,-6 4,1 M46,24 l4,-6 -4,1" stroke="#f4f9ff" strokeWidth="4" strokeLinecap="round" />
          <ellipse cx="30" cy="33" rx="12" ry="10" fill="#bfd9f2" />
          <circle cx="25.5" cy="31" r="2.2" fill="#2b3a4a" /><circle cx="34.5" cy="31" r="2.2" fill="#2b3a4a" />
          <path d="M25,37 Q30,41 35,37" stroke="#2b3a4a" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          <circle cx="21" cy="36" r="2" fill="#ffc2d1" opacity="0.8" /><circle cx="39" cy="36" r="2" fill="#ffc2d1" opacity="0.8" />
        </svg>
        </span>
        {NEAR_TREES.map(([x, f, s, kind], i) => <Tree key={i} x={x} f={f} s={s} kind={kind} thin={i % 2 === 1} />)}
      </div>

      {/* Foreground meadow */}
      <svg className="scene-meadow" viewBox="0 0 1440 120" preserveAspectRatio="none">
        <path d="M0,120 L0,60 C180,30 360,75 560,55 C760,35 920,80 1120,60 C1280,45 1380,65 1440,55 L1440,120 Z" />
      </svg>

      {/* Grasses catching the breeze along the meadow line */}
      <svg className="scene-grass" viewBox="0 0 1440 90" preserveAspectRatio="none">
        <g className="sg sg-1">
          <path d="M120,90 C118,70 116,52 110,36" /><path d="M132,90 C132,72 134,56 140,42" />
          <path d="M126,90 C126,74 124,60 120,48" />
        </g>
        <g className="sg sg-2">
          <path d="M640,90 C638,72 636,56 630,40" /><path d="M652,90 C652,74 654,58 660,46" />
          <path d="M646,90 C646,76 644,62 641,52" />
        </g>
        <g className="sg sg-3">
          <path d="M1180,90 C1178,74 1176,58 1170,44" /><path d="M1192,90 C1192,74 1194,60 1200,48" />
          <path d="M1186,90 C1186,76 1184,64 1181,54" />
        </g>
      </svg>

      {/* A little family of toadstools in the meadow */}
      <svg className="scene-shrooms" viewBox="0 0 220 120">
        <g className="ss ss-1">
          <path className="ss-stem" d="M52,70 C50,84 48,98 47,110 C47,115 52,118 59,118 C66,118 71,115 70,110 C68,98 67,84 66,70" />
          <path className="ss-cap" d="M59,22 C40,23 26,38 22,54 C20,62 24,69 32,70 C50,74 70,73 86,69 C93,67 96,60 94,54 C89,36 76,21 59,22 Z" />
          <path className="ss-spot" d="M44,40 C41,42 42,47 45,48 C49,49 52,45 50,42 C49,40 46,39 44,40 Z" />
          <path className="ss-spot" d="M66,34 C63,36 64,40 67,41 C70,42 73,38 71,36 C70,34 68,33 66,34 Z" />
        </g>
        <g className="ss ss-2">
          <path className="ss-stem" d="M138,84 C137,94 136,104 136,112 C136,116 140,119 145,119 C150,119 154,116 154,112 C153,104 152,94 151,84" />
          <path className="ss-cap" d="M145,52 C132,53 122,64 120,76 C119,82 123,87 129,88 C140,90 152,90 162,87 C168,86 171,81 169,76 C166,63 157,51 145,52 Z" />
          <path className="ss-spot" d="M136,66 C134,68 135,71 137,72 C140,73 142,70 140,68 C139,66 137,65 136,66 Z" />
        </g>
        <g className="ss ss-3">
          <path className="ss-stem" d="M188,96 C187,102 186,108 186,113 C186,116 189,118 193,118 C197,118 200,116 200,113 C199,108 198,102 197,96" />
          <path className="ss-cap" d="M193,74 C184,75 178,82 176,90 C175,94 178,97 182,98 C189,99 197,99 204,97 C208,96 210,93 209,90 C207,81 201,73 193,74 Z" />
        </g>
      </svg>

      {/* Spores drifting on the air — finer and slower than the fireflies */}
      {Array.from({ length: 14 }).map((_, i) => (
        <span
          key={`sp-${i}`}
          className="scene-spore"
          style={{
            left: `${(i * 17 + 4) % 100}%`,
            animationDelay: `${(i % 9) * 2.3}s`,
            animationDuration: `${16 + (i % 5) * 4}s`,
          }}
        />
      ))}

      {/* Fireflies rising through the dusk */}
      {Array.from({ length: 10 }).map((_, i) => (
        <span
          key={`fl-${i}`}
          className="scene-fly"
          style={{
            left: `${(i * 31 + 7) % 100}%`,
            animationDelay: `${(i % 7) * 1.1}s`,
            animationDuration: `${7 + (i % 4) * 2}s`,
          }}
        />
      ))}
    </div>
  );
}

/* Trees on the hills: [left %, height up the ridge (0–1, from the ridge's own path), size, kind].
   Placed as separate little SVGs (not inside the stretched ridge art) so they keep their shape on
   every screen; colours come from --sc-tree / --sc-tree2, so they follow the seasons too. */
type TreeSpec = [number, number, number, "pine" | "round"];
const NEAR_TREES: TreeSpec[] = [
  [0.4, 0.257, 1.25, "pine"], [1.7, 0.277, 0.81, "pine"], [3.3, 0.293, 1.17, "round"], [5.0, 0.303, 0.93, "pine"],
  [8.2, 0.308, 0.94, "round"], [9.7, 0.305, 1.21, "pine"], [11.7, 0.298, 1.04, "pine"], [12.7, 0.294, 1.0, "round"],
  [18.3, 0.273, 1.07, "round"], [19.8, 0.271, 1.2, "pine"], [21.3, 0.271, 1.18, "pine"], [22.9, 0.275, 0.92, "round"],
  [30.1, 0.341, 1.05, "pine"], [31.9, 0.362, 1.11, "round"], [33.7, 0.383, 0.95, "pine"], [35.5, 0.403, 0.77, "pine"],
  [38.7, 0.437, 0.97, "round"], [41.2, 0.457, 0.8, "pine"], [42.8, 0.468, 1.1, "pine"], [44.5, 0.477, 0.96, "round"],
  [49.2, 0.481, 1.18, "pine"], [50.7, 0.476, 1.12, "round"], [52.0, 0.468, 1.24, "pine"], [54.2, 0.45, 1.2, "pine"],
  [58.8, 0.419, 1.01, "pine"], [60.5, 0.415, 0.9, "pine"], [61.6, 0.414, 1.03, "round"], [63.3, 0.416, 0.96, "pine"],
  [69.0, 0.432, 1.24, "pine"], [70.6, 0.438, 0.85, "pine"], [72.5, 0.443, 1.14, "round"], [74.5, 0.447, 0.77, "pine"],
  [77.6, 0.443, 0.85, "pine"], [78.9, 0.437, 1.2, "pine"], [80.5, 0.425, 0.79, "round"], [82.3, 0.412, 1.21, "pine"],
  [87.2, 0.395, 0.77, "round"], [88.3, 0.395, 0.92, "pine"], [90.9, 0.399, 1.02, "pine"], [92.3, 0.401, 1.12, "round"],
  [94.7, 0.405, 0.81, "pine"], [96.5, 0.403, 1.0, "round"], [98.5, 0.392, 0.8, "pine"], [99.7, 0.379, 1.17, "pine"],
];
const FAR_TREES: TreeSpec[] = [
  [5.9, 0.326, 0.8, "round"], [7.2, 0.359, 1.09, "pine"], [8.1, 0.387, 1.11, "pine"], [22.8, 0.422, 1.14, "pine"],
  [24.0, 0.39, 1.06, "pine"], [25.4, 0.368, 0.8, "pine"], [47.4, 0.559, 1.11, "round"], [48.6, 0.499, 0.9, "pine"],
  [49.6, 0.463, 0.97, "pine"], [51.8, 0.404, 0.89, "round"], [52.5, 0.396, 0.81, "pine"], [54.2, 0.386, 1.25, "pine"],
  [75.2, 0.497, 1.22, "pine"], [76.0, 0.466, 0.95, "round"], [77.0, 0.439, 1.29, "pine"], [82.6, 0.412, 1.17, "pine"],
  [83.7, 0.432, 0.96, "pine"], [85.2, 0.477, 1.26, "round"], [95.6, 0.717, 0.94, "pine"], [96.3, 0.697, 1.03, "pine"],
  [97.5, 0.648, 0.8, "round"],
];

/* `thin`: left out on narrow screens (phones, portrait tablets), where the stands would otherwise
   crowd into one blur: groves of two instead of four. */
function Tree({ x, f, s, kind, thin }: { x: number; f: number; s: number; kind: "pine" | "round"; thin?: boolean }) {
  const style = { left: `${x}%`, "--f": f, "--s": s } as React.CSSProperties;
  const cls = thin ? " t-thin" : "";
  return kind === "pine" ? (
    <svg className={`scene-tree t-pine${cls}`} viewBox="0 0 40 64" style={style}>
      <rect className="tr-trunk" x="17.5" y="52" width="5" height="12" />
      <polygon className="tr-a" points="20,22 4,54 20,54" /><polygon className="tr-b" points="20,22 36,54 20,54" />
      <polygon className="tr-a" points="20,10 7,38 20,38" /><polygon className="tr-b" points="20,10 33,38 20,38" />
      <polygon className="tr-a" points="20,0 10,22 20,22" /><polygon className="tr-b" points="20,0 30,22 20,22" />
      <path className="tr-snow" d="M20,0 L13.5,14 L17,12.5 L20,15 L23,12.5 L26.5,14 Z M20,12 L10.5,31 L15,29 L20,32 L25,29 L29.5,31 Z" />
    </svg>
  ) : (
    <svg className={`scene-tree t-round${cls}`} viewBox="0 0 40 56" style={style}>
      <rect className="tr-trunk" x="17.5" y="36" width="5" height="20" />
      <circle className="tr-c" cx="20" cy="22" r="17" />
      <path className="tr-b2" d="M20,5 A17,17 0 0 1 20,39 A10,17 0 0 0 20,5 Z" />
      <path className="tr-snow" d="M6,16 C9,6 31,6 34,16 C28,12 12,12 6,16 Z" />
    </svg>
  );
}
