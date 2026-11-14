import { addDays, pacificDay } from "./periods";

/**
 * Themed versions of the members' entrance (app/components/ForestEntrance.tsx):
 * the same forest-parting scene with seasonal colours and little extras
 * (falling leaves, snow, a snowman, blooming flowers, bats, fireworks…).
 * "classic" is the original. With the switch `seasonal_entrance` on, staff
 * choose one in Settings → Entrance animation, or "auto": holidays first,
 * then the season, by the date in brand.timezone. Client-safe (the panel previews them).
 */

export const ENTRANCE_KEYS = ["classic", "spring", "summer", "fall", "winter", "valentines", "stpatricks", "earthday", "mothersday", "july4", "halloween", "thanksgiving", "holiday", "newyear"] as const;
export type EntranceKey = (typeof ENTRANCE_KEYS)[number];
export type EntranceChoice = EntranceKey | "auto";

export type Falling = { kind: "leaf" | "snow" | "petal" | "heart" | "confetti" | "shamrock" | "star"; colors: string[]; count: number; /** Leaves only: a mix of maple, oak and plain leaves (site background). */ mixed?: boolean };
export type Ground = "shrooms" | "pumpkins" | "jacks" | "flowers" | "sunflowers" | "gifts" | "candies";

export type EntranceTheme = {
  key: EntranceKey;
  label: string;
  emoji: string;
  /** Small line under the members' area name (none on classic). */
  greeting?: string;
  /** When "auto" uses it. */
  when: string;
  /** CSS variables for the scene (see .en-entrance in globals.css). */
  vars: Record<string, string>;
  /** Colours of the leaves that burst as the trees part. */
  burst: string[];
  /** Things drifting down (or up, for hearts) through the scene. */
  falling?: Falling;
  ground: Ground;
  extras?: {
    moon?: boolean;
    stars?: boolean;
    snowcaps?: boolean;
    snowman?: boolean;
    lights?: boolean;
    bats?: boolean;
    butterflies?: boolean;
    fireworks?: boolean;
    /** Firework colours (default: gold, pink, blue, lilac). */
    fireworkColors?: string[];
    rainbow?: boolean;
    /** Northern lights across the sky. */
    aurora?: boolean;
    /** A little yeti who pops up and waves (winter Easter egg). */
    yeti?: boolean;
    /** A pot of gold with a dancing leprechaun (St. Patrick's). */
    leprechaun?: boolean;
    /** A big gobbling turkey (Thanksgiving). */
    turkey?: boolean;
    /** A pilgrim couple waving (Thanksgiving). */
    pilgrims?: boolean;
    /** Cupid flying across with his bow (Valentine's). */
    cupid?: boolean;
    /** Santa's sleigh and reindeer flying past the peaks (Holidays). */
    santa?: boolean;
    /** The sun becomes a little Earth. */
    earth?: boolean;
    wheat?: boolean;
    blooms?: boolean;
  };
};

const CLASSIC_BURST = ["#3f6c5e", "#5d8a4d", "#85ba45", "#2f5f4d", "#e0a074"];

const WINTER_VARS = {
  "--en-meadow": "#eef3f6", "--en-meadow2": "#dce7ee", "--en-meadow3": "#c6d6e0", "--en-path": "#ffffff",
  "--en-t1": "#4f7a73", "--en-t1s": "#3f675f", "--en-t2": "#2f5a50", "--en-t2s": "#264a42", "--en-t3": "#1f4339", "--en-t3s": "#18362e",
  "--en-far1": "#c9d6e2", "--en-far2": "#dfe7ee", "--en-mist": "236, 243, 248",
  "--en-title": "#24414f", "--en-title-shadow": "rgba(255, 255, 255, 0.7)",
};

