/**
 * Email campaign themes: a seasonal banner + divider (public/email-art/,
 * drawn by scripts/email-art.cjs) and a colour palette for headings, buttons
 * and the footer. "auto" picks one from the subject/text, then the date.
 * Client-safe (the composer's picker uses it too).
 */

import { brand } from "./brand";

export const THEME_KEYS = [
  "classic", "fall", "halloween", "thanksgiving", "blackfriday", "holiday", "winter",
  "newyear", "valentines", "spring", "mothersday", "summer",
] as const;
export type ThemeKey = (typeof THEME_KEYS)[number];
/** What a campaign stores: a theme, "auto", or "none" (plain, no artwork). */
export type ThemeChoice = ThemeKey | "auto" | "none";

export type Theme = {
  key: ThemeKey;
  label: string;
  emoji: string;
  /** Buttons, headings, links. */
  accent: string;
  /** Text on the accent colour. */
  onAccent: string;
  /** Page background behind the card, and the footer band. */
  soft: string;
  /** Small caps line under the banner. */
  kicker: string;
};

export const THEMES: Record<ThemeKey, Theme> = {
  classic: { key: "classic", label: "Classic", emoji: "⛰️", accent: "#6fa336", onAccent: "#ffffff", soft: "#f3f6ec", kicker: "#85ba45" },
  fall: { key: "fall", label: "Fall", emoji: "🍂", accent: "#c4602b", onAccent: "#ffffff", soft: "#fbf1e4", kicker: "#c4602b" },
  halloween: { key: "halloween", label: "Halloween", emoji: "🎃", accent: "#e07a2e", onAccent: "#ffffff", soft: "#f3eef7", kicker: "#6b4a8a" },
  thanksgiving: { key: "thanksgiving", label: "Thanksgiving", emoji: "🌾", accent: "#b8702e", onAccent: "#ffffff", soft: "#fbf2e2", kicker: "#b8702e" },
  blackfriday: { key: "blackfriday", label: "Black Friday", emoji: "🏷️", accent: "#1f1f28", onAccent: "#f4cf6a", soft: "#f1f1f3", kicker: "#1f1f28" },
  holiday: { key: "holiday", label: "Holiday", emoji: "🎁", accent: "#c62f36", onAccent: "#ffffff", soft: "#eef5f1", kicker: "#2e7a4f" },
  winter: { key: "winter", label: "Winter", emoji: "❄️", accent: "#4f7f9f", onAccent: "#ffffff", soft: "#eef5fa", kicker: "#4f7f9f" },
  newyear: { key: "newyear", label: "New Year", emoji: "✨", accent: "#3a2f5e", onAccent: "#f4cf6a", soft: "#f3f1f8", kicker: "#b8902e" },
  valentines: { key: "valentines", label: "Valentine's", emoji: "💗", accent: "#d63b62", onAccent: "#ffffff", soft: "#fdf0f3", kicker: "#d63b62" },
  spring: { key: "spring", label: "Spring", emoji: "🌸", accent: "#5f9e45", onAccent: "#ffffff", soft: "#f2f8ee", kicker: "#d2789e" },
  mothersday: { key: "mothersday", label: "Mother's Day", emoji: "💐", accent: "#a7639c", onAccent: "#ffffff", soft: "#f8f0f7", kicker: "#a7639c" },
  summer: { key: "summer", label: "Summer", emoji: "☀️", accent: "#2f8db8", onAccent: "#ffffff", soft: "#eef8fb", kicker: "#e0a417" },
};

// Words that point to a holiday or season (checked in this order).
const WORDS: Array<[ThemeKey, RegExp]> = [
  ["halloween", /\b(halloween|spooky|trick[- ]or[- ]treat|pumpkin spice|all hallows)\b/i],
  ["blackfriday", /\b(black friday|cyber monday|doorbuster)\b/i],
  ["thanksgiving", /\b(thanksgiving|thankful|gratitude|harvest feast)\b/i],
  ["newyear", /\b(new year|nye|resolution)s?\b/i],
  ["valentines", /\b(valentine'?s?|galentine'?s?)\b/i],
  ["mothersday", /\b(mother'?s day|for mom)\b/i],
  ["holiday", /\b(christmas|holiday|holidays|hanukkah|stocking stuffer|festive|gift guide|gifting)\b/i],
  ["fall", /\b(fall|autumn|harvest|cozy season|sweater weather)\b/i],
  ["winter", /\b(winter|snow|snowy|cold season)\b/i],
  ["spring", /\b(spring|bloom|blossom)\b/i],
  ["summer", /\b(summer|sunshine|beach)\b/i],
];

/** Local (brand time zone) month (1–12) and day for a date. */
function pacificMonthDay(t: number): [number, number] {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: brand.timezone, month: "numeric", day: "numeric" }).formatToParts(new Date(t));
  return [Number(parts.find((p) => p.type === "month")?.value), Number(parts.find((p) => p.type === "day")?.value)];
}

/** The theme "auto" resolves to: words in the subject/text first, then the season of `when`. */
export function autoTheme(subject: string, body: string, when = Date.now()): ThemeKey {
  const text = `${subject}\n${body}`.replace(/\(https?:[^)]*\)/g, "");
  for (const [k, re] of WORDS) if (re.test(text)) return k;
  const [m, d] = pacificMonthDay(when);
  if (m === 10 && d >= 15) return "halloween";
  if (m === 11 && d >= 20) return "thanksgiving";
  if (m === 12) return "holiday";
  if (m === 1 || m === 2) return "winter";
  if (m >= 3 && m <= 5) return "spring";
  if (m >= 6 && m <= 8) return "summer";
  return "fall";
}

/** The theme to draw for a campaign (null = plain, no artwork). */
export function resolveTheme(choice: string | undefined, subject: string, body: string, when = Date.now()): Theme | null {
  if (choice === "none") return null;
  if (choice && (THEME_KEYS as readonly string[]).includes(choice)) return THEMES[choice as ThemeKey];
  return THEMES[autoTheme(subject, body, when)];
}

export const cleanThemeChoice = (v: unknown): ThemeChoice =>
  v === "none" || v === "auto" || (typeof v === "string" && (THEME_KEYS as readonly string[]).includes(v)) ? (v as ThemeChoice) : "auto";

/** Template library category → theme. */
export const themeForCategory = (category?: string): ThemeChoice =>
  category && (THEME_KEYS as readonly string[]).includes(category) ? (category as ThemeKey) : "auto";
