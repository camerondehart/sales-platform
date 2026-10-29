import { getProducts, isExternal } from "@/lib/storage";
import { applyVideoFlag, isEnabled } from "@/lib/flags";
import { applyStockFlag } from "@/lib/stock";
import RetailClient from "./RetailClient";
import { brand } from "@/lib/brand";

export const metadata = {
  title: `${brand.name} · Shop`,
  description: `${brand.productsPhrase[0].toUpperCase()}${brand.productsPhrase.slice(1)} from ${brand.name}.`,
};

export const dynamic = "force-dynamic";

export default async function RetailPage() {
  // Only external/both products are public.
  const products = await applyStockFlag(await applyVideoFlag((await getProducts()).filter(isExternal)));
  const stores = await isEnabled("store_locator").catch(() => false);
  const pickup = await isEnabled("cash_pickup").catch(() => false);
  return <RetailClient products={products} stores={stores} pickup={pickup} />;
}