export const ENTRANCE_THEMES: Record<EntranceKey, EntranceTheme> = {
  classic: { key: "classic", label: "Classic", emoji: "⛰️", when: "The original, any time", vars: {}, burst: CLASSIC_BURST, ground: "shrooms" },
  spring: {
    key: "spring", label: "Spring", emoji: "🌸", greeting: "Spring is in bloom", when: "March to May",
    vars: {
      "--en-sky-top": "#6fb2d6", "--en-sky-mid": "#cfe6ec", "--en-sky-low": "#f7d6e0", "--en-sky-hor": "#fcefd8", "--en-sun": "#fff6dd",
      "--en-meadow": "#8cc068", "--en-meadow2": "#72ad56", "--en-meadow3": "#5a9446", "--en-path": "#f3e1b5",
      "--en-t1": "#62a074", "--en-t1s": "#4f8b61", "--en-t2": "#43805b", "--en-t2s": "#386f4e", "--en-t3": "#2c6044", "--en-t3s": "#235138",
      "--en-cap": "#e57fa0", "--en-far1": "#c3b5d6", "--en-far2": "#e6bccb", "--en-kicker": "#d9688f",
    },
    burst: ["#f6b6c8", "#ffffff", "#f9d3df", "#ffe28a", "#9fd27a"],
    falling: { kind: "petal", colors: ["#f8c3d3", "#ffffff", "#f4a7bf"], count: 22 },
    ground: "flowers", extras: { blooms: true, butterflies: true },
  },
  summer: {
    key: "summer", label: "Summer", emoji: "☀️", greeting: "Hello, summer", when: "June to August",
    vars: {
      "--en-sky-top": "#2f8fc0", "--en-sky-mid": "#9ed3e6", "--en-sky-low": "#ffe2a0", "--en-sky-hor": "#fff1c4", "--en-sun": "#fff3b0",
      "--en-meadow": "#86b84e", "--en-meadow2": "#6aa23f", "--en-meadow3": "#4f8a35", "--en-path": "#f1d68f",
      "--en-cap": "#e8553a", "--en-far1": "#9fb7cf", "--en-far2": "#bccba6", "--en-kicker": "#f08a3c",
    },
    burst: ["#5d8a4d", "#85ba45", "#ffd34d", "#3f6c5e", "#ffb347"],
    ground: "sunflowers", extras: { butterflies: true },
  },
  fall: {
    key: "fall", label: "Fall", emoji: "🍂", greeting: "Cozy season is here", when: "September to November",
    vars: {
      "--en-sky-top": "#3d6f8a", "--en-sky-mid": "#d9b98f", "--en-sky-low": "#f0a868", "--en-sky-hor": "#f8d79a", "--en-sun": "#ffe3b0",
      "--en-meadow": "#a99a4e", "--en-meadow2": "#8f8a45", "--en-meadow3": "#6e6b37", "--en-path": "#e9c78e",
      "--en-t1": "#d07a3e", "--en-t1s": "#b05f31", "--en-t2": "#b9542f", "--en-t2s": "#924127", "--en-t3": "#3f5a3c", "--en-t3s": "#30472f",
      "--en-cap": "#c2452f", "--en-far1": "#b88f8f", "--en-far2": "#d0a47f",
    },
    burst: ["#e07a2e", "#c2452f", "#f2b33d", "#a8552a", "#d9a25a"],
    falling: { kind: "leaf", colors: ["#e07a2e", "#c2452f", "#f2b33d", "#a8552a"], count: 24 },
    ground: "shrooms",
  },
  winter: {
    key: "winter", label: "Winter", emoji: "❄️", greeting: "Warm wishes this winter", when: "December to February",
    vars: {
      "--en-sky-top": "#14284a", "--en-sky-mid": "#2f5f8f", "--en-sky-low": "#9cc6e8", "--en-sky-hor": "#eaf4fc", "--en-sun": "#fff8ec",
      ...WINTER_VARS, "--en-meadow": "#f2f8fd", "--en-meadow2": "#dfeefa", "--en-meadow3": "#c8e0f4", "--en-far1": "#9ab8d8", "--en-far2": "#c4d9ee", "--en-mist": "226, 240, 252",
      "--en-cap": "#e05a6a", "--en-kicker": "#3f86c6",
    },
    burst: ["#ffffff", "#dce9f2", "#b8d0e0", "#ffffff", "#9fbfd4"],
    falling: { kind: "snow", colors: ["#ffffff"], count: 40 },
    ground: "shrooms", extras: { snowcaps: true, snowman: true, aurora: true, yeti: true, stars: true },
  },
  valentines: {
    key: "valentines", label: "Valentine's", emoji: "💗", greeting: "Happy Valentine's Day", when: "February 7 to 14",
    vars: {
      "--en-sky-top": "#c86b8d", "--en-sky-mid": "#f2b6c4", "--en-sky-low": "#fbd5d0", "--en-sky-hor": "#fde8e0", "--en-sun": "#fff0f0",
      "--en-meadow": "#8fbf6e", "--en-meadow2": "#74ab58", "--en-meadow3": "#5b9145", "--en-path": "#fbe0e0",
      "--en-cap": "#e0457b", "--en-far1": "#d3a3bd", "--en-far2": "#eab3bf", "--en-kicker": "#e0457b",
    },
    burst: ["#e0457b", "#f6a1bd", "#ffffff", "#c92a5f", "#ffd1dc"],
    falling: { kind: "heart", colors: ["#e0457b", "#f48fb1", "#ff5c8a"], count: 18 },
    ground: "candies", extras: { blooms: true, cupid: true },
  },
  stpatricks: {
    key: "stpatricks", label: "St. Patrick's", emoji: "☘️", greeting: "Happy St. Patrick's Day", when: "March 14 to 17",
    vars: {
      "--en-sky-top": "#4f9fc4", "--en-sky-mid": "#bfe3e6", "--en-sky-low": "#e9f3c8", "--en-sky-hor": "#f6f6dc", "--en-sun": "#fff6c8",
      "--en-meadow": "#5fae4e", "--en-meadow2": "#46983f", "--en-meadow3": "#357f33", "--en-path": "#f0dd8a",
      "--en-t1": "#3f9a5a", "--en-t1s": "#32854b", "--en-t2": "#2b7a45", "--en-t2s": "#226a3b", "--en-t3": "#1c5b33", "--en-t3s": "#154b29",
      "--en-cap": "#2e9a4f", "--en-far1": "#9cc3b0", "--en-far2": "#c4d8a8", "--en-kicker": "#2e8a45",
    },
    burst: ["#2e9a4f", "#5fc46a", "#f4cf6a", "#1f7a3e", "#a7e08a"],
    falling: { kind: "shamrock", colors: ["#2e9a4f", "#4fbf5f", "#1f7a3e"], count: 20 },
    ground: "shrooms", extras: { rainbow: true, leprechaun: true },
  },
  earthday: {
    key: "earthday", label: "Earth Day", emoji: "🌍", greeting: "Happy Earth Day", when: "April 20 to 22",
    vars: {
      "--en-sky-top": "#3e9bd0", "--en-sky-mid": "#bfe4f0", "--en-sky-low": "#e4f2d0", "--en-sky-hor": "#f4f8e2", "--en-sun": "#3f8fd0",
      "--en-meadow": "#79b957", "--en-meadow2": "#5fa445", "--en-meadow3": "#4a8c36", "--en-path": "#e8dca8",
      "--en-t1": "#4f9a62", "--en-t1s": "#418653", "--en-t2": "#357a4b", "--en-t2s": "#2b6a40", "--en-t3": "#225b36", "--en-t3s": "#1a4c2c",
      "--en-cap": "#d4583f", "--en-far1": "#a9c6c9", "--en-far2": "#c7d8b0", "--en-kicker": "#3f8fd0",
    },
    burst: ["#5fa445", "#85ba45", "#3f8fd0", "#a7e08a", "#2f7a4d"],
    falling: { kind: "leaf", colors: ["#5fa445", "#85ba45", "#3f9a5a", "#a7d86a"], count: 18 },
    ground: "flowers", extras: { earth: true, blooms: true, butterflies: true },
  },
  mothersday: {
    key: "mothersday", label: "Mother's Day", emoji: "💐", greeting: "Happy Mother's Day", when: "The week of Mother's Day",
    vars: {
      "--en-sky-top": "#9a86c4", "--en-sky-mid": "#e2cbe6", "--en-sky-low": "#f9d9df", "--en-sky-hor": "#fdeee4", "--en-sun": "#fff2ec",
      "--en-meadow": "#8cc068", "--en-meadow2": "#72ad56", "--en-meadow3": "#5a9446", "--en-path": "#f6e2d6",
      "--en-t1": "#62a074", "--en-t1s": "#4f8b61", "--en-t2": "#43805b", "--en-t2s": "#386f4e", "--en-t3": "#2c6044", "--en-t3s": "#235138",
      "--en-cap": "#a7639c", "--en-far1": "#c3b0d8", "--en-far2": "#e5bfd0", "--en-kicker": "#a7639c",
    },
    burst: ["#f6a1bd", "#c9a2ff", "#ffffff", "#ffd1dc", "#a7639c"],
    falling: { kind: "petal", colors: ["#f8c3d3", "#d9b8f0", "#ffffff", "#f4a7bf"], count: 24 },
    ground: "flowers", extras: { blooms: true, butterflies: true },
  },
  july4: {
    key: "july4", label: "4th of July", emoji: "🎆", greeting: "Happy 4th of July", when: "July 1 to 4",
    vars: {
      "--en-sky-top": "#14214a", "--en-sky-mid": "#2c3f7a", "--en-sky-low": "#7a5a8a", "--en-sky-hor": "#e09a6e", "--en-sun": "#fff4dc",
      "--en-meadow": "#4f7a42", "--en-meadow2": "#40693a", "--en-meadow3": "#33582f", "--en-path": "#cdb67e",
      "--en-t1": "#3f6c5e", "--en-t1s": "#335a4e", "--en-t2": "#2a5043", "--en-t2s": "#214237", "--en-t3": "#18352b", "--en-t3s": "#122a22",
      "--en-cap": "#d23a3a", "--en-far1": "#3d4a7a", "--en-far2": "#5a557c", "--en-mist": "122, 90, 138", "--en-kicker": "#ff6b6b",
    },
    burst: ["#d23a3a", "#ffffff", "#3a6fd2", "#f4cf6a", "#ff8a8a"],
    falling: { kind: "star", colors: ["#ffffff", "#ff5a5a", "#5a8cff", "#f4cf6a"], count: 22 },
    ground: "shrooms", extras: { moon: true, stars: true, fireworks: true, fireworkColors: ["#ff4d4d", "#ffffff", "#4d7cff", "#ff4d4d", "#9fc0ff"] },
  },
  halloween: {
    key: "halloween", label: "Halloween", emoji: "🎃", greeting: "Happy Halloween", when: "October 15 to 31",
    vars: {
      "--en-sky-top": "#1d1430", "--en-sky-mid": "#3d2a5c", "--en-sky-low": "#7a4a6e", "--en-sky-hor": "#d9825a", "--en-sun": "#fff2c8",
      "--en-meadow": "#3f4f3a", "--en-meadow2": "#34432f", "--en-meadow3": "#283624", "--en-path": "#b9965f",
      "--en-t1": "#3a3f4f", "--en-t1s": "#2e3240", "--en-t2": "#2a2d3b", "--en-t2s": "#20232e", "--en-t3": "#191b24", "--en-t3s": "#121319", "--en-trunk": "#2a1d18",
      "--en-cap": "#e07a2e", "--en-far1": "#4b3b63", "--en-far2": "#5e4466", "--en-mist": "122, 74, 110", "--en-kicker": "#f08a3c",
    },
    burst: ["#e07a2e", "#6b4a8a", "#2a2d3b", "#f2b33d", "#3a3f4f"],
    falling: { kind: "leaf", colors: ["#e07a2e", "#a8552a", "#6b4a8a"], count: 14 },
    ground: "jacks", extras: { moon: true, stars: true, bats: true },
  },
  thanksgiving: {
    key: "thanksgiving", label: "Thanksgiving", emoji: "🌾", greeting: "Happy Thanksgiving", when: "Thanksgiving week",
    vars: {
      "--en-sky-top": "#4a6f86", "--en-sky-mid": "#e0bf8f", "--en-sky-low": "#f2a861", "--en-sky-hor": "#f9dba0", "--en-sun": "#ffe6b8",
      "--en-meadow": "#b2a050", "--en-meadow2": "#988b46", "--en-meadow3": "#776c38", "--en-path": "#ecd09a",
      "--en-t1": "#c9733d", "--en-t1s": "#a85a30", "--en-t2": "#a24a2b", "--en-t2s": "#823c24", "--en-t3": "#3f5a3c", "--en-t3s": "#30472f",
      "--en-cap": "#b8702e", "--en-far1": "#b9958c", "--en-far2": "#d2a77e",
    },
    burst: ["#d98a3a", "#b8702e", "#f2c14e", "#8f3f26", "#e7b06a"],
    falling: { kind: "leaf", colors: ["#d98a3a", "#b8702e", "#f2c14e", "#8f3f26"], count: 18 },
    ground: "pumpkins", extras: { wheat: true, turkey: true, pilgrims: true },
  },
  holiday: {
    key: "holiday", label: "Holidays", emoji: "🎁", greeting: "Happy Holidays", when: "December 1 to 25",
    vars: {
      "--en-sky-top": "#34506e", "--en-sky-mid": "#8fa9c4", "--en-sky-low": "#e9c9b8", "--en-sky-hor": "#f6e3d3", "--en-sun": "#fff4e0",
      ...WINTER_VARS, "--en-cap": "#c62f36", "--en-kicker": "#c62f36",
    },
    burst: ["#ffffff", "#c62f36", "#2e7a4f", "#f4cf6a", "#dce9f2"],
    falling: { kind: "snow", colors: ["#ffffff"], count: 36 },
    ground: "gifts", extras: { snowcaps: true, snowman: true, lights: true, santa: true },
  },
  newyear: {
    key: "newyear", label: "New Year", emoji: "✨", greeting: "Happy New Year", when: "December 26 to January 2",
    vars: {
      "--en-sky-top": "#0f1730", "--en-sky-mid": "#26305a", "--en-sky-low": "#5a4a7a", "--en-sky-hor": "#c58b6e", "--en-sun": "#fff6dc",
      "--en-meadow": "#6f7fa3", "--en-meadow2": "#5c6b90", "--en-meadow3": "#4a587b", "--en-path": "#a9b6d2",
      "--en-t1": "#2f4a52", "--en-t1s": "#253c43", "--en-t2": "#203439", "--en-t2s": "#19292e", "--en-t3": "#132126", "--en-t3s": "#0e191d",
      "--en-far1": "#3a3f6a", "--en-far2": "#4d4a74", "--en-mist": "90, 74, 122", "--en-kicker": "#f4cf6a", "--en-cap": "#d4a83a",
    },
    burst: ["#f4cf6a", "#ffffff", "#c9a2ff", "#7fd3ff", "#ff8fb1"],
    falling: { kind: "confetti", colors: ["#f4cf6a", "#ffffff", "#c9a2ff", "#7fd3ff", "#ff8fb1"], count: 34 },
    ground: "shrooms", extras: { moon: true, stars: true, fireworks: true, snowcaps: true },
  },
};

