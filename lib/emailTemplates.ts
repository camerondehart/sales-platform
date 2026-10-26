import path from "path";
import { VersionedStore } from "./versionedStore";
import { brand, TEAM } from "@/lib/brand";

/**
 * Email template library for the Marketing tab.
 *
 * Starter templates live in code. Staff can still rewrite one ("Redo with AI"
 * saves an override with the same starter_ id), remove one (a hidden
 * tombstone row) and bring it back (the row is dropped → the original from
 * code shows again). Saved templates live in a VersionedStore, the same
 * race-safe storage the member list uses.
 *
 * Bodies use the campaign composer's plain-text format:
 *   # Heading · blank line = new paragraph · "- " bullets · **bold** ·
 *   a line on its own like [Shop now](https://…) becomes a green button.
 */

export const TEMPLATE_CATEGORIES = ["fall", "holiday", "winter", "spring", "summer", "promo", "event", "news", "blank", "custom"] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export type EmailTemplate = {
  id: string;
  name: string;
  category: TemplateCategory;
  subject: string;
  body: string;
  archived?: boolean;
  starter?: boolean;
  /** Starter override rows only: removed by staff (hidden from the list). */
  hidden?: boolean;
  /** In listings: a starter whose wording staff changed. */
  edited?: boolean;
  createdAt: number;
  updatedAt: number;
};

const SHOP = `${brand.siteUrl}/retail`;
const EVENTS = `${brand.siteUrl}/events`;

const starter = (id: string, name: string, category: TemplateCategory, subject: string, body: string): EmailTemplate => ({
  id: `starter_${id}`,
  name,
  category,
  subject,
  body,
  starter: true,
  createdAt: 0,
  updatedAt: 0,
});

export const STARTERS: EmailTemplate[] = [
  starter(
    "fall",
    "Fall ritual",
    "fall",
    "Cozy season is here 🍂",
    `# Settle into fall

The mornings are crisp and the days are getting shorter — a good time to slow down and build a ritual that carries you through the season.

A few of our favourites for this time of year:

- **[Product]** — [why it fits fall mornings]
- **[Product]** — [for winding down in the evening]
- **[Product]** — [a cozy afternoon favourite]

[Shop fall favourites](${SHOP})

Warmly,
${TEAM}`
  ),
  starter(
    "holiday",
    "Holiday gifting",
    "holiday",
    "Thoughtful gifts, grown with care 🎁",
    `# Gifts that feel good

Looking for something meaningful this year? Our ${brand.productsPhrase} make gifts people actually use — for the early riser, the night owl, or the friend who's always on the go.

- Bundles ready to give
- Something for every budget
- Order by **[date]** for delivery before the holidays

[Find a gift](${SHOP})

Happy holidays from all of us,
${TEAM}`
  ),
  starter(
    "winter",
    "Winter wellness",
    "winter",
    "Stay well this winter ❄️",
    `# Winter, supported

Cold, dark days ask a lot of us. Our winter lineup is here to help you feel your best while the season does its thing.

- **[Product]** — [why it's a winter favourite]
- **[Product]** — [for slow, warm evenings]

[Shop the winter lineup](${SHOP})

Stay cozy,
${TEAM}`
  ),
  starter(
    "spring",
    "Spring renewal",
    "spring",
    "Fresh season, fresh start 🌱",
    `# Hello, spring

New growth everywhere — and a great time to refresh your routine.

Whether you want more focus for busy days or more calm in the evenings, we've got a blend for it.

[Start your spring ritual](${SHOP})

With gratitude,
${TEAM}`
  ),
  starter(
    "summer",
    "Summer energy",
    "summer",
    "Long days, steady energy ☀️",
    `# Made for summer

Early hikes, late sunsets, full weekends. Keep your energy steady and your mind clear with a few summer staples.

- **[Product]** — [for active days]
- **[Product]** — [for busy, focused days]
- **[Product]** — [easy to take on the road]

[Shop summer staples](${SHOP})

See you outside,
${TEAM}`
  ),
  starter(
    "promo",
    "Sale / promotion",
    "promo",
    "[X]% off — this week only",
    `# [X]% off, this week only

For a limited time, save **[X]%** on [what's included]. Use code **[CODE]** at checkout, or shop the sale prices directly.

- Ends **[day, date]**
- While stock lasts

[Shop the sale](${SHOP})

Thank you for being part of our community,
${TEAM}`
  ),
  starter(
    "event",
    "Upcoming event",
    "event",
    `Join us: [event name] ${brand.emoji}`,
    `# You're invited

We'd love to see you at **[event name]**.

- **When:** [day, date, time]
- **Where:** [place]
- **Cost:** [price or free]

[What we'll cover or what to expect.]

Spaces are limited, so save your spot soon.

[Reserve your spot](${EVENTS})

See you there,
${TEAM}`
  ),
  starter(
    "news",
    "New arrivals / news",
    "news",
    `New this month ${brand.emoji}`,
    `# New this month

[One or two sentences about what's new — a product, a restock, a story from the workshop.]

[Take a look](${SHOP})

Warmly,
${TEAM}`
  ),
  starter("blank", "Blank", "blank", "", `# Your heading

Write your message here.

[Button text](${SHOP})

${TEAM}`),
];

const store = new VersionedStore<EmailTemplate>({
  name: "email-templates",
  legacyKey: "email-templates.json",
  localFile: path.join(process.cwd(), "data", "email-templates.json"),
  keep: 12,
  reconcileLegacy: false,
});

