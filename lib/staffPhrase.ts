import path from "path";
import crypto from "crypto";
import { VersionedStore } from "./versionedStore";
import { currentEnv } from "./flags";
import { addDays, pacificDay, pacificMidnight } from "./periods";

/**
 * The daily staff password (switch `rotating_staff_password`): a two-word
 * phrase plus two digits, e.g. "maple-otter-42", that changes at midnight
 * Pacific. It's in that morning's nightly report email and always shown to
 * signed-in staff in Settings → Steward password, so nobody is locked out if
 * an email goes astray. Face ID and the emailed sign-in link keep working.
 *
 * Nothing is stored for the phrase itself: it's worked out from AUTH_SECRET
 * and the date, so every server instance agrees. Yesterday's phrase still
 * works until noon Pacific, for anyone who hasn't opened the new email yet.
 *
 * The old fixed password keeps working for 7 days after this first runs in
 * an environment (recorded below), then stops. Switching this off brings the
 * fixed password back.
 */

export const GRACE_DAYS = 7;
const GRACE_MS = GRACE_DAYS * 24 * 60 * 60 * 1000;
/** Yesterday's phrase is accepted until this hour (Pacific). */
const OVERLAP_HOUR = 12;

// Short, everyday, easy to spell and to say over the phone.
const WORDS = [
  "acorn", "alder", "amber", "anise", "apple", "aspen", "aster", "badger", "basil", "bay",
  "beach", "bean", "bear", "beaver", "bee", "berry", "birch", "bison", "bloom", "bluff",
  "bramble", "breeze", "brook", "bunny", "cabin", "canyon", "cedar", "chive", "cider", "clay",
  "clover", "cloud", "cocoa", "comet", "coral", "cove", "crane", "creek", "cricket", "daisy",
  "dawn", "deer", "delta", "dew", "dove", "dune", "eagle", "elk", "elm", "ember",
  "falcon", "fawn", "fern", "fig", "finch", "fir", "flint", "fox", "frost", "garden",
  "gecko", "ginger", "glade", "glen", "goose", "grove", "harbor", "hare", "hawk", "hazel",
  "heron", "hill", "holly", "honey", "iris", "ivy", "jade", "jay", "juniper", "kelp",
  "kestrel", "kite", "lake", "lark", "laurel", "leaf", "lemon", "lilac", "lily", "linen",
  "lotus", "lynx", "maple", "marsh", "meadow", "mesa", "mint", "moon", "moose", "moss",
  "nectar", "nutmeg", "oak", "oasis", "ocean", "olive", "orchid", "otter", "owl", "panda",
  "pansy", "peach", "pear", "pebble", "pecan", "pepper", "petal", "pine", "plum", "pond",
  "poppy", "prairie", "quail", "rabbit", "rain", "raven", "reed", "ridge", "river", "robin",
  "rose", "rowan", "sage", "salmon", "sand", "sequoia", "shell", "sky", "slate", "snow",
  "sparrow", "spruce", "star", "stone", "storm", "summit", "sun", "swan", "tea", "thistle",
  "thyme", "tide", "trail", "trout", "tulip", "tundra", "valley", "violet", "walnut", "wave",
  "willow", "wind", "wren", "yarrow", "zinnia", "lagoon", "basin", "orca", "puffin", "sorrel",
];

const secret = () => process.env.AUTH_SECRET || "dev-secret-please-change-in-production-12345";

/** The phrase for one Pacific day ("2026-10-29"). */
export function phraseFor(ymd: string): string {
  const h = crypto.createHmac("sha256", `staff-phrase:${secret()}`).update(ymd).digest();
  const a = h.readUInt32BE(0) % WORDS.length;
  let b = h.readUInt32BE(4) % WORDS.length;
  if (b === a) b = (b + 1) % WORDS.length;
  const n = h.readUInt32BE(8) % 100;
  return `${WORDS[a]}-${WORDS[b]}-${String(n).padStart(2, "0")}`;
}

/** Forgiving about case, spaces and dashes: "Maple Otter 42" works. */
export const normalizePhrase = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** The phrases that sign in right now: today's, plus yesterday's before noon Pacific. */
export function acceptablePhrases(now = Date.now()): string[] {
  const today = pacificDay(now);
  const out = [phraseFor(today)];
  if (now < pacificMidnight(today) + OVERLAP_HOUR * 60 * 60 * 1000) out.push(phraseFor(addDays(today, -1)));
  return out;
}

export function matchesPhrase(input: string, now = Date.now()): boolean {
  const got = Buffer.from(normalizePhrase(input));
  if (got.length < 6) return false;
  return acceptablePhrases(now).some((p) => {
    const want = Buffer.from(normalizePhrase(p));
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  });
}

// ------------------------------------------------------------------ retiring the old password

type Row = { id: string; startedAt: number };

const store = new VersionedStore<Row>({
  name: "staff-phrase",
  legacyKey: "staff-phrase.json",
  localFile: path.join(process.cwd(), "data", "staff-phrase.json"),
  keep: 4,
  reconcileLegacy: false,
});

/**
 * When the daily phrase first ran in this environment (stage and production
 * share storage, so each keeps its own start). Recorded on first use.
 * Null if it can't be read — the old password is then refused, the phrase isn't.
 */
export async function phraseStartedAt(): Promise<number | null> {
  const env = currentEnv();
  try {
    const hit = (await store.read()).data.find((r) => r.id === env);
    if (hit) return hit.startedAt;
    return await store.mutate<number>((rows) => {
      const again = rows.find((r) => r.id === env);
      if (again) return { data: null, result: again.startedAt };
      const startedAt = Date.now();
      return { data: [...rows, { id: env, startedAt }], result: startedAt };
    });
  } catch (err) {
    console.error("[staff-phrase] couldn't read or record the start date", err);
    return null;
  }
}

/** Whether the old fixed password still signs in, and until when. */
export async function oldPasswordStatus(now = Date.now()): Promise<{ works: boolean; until: number | null }> {
  const started = await phraseStartedAt();
  if (started === null) return { works: false, until: null };
  const until = started + GRACE_MS;
  return { works: now < until, until };
}
