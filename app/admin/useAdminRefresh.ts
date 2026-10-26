"use client";

import { useEffect, useRef } from "react";
import { EVT_ADMIN_REFRESH, type AdminRefreshKey } from "@/lib/assistant/shared";

/** Reload a panel when a Concierge card that touches its data is confirmed. */
export function useAdminRefresh(keys: AdminRefreshKey[], reload: () => unknown) {
  const ref = useRef(reload);
  ref.current = reload;
  const want = keys.join(",");
  useEffect(() => {
    const on = (e: Event) => {
      const what = (e as CustomEvent).detail;
      if (Array.isArray(what) && what.some((k) => want.split(",").includes(k))) {
        try {
          const r = ref.current();
          if (r && typeof (r as Promise<unknown>).catch === "function") (r as Promise<unknown>).catch(() => {});
        } catch {}
      }
    };
    window.addEventListener(EVT_ADMIN_REFRESH, on);
    return () => window.removeEventListener(EVT_ADMIN_REFRESH, on);
  }, [want]);
}
