import { actionFor } from "../todayActions";
import type { Suggestion } from "../siteManager";

/** The Today list's items with the same ids the Today route gives them. */
export function todayItemIds(daily: Array<{ priority: string; task: string; items?: string[] }>, suggestions: Suggestion[]) {
  return [
    ...daily.map((t) => ({ id: actionFor(t.task).key, priority: t.priority, task: t.task, items: (t.items || []).map((s) => s.replace(/\s*\{id:[^}]*\}/g, "").trim()) })),
    ...suggestions.map((s) => ({ id: s.key, priority: s.priority as string, task: s.task, items: s.items || [] })),
  ];
}
