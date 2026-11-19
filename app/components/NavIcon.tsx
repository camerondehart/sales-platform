// Small line icons for the top navigation (same style as the gallery's account/cart icons).
export type NavIconName = "shop" | "events" | "pin" | "about" | "user" | "basket" | "gift" | "chart";

const PATHS: Record<NavIconName, JSX.Element> = {
  shop: (
    <>
      <path d="M5.5 8.5h13l-1 11h-11z" />
      <path d="M9 8.5V7a3 3 0 0 1 6 0v1.5" />
    </>
  ),
  events: (
    <>
      <rect x="4" y="5.5" width="16" height="14" rx="2" />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-6.5-6.1-6.5-11a6.5 6.5 0 0 1 13 0c0 4.9-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  about: (
    <>
      <path d="M5 19c9 0 14-5 14-14-9 0-14 5-14 14z" />
      <path d="M5 19l7-7" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
    </>
  ),
  gift: (
    <>
      <rect x="4" y="9" width="16" height="4" rx="1" />
      <path d="M5.5 13v7h13v-7M12 9v11" />
      <path d="M12 9c-1.2-3.2-5.2-4.3-5.2-1.6C6.8 9 10 9 12 9zM12 9c1.2-3.2 5.2-4.3 5.2-1.6C17.2 9 14 9 12 9z" />
    </>
  ),
  chart: (
    <>
      <path d="M4.5 19.5h15" />
      <path d="M7 16v-4M11 16V8M15 16v-6M19 16V5" />
    </>
  ),
  basket: (
    <>
      <path d="M4.5 9.5h15l-1.6 9.5H6.1z" />
      <path d="M9 9.5 12 3.5l3 6" />
      <path d="M9.5 13v3M14.5 13v3" />
    </>
  ),
};

export default function NavIcon({ name }: { name: NavIconName }) {
  return (
    <svg className="line-icon nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
