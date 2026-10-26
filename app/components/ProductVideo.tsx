"use client";

import { useEffect } from "react";
import { parseVideo } from "@/lib/video";

/** A product's video in its pop-up. Renders nothing if there's no usable link. */
export default function ProductVideo({ url, title }: { url?: string; title: string }) {
  const v = parseVideo(url);
  if (!v) return null;
  return (
    <div className="product-video">
      {v.kind === "file" ? (
        <video src={v.src} controls playsInline preload="metadata" aria-label={`${title} video`} />
      ) : (
        <iframe
          src={v.embed}
          title={`${title} video`}
          loading="lazy"
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      )}
    </div>
  );
}

/**
 * Open a product's pop-up when the page is visited as ?product=<id> — this
 * is where printed QR codes (/p/<id>) land. The parameter is removed from the
 * address bar afterwards so closing the pop-up leaves a normal shop URL.
 */
export function useProductDeepLink<T extends { id: string }>(products: T[], open: (p: T) => void) {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("product");
    if (!id) return;
    const p = products.find((x) => x.id === id);
    if (p) open(p);
    params.delete("product");
    const rest = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
    // Only on first load.
  }, []);
}