const isStarterId = (id: string | undefined) => !!id && id.startsWith("starter_");
const builtIn = (id: string) => STARTERS.find((t) => t.id === id);

export async function listTemplates(): Promise<EmailTemplate[]> {
  const rows = (await store.read()).data;
  const over = new Map(rows.filter((r) => isStarterId(r.id)).map((r) => [r.id, r]));
  const starters = STARTERS.flatMap((t) => {
    const o = over.get(t.id);
    if (!o) return [t];
    if (o.hidden) return [];
    return [{ ...t, ...o, starter: true, edited: o.updatedAt > 0 && (o.subject !== t.subject || o.body !== t.body || o.name !== t.name) }];
  });
  const saved = rows.filter((r) => !isStarterId(r.id));
  return [...starters, ...saved.sort((a, b) => b.updatedAt - a.updatedAt)];
}

/** Built-in templates staff removed (so the list can offer to bring them back). */
export async function hiddenStarters(): Promise<string[]> {
  const rows = (await store.read()).data;
  return rows.filter((r) => isStarterId(r.id) && r.hidden && builtIn(r.id)).map((r) => r.id);
}

const clean = (v: unknown, max: number) => String(v ?? "").replace(/\r\n/g, "\n").slice(0, max);
const cleanCategory = (v: unknown): TemplateCategory =>
  (TEMPLATE_CATEGORIES as readonly string[]).includes(String(v)) ? (v as TemplateCategory) : "custom";

export async function saveTemplate(input: { id?: string; name: unknown; category?: unknown; subject: unknown; body: unknown }) {
  const name = clean(input.name, 80).trim();
  const body = clean(input.body, 20000);
  if (!name) throw new Error("Give the template a name.");
  if (!body.trim()) throw new Error("The template is empty.");
  // Rewriting a built-in saves an override under the same id.
  const base = isStarterId(input.id) ? builtIn(input.id!) : undefined;
  if (isStarterId(input.id) && !base) throw new Error("Template not found.");
  const now = Date.now();
  return store.mutate((rows) => {
    const i = input.id ? rows.findIndex((r) => r.id === input.id) : -1;
    if (base && i >= 0 && rows[i].hidden) throw new Error("That built-in template was removed — bring it back first.");
    const rec: EmailTemplate = {
      id: base ? base.id : i >= 0 ? rows[i].id : `tpl_${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name,
      category: cleanCategory(input.category),
      subject: clean(input.subject, 150),
      body,
      archived: i >= 0 ? rows[i].archived : false,
      ...(base ? { starter: true } : {}),
      createdAt: i >= 0 ? rows[i].createdAt : base ? 0 : now,
      updatedAt: now,
    };
    const next = rows.slice();
    if (i >= 0) next[i] = rec;
    else next.push(rec);
    return { data: next, result: rec };
  });
}

export async function setArchived(id: string, archived: boolean) {
  if (id.startsWith("starter_")) throw new Error("Starter templates can't be archived — remove it instead (you can bring it back).");
  return store.mutate((rows) => {
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0) return { data: null, result: null };
    const next = rows.slice();
    next[i] = { ...rows[i], archived, updatedAt: Date.now() };
    return { data: next, result: next[i] };
  });
}

/**
 * Delete one of your saved templates for good, or remove a built-in one (it
 * can be brought back). Returns what was removed.
 */
export async function deleteTemplate(id: string) {
  if (isStarterId(id)) {
    const base = builtIn(id);
    if (!base) return null;
    return store.mutate((rows) => {
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0 && rows[i].hidden) return { data: null, result: null };
      const shown = i >= 0 ? { ...base, ...rows[i] } : base;
      const tomb: EmailTemplate = { ...shown, starter: true, hidden: true, updatedAt: Date.now() };
      const next = rows.slice();
      if (i >= 0) next[i] = tomb;
      else next.push(tomb);
      return { data: next, result: shown };
    });
  }
  return store.mutate(
    (rows) => {
      const gone = rows.find((r) => r.id === id);
      if (!gone) return { data: null, result: null };
      return { data: rows.filter((r) => r.id !== id), result: gone };
    },
    { allowShrink: true }
  );
}

/** Built-in template back to its original wording (or back on the list if removed). */
export async function resetStarter(id: string) {
  if (!builtIn(id)) throw new Error("Template not found.");
  return store.mutate(
    (rows) => {
      const old = rows.find((r) => r.id === id);
      if (!old) return { data: null, result: null };
      return { data: rows.filter((r) => r.id !== id), result: old };
    },
    { allowShrink: true }
  );
}

/** Bring back every removed built-in template. Returns how many. */
export async function restoreStarters() {
  return store.mutate(
    (rows) => {
      const back = rows.filter((r) => isStarterId(r.id) && r.hidden);
      if (!back.length) return { data: null, result: 0 };
      return { data: rows.filter((r) => !(isStarterId(r.id) && r.hidden)), result: back.length };
    },
    { allowShrink: true }
  );
}

export async function duplicateTemplate(id: string) {
  const all = await listTemplates();
  const src = all.find((t) => t.id === id);
  if (!src) throw new Error("Template not found.");
  return saveTemplate({ name: `${src.name} (copy)`, category: src.starter ? src.category : src.category, subject: src.subject, body: src.body });
}
