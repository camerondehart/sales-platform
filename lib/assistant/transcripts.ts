import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type { Audience } from "./shared";
import { OFF_LIMITS } from "./shared";
import { recordCounter } from "../traffic";

/**
 * Concierge chat transcripts — kept 30 days, then deleted.
 *
 * One small file per conversation (`transcripts/<key>.json`), rewritten as the
 * chat goes on. The key is derived from the widget's conversation id AND the
 * visitor (member id, or IP for guests), so nobody can overwrite someone
 * else's transcript by guessing an id.
 *
 * Each customer message is tagged with topics and checked for anything
 * concerning using plain keyword rules (no extra AI cost). Flags are for
 * staff only: nothing about them is ever shown or hinted to the customer,
 * and they don't change how the Concierge answers. Topic totals are
 * added to the site's daily counters so the Analytics tab can show what
 * people ask about. Serious flags email the team once per conversation.
 */

export type Flag = { kind: FlagKind; severity: "high" | "medium" | "low"; excerpt: string; at: number };
export type FlagKind =
  | "health_emergency"
  | "self_harm"
  | "adverse_reaction"
  | "legal_or_chargeback"
  | "harassment"
  | "possible_minor"
  | "manipulation_attempt"
  | "off_limits_topic"
  | "other_customer_data"
  | "angry_customer"
  | "threat"
  | "slur"
  | "hostile_to_business"
  | "authorities"
  | "risky_use"
  | "personal_distress"
  | "probing"
  | "negative_sentiment"
  | "profanity"
  | "odd_behavior";

export type Transcript = {
  id: string;
  audience: Audience;
  who: string; // "Visitor", member name/email, or "Staff"
  startedAt: number;
  lastAt: number;
  /** `model` = which AI model wrote that reply (staff-only note). */
  messages: Array<{ role: "user" | "assistant"; content: string; at: number; model?: string }>;
  topics: string[];
  flags: Flag[];
  alerted?: boolean;
};

export const RETENTION_DAYS = 30;
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
const LOCAL_DIR = path.join(process.cwd(), "data", "transcripts");
const PREFIX = "transcripts/";

// ------------------------------------------------------------ classification

