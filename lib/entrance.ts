import { brand } from "./brand";
import path from "path";
import { VersionedStore } from "./versionedStore";
import { isEnabled } from "./flags";
import { autoSchedule, cleanEntranceChoice, ENTRANCE_THEMES, resolveEntrance, type EntranceChoice, type EntranceKey } from "./entranceThemes";

/**
 * Which members' entrance plays (Settings → Entrance animation; switch
 * `seasonal_entrance`). One saved row: the staff choice, "auto" by default.
 * Race-safe store, like the FAQ. Themes live in lib/entranceThemes.ts.
 */

type Row = { id: "entrance"; choice: EntranceChoice; updatedAt: number };

const store = new VersionedStore<Row>({
  name: "entrance",
  legacyKey: "entrance.json",
  localFile: path.join(process.cwd(), "data", "entrance.json"),
  keep: 10,
  reconcileLegacy: false,
});

export async function getEntranceChoice(): Promise<EntranceChoice> {
  const rows = (await store.read().catch(() => ({ data: [] as Row[] }))).data;
  return cleanEntranceChoice(rows.find((r) => r.id === "entrance")?.choice);
}

export async function setEntranceChoice(choice: EntranceChoice): Promise<{ before: EntranceChoice; after: EntranceChoice }> {
  return store.mutate<{ before: EntranceChoice; after: EntranceChoice }>(
    (rows) => {
      const before = cleanEntranceChoice(rows.find((r) => r.id === "entrance")?.choice);
      return { data: [{ id: "entrance", choice, updatedAt: Date.now() }], result: { before, after: choice } };
    },
    { allowShrink: true }
  );
}

/** The theme members see right now. */
export async function currentEntrance(now = Date.now()): Promise<EntranceKey> {
  const [on, choice] = await Promise.all([isEnabled("seasonal_entrance").catch(() => false), getEntranceChoice()]);
  return resolveEntrance(choice, on, now);
}

/** The season the site background uses (switch `seasonal_site`; same choice as the entrance). null = the usual look. */
export async function currentSiteSeason(now = Date.now()): Promise<EntranceKey | null> {
  // "plain" decor has no scene to dress up, so the site keeps its plain look.
  if (brand.decor !== "meadow") return null;
  const [on, choice] = await Promise.all([isEnabled("seasonal_site").catch(() => false), getEntranceChoice().catch(() => "auto" as const)]);
  if (!on) return null;
  const key = resolveEntrance(choice, true, now);
  return key === "classic" ? null : key;
}

/** Everything the Settings panel and the Concierge show. */
export async function entranceStatus(now = Date.now()) {
  const [on, choice] = await Promise.all([isEnabled("seasonal_entrance").catch(() => false), getEntranceChoice()]);
  const showing = resolveEntrance(choice, on, now);
  const siteOn = await isEnabled("seasonal_site").catch(() => false);
  return {
    switchOn: on,
    siteSwitchOn: siteOn,
    siteShowing: siteOn ? ENTRANCE_THEMES[resolveEntrance(choice, true, now)].label : "Classic",
    choice,
    showing,
    showingLabel: ENTRANCE_THEMES[showing].label,
    upcoming: choice === "auto" && on ? autoSchedule(now, 6).map((c) => ({ ...c, label: ENTRANCE_THEMES[c.key].label })) : [],
    themes: Object.values(ENTRANCE_THEMES).map((t) => ({ key: t.key, label: t.label, emoji: t.emoji, when: t.when })),
  };
}
