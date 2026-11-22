/**
 * Customer-facing writing for many people (campaigns and templates) must
 * never quote the shop's internal numbers: units sold, order
 * counts, revenue, stock levels or "over the last 30 days" windows (a
 * Black Friday draft once said a product "was our best-selling product by
 * units over the last 30 days, with 63 boxes sold"). The Concierge's tools
 * refuse such text and ask for a rewrite.
 * Prices, totals, order references, dates and codes are fine.
 */
const INTERNAL_STATS: RegExp[] = [
  /\b\d[\d,]*\s+(?:boxes|units|bottles|jars|tins|bags|packs|pieces|items|products|tinctures|bars)\s+(?:were\s+|have\s+been\s+)?(?:sold|ordered|bought|purchased|moved)\b/i,
  /\bunits?\s+sold\b/i,
  /\b(?:sold|moved)\s+(?:over\s+|more than\s+)?\d[\d,]*\s+(?:boxes|units|bottles|jars|tins|bags|packs|pieces|items|products|tinctures|bars|orders)\b/i,
  /\bby\s+(?:units|unit sales|revenue|sales volume)\b/i,
  /\b(?:across|from|in|over)\s+\d[\d,]*\s+(?:orders|sales|purchases)\b/i,
  /\b\d[\d,]*\s+(?:orders|sales|purchases)\s+(?:in|over|during|this|last)\b/i,
  /\b(?:over|in|during|for)\s+the\s+(?:last|past|previous)\s+\d+\s+(?:days|weeks|months)\b/i,
  /\b\d[\d,]*\s+(?:customers|members|people|shoppers)\s+(?:who\s+)?(?:have\s+)?(?:bought|ordered|purchased)\b/i,
  /\brevenue\b/i,
  /\b\d[\d,]*\s+(?:left\s+)?in\s+stock\b/i,
  /\bstock\s+(?:count|level)s?\b/i,
];

/** The first internal-number phrase in a customer-facing text, or null. */
export function internalStatsIn(...texts: unknown[]): string | null {
  for (const t of texts) {
    if (typeof t !== "string" || !t) continue;
    for (const re of INTERNAL_STATS) {
      const m = t.match(re);
      if (m) return m[0];
    }
  }
  return null;
}

/** Tool error the Concierge gets back, so it rewrites instead of sending stats to customers. */
export function statsRewrite(found: string) {
  return {
    error:
      `This goes to customers, so it can't quote internal numbers ("${found}"): no units or boxes sold, order counts, revenue, stock levels or "last 30 days". ` +
      `Rewrite it in the warm, friendly customer voice, keeping the offer, code, dates and links exact. ` +
      `To highlight a product, call it a gentle "customer favorite" or "a little treasure our members love", with no figures. Then call this tool again.`,
  };
}
