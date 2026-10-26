"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { trackPage } from "@/lib/track";

/** Counts page views (cookie-free, see lib/track.ts). Renders nothing. */
export default function Tracker() {
  const pathname = usePathname();
  useEffect(() => {
    // After first paint, so counting never competes with the page loading.
    const t = setTimeout(trackPage, 300);
    return () => clearTimeout(t);
  }, [pathname]);
  return null;
}
