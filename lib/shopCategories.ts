/**
 * Members' shop category filter: groups product categories so near-duplicates
 * ("Bundle" / "Bundles", "capsules" / "Capsules ") show as one choice.
 */

export type ShopCategory = { key: string; label: string; count: number };

/** Lower case, single spaces, simple plural folded ("Gummies" = "Gummy", "Bundles" = "Bundle"). */
export function categoryKey(raw: string | undefined | null): string {
  let k = (raw || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!k) return "";
  if (/[^aeiou]ies$/.test(k)) k = k.slice(0, -3) + "y";
  else if (/[^s]s$/.test(k) && k.length > 3) k = k.slice(0, -1);
  return k;
}

/** One entry per grouped category, most products first (ties A to Z). The label is the
 *  spelling most products use (ties: the plural/longer one). */
export function shopCategories(products: { category?: string }[]): ShopCategory[] {
  const groups = new Map<string, { count: number; spellings: Map<string, number> }>();
  for (const p of products) {
    const label = (p.category || "").trim().replace(/\s+/g, " ");
    const key = categoryKey(label);
    if (!key) continue;
    const g = groups.get(key) || { count: 0, spellings: new Map<string, number>() };
    g.count++;
    g.spellings.set(label, (g.spellings.get(label) || 0) + 1);
    groups.set(key, g);
  }
  const out: ShopCategory[] = [];
  groups.forEach((g, key) => {
    const label = Array.from(g.spellings.entries()).sort(
      (a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0])
    )[0][0];
    out.push({ key, label, count: g.count });
  });
  return out.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
