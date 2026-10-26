import { brand } from "@/lib/brand";
// A tiny footer on every page: the usual links, the Terms, and a quiet sign-off.
export default function SiteFooter() {
  const year = new Intl.DateTimeFormat("en-US", { timeZone: brand.timezone, year: "numeric" }).format(new Date());
  return (
    <footer className="site-foot">
      <nav className="site-foot-links" aria-label="Footer">
        <span>© {year} {brand.legalName}</span>
        <a href="/retail">Shop</a>
        <a href="/events">Events</a>
        <a href="/about">About</a>
        <a href="/terms">Terms</a>
        <a href={`mailto:${brand.supportEmail}`}>Contact</a>
      </nav>
      {brand.city && (
        <div className="site-foot-made">
          Site made with <span className="site-foot-heart" aria-label="love">♥</span> in {brand.city}
        </div>
      )}
    </footer>
  );
}
