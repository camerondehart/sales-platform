import type { ReactNode } from "react";
import { AskAssistantLink } from "./assistant/AskAssistant";
import NavIcon, { type NavIconName } from "./NavIcon";

// Top navigation for the public pages (Shop, Events, About, Terms, Find us):
// one look everywhere, the current page marked, and "Find us in stores" only
// while the Store locator switch is on. Extra buttons (the cart) go in children.

export type NavKey = "shop" | "events" | "stores" | "about";

export default function SiteNav({
  current,
  stores,
  concierge = false,
  children,
}: {
  current?: NavKey;
  /** The Store locator switch is on. */
  stores: boolean;
  /** Show "Ask our Concierge" in the bar. */
  concierge?: boolean;
  children?: ReactNode;
}) {
  const items: Array<{ key: NavKey; href: string; label: string; short?: string; icon: NavIconName }> = [
    { key: "shop", href: "/retail", label: "Shop", icon: "shop" },
    { key: "events", href: "/events", label: "Events", icon: "events" },
    ...(stores ? [{ key: "stores" as const, href: "/stores", label: "Find us in stores", short: "Find us", icon: "pin" as const }] : []),
    { key: "about", href: "/about", label: "About", icon: "about" },
  ];
  return (
    <div className="masthead-meta site-nav-wrap">
      <nav className="site-nav" aria-label="Main">
        {items.map((i) => (
          <a
            key={i.key}
            href={i.href}
            className={`sn-item${i.key === "stores" ? " sn-stores" : ""}${current === i.key ? " is-current" : ""}`}
            aria-current={current === i.key ? "page" : undefined}
          >
            <NavIcon name={i.icon} />
            {i.short ? (
              <>
                <em className="nl-long">{i.label}</em>
                <em className="nl-short">{i.short}</em>
              </>
            ) : (
              <em>{i.label}</em>
            )}
          </a>
        ))}
        {concierge && <AskAssistantLink className="sn-item sn-ask" label="Ask our Concierge" shortLabel="Ask" />}
      </nav>
      <a href="/" className="sn-signin">
        <NavIcon name="user" />
        <em>Member sign in</em>
      </a>
      {children}
    </div>
  );
}
