/**
 * Ambassador page looks (2026-11-06): each ambassador's page and welcome
 * animation get a personal style. Staff pick one in the Ambassadors tab, or
 * leave it on Auto, which reads the emoji in their headline (Toni's 👽 →
 * Cosmic). Colours live in CSS (`.amb-look-<key>` in globals.css); this file
 * only names the looks and picks one.
 */

export const AMBASSADOR_LOOKS = {
  cosmic: { label: "Cosmic", hint: "Night sky, stars and a soft blue glow", glyphs: ["✦", "✧", "⋆", "✦", "·"] },
  botanical: { label: "Botanical", hint: "Forest greens and drifting leaves", glyphs: ["❦", "✿", "❀", "✦", "·"] },
  blossom: { label: "Blossom", hint: "Rose and peach with falling petals", glyphs: ["❀", "✿", "❁", "✦", "·"] },
  golden: { label: "Golden hour", hint: "Warm amber light and sparkles", glyphs: ["✦", "✧", "☼", "✦", "·"] },
} as const;

export type LookKey = keyof typeof AMBASSADOR_LOOKS;
export type LookChoice = LookKey | "auto";

export const isLookKey = (v: unknown): v is LookKey => typeof v === "string" && v in AMBASSADOR_LOOKS;
export const cleanLook = (v: unknown): LookChoice => (isLookKey(v) ? v : "auto");

// Emoji and other pictographs (not plain letters, digits, # or *).
const EMOJI = /(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)/u;

/** The first emoji in some text, e.g. "Toni's Favorites 👽" → "👽". */
export function firstEmoji(text: string | undefined | null): string | null {
  const m = EMOJI.exec(String(text || ""));
  return m ? m[0] : null;
}

const AUTO: Array<[LookKey, RegExp]> = [
  ["cosmic", /[👽🛸🌙🌛🌜🌝🌚⭐🌟💫✨🪐🔮🌌🌠☄🌑🌒🌓🌔🌕🌖🌗🌘🦄👾🤖💜]/u],
  ["blossom", /[🌸🌷💐🌺🌹🌼🦋💖💕💗💓💞💝🩷❤🎀🍑🍓]/u],
  ["golden", /[☀🌞🌻🔥🍯🌅🌄💛🧡🍊🍋🐝👑💰🥂✌]/u],
  ["botanical", /[🌿🍄🌱🌲🌳🍃🍀☘🌾🪴🌵🍂🍁🐸💚🧘]/u],
];

/** One emoji from staff input ("" when there isn't one). */
export const cleanEmoji = (v: unknown): string => firstEmoji(typeof v === "string" ? v.slice(0, 40) : "") || "";

type EmojiSource = { emoji?: string; showEmoji?: boolean; headline?: string; name?: string };
/** The emoji on their photo and in the welcome: the one staff picked, else the headline's; none when switched off. */
export function emojiFor(a: EmojiSource): string | null {
  if (a.showEmoji === false) return null;
  return cleanEmoji(a.emoji) || firstEmoji(a.headline) || firstEmoji(a.name);
}

/** The look an ambassador's page uses: their choice, or Auto from their emoji (Botanical when there's none). */
export function lookFor(a: EmojiSource & { look?: string; bio?: string }): LookKey {
  if (isLookKey(a.look)) return a.look;
  // Their emoji decides first (a picked one beats one in the headline), then the rest of their words.
  const emoji = emojiFor(a);
  if (emoji) for (const [key, re] of AUTO) if (re.test(emoji)) return key;
  const text = `${a.headline || ""} ${a.name || ""} ${a.bio || ""}`;
  for (const [key, re] of AUTO) if (re.test(text)) return key;
  return "botanical";
}

/** sessionStorage key: this ambassador's welcome already played in this visit. */
export const welcomeKey = (slug: string) => `fp_amb_welcome_${slug}`;

/**
 * Runs before the first paint (inline in the page): decides whether the welcome
 * plays, so a repeat visit never flashes it. Sets <html data-amb-welcome="play|skip">.
 */
export function welcomeScript(slug: string, force: boolean): string {
  const k = JSON.stringify(welcomeKey(slug)).replace(/</g, "\\u003c");
  return `(function(){var h=document.documentElement;try{if(!${force ? "true" : "false"}&&(sessionStorage.getItem(${k})||matchMedia("(prefers-reduced-motion: reduce)").matches)){h.setAttribute("data-amb-welcome","skip")}else{h.setAttribute("data-amb-welcome","play")}}catch(e){h.setAttribute("data-amb-welcome","skip")}})();`;
}
