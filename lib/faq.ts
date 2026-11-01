import path from "path";
import { VersionedStore } from "./versionedStore";

/**
 * The Smart FAQ page (switch `faq_page`; services agreement §4.1): questions and
 * answers the business writes and approves in Settings → FAQ page. Published
 * answers show on /faq and the Concierge answers from them (lib/assistant/knowledge.ts),
 * including dosing guidance, which it may repeat only word-for-word.
 */

export type FaqItem = {
  id: string;
  question: string;
  /** Plain text: blank line = new paragraph, "- " = bullet. */
  answer: string;
  /** Groups the page ("Ordering", "Products"…). Empty = "General". */
  category: string;
  published: boolean;
  /** Position on the page (lower first). */
  order: number;
  createdAt: number;
  updatedAt: number;
};

const store = new VersionedStore<FaqItem>({
  name: "faq",
  legacyKey: "faq.json",
  localFile: path.join(process.cwd(), "data", "faq.json"),
  keep: 20,
  reconcileLegacy: false,
});

const byOrder = (a: FaqItem, b: FaqItem) => a.order - b.order || a.createdAt - b.createdAt;

export async function getFaq(): Promise<FaqItem[]> {
  return (await store.read()).data.slice().sort(byOrder);
}

/** What /faq and the Concierge use. */
export async function publishedFaq(): Promise<FaqItem[]> {
  return (await getFaq()).filter((f) => f.published);
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, max) : "");

type SaveResult = { ok: true; item: FaqItem; before?: FaqItem } | { ok: false; error: string; status: number };

export type FaqInput = { question?: unknown; answer?: unknown; category?: unknown; published?: unknown };

/** Create (no id) or update an item. Only fields that are sent change on update. */
export async function saveFaq(id: string | undefined, input: FaqInput): Promise<SaveResult> {
  const has = (k: keyof FaqInput) => input[k] !== undefined;
  if (!id) {
    const question = clean(input.question, 300);
    const answer = clean(input.answer, 6000);
    if (!question || !answer) return { ok: false, error: "Write a question and its answer.", status: 400 };
    const now = Date.now();
    return store.mutate<SaveResult>((rows) => {
      const item: FaqItem = {
        id: `faq_${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        question,
        answer,
        category: clean(input.category, 60),
        published: input.published === true,
        order: rows.reduce((m, r) => Math.max(m, r.order), 0) + 1,
        createdAt: now,
        updatedAt: now,
      };
      return { data: [...rows, item].slice(-500), result: { ok: true, item } };
    });
  }
  return store.mutate<SaveResult>((rows) => {
    const i = rows.findIndex((r) => r.id === id);
    if (i === -1) return { data: null, result: { ok: false, error: "That question was deleted.", status: 404 } };
    const before = rows[i];
    const next: FaqItem = {
      ...before,
      ...(has("question") ? { question: clean(input.question, 300) } : {}),
      ...(has("answer") ? { answer: clean(input.answer, 6000) } : {}),
      ...(has("category") ? { category: clean(input.category, 60) } : {}),
      ...(has("published") ? { published: input.published === true } : {}),
      updatedAt: Date.now(),
    };
    if (!next.question || !next.answer) return { data: null, result: { ok: false, error: "A question and its answer can't be empty.", status: 400 } };
    const out = rows.slice();
    out[i] = next;
    return { data: out, result: { ok: true, item: next, before } };
  });
}

export async function deleteFaq(id: string): Promise<FaqItem | null> {
  return store.mutate<FaqItem | null>((rows) => {
    const hit = rows.find((r) => r.id === id) || null;
    if (!hit) return { data: null, result: null };
    return { data: rows.filter((r) => r.id !== id), result: hit };
  }, { allowShrink: true });
}

/** Swap an item with its neighbour above or below. */
export async function moveFaq(id: string, dir: "up" | "down"): Promise<boolean> {
  return store.mutate<boolean>((rows) => {
    const sorted = rows.slice().sort(byOrder);
    const i = sorted.findIndex((r) => r.id === id);
    const j = dir === "up" ? i - 1 : i + 1;
    if (i === -1 || j < 0 || j >= sorted.length) return { data: null, result: false };
    const renumbered = sorted.map((r, k) => ({ ...r, order: k + 1 }));
    [renumbered[i].order, renumbered[j].order] = [renumbered[j].order, renumbered[i].order];
    return { data: renumbered, result: true };
  });
}

// The footer asks on every page whether to show the FAQ link: answer from a
// short per-instance cache rather than reading storage each time.
let liveCache: { at: number; value: boolean } | null = null;
export async function faqHasAnswers(): Promise<boolean> {
  if (liveCache && Date.now() - liveCache.at < 60_000) return liveCache.value;
  const value = (await publishedFaq().catch(() => [])).length > 0;
  liveCache = { at: Date.now(), value };
  return value;
}
export function forgetFaqCache(): void {
  liveCache = null;
}
