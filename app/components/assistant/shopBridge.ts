"use client";

import { useEffect, useRef } from "react";
import { EVT_ADD_TO_CART, EVT_OPEN_CART, EVT_VIEW_PRODUCT, type ShopEventDetail } from "@/lib/assistant/shared";

/**
 * Lets the Concierge's product cards use the shop that's on screen: "Add to
 * cart" goes into this page's cart (so the count updates at once) and "View"
 * opens the product's own pop-up. Also opens the cart for ?cart=1 links.
 * The widget falls back to the saved cart / a link when no shop is on the page.
 */
export function useChatShopBridge<T extends { id: string }>(opts: {
  shop: "members" | "public";
  products: T[];
  add: (productId: string) => void;
  view: (p: T) => void;
  openCart: () => void;
}) {
  const ref = useRef(opts);
  ref.current = opts;
  useEffect(() => {
    const handle = (kind: "add" | "view" | "cart") => (e: Event) => {
      const d = (e as CustomEvent<ShopEventDetail>).detail;
      const o = ref.current;
      if (!d || d.shop !== o.shop) return;
      if (kind === "cart") {
        o.openCart();
        d.handled = true;
        return;
      }
      const p = o.products.find((x) => x.id === d.productId);
      if (!p) return;
      if (kind === "add") o.add(p.id);
      else o.view(p);
      d.handled = true;
    };
    const onAdd = handle("add");
    const onView = handle("view");
    const onCart = handle("cart");
    window.addEventListener(EVT_ADD_TO_CART, onAdd);
    window.addEventListener(EVT_VIEW_PRODUCT, onView);
    window.addEventListener(EVT_OPEN_CART, onCart);
    // Links from the chat on other pages: /gallery?cart=1 or /retail?cart=1
    const params = new URLSearchParams(window.location.search);
    if (params.get("cart") === "1") {
      ref.current.openCart();
      params.delete("cart");
      const rest = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
    }
    return () => {
      window.removeEventListener(EVT_ADD_TO_CART, onAdd);
      window.removeEventListener(EVT_VIEW_PRODUCT, onView);
      window.removeEventListener(EVT_OPEN_CART, onCart);
    };
  }, []);
}
