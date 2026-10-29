"use client";

import { useEffect } from "react";
import { rememberAmbassador } from "@/lib/ambassadorRef";

/**
 * Remembers this ambassador's page (and their discount code) in the shopper's
 * browser, so their order is credited and the code is filled in at checkout.
 */
export default function RememberAmbassador({ slug, code }: { slug: string; code?: string }) {
  useEffect(() => {
    rememberAmbassador(slug, code);
  }, [slug, code]);
  return null;
}
