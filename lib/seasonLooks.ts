import type { EntranceKey, Falling } from "./entranceThemes";

/**
 * Seasonal site backgrounds (switch `seasonal_site`): the same theme the
 * members' entrance uses (Settings → Entrance animation, Auto by default),
 * applied gently to the illustrated valley behind the site — sky, sun,
 * ridges, meadow, mushroom caps — plus a light layer of things drifting down.
 * Kept pale on purpose so text stays easy to read. Client-safe.
 * Colours: "r, g, b" strings are used inside rgba() with the site's own opacities.
 */
export type SiteLook = {
  sky: [string, string, string, string];
  sun: string;
  ridge: string;
  meadow: string;
  caps?: [string, string, string];
  /** Evergreens and leafy trees on the hills ("r, g, b"); default greens when left out. */
  tree?: string;
  tree2?: string;
  /** Corner glows on the page background. */
  glow: [string, string];
  drift?: Falling;
};

export const SITE_LOOKS: Partial<Record<EntranceKey, SiteLook>> = {
  spring: {
    tree: "74, 130, 70", tree2: "236, 158, 188",
    sky: ["#fbf9fa", "#f8f1f4", "#f2f3e7", "#eaf2dd"], sun: "255, 226, 236", ridge: "140, 190, 110", meadow: "118, 176, 82",
    caps: ["#e57fa0", "#85ba45", "#f2c14e"], glow: ["244, 167, 191", "133, 186, 69"],
    drift: { kind: "petal", colors: ["#f8c3d3", "#ffffff", "#f4a7bf"], count: 16 },
  },
  summer: {
    tree: "60, 120, 60", tree2: "80, 150, 60",
    sky: ["#fbfaf2", "#f7f6e0", "#eff4da", "#e6efd0"], sun: "255, 236, 160", ridge: "116, 178, 78", meadow: "106, 162, 63",
    glow: ["255, 211, 77", "47, 141, 184"],
  },
  fall: {
    tree: "70, 110, 70", tree2: "214, 118, 48",
    sky: ["#fbf8f3", "#f8f0e3", "#f3e6d1", "#eddcc0"], sun: "250, 210, 150", ridge: "196, 118, 60", meadow: "168, 140, 72",
    caps: ["#c2452f", "#d98a3a", "#e0b04a"], glow: ["224, 122, 46", "194, 69, 47"],
    drift: { kind: "leaf", colors: ["#e07a2e", "#c2452f", "#e6a53a", "#a8552a"], count: 18 },
  },
  winter: {
    tree: "58, 118, 132", tree2: "150, 196, 230",
    sky: ["#f7fbff", "#eaf4fe", "#dfeefc", "#d3e8fa"], sun: "214, 236, 255", ridge: "110, 168, 222", meadow: "200, 226, 250",
    caps: ["#e05a6a", "#5aa6e0", "#a9d3f5"], glow: ["150, 205, 250", "180, 168, 245"],
    drift: { kind: "snow", colors: ["#ffffff"], count: 30 },
  },
  valentines: {
    tree: "74, 130, 80", tree2: "240, 150, 180",
    sky: ["#fcf8f9", "#faeff2", "#f6e8ea", "#efe6e0"], sun: "255, 214, 224", ridge: "204, 120, 150", meadow: "132, 180, 100",
    caps: ["#e0457b", "#f48fb1", "#c92a5f"], glow: ["224, 69, 123", "244, 143, 177"],
    drift: { kind: "heart", colors: ["#f48fb1", "#e0457b", "#ffb3c8"], count: 10 },
  },
  stpatricks: {
    tree: "40, 128, 70", tree2: "80, 170, 80",
    sky: ["#f8fbf6", "#eff7ea", "#eaf3df", "#e1eed2"], sun: "236, 247, 200", ridge: "70, 160, 90", meadow: "80, 160, 70",
    caps: ["#2e9a4f", "#5fc46a", "#f4cf6a"], glow: ["46, 154, 79", "244, 207, 106"],
    drift: { kind: "shamrock", colors: ["#2e9a4f", "#4fbf5f", "#7fd38a"], count: 12 },
  },
  earthday: {
    tree: "60, 130, 80", tree2: "90, 170, 80",
    sky: ["#f7fbfb", "#ecf5f4", "#e6f1e2", "#ddebd2"], sun: "200, 230, 250", ridge: "80, 150, 110", meadow: "100, 170, 80",
    caps: ["#d4583f", "#3f8fd0", "#85ba45"], glow: ["63, 143, 208", "95, 164, 69"],
    drift: { kind: "leaf", colors: ["#5fa445", "#85ba45", "#3f9a5a"], count: 14 },
  },
  mothersday: {
    tree: "74, 130, 80", tree2: "212, 160, 214",
    sky: ["#fbf9fc", "#f6eff7", "#f4e9ee", "#eee7e4"], sun: "255, 226, 236", ridge: "167, 120, 170", meadow: "120, 176, 90",
    caps: ["#a7639c", "#f48fb1", "#c9a2ff"], glow: ["201, 162, 255", "244, 143, 177"],
    drift: { kind: "petal", colors: ["#f8c3d3", "#d9b8f0", "#ffffff"], count: 16 },
  },
  july4: {
    tree: "60, 110, 70", tree2: "90, 150, 70",
    sky: ["#f8f9fc", "#eff2f8", "#f2ece9", "#ebe8e2"], sun: "255, 236, 200", ridge: "80, 110, 170", meadow: "100, 150, 80",
    caps: ["#d23a3a", "#3a6fd2", "#f4cf6a"], glow: ["210, 58, 58", "58, 111, 210"],
    drift: { kind: "star", colors: ["#e05050", "#4d7cff", "#f4cf6a"], count: 12 },
  },
  halloween: {
    tree: "70, 72, 80", tree2: "204, 112, 50",
    sky: ["#faf7f5", "#f4ede9", "#eee3e5", "#e6dae2"], sun: "250, 210, 160", ridge: "150, 112, 150", meadow: "120, 116, 80",
    caps: ["#e07a2e", "#6b4a8a", "#f2b33d"], glow: ["224, 122, 46", "107, 74, 138"],
    drift: { kind: "leaf", colors: ["#e07a2e", "#a8552a", "#6b4a8a"], count: 14 },
  },
  thanksgiving: {
    tree: "76, 104, 64", tree2: "200, 112, 46",
    sky: ["#fbf8f2", "#f8efe0", "#f3e5cc", "#ecdabb"], sun: "250, 214, 150", ridge: "184, 112, 46", meadow: "176, 150, 76",
    caps: ["#b8702e", "#e07a2e", "#f2c14e"], glow: ["217, 138, 58", "184, 112, 46"],
    drift: { kind: "leaf", colors: ["#d98a3a", "#b8702e", "#f2c14e", "#8f3f26"], count: 16 },
  },
  holiday: {
    tree: "40, 100, 70", tree2: "40, 100, 70",
    sky: ["#f8fafb", "#eff4f5", "#f2eeec", "#e6ece8"], sun: "255, 240, 220", ridge: "60, 120, 90", meadow: "196, 212, 222",
    caps: ["#c62f36", "#2e7a4f", "#f4cf6a"], glow: ["198, 47, 54", "46, 122, 79"],
    drift: { kind: "snow", colors: ["#ffffff"], count: 26 },
  },
  newyear: {
    tree: "70, 90, 120", tree2: "110, 120, 160",
    sky: ["#f9f8fc", "#f1eff8", "#ece8f2", "#e6e3ec"], sun: "255, 236, 190", ridge: "90, 80, 150", meadow: "150, 160, 190",
    caps: ["#d4a83a", "#9a86c4", "#7fd3ff"], glow: ["244, 207, 106", "154, 134, 196"],
    drift: { kind: "confetti", colors: ["#f4cf6a", "#c9a2ff", "#7fd3ff", "#ff8fb1"], count: 18 },
  },
};

/** CSS variables for a look (set on <body>, read by .scene and the page background). */
export function siteLookVars(key: EntranceKey): Record<string, string> | null {
  const l = SITE_LOOKS[key];
  if (!l) return null;
  return {
    "--sc-sky1": l.sky[0], "--sc-sky2": l.sky[1], "--sc-sky3": l.sky[2], "--sc-sky4": l.sky[3],
    "--sc-sun": l.sun, "--sc-ridge": l.ridge, "--sc-meadow": l.meadow,
    "--sc-glow1": l.glow[0], "--sc-glow2": l.glow[1],
    ...(l.caps ? { "--sc-cap1": l.caps[0], "--sc-cap2": l.caps[1], "--sc-cap3": l.caps[2] } : {}),
    ...(l.tree ? { "--sc-tree": l.tree } : {}),
    ...(l.tree2 ? { "--sc-tree2": l.tree2 } : {}),
  };
}
