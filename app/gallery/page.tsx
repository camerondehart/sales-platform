import { redirect } from "next/navigation";
import { getApprovedVisitor, getVisitor, isAdmin } from "@/lib/auth";
import { getProducts, isInternal } from "@/lib/storage";
import { applyVideoFlag } from "@/lib/flags";
import GalleryClient from "./GalleryClient";
import Scene from "@/app/components/Scene";

export const dynamic = "force-dynamic";

export default async function GalleryPage() {
  const user = await getApprovedVisitor();
  if (!user) {
    if (await isAdmin()) {
      const products = await applyVideoFlag((await getProducts()).filter(isInternal));
      return (
        <>
          <Scene variant="soft" />
          <GalleryClient
            products={products}
            userName="Boss"
            userEmail=""
            isAdminPreview
          />
        </>
      );
    }
    redirect("/");
  }
  // Members see internal + shared products, never external-only ones.
  const products = await applyVideoFlag((await getProducts()).filter(isInternal));
  return (
    <>
      <Scene variant="soft" />
      <GalleryClient products={products} userName={user.name} userEmail={user.email} actingAs={(await getVisitor())?.as} />
    </>
  );
}
