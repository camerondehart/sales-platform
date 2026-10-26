/**
 * The Today bulletin's suggestions (site-manager items + campaign ideas),
 * worked out in one place so the Overview card and the Concierge's
 * today_item tool always agree on exactly which people, orders and products
 * an item is about.
 */

import { cachedEvents, cachedOrders, cachedProducts, cachedUsers } from "./assistant/knowledge";
import { monthSpend } from "./assistant/usage";
import { getDiscounts } from "./discounts";
import { getRegistrations } from "./events";
import { getBanner } from "./banner";
import { isEnabled } from "./flags";
import { getSubscribers } from "./subscribers";
import { listCampaigns } from "./campaignSchedule";
import { listBundles } from "./bundleStore";
import { getSettings } from "./settings";
import { managerSuggestions, type Suggestion } from "./siteManager";
import { marketingIdeas } from "./marketingIdeas";

export async function todaySuggestions(monthCap: number): Promise<{ manager: Suggestion[]; marketing: Suggestion[] }> {
  let manager: Suggestion[] = [];
  let marketing: Suggestion[] = [];
  // Each half fails on its own, so one bad read never hides the other.
  try {
    const [orders, users, products, codes, events, registrations, banner, remindersOn, spent, settings] = await Promise.all([
      cachedOrders(),
      cachedUsers(),
      cachedProducts(),
      getDiscounts(),
      cachedEvents(),
      getRegistrations(),
      getBanner().catch(() => null),
      isEnabled("invoice_reminders"),
      monthSpend().catch(() => 0),
      getSettings().catch(() => null),
    ]);
    manager = managerSuggestions({
      now: Date.now(),
      orders,
      users,
      products,
      codes,
      events,
      registrations,
      banner,
      remindersOn,
      spend: { month: spent, cap: monthCap },
      packagingSet: settings ? settings.packagingOz !== undefined && settings.packagingOz !== null : undefined,
    });
  } catch (err) {
    console.error("[today] suggestions skipped", err);
  }
  try {
    const [orders, users, products, subscribers, campaigns, bundles, settings] = await Promise.all([
      cachedOrders(),
      cachedUsers(),
      cachedProducts(),
      getSubscribers().catch(() => []),
      listCampaigns().catch(() => []),
      listBundles().catch(() => []),
      getSettings().catch(() => null),
    ]);
    marketing = marketingIdeas({ now: Date.now(), orders, users, products, subscribers, campaigns, bundles, settings });
  } catch (err) {
    console.error("[today] campaign ideas skipped", err);
  }
  return { manager, marketing };
}
