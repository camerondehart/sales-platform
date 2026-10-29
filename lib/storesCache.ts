import { getPublicStores, type PublicStore } from "./stores";
import { singleton } from "./assistant/singleton";

// The public store list, cached 60 s per server and cleared on any staff change.
const CACHE = singleton("publicStores", () => ({ at: 0, stores: null as PublicStore[] | null }));

export function forgetPublicStores() {
  CACHE.at = 0;
  CACHE.stores = null;
}

export async function cachedPublicStores(): Promise<PublicStore[]> {
  if (CACHE.stores && Date.now() - CACHE.at < 60_000) return CACHE.stores;
  const stores = await getPublicStores();
  CACHE.at = Date.now();
  CACHE.stores = stores;
  return stores;
}
