import { notFound } from "next/navigation";
import { isEnabled } from "@/lib/flags";
import { getProducts, isExternal } from "@/lib/storage";
import { cachedPublicStores } from "@/lib/storesCache";
import StoresClient from "./StoresClient";
import SiteNav from "@/app/components/SiteNav";
import { brand } from "@/lib/brand";

export const metadata = {
  title: `Find us in stores · ${brand.name}`,
  description: `Shops that carry ${brand.name}, with a map, hours and directions.`,
};

export const dynamic = "force-dynamic";

export default async function StoresPage({ searchParams }: { searchParams: { product?: string } }) {
  if (!(await isEnabled("store_locator").catch(() => false))) notFound();
  const [stores, products] = await Promise.all([cachedPublicStores(), getProducts().catch(() => [])]);
  // Only public-shop product names are shown on this public page.
  const names: Record<string, string> = {};
  for (const p of products) if (isExternal(p)) names[p.id] = p.name;
  const product = String(searchParams?.product || "").slice(0, 80) || null;

  return (
    <div className="shell">
      <header className="masthead">
        <a className="masthead-brand" href="/" aria-label={`${brand.name} home`}>
          <div className="logo-mark floaty" aria-hidden="true">
            <span></span><span></span><span></span><span></span>
          </div>
          <h1 className="masthead-title">{brand.name}</h1>
        </a>
        <SiteNav current="stores" stores />
      </header>
      <StoresClient stores={stores} productNames={names} initialProduct={product} />
    </div>
  );
}
