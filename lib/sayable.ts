/**
 * Rewrites money, number ranges and big numbers as words before the
 * Concierge reads an answer aloud, so every speech model says them the same
 * way ("$4,164.77" → "four thousand one hundred sixty-four dollars and
 * seventy-seven cents", "October 22–28" → "October 22 to 28"). Only the
 * spoken copy changes; the text on screen stays as written.
 */

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function under1000(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  const rest = r < 20 ? ONES[r] : TENS[Math.floor(r / 10)] + (r % 10 ? `-${ONES[r % 10]}` : "");
  return h ? `${ONES[h]} hundred${r ? ` ${rest}` : ""}` : rest;
}

/** 0 … 999,999,999,999 in words; bigger numbers are left as digits. */
export function numberWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 1e12) return String(n);
  if (n === 0) return "zero";
  const out: string[] = [];
  for (const [size, name] of [[1e9, "billion"], [1e6, "million"], [1e3, "thousand"]] as const) {
    if (n >= size) { out.push(`${under1000(Math.floor(n / size))} ${name}`); n %= size; }
  }
  if (n) out.push(under1000(n));
  return out.join(" ");
}

const int = (s: string) => Number(s.replace(/,/g, ""));

const MONTHS: Record<string, string> = {
  jan: "January", feb: "February", mar: "March", apr: "April", may: "May", jun: "June", jul: "July",
  aug: "August", sep: "September", sept: "September", oct: "October", nov: "November", dec: "December",
};
const MONTH_NAMES = "January|February|March|April|May|June|July|August|September|October|November|December";
const ABBR = "Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec";
const DAY = "(\\d{1,2}(?:st|nd|rd|th)?)\\b(?![:.,]?\\d)";

export function sayable(text: string): string {
  return text
    // Month abbreviations → full names. Before a day/year ("Oct 22", "Oct. 2026") always;
    // on their own ("in Oct") too, except Jan/Mar, which are also a name and a word.
    .replace(new RegExp(`\\b(${ABBR})\\.?(?=\\s+\\d)`, "g"), (m, a: string) => MONTHS[a.toLowerCase()])
    .replace(new RegExp(`\\b(Feb|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\\b(\\.(?=\\s+[a-z]))?`, "g"), (m, a: string) => MONTHS[a.toLowerCase()])
    // "October 22–28" / "October 22 - 28" → "October 22 to 28" (digits: voices say those best)
    .replace(new RegExp(`\\b(${MONTH_NAMES}) ${DAY}\\s*[–—-]\\s*${DAY}`, "g"), "$1 $2 to $3")
    // "October 28 – November 3" (a range across months)
    .replace(new RegExp(`(\\S)\\s*[–—]\\s*(?=(?:${MONTH_NAMES}) )|(\\S) - (?=(?:${MONTH_NAMES}) )`, "g"), (m, a?: string, b?: string) => `${a || b} to `)
    // $4,164.77 · $20 · $1.50 · $0.99 (also "$4.2k"-style left alone)
    .replace(/\$(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d.,]*\d|k\b|K\b)/g, (_m, d: string, c?: string) => {
      const dollars = int(d);
      const cents = c ? Number(c.padEnd(2, "0")) : 0;
      const dPart = `${numberWords(dollars)} dollar${dollars === 1 ? "" : "s"}`;
      if (!cents) return dPart;
      const cPart = `${numberWords(cents)} cent${cents === 1 ? "" : "s"}`;
      return dollars ? `${dPart} and ${cPart}` : cPart;
    })
    // 22–28, 9—5, 10 – 12, 22-28 → "22 to 28". A hyphen only between two short
    // numbers on their own, so phone numbers and 2026-10-22 dates are left alone.
    .replace(/(\d)\s*[–—]\s*(?=\d)/g, "$1 to ")
    .replace(/(?<![\d\-/.:])(\d{1,4})\s?-\s?(\d{1,4})(?![\d\-/.:])/g, "$1 to $2")
    // 4,164 · 12,500 (thousands commas) → words
    .replace(/\b\d{1,3}(?:,\d{3})+\b(?!\.\d)/g, (m) => numberWords(int(m)));
}
