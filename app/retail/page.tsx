import { getProducts, isExternal } from "@/lib/storage";
import { applyVideoFlag } from "@/lib/flags";
import RetailClient from "./RetailClient";
import { brand } from "@/lib/brand";

export const metadata = {
  title: `${brand.name} · Shop`,
  description: `${brand.productsPhrase[0].toUpperCase()}${brand.productsPhrase.slice(1)} from ${brand.name}.`,
};

export const dynamic = "force-dynamic";

export default async function RetailPage() {
  // Only external/both products are public.
  const products = await applyVideoFlag((await getProducts()).filter(isExternal));
  return <RetailClient products={products} />;
}
