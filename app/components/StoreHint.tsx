"use client";

import { useEffect, useState } from "react";

// Product pop-up: "Find it in a store near you" when an active store carries
// it. The store list is fetched once per page and shared by every pop-up.
let carried: Promise<Set<string>> | null = null;
function carriedIds(): Promise<Set<string>> {
  if (!carried) {
    carried = fetch("/api/stores")
      .then((r) => (r.ok ? r.json() : { stores: [] }))
      .then((d) => new Set<string>((d.stores || []).flatMap((s: { productIds?: string[] }) => s.productIds || [])))
      .catch(() => new Set<string>());
  }
  return carried;
}

export default function StoreHint({ productId }: { productId: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let live = true;
    carriedIds().then((ids) => live && setShow(ids.has(productId)));
    return () => { live = false; };
  }, [productId]);
  if (!show) return null;
  return (
    <a className="store-hint" href={`/stores?product=${encodeURIComponent(productId)}`}>
      📍 Find it in a store near you&nbsp;→
    </a>
  );
}
