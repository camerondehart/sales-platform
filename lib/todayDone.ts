/**
 * Which Today-list items staff have ticked "done", per local day — shared
 * by everyone and every device (it used to live in each browser).
 */

import path from "path";
import { VersionedStore } from "./versionedStore";
import { pacificDay } from "./periods";

type Row = { id: string; done: string[]; updatedAt: number };

const store = new VersionedStore<Row>({
  name: "today-done",
  legacyKey: "today-done.json",
  localFile: path.join(process.cwd(), "data", "today-done.json"),
  keep: 10,
  reconcileLegacy: false,
});

export async function doneToday(day = pacificDay()): Promise<string[]> {
  const row = (await store.read()).data.find((r) => r.id === day);
  return row ? row.done : [];
}

export async function setDone(itemId: string, done: boolean, day = pacificDay()): Promise<string[]> {
  return store.mutate(
    (rows) => {
      const keep = rows.filter((r) => r.id !== day).sort((a, b) => (a.id < b.id ? 1 : -1)).slice(0, 13); // two weeks is plenty
      const cur = new Set(rows.find((r) => r.id === day)?.done || []);
      if (done) cur.add(itemId);
      else cur.delete(itemId);
      const list = Array.from(cur).slice(0, 200);
      return { data: [{ id: day, done: list, updatedAt: Date.now() }, ...keep], result: list };
    },
    { allowShrink: true }
  );
}

/** Ticked items for the last few days, newest first (for the Concierge's nightly notes review). */
export async function recentDone(days = 7): Promise<Array<{ day: string; done: string[] }>> {
  const rows = (await store.read()).data.sort((a, b) => (a.id < b.id ? 1 : -1)).slice(0, days);
  return rows.map((r) => ({ day: r.id, done: r.done }));
}