export const isEntranceKey = (v: unknown): v is EntranceKey => typeof v === "string" && (ENTRANCE_KEYS as readonly string[]).includes(v);
export const cleanEntranceChoice = (v: unknown): EntranceChoice => (v === "auto" || isEntranceKey(v) ? v : "auto");

/** The 4th Thursday of November, as YYYY-MM-DD. */
function thanksgiving(year: number): string {
  const first = new Date(Date.UTC(year, 10, 1)).getUTCDay(); // 0 = Sunday
  const day = 1 + ((4 - first + 7) % 7) + 21;
  return `${year}-11-${String(day).padStart(2, "0")}`;
}

/** Mother's Day: the 2nd Sunday of May, as YYYY-MM-DD. */
function mothersDay(year: number): string {
  const first = new Date(Date.UTC(year, 4, 1)).getUTCDay();
  const day = 1 + ((7 - first) % 7) + 7;
  return `${year}-05-${String(day).padStart(2, "0")}`;
}

/** What "auto" shows on a date in brand.timezone (YYYY-MM-DD): holidays first, then the season. */
export function autoEntranceOn(ymd: string): EntranceKey {
  const [y, m, d] = ymd.split("-").map(Number);
  const md = m * 100 + d;
  if (md >= 207 && md <= 214) return "valentines";
  if (md >= 314 && md <= 317) return "stpatricks";
  if (md >= 420 && md <= 422) return "earthday";
  const mom = mothersDay(y);
  if (ymd >= addDays(mom, -6) && ymd <= mom) return "mothersday";
  if (md >= 701 && md <= 704) return "july4";
  if (md >= 1015 && md <= 1031) return "halloween";
  const tg = thanksgiving(y);
  if (ymd >= addDays(tg, -6) && ymd <= addDays(tg, 3)) return "thanksgiving";
  if (md >= 1201 && md <= 1225) return "holiday";
  if (md >= 1226 || md <= 102) return "newyear";
  if (m >= 3 && m <= 5) return "spring";
  if (m >= 6 && m <= 8) return "summer";
  if (m >= 9 && m <= 11) return "fall";
  return "winter";
}

export const autoEntrance = (now = Date.now()) => autoEntranceOn(pacificDay(now));

/** The theme the entrance plays: switch off = classic. */
export function resolveEntrance(choice: EntranceChoice, switchOn: boolean, now = Date.now()): EntranceKey {
  if (!switchOn) return "classic";
  return choice === "auto" ? autoEntrance(now) : choice;
}

/** The next changes "auto" will make (for the Settings panel and the Concierge). */
export function autoSchedule(now = Date.now(), changes = 6): Array<{ from: string; key: EntranceKey }> {
  const out: Array<{ from: string; key: EntranceKey }> = [];
  let day = pacificDay(now);
  let cur = autoEntranceOn(day);
  for (let i = 1; i <= 400 && out.length < changes; i++) {
    day = addDays(day, 1);
    const k = autoEntranceOn(day);
    if (k !== cur) {
      out.push({ from: day, key: k });
      cur = k;
    }
  }
  return out;
}
