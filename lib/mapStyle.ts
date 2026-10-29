/**
 * MapLibre styles for the store map, built from the site's own theme tokens
 * so water, parks, roads and labels feel like part of the site. One function,
 * two looks: pass the light tokens or the dark ones (the admin dashboard's dark
 * theme redefines the same tokens). OpenFreeMap vector tiles (OpenStreetMap
 * data, OpenMapTiles schema) — free, no key.
 *
 * No DOM or browser imports here: the unit test validates the output against
 * the MapLibre style spec.
 */

export type MapTokens = {
  /** Page background (land). */
  bg: string;
  /** Card/surface colour (major roads in dark, minor roads in light). */
  surface: string;
  /** Main text colour (labels). */
  ink: string;
  /** Muted text colour (minor labels, boundaries). */
  muted: string;
  /** Hairline colour (road edges, buildings). */
  rule: string;
  /** Brand accent (parks tint, highlights). */
  accent: string;
  /** Secondary accent (water tint). */
  water: string;
  dark: boolean;
};

export const TILES_URL = "https://tiles.openfreemap.org/planet";
export const GLYPHS_URL = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
export const ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>';

const FONT = ["Noto Sans Regular"];
const FONT_BOLD = ["Noto Sans Bold"];
const FONT_ITALIC = ["Noto Sans Italic"];

/** Mix two #rrggbb colours: t = 0 → a, t = 1 → b. Anything unparseable returns a. */
export function mix(a: string, b: string, t: number): string {
  const p = (h: string) => {
    const m = h.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) return null;
    const x = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
    return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16));
  };
  const A = p(a), B = p(b);
  if (!A || !B) return a;
  return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

const NAME = ["coalesce", ["get", "name:en"], ["get", "name"]];
const W = (pairs: Array<[number, number]>) => ["interpolate", ["exponential", 1.4], ["zoom"], ...pairs.flat()];

/** The full style for one theme. */
export function buildMapStyle(k: MapTokens): any {
  const land = k.bg;
  const water = mix(k.bg, k.water, k.dark ? 0.22 : 0.2);
  const waterLine = mix(k.bg, k.water, k.dark ? 0.35 : 0.32);
  const park = mix(k.bg, k.accent, k.dark ? 0.12 : 0.14);
  const wood = mix(k.bg, k.accent, k.dark ? 0.08 : 0.09);
  const building = mix(k.bg, k.rule, k.dark ? 0.35 : 0.4);
  const roadMinor = k.dark ? mix(k.bg, k.ink, 0.12) : mix(k.bg, "#ffffff", 0.75);
  const roadMajor = k.dark ? mix(k.bg, k.ink, 0.2) : "#ffffff";
  const roadEdge = mix(k.bg, k.rule, k.dark ? 0.5 : 0.7);
  const motorway = mix(roadMajor, k.accent, k.dark ? 0.18 : 0.22);
  const boundary = mix(k.bg, k.muted, 0.55);
  const label = k.ink;
  const labelSoft = k.muted;
  const halo = k.bg;

  const road = (id: string, classes: string[], color: string, widths: Array<[number, number]>, minzoom = 0) => ({
    id,
    type: "line",
    source: "openmaptiles",
    "source-layer": "transportation",
    minzoom,
    filter: ["all", ["match", ["get", "class"], classes, true, false], ["!=", ["get", "brunnel"], "tunnel"]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": color, "line-width": W(widths) },
  });

  return {
    version: 8,
    name: k.dark ? "Store map dark" : "Store map light",
    glyphs: GLYPHS_URL,
    sources: { openmaptiles: { type: "vector", url: TILES_URL, attribution: ATTRIBUTION } },
    layers: [
      { id: "background", type: "background", paint: { "background-color": land } },
      { id: "wood", type: "fill", source: "openmaptiles", "source-layer": "landcover", filter: ["match", ["get", "class"], ["wood", "forest"], true, false], paint: { "fill-color": wood } },
      { id: "grass", type: "fill", source: "openmaptiles", "source-layer": "landcover", filter: ["match", ["get", "class"], ["grass", "farmland"], true, false], paint: { "fill-color": wood, "fill-opacity": 0.6 } },
      { id: "park", type: "fill", source: "openmaptiles", "source-layer": "park", paint: { "fill-color": park } },
      { id: "water", type: "fill", source: "openmaptiles", "source-layer": "water", paint: { "fill-color": water } },
      { id: "waterway", type: "line", source: "openmaptiles", "source-layer": "waterway", paint: { "line-color": waterLine, "line-width": W([[8, 0.5], [16, 3]]) } },
      { id: "building", type: "fill", source: "openmaptiles", "source-layer": "building", minzoom: 14, paint: { "fill-color": building, "fill-opacity": 0.55 } },
      { id: "boundary", type: "line", source: "openmaptiles", "source-layer": "boundary", filter: ["<=", ["get", "admin_level"], 4], paint: { "line-color": boundary, "line-width": 1, "line-dasharray": [3, 2] } },
      road("road-edge-major", ["motorway", "trunk", "primary"], roadEdge, [[6, 1], [12, 3.5], [18, 24]], 6),
      road("road-minor", ["minor", "service", "track"], roadMinor, [[12, 0.5], [14, 2], [18, 12]], 12),
      road("road-mid", ["secondary", "tertiary"], roadMajor, [[8, 0.6], [12, 1.6], [18, 16]], 8),
      road("road-major", ["primary", "trunk"], roadMajor, [[6, 0.6], [12, 2.4], [18, 20]], 6),
      road("road-motorway", ["motorway"], motorway, [[5, 0.7], [12, 2.8], [18, 22]], 5),
      {
        id: "water-name", type: "symbol", source: "openmaptiles", "source-layer": "water_name",
        layout: { "text-field": NAME, "text-font": FONT_ITALIC, "text-size": 12 },
        paint: { "text-color": waterLine, "text-halo-color": halo, "text-halo-width": 1.2 },
      },
      {
        id: "road-name", type: "symbol", source: "openmaptiles", "source-layer": "transportation_name", minzoom: 13,
        layout: { "symbol-placement": "line", "text-field": NAME, "text-font": FONT, "text-size": 11 },
        paint: { "text-color": labelSoft, "text-halo-color": halo, "text-halo-width": 1.4 },
      },
      {
        id: "place-minor", type: "symbol", source: "openmaptiles", "source-layer": "place", minzoom: 11,
        filter: ["match", ["get", "class"], ["suburb", "neighbourhood", "village", "hamlet"], true, false],
        layout: { "text-field": NAME, "text-font": FONT, "text-size": 12 },
        paint: { "text-color": labelSoft, "text-halo-color": halo, "text-halo-width": 1.4 },
      },
      {
        id: "place-town", type: "symbol", source: "openmaptiles", "source-layer": "place",
        filter: ["==", ["get", "class"], "town"],
        layout: { "text-field": NAME, "text-font": FONT, "text-size": ["interpolate", ["linear"], ["zoom"], 8, 12, 14, 16] },
        paint: { "text-color": label, "text-halo-color": halo, "text-halo-width": 1.6 },
      },
      {
        id: "place-city", type: "symbol", source: "openmaptiles", "source-layer": "place",
        filter: ["==", ["get", "class"], "city"],
        layout: { "text-field": NAME, "text-font": FONT_BOLD, "text-size": ["interpolate", ["linear"], ["zoom"], 4, 12, 12, 20] },
        paint: { "text-color": label, "text-halo-color": halo, "text-halo-width": 1.8 },
      },
    ],
  };
}
