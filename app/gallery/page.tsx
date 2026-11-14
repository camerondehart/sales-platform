import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { localEventNoteFor } from "@/lib/localEventsNote";
import { currentEntrance } from "@/lib/entrance";
import { getApprovedVisitor, getVisitor, isAdmin } from "@/lib/auth";
import { getProducts, isInternal } from "@/lib/storage";
import { applyVideoFlag, isEnabled } from "@/lib/flags";
import { applyStockFlag } from "@/lib/stock";
import GalleryClient from "./GalleryClient";
import Scene from "@/app/components/Scene";

export const dynamic = "force-dynamic";

export default async function GalleryPage() {
  const user = await getApprovedVisitor();
  const stores = await isEnabled("store_locator").catch(() => false);
  if (!user) {
    if (await isAdmin()) {
      const products = await applyStockFlag(await applyVideoFlag((await getProducts()).filter(isInternal)));
      return (
        <>
          <Scene variant="soft" />
          <GalleryClient
            products={products}
            userName="Boss"
            userEmail=""
            isAdminPreview
            stores={stores}
          />
        </>
      );
    }
    redirect("/");
  }
  // Members see internal + shared products, never external-only ones.
  const products = await applyStockFlag(await applyVideoFlag((await getProducts()).filter(isInternal)));
  const actingAs = (await getVisitor())?.as;
  // One-time events note for members signing in near the Events popup town (lib/localEvents.ts).
  const h = headers();
  const localEvent = await localEventNoteFor(user, (n) => h.get(n), actingAs);
  return (
    <>
      <Scene variant="soft" />
      <GalleryClient products={products} userName={user.name} userEmail={user.email} actingAs={actingAs} localEvent={localEvent} stores={stores} faceId={await isEnabled("member_passkeys").catch(() => false)} consult={await isEnabled("consultation_form").catch(() => false)} entranceTheme={await currentEntrance().catch(() => "classic" as const)} />
    </>
  );
}
