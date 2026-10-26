/**
 * Process-wide state for the assistant.
 *
 * Next.js bundles each API route separately, so a plain module-level
 * variable exists once PER ROUTE: the admin tab's config cache and the chat
 * route's config cache would be two different objects, and a spending limit
 * saved in one wouldn't be seen by the other until its cache expired.
 * Anchoring shared state on globalThis gives every route in the same server
 * instance one copy.
 */
export function singleton<T>(key: string, init: () => T): T {
  const g = globalThis as unknown as Record<string, unknown>;
  const k = `__fpAssistant_${key}`;
  if (!(k in g)) g[k] = init();
  return g[k] as T;
}
