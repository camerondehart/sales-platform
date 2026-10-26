"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { Banner } from "@/lib/banner";

function formatRemaining(ms: number): string {
  if (ms <= 0) return "";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

export default function SiteBanner({ initial }: { initial: Banner }) {
  const [banner] = useState<Banner>(initial);
  const [remaining, setRemaining] = useState<string>("");
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  // The customer announcement has no place on staff-only screens.
  const staffPage = pathname?.startsWith("/help") || pathname?.startsWith("/admin");

  useEffect(() => {
    if (!banner.countdownTo) return;
    const tick = () => setRemaining(formatRemaining(banner.countdownTo! - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [banner.countdownTo]);

  // Countdown finished — hide the banner rather than showing 00:00:00
  const expired = !!banner.countdownTo && banner.countdownTo <= Date.now();
  const visible = !staffPage && !!banner.enabled && !!banner.message?.trim() && !expired;

  return (
    <>
      <BannerHeight el={ref} visible={visible} />
      {visible && (
        <div
          ref={ref}
          className="site-banner"
          style={{ background: banner.background, color: banner.textColor }}
          role="status"
        >
          <div className="site-banner-inner">
            <span
              className="site-banner-msg"
              dangerouslySetInnerHTML={{ __html: banner.message }}
            />
            {banner.countdownTo && remaining && (
              <span className="site-banner-count">
                {banner.countdownLabel ? `${banner.countdownLabel} ` : ""}
                <strong>{remaining}</strong>
              </span>
            )}
            {banner.linkUrl && (
              <a className="site-banner-link" href={banner.linkUrl} style={{ color: banner.textColor }}>
                {banner.linkLabel || "Learn more"} →
              </a>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Publishes the banner's real height as `--banner-h` on <html>.
 *
 * Full-height sections (the sign-in hero, the gate pages) subtract it, so the
 * banner pushes the page down instead of shoving the bottom of the hero — and
 * the "shop our range" cue stays exactly where it sits without one.
 *
 * Measured rather than hard-coded because the message can wrap to two lines
 * on a phone, and a countdown or link changes the height too.
 */
function BannerHeight({
  el,
  visible,
}: {
  el: React.RefObject<HTMLDivElement>;
  visible: boolean;
}) {
  useEffect(() => {
    const root = document.documentElement;
    const clear = () => root.style.setProperty("--banner-h", "0px");
    if (!visible) {
      clear();
      return clear;
    }
    const node = el.current;
    if (!node) {
      clear();
      return clear;
    }
    const apply = () => root.style.setProperty("--banner-h", `${node.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(node);
    window.addEventListener("resize", apply);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", apply);
      clear();
    };
  }, [el, visible]);

  return null;
}
