/**
 * Cookie-free visitor counters — the browser side.
 *
 * What's sent: an event name plus a few non-personal details (the page path,
 * a product id, the referring site's domain, phone/tablet/desktop). No
 * cookies, no IP storage, no names or emails, nothing that identifies a person.
 *
 * Funnel steps ("viewed a product", "added to cart", …) are sent at most once
 * per browser tab session (sessionStorage), so the server's counts are
 * "sessions that reached this step" without ever tracking who they were.
 *
 * Respects Global Privacy Control and Do Not Track: if either is on, nothing
 * is sent at all.
 *
 * Client-only module.
 */

export type TrackEvent =
  | "visit"
  | "page"
  | "product_view"
  | "add_to_cart"
  | "cart_open"
  | "checkout_open"
  | "order_placed"
  | "assistant_open"
  | "assistant_add"
  | "join_request"
  | "subscribe"
  | "category"
  | "event_signup";

/**
 * Funnel steps. Every occurrence is counted (so per-product numbers are
 * right), and the FIRST one in a session is flagged so the server can also
 * count "sessions that got this far" for the funnel.
 */
const FUNNEL: TrackEvent[] = ["product_view", "add_to_cart", "cart_open", "checkout_open", "order_placed", "assistant_open"];

function optedOut(): boolean {
  if (typeof navigator === "undefined") return true;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; doNotTrack?: string };
  return nav.globalPrivacyControl === true || nav.doNotTrack === "1" || (window as unknown as { doNotTrack?: string }).doNotTrack === "1";
}

function ss(key: string, value?: string): string | null {
  try {
    if (value !== undefined) sessionStorage.setItem(key, value);
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

/** The campaign that brought this visitor (from ?utm_campaign=…), for sales attribution. */
export function sessionCampaign(): string | undefined {
  return ss("fp_t_campaign") || undefined;
}

export function track(name: TrackEvent, props: Record<string, string | number | undefined> = {}): void {
  try {
    if (typeof window === "undefined" || optedOut()) return;
    const path = window.location.pathname;
    if (path.startsWith("/admin") || path.startsWith("/help")) return; // staff pages aren't traffic
    let first: string | undefined;
    if (FUNNEL.includes(name)) {
      const k = `fp_t_${name}`;
      if (!ss(k)) {
        ss(k, "1");
        first = "1";
      }
    }
    const body = JSON.stringify({ e: name, p: { ...props, first } });
    const url = "/api/t";
    if (navigator.sendBeacon) navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
    else void fetch(url, { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true });
  } catch {
    /* analytics must never break the page */
  }
}

/** Call on every page load/navigation. Sends "visit" once per session, then "page". */
export function trackPage(): void {
  if (typeof window === "undefined" || optedOut()) return;
  const path = window.location.pathname;
  if (path.startsWith("/admin") || path.startsWith("/help")) return;
  if (!ss("fp_t_visit")) {
    ss("fp_t_visit", "1");
    const params = new URLSearchParams(window.location.search);
    const campaign = (params.get("utm_campaign") || "").slice(0, 60);
    if (campaign) ss("fp_t_campaign", campaign);
    let ref = "";
    try {
      const r = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, "") : "";
      if (r && r !== window.location.hostname.replace(/^www\./, "")) ref = r;
    } catch {
      /* ignore */
    }
    const w = window.innerWidth;
    const device = /Mobi|Android|iPhone/i.test(navigator.userAgent) || w < 640 ? "phone" : w < 1024 ? "tablet" : "desktop";
    track("visit", { path, ref: ref || (params.get("utm_source") || "").slice(0, 40) || undefined, device, campaign: campaign || undefined });
  }
  track("page", { path });
}