const TOPICS: Array<[string, RegExp]> = [
  ["orders", /\b(order|ref(erence)?|tracking|shipped|deliver|arriv|package|parcel|where'?s my)\b/i],
  ["payment", /\b(pay|paid|payment|invoice|venmo|zelle|cash|refund|charge|owe)\b/i],
  ["shipping", /\b(ship|shipping|pickup|pick up|pick-up|deliver|postage|usps)\b/i],
  ["products", /\b(product|tincture|capsule|blend|extract|coffee|tea|ingredient|dose|dosage|recommend|best for|focus|sleep|energy|calm|immun)/i],
  ["membership", /\b(member|membership|join|approve|approval|collective|request access)\b/i],
  ["login", /\b(password|log ?in|sign ?in|account|locked|reset|code)\b/i],
  ["events", /\b(event|class|workshop|walk|register|registration|waitlist)\b/i],
  ["deals", /\b(discount|code|coupon|sale|promo|deal|bundle|points|loyalty)\b/i],
  ["complaint", /\b(complain|complaint|unhappy|disappoint|terrible|awful|worst|broken|damaged|wrong item|missing)\b/i],
];

// Sensitive on purpose: staff would rather skim a few false alarms than miss
// something. High = emailed to the team straight away.
const A = "[a@4]", I = "[i1!|]", E = "[e3]", O = "[o0]";
// Common slurs, tolerant of simple letter swaps (f4g, n1gg…).
const SLURS = new RegExp(
  "\\b(" +
    [
      `n${I}gg(${E}r|${A}|${A}z|${E}rs)`, `f${A}gg?(${O}t|${O}ts|y)?`, `dyk${E}s?`, `tr${A}nn(y|${I}${E}s)`, `r${E}t${A}rd(s|${E}d)?`,
      `sp${I}cs?`, `ch${I}nks?`, `k${I}k${E}s?`, `w${E}tb${A}cks?`, `g${O}${O}ks?`, `t${O}w${E}l ?h${E}${A}ds?`, `r${A}gh${E}${A}ds?`,
      `b${E}${A}n${E}rs?`, `p${A}k${I}s?`, `j${I}g${A}b${O}${O}s?`, `sh${E}m${A}l${E}s?`, `c[u*]nts?`, `wh${O}r${E}s?`, `sl[u*]ts?`,
    ].join("|") +
    ")\\b",
  "i"
);

const FLAGS: Array<[FlagKind, Flag["severity"], RegExp]> = [
  ["self_harm", "high", /\b(kill myself|killing myself|suicid\w*|end (it all|my life|things)|self[- ]?harm|want to die|wanna die|hurt myself|cutting myself|no reason to live|better off dead)\b/i],
  ["health_emergency", "high", /\b(overdos\w*|od'?d|can'?t breathe|trouble breathing|chest pain|heart (attack|racing)|seizure|unconscious|passed out|fainted|911|emergency room|poison(ed|ing)?|anaphyla\w*|throat (closing|swelling)|not waking up)/i],
  ["threat", "high", /(\b(i('ll| will)|i'?m (gonna|going to)|gonna|we('ll| will))\s+(kill|hurt|shoot|stab|beat( up)?|find|burn|destroy|come (for|after)|ruin|smash|attack)\s+(you|u|ya|y'all|your|ur|the owner|the staff|nicole|grace|everyone|them|this place)\b|\bi know where (you|u|she|they) (live|are|work)\b|\bwatch (your|ur) back\b|\byou('ll| will) (regret|pay for) (this|it)\b|\b(bomb|shoot up|pipe bomb|with a (gun|knife))\b|\bburn (it|the place|your (shop|store|house|farm)) down\b)/i],
  ["adverse_reaction", "medium", /\b(allergic|reaction|rash|hives|vomit\w*|throw(ing)? up|made me sick|feel(ing)? sick|side effects?|dizzy|nause\w*|hospital|bad trip|paranoi\w*|palpitations?|migraine)\b/i],
  ["legal_or_chargeback", "medium", /\b(lawyer|attorney|sue|suing|lawsuit|legal action|small claims|chargeback|dispute (the|a|my) charge|bbb|better business bureau|report you|fraud|class action|cease and desist)\b/i],
  ["harassment", "medium", /(\bf+u+c+k+\s*(you|u|off|this|ur|y'all)\b|\bgo to hell\b|\bscrew (you|u)\b|\bpiece of (shit|crap|garbage)\b|\b(stupid|dumb|useless|worthless|pathetic) (bot|bitch|people|company|ass|machine|robot)\b|\b(idiots?|morons?|assholes?|bitch(es)?|dumbass|jackass|losers?|scumbags?)\b|\bshut up\b|\bkys\b)/i],
  ["slur", "medium", SLURS],
  ["hostile_to_business", "medium", /\b(boycott|expose (you|this|them)|(leave|write|post) (a )?(bad|terrible|negative|1[- ]star|one[- ]star) review|tell everyone|shut (you|this|them) down|this is (a )?(scam|fraud|illegal|a joke)|you('re| are) (a )?(liars?|lying|frauds?|scammers?|crooks?|criminals?)|drug dealers?|snake oil|quacks?|quackery|ripping people off|should be (shut down|illegal|arrested))\b/i],
  ["authorities", "medium", /\b(police|cops|dea|fda|feds|federal agents?|sheriff|authorities|undercover|narcs?|licensing board|health department|attorney general|report (you|this) to)\b/i],
  ["possible_minor", "medium", /\b(i'?m|i am|im) (1[0-9]|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)(?!\s*(min|mins|minutes|miles|mi|hours|hrs|km|%|percent|dollars|bucks|\$))( years old| yo| y\/o)?\b|\bmy (mom|dad|parents?) (doesn'?t|don'?t|won'?t|can'?t) (know|find out)\b|\b(in|at) (high school|middle school|8th grade|9th grade|10th grade|11th grade|12th grade)\b|\bfake id\b/i],
  ["risky_use", "medium", /\b(give (it|this|them|some) to my (kid|kids|child|children|son|daughter|baby|toddler|teen|grandkid)|for my (kid|kids|child|son|daughter|teen|baby)|(mix|combine|take) (it |this |them )?with (alcohol|booze|beer|wine|xanax|benzos?|lithium|ssris?|maois?|antidepressants?|meds|medication|adderall|opioids?)|before (driving|i drive|work)|drive (after|on it)|get (high|stoned|tripping|wasted|messed up)|how much (to|for) (trip|get high|feel it)|(double|triple) (the|my) dose|resell\w*|sell (it|them|these) (to|on|at)|while pregnant|i'?m pregnant|breastfeed\w*)\b/i],
  ["personal_distress", "medium", /\b(depress\w*|hopeless|can'?t cope|can'?t go on|panic attacks?|breakdown|nobody cares|so alone|lonely|worthless|falling apart|in a dark place|grieving|abusive (partner|relationship|home))\b/i],
  ["manipulation_attempt", "medium", /\b(ignore (all |your |the |any )?(previous |prior |above |earlier )?(instructions|rules|prompts?|guidelines)|system prompt|reveal (your|the) (prompt|instructions|rules)|what are your instructions|you are now|pretend (to be|you('re| are))|act as (an? )?(admin|developer|owner|staff)|jailbreak|developer mode|dan mode|override (your|the) (rules|safety))\b/i],
  ["probing", "medium", /(<script|javascript:|drop\s+table|select\s+\*\s+from|union\s+select|' ?or ?'?1'? ?= ?'?1|\.\.\/|\b(api[_ -]?keys?|admin (password|login|panel|dashboard)|database|env(ironment)? variables?|access tokens?|bearer token|secret key|staff password)\b)/i],
  ["other_customer_data", "medium", /\b(someone else'?s|another (customer|member)'?s?|other (customers|members)|list (of )?(all )?(customers|members|emails)|who (else )?(bought|ordered)|(nicole|grace)'?s (address|phone|number|home))\b/i],
  ["angry_customer", "low", /(!{3,}|\b(unacceptable|ridiculous|scam|rip ?off|never (buying|ordering|coming back) again|want my money back|refund (me )?now|furious|livid|outraged|disgusted)\b)/i],
  ["negative_sentiment", "low", /\b(disappoint\w*|frustrat\w*|annoy\w*|upset|angry|mad at|not happy|unhappy|fed up|sick of|tired of|waste of (money|time)|doesn'?t work|didn'?t work|not working|useless|hate|hated|sucks?|garbage|trash|horrible|terrible|awful|worst|pathetic|regret|let down|still waiting|no one (answers|replies|responds)|ignored)\b/i],
  ["profanity", "low", /\b(f+u+c+k\w*|shit\w*|bullshit|damn\w*|crap\w*|pissed|wtf|stfu|goddamn|bastards?)\b/i],
];

/**
 * Odd-behaviour checks that look at the whole message (and the ones before
 * it): repeating the same thing, shouting, gibberish, link spam.
 */
function oddBehavior(text: string, previousUser: string[]): boolean {
  const t = text.trim();
  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, " ").trim();
  if (t.length >= 6 && previousUser.slice(-3).some((p) => norm(p) === norm(t))) return true; // repeating
  const letters = t.replace(/[^a-z]/gi, "");
  if (letters.length >= 24 && letters === letters.toUpperCase()) return true; // shouting
  if ((t.match(/https?:\/\//gi) || []).length >= 3) return true; // link spam
  if (/\b(crypto|casino|backlinks?|seo services|loan offer|viagra)\b/i.test(t)) return true; // spam
  if (/(.)\1{7,}/.test(t)) return true; // "aaaaaaaaa"
  const words = t.split(/\s+/).filter((w) => w.replace(/[^a-z]/gi, "").length >= 5);
  if (words.length >= 3 && words.filter((w) => !/[aeiouy]/i.test(w)).length / words.length > 0.5) return true; // gibberish
  return false;
}

export function classify(text: string, previousUser: string[] = []): { topics: string[]; flags: Array<{ kind: FlagKind; severity: Flag["severity"] }> } {
  const topics = TOPICS.filter(([, re]) => re.test(text)).map(([t]) => t);
  const flags = FLAGS.filter(([, , re]) => re.test(text)).map(([kind, severity]) => ({ kind, severity }));
  if (OFF_LIMITS.test(text)) flags.push({ kind: "off_limits_topic", severity: "low" });
  if (oddBehavior(text, previousUser)) flags.push({ kind: "odd_behavior", severity: "low" });
  return { topics: topics.length ? topics : ["other"], flags };
}

export const FLAG_LABELS: Record<FlagKind, string> = {
  self_harm: "Mentions self-harm",
  health_emergency: "Possible medical emergency",
  adverse_reaction: "Possible reaction / feeling unwell",
  legal_or_chargeback: "Legal threat or chargeback",
  harassment: "Abusive language",
  possible_minor: "May be under 21",
  manipulation_attempt: "Tried to override the assistant",
  other_customer_data: "Asked about other customers",
  angry_customer: "Very unhappy customer",
  off_limits_topic: "Off-limits topic",
  threat: "Possible threat",
  slur: "Slur or hateful language",
  hostile_to_business: "Hostile to the business",
  authorities: "Mentions police / regulators",
  risky_use: "Risky use or resale",
  personal_distress: "Personal distress",
  probing: "Probing for private info / hacking",
  negative_sentiment: "Negative / frustrated",
  profanity: "Swearing",
  odd_behavior: "Odd behaviour (repeating, shouting, spam)",
};

/** Kinds that email the team straight away. */
export const HIGH_FLAGS: FlagKind[] = FLAGS.filter(([, sev]) => sev === "high").map(([k]) => k);

// ------------------------------------------------------------------- storage

const keyFor = (convId: string, owner: string) => createHash("sha256").update(`${convId}|${owner}`).digest("hex").slice(0, 24);

async function readOne(key: string): Promise<Transcript | null> {
  try {
    if (!useBlob) return JSON.parse(await fs.readFile(path.join(LOCAL_DIR, `${key}.json`), "utf8"));
    const { list } = await import("@vercel/blob");
    const p = `${PREFIX}${key}.json`;
    const { blobs } = await list({ prefix: p });
    const b = blobs.find((x) => x.pathname === p);
    if (!b) return null;
    const r = await fetch(`${b.url}?v=${Date.now()}`, { cache: "no-store" });
    return r.ok ? ((await r.json()) as Transcript) : null;
  } catch {
    return null;
  }
}

async function writeOne(t: Transcript): Promise<void> {
  const body = JSON.stringify(t);
  if (!useBlob) {
    await fs.mkdir(LOCAL_DIR, { recursive: true });
    await fs.writeFile(path.join(LOCAL_DIR, `${t.id}.json`), body, "utf8");
    return;
  }
  const { put } = await import("@vercel/blob");
  await put(`${PREFIX}${t.id}.json`, body, {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
}

/**
 * Add one turn (the customer's message + the reply) to its conversation.
 * Returns any NEW high-severity flags so the caller can alert the team.
 */
export async function saveTurn(input: {
  convId: string;
  owner: string;
  audience: Audience;
  who: string;
  userMessage: string;
  reply: string;
  /** Which model wrote the reply (staff-only note in the transcript). */
  model?: string;
}): Promise<{ transcript: Transcript; newHighFlags: Flag[] } | null> {
  if (!/^[a-z0-9]{8,40}$/i.test(input.convId)) return null;
  const id = keyFor(input.convId, input.owner);
  const now = Date.now();
  const t: Transcript =
    (await readOne(id)) || { id, audience: input.audience, who: input.who, startedAt: now, lastAt: now, messages: [], topics: [], flags: [] };
  const user = input.userMessage.slice(0, 2000);
  const previousUser = t.messages.filter((m) => m.role === "user").map((m) => m.content);
  t.messages.push({ role: "user", content: user, at: now }, { role: "assistant", content: input.reply.slice(0, 4000), at: now, ...(input.model ? { model: input.model } : {}) });
  t.messages = t.messages.slice(-200);
  t.lastAt = now;
  t.who = input.who || t.who;
  const { topics, flags } = input.audience === "admin" ? { topics: ["staff"], flags: [] } : classify(user, previousUser);
  for (const topic of topics) {
    if (!t.topics.includes(topic)) t.topics.push(topic);
    recordCounter(`at:${topic}`);
  }
  if (t.messages.length === 2) recordCounter(`ac:${input.audience}`); // new conversation
  const added: Flag[] = [];
  for (const f of flags) {
    if (t.flags.some((x) => x.kind === f.kind)) continue;
    const flag: Flag = { ...f, excerpt: user.slice(0, 240), at: now };
    t.flags.push(flag);
    added.push(flag);
    recordCounter(`afl:${f.kind}`);
  }
  await writeOne(t);
  return { transcript: t, newHighFlags: added.filter((f) => f.severity === "high") };
}

export async function markAlerted(t: Transcript) {
  t.alerted = true;
  await writeOne(t);
}

// ------------------------------------------------------------------- reading

async function listAll(): Promise<Array<{ key: string; url?: string; at: number }>> {
  if (!useBlob) {
    try {
      const files = await fs.readdir(LOCAL_DIR);
      const out = [];
      for (const f of files.filter((x) => x.endsWith(".json"))) {
        const st = await fs.stat(path.join(LOCAL_DIR, f));
        out.push({ key: f.replace(/\.json$/, ""), at: st.mtimeMs });
      }
      return out;
    } catch {
      return [];
    }
  }
  const { list } = await import("@vercel/blob");
  const out: Array<{ key: string; url?: string; at: number }> = [];
  let cursor: string | undefined;
  do {
    const page: Awaited<ReturnType<typeof list>> = await list({ prefix: PREFIX, limit: 1000, cursor });
    for (const b of page.blobs) out.push({ key: b.pathname.slice(PREFIX.length).replace(/\.json$/, ""), url: b.url, at: b.uploadedAt.getTime() });
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

/** Newest conversations (up to `limit`), optionally filtered. */
export async function recentTranscripts(opts: { audience?: string; flagged?: boolean; q?: string; limit?: number } = {}): Promise<Transcript[]> {
  const limit = Math.min(Math.max(opts.limit || 80, 1), 300);
  const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
  const all = (await listAll()).filter((x) => x.at >= cutoff).sort((a, b) => b.at - a.at);
  const out: Transcript[] = [];
  const needle = (opts.q || "").toLowerCase();
  // Read newest-first in batches until we have enough matches (bounded).
  for (let i = 0; i < all.length && out.length < limit && i < 600; i += 25) {
    const batch = await Promise.all(all.slice(i, i + 25).map((x) => readOne(x.key)));
    for (const t of batch) {
      if (!t) continue;
      if (opts.audience && t.audience !== opts.audience) continue;
      if (opts.flagged && t.flags.length === 0) continue;
      if (needle && !JSON.stringify(t.messages).toLowerCase().includes(needle) && !t.who.toLowerCase().includes(needle)) continue;
      out.push(t);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/**
 * One page of conversations, newest first. Without filters only that page's
 * files are read; with filters (audience / flagged / search) conversations
 * are read newest-first until the page is full.
 */
export async function pageTranscripts(opts: { audience?: string; flagged?: boolean; q?: string; page?: number; pageSize?: number }): Promise<{
  items: Transcript[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  total: number | null;
}> {
  const pageSize = Math.min(Math.max(Math.floor(opts.pageSize || 20), 5), 100);
  const page = Math.max(0, Math.floor(opts.page || 0));
  const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
  const all = (await listAll()).filter((x) => x.at >= cutoff).sort((a, b) => b.at - a.at);
  const start = page * pageSize;
  const needle = (opts.q || "").toLowerCase();
  const filtered = !!(opts.audience || opts.flagged || needle);
  if (!filtered) {
    const slice = all.slice(start, start + pageSize);
    const items = (await Promise.all(slice.map((x) => readOne(x.key)))).filter((t): t is Transcript => !!t);
    return { items, page, pageSize, hasMore: all.length > start + pageSize, total: all.length };
  }
  const matches: Transcript[] = [];
  const want = start + pageSize + 1; // one extra tells us there's a next page
  for (let i = 0; i < all.length && matches.length < want && i < 3000; i += 25) {
    const batch = await Promise.all(all.slice(i, i + 25).map((x) => readOne(x.key)));
    for (const t of batch) {
      if (!t) continue;
      if (opts.audience && t.audience !== opts.audience) continue;
      if (opts.flagged && t.flags.length === 0) continue;
      if (needle && !JSON.stringify(t.messages).toLowerCase().includes(needle) && !t.who.toLowerCase().includes(needle)) continue;
      matches.push(t);
    }
  }
  return { items: matches.slice(start, start + pageSize), page, pageSize, hasMore: matches.length > start + pageSize, total: null };
}

/** Delete conversations older than the retention window. Returns how many. */
export async function pruneTranscripts(): Promise<number> {
  const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
  const old = (await listAll()).filter((x) => x.at < cutoff);
  if (old.length === 0) return 0;
  if (!useBlob) {
    for (const x of old) await fs.rm(path.join(LOCAL_DIR, `${x.key}.json`), { force: true });
    return old.length;
  }
  const { del } = await import("@vercel/blob");
  for (let i = 0; i < old.length; i += 100) await del(old.slice(i, i + 100).map((x) => x.url!).filter(Boolean));
  return old.length;
}
