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

      {/* A soft band of valley haze sitting in front of the peaks */}
      <div className="scene-haze" />

      {/* Near ridge, softer */}
      <svg className="scene-ridge scene-ridge-near" viewBox="0 0 1440 200" preserveAspectRatio="none">
        <path d="M0,200 L0,150 C120,120 240,160 380,140 C520,120 640,90 780,110 C920,130 1040,100 1160,115 C1280,130 1370,110 1440,125 L1440,200 Z" />
      </svg>

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
