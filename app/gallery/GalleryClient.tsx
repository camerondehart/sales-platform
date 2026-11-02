"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import NavIcon from "@/app/components/NavIcon";
import ForestEntrance from "@/app/components/ForestEntrance";
import { ambassadorRef } from "@/lib/ambassadorRef";
import { useRouter } from "next/navigation";
import type { Product } from "@/lib/storage";
import { parsePrice, effectivePrice, promoLabel, asCash } from "@/lib/pricing";
import { priceCart, nextBundleHint, type Bundle } from "@/lib/bundles";
import { ProductFlags, PriceTag, RestockNote } from "@/app/components/ProductPrice";
import FormattedDescription from "@/app/components/FormattedDescription";
import ProductVideo, { useProductDeepLink } from "@/app/components/ProductVideo";
import { useChatShopBridge } from "@/app/components/assistant/shopBridge";
import { track, sessionCampaign } from "@/lib/track";
import { AskAboutProduct, AskAssistantLink } from "@/app/components/assistant/AskAssistant";
import { brand } from "@/lib/brand";
import StoreHint from "@/app/components/StoreHint";
import { FaceIdDevices, FaceIdIcon, FaceIdPrompt, useFaceIdPrompt } from "@/app/components/MemberFaceId";

// ------------------------------------------------------------------
// Cart — persisted in localStorage so it survives refreshes.
// ------------------------------------------------------------------
type CartItem = { productId: string; quantity: number };

type MemberOrder = {
  id: string;
  shortId: string;
  items: Array<{ productName: string; price: string; quantity: number }>;
  shippingMethod: "ship" | "pickup";
  shippingCost: number;
  subtotal: number;
  discount: number;
  total: number;
  status: "inquiry" | "pending" | "paid" | "completed" | "shipped" | "picked-up" | "cancelled";
  isInquiry: boolean;
  createdAt: number;
  trackingNumber: string | null;
  paymentMethod: "invoice" | "cash";
  paymentToken: string | null;
};

// Inline line-art icons — stroke-based so they inherit text color
function Icon({ name }: { name: "orders" | "address" | "key" | "signout" | "basket" | "user" }) {
  const paths: Record<string, React.ReactNode> = {
    user: (
      <>
        <circle cx="12" cy="8.5" r="3.6" />
        <path d="M5 20c.9-3.6 3.7-5.6 7-5.6s6.1 2 7 5.6" />
      </>
    ),
    orders: (
      <>
        <path d="M6.5 3.5h11v17l-2.2-1.6-2.1 1.6-2.2-1.6-2.1 1.6-2.4-1.6z" />
        <path d="M9.5 8.5h5M9.5 12h5" />
      </>
    ),
    address: (
      <>
        <path d="M12 20.5s-6-5.1-6-9.7a6 6 0 1 1 12 0c0 4.6-6 9.7-6 9.7z" />
        <circle cx="12" cy="10.6" r="2.1" />
      </>
    ),
    key: (
      <>
        <circle cx="8" cy="12" r="3.2" />
        <path d="M11.2 12h9M17.5 12v3M20.2 12v2.2" />
      </>
    ),
    signout: (
      <>
        <path d="M13 4.5H5.5v15H13" />
        <path d="M10.5 12h9.5M17 9l3 3-3 3" />
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
  return (
    <svg
      className="line-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

// Subset of site settings the storefront needs
type SiteSettingsLite = {
  bundleRuleEnabled: boolean;
  bundleRuleMinItems: number;
  bundleRulePercent: number;
  loyaltyEnabled: boolean;
  pointsPerDollar: number;
  pointsPerDollarRedeemed: number;
  minPointsToRedeem: number;
};

const MEMBER_STATUS_LABELS: Record<MemberOrder["status"], string> = {
  inquiry: "Inquiry sent",
  pending: "Awaiting payment",
  paid: "Paid",
  completed: "Completed",
  shipped: "Completed",
  "picked-up": "Completed",
  cancelled: "Cancelled",
};
const CART_KEY = "collective_cart_v1";

function loadCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((i) => i?.productId && i.quantity > 0) : [];
  } catch {
    return [];
  }
}

// ---- Pricing helpers: MUST mirror lib/storage.ts (server is authoritative) ----
const SHIPPING_FLAT = 10;

export default function GalleryClient({
  products,
  userName,
  userEmail,
  isAdminPreview = false,
  actingAs,
  stores = false,
  faceId = false,
  consult = false,
}: {
  products: Product[];
  userName: string;
  userEmail: string;
  isAdminPreview?: boolean;
  /** Staff "Log in as": who's acting (their email, or "admin"). */
  actingAs?: string;
  /** Store locator switch is on: show "Find us in stores". */
  stores?: boolean;
  /** member_passkeys switch: Face ID popup after sign-in + Account → Face ID. */
  faceId?: boolean;
  /** consultation_form switch: the Phone Consultation footnote links to /consultation. */
  consult?: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Product | null>(null);
  // Printed product QR codes land here as ?product=<id>.
  useProductDeepLink(products, setSelected);
  useEffect(() => {
    if (selected) track("product_view", { id: selected.id });
  }, [selected]);

  // Cart state
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  useEffect(() => {
    if (cartOpen) track("cart_open");
  }, [cartOpen]);
  useEffect(() => {
    if (checkoutOpen) track("checkout_open", { shop: "member" });
  }, [checkoutOpen]);
  const [justAdded, setJustAdded] = useState<string | null>(null);

  // Password modal state
  const [pwOpen, setPwOpen] = useState(false);
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwSubmitting, setPwSubmitting] = useState(false);
  const [pwMsg, setPwMsg] = useState("");
  const [pwSuccess, setPwSuccess] = useState(false);

  // Account dropdown + order history
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [myOrders, setMyOrders] = useState<MemberOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  async function openOrders() {
    setMenuOpen(false);
    setOrdersOpen(true);
    setOrdersLoading(true);
    try {
      const res = await fetch("/api/account/orders");
      if (res.ok) {
        const data = await res.json();
        setMyOrders(data.orders);
      }
    } catch {}
    setOrdersLoading(false);
  }

  // Address state (shared with checkout prefill)
  const [addressOpen, setAddressOpen] = useState(false);
  const [addressLoading, setAddressLoading] = useState(false);
  const [addressMsg, setAddressMsg] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");

  // Forest entrance — plays once per session, right after sign-in
  const [entering, setEntering] = useState(false);
  const [arrived, setArrived] = useState(false);
  useEffect(() => {
    if (isAdminPreview) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduced && !sessionStorage.getItem("fp_entered")) {
      sessionStorage.setItem("fp_entered", "1");
      setEntering(true);
      // The trees part by 2s; the scene fades from 3.25s, the gallery
      // sharpens underneath, and the overlay unmounts at 4s.
      const t1 = setTimeout(() => setArrived(true), 3000);
      const t2 = setTimeout(() => setEntering(false), 4000);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [isAdminPreview]);

  // Face ID: offer it once the entrance has played (never to staff "Log in as" or previews).
  const [settled, setSettled] = useState(false);
  useEffect(() => setSettled(true), []);
  const faceIdOn = faceId && !isAdminPreview && !actingAs;
  const faceIdPrompt = useFaceIdPrompt({ email: userEmail, enabled: faceIdOn, ready: settled && !entering });
  const [faceIdOpen, setFaceIdOpen] = useState(false);

  // Lock body scroll while any modal or the cart drawer is open,
  // so scrolling stays inside the overlay content.
  const anyOverlayOpen =
    !!selected || cartOpen || checkoutOpen || pwOpen || addressOpen || ordersOpen;
  useEffect(() => {
    if (anyOverlayOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = prev; };
    }
  }, [anyOverlayOpen]);

  // Loyalty
  const [loyalty, setLoyalty] = useState<null | {
    enabled: boolean;
    points: number;
    dollarValue: number;
    pointsPerDollar: number;
    pointsPerDollarRedeemed: number;
    minPointsToRedeem: number;
    history: Array<{ amount: number; reason: string; date: number }>;
  }>(null);
  const [loyaltyOpen, setLoyaltyOpen] = useState(false);

  const loadLoyalty = useCallback(() => {
    if (isAdminPreview) return;
    fetch("/api/account/loyalty")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setLoyalty(d.loyalty);
      })
      .catch(() => {});
  }, [isAdminPreview]);
  useEffect(() => { loadLoyalty(); }, [loadLoyalty]);

  // Site settings (bundle rule, loyalty config)
  const [settings, setSettings] = useState<SiteSettingsLite | null>(null);
  useEffect(() => {
    fetch("/api/admin/settings")
      .then((r) => r.json())
      .then((d) => setSettings(d.settings))
      .catch(() => {});
  }, []);
  // Mix-and-match bundles (empty unless switched on)
  const [bundles, setBundles] = useState<Bundle[]>([]);
  useEffect(() => {
    fetch("/api/bundles", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { bundles: [] }))
      .then((d) => setBundles(d.bundles || []))
      .catch(() => {});
  }, []);

  // Load cart + saved address on mount
  useEffect(() => {
    setCart(loadCart());
    if (!isAdminPreview) {
      fetch("/api/account/address")
        .then((res) => res.json())
        .then((data) => {
          if (data.addressLine1 || data.city) {
            setAddressLine1(data.addressLine1 || "");
            setAddressLine2(data.addressLine2 || "");
            setCity(data.city || "");
            setState(data.state || "");
            setPostalCode(data.postalCode || "");
          }
        })
        .catch(() => {});
    }
  }, [isAdminPreview]);

  const persistCart = useCallback((next: CartItem[]) => {
    setCart(next);
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(next));
    } catch {}
  }, []);

  function addToCart(productId: string, quantity = 1) {
    track("add_to_cart", { id: productId });
    const next = [...cart];
    const existing = next.find((i) => i.productId === productId);
    if (existing) existing.quantity += quantity;
    else next.push({ productId, quantity });
    persistCart(next);
    setJustAdded(productId);
    setTimeout(() => setJustAdded(null), 1200);
  }

  // The Concierge's product cards add to this cart and open these pop-ups.
  useChatShopBridge({
    shop: "members",
    products: isAdminPreview ? [] : products,
    add: (id) => addToCart(id),
    view: (p) => setSelected(p),
    openCart: () => setCartOpen(true),
  });

  function setQuantity(productId: string, quantity: number) {
    if (quantity < 1) return removeFromCart(productId);
    persistCart(cart.map((i) => (i.productId === productId ? { ...i, quantity } : i)));
  }

  function removeFromCart(productId: string) {
    persistCart(cart.filter((i) => i.productId !== productId));
  }

  function clearCart() {
    persistCart([]);
  }

  // Category filter — derived from product data, so new categories
  // added in the admin appear here automatically. Bundles pinned last.
  const [activeCat, setActiveCat] = useState<string>("all");

  // Phone layout: two per row by default, one per row if they prefer bigger
  // photos. Remembered between visits.
  const [oneUp, setOneUp] = useState(false);
  useEffect(() => {
    try {
      setOneUp(localStorage.getItem("collective_grid_oneup") === "1");
    } catch {}
  }, []);
  function toggleOneUp() {
    setOneUp((v) => {
      const next = !v;
      try {
        localStorage.setItem("collective_grid_oneup", next ? "1" : "0");
      } catch {}
      return next;
    });
  }
  const categories = useMemo(() => {
    const map = new Map<string, string>();
    products.forEach((p) => {
      const c = p.category?.trim();
      if (c) map.set(c.toLowerCase(), c);
    });
    const arr = Array.from(map.values()).sort((a, b) => a.localeCompare(b));
    const bi = arr.findIndex((c) => /bundle/i.test(c));
    if (bi >= 0) arr.push(arr.splice(bi, 1)[0]);
    return arr;
  }, [products]);
  const hasUncategorized = useMemo(
    () => categories.length > 0 && products.some((p) => !p.category?.trim()),
    [categories, products]
  );
  const visibleProducts = useMemo(() => {
    if (activeCat === "all") return products;
    if (activeCat === "__other") return products.filter((p) => !p.category?.trim());
    return products.filter((p) => p.category?.trim().toLowerCase() === activeCat);
  }, [products, activeCat]);

  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const cartDetailed = useMemo(
    () =>
      cart
        .map((i) => ({ ...i, product: productMap.get(i.productId) }))
        .filter((i): i is CartItem & { product: Product } => !!i.product),
    [cart, productMap]
  );
  const cartCount = cartDetailed.reduce((n, i) => n + i.quantity, 0);
  const subtotal = cartDetailed.reduce((n, i) => n + parsePrice(effectivePrice(i.product)) * i.quantity, 0);
  // BOGO + bundles for the drawer (the cart-wide rule is shown at checkout).
  const cartPriced = useMemo(() => priceCart(cartDetailed, bundles, null), [cartDetailed, bundles]);
  const cartDiscount = cartPriced.discount;
  const bundleHint = useMemo(
    () => nextBundleHint(cartDetailed, bundles, new Map(products.map((p) => [p.id, p.name]))),
    [cartDetailed, bundles, products]
  );

  async function handleLogout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  function openPwModal() {
    setPwOpen(true);
    setPwCurrent("");
    setPwNew("");
    setPwConfirm("");
    setPwMsg("");
    setPwSuccess(false);
  }

  async function submitPwChange(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg("");
    if (pwNew !== pwConfirm) {
      setPwMsg("Your new passwords don't match.");
      return;
    }
    setPwSubmitting(true);
    const res = await fetch("/api/account/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: pwCurrent, newPassword: pwNew }),
    });
    setPwSubmitting(false);
    if (res.ok) {
      setPwSuccess(true);
      setPwMsg("Password updated. You'll use the new one next time you sign in.");
      setPwCurrent("");
      setPwNew("");
      setPwConfirm("");
    } else {
      const data = await res.json().catch(() => ({}));
      setPwMsg(data.error || "Something went wrong. Please try again.");
    }
  }

  async function submitAddress(e: React.FormEvent) {
    e.preventDefault();
    setAddressLoading(true);
    setAddressMsg("");
    const res = await fetch("/api/account/address", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addressLine1, addressLine2, city, state, postalCode }),
    });
    if (res.ok) {
      setAddressMsg("Address saved.");
      setTimeout(() => setAddressMsg(""), 2000);
      setTimeout(() => setAddressOpen(false), 1500);
    } else {
      setAddressMsg("Failed to save address.");
    }
    setAddressLoading(false);
  }

  return (
    <>
      {/* Entrance: the forest is brushed aside (app/components/ForestEntrance.tsx). Tap skips it. "plain" decor skips it. */}
      {entering && brand.decor === "meadow" && <ForestEntrance onSkip={() => { setArrived(true); setEntering(false); }} />}

      {actingAs && (
        <div className="admin-preview-bar act-as-bar">
          <div>
            <strong>Signed in as {userName}</strong> ({userEmail}) — you&apos;re using their account from the dashboard. Anything you do here, including orders, is done as them and noted as placed by staff. Ends within an hour.
          </div>
          <button
            type="button"
            onClick={async () => {
              await fetch("/api/admin/users/login-as", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "end" }) }).catch(() => {});
              window.location.href = "/admin";
            }}
          >
            ← Back to admin
          </button>
        </div>
      )}
      {isAdminPreview && (
        <div className="admin-preview-bar">
          <div>
            <strong>Admin preview mode</strong> — You're viewing the gallery as your customers see it. Orders can't be placed in this mode.
          </div>
          <a href="/admin">← Back to admin</a>
        </div>
      )}
      <div className={`shell${arrived ? " shell-arrive" : ""}`}>
        <header className="masthead gallery-masthead">
          <a className="masthead-brand" href="/gallery" aria-label={`${brand.members} home`}>
            <div className="logo-mark floaty" aria-hidden="true">
              <span></span>
              <span></span>
              <span></span>
              <span></span>
            </div>
            <h1 className="masthead-title">{brand.members}</h1>
          </a>
          <div className="masthead-meta">
            <nav className="masthead-nav" aria-label="Other pages">
              <a href="/events" className="nav-pill">
                <NavIcon name="events" /> <em>Events</em>
              </a>
              <a href="/retail" className="nav-pill">
                <NavIcon name="shop" /> <em className="nl-long">Shop</em>
                <em className="nl-short">Shop</em>
              </a>
              {stores && (
                <a href="/stores" className="nav-pill sn-stores">
                  <NavIcon name="pin" /> <em className="nl-long">Find us in stores</em>
                  <em className="nl-short">Find us</em>
                </a>
              )}
              <AskAssistantLink className="nav-pill ask-nav" label="Ask our Concierge" shortLabel="Concierge" />
            </nav>
            <div className="masthead-welcome">Welcome, {userName.split(" ")[0]}</div>
            {!isAdminPreview ? (
              <div className="account-menu" ref={menuRef}>
                <button
                  className="account-trigger"
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-expanded={menuOpen}
                >
                  <Icon name="user" />
                  <span className="acct-label">Account</span> <span className={`account-caret ${menuOpen ? "open" : ""}`}>▾</span>
                </button>
                {menuOpen && (
                  <div className="account-dropdown">
                    <div className="account-dropdown-head">
                      <div className="account-dropdown-name">{userName}</div>
                      <div className="account-dropdown-email">{userEmail}</div>
                    </div>
                    <button onClick={openOrders}>
                      <Icon name="orders" /> My orders
                    </button>
                    {loyalty?.enabled && (
                      <button onClick={() => { setMenuOpen(false); setLoyaltyOpen(true); }}>
                        <Icon name="orders" /> Points &amp; rewards
                        <span style={{ marginLeft: "auto", fontWeight: 700, color: "var(--accent-strong)" }}>
                          {loyalty.points}
                        </span>
                      </button>
                    )}
                    <button onClick={() => { setMenuOpen(false); setAddressOpen(true); }}>
                      <Icon name="address" /> Shipping address
                    </button>
                    <button onClick={() => { setMenuOpen(false); openPwModal(); }}>
                      <Icon name="key" /> Change password
                    </button>
                    {faceIdOn && (
                      <button onClick={() => { setMenuOpen(false); setFaceIdOpen(true); }}>
                        <FaceIdIcon unlock="Face ID" size={18} /> Face ID &amp; Touch ID
                      </button>
                    )}
                    <div className="account-dropdown-rule" />
                    <button className="account-signout" onClick={handleLogout}>
                      <Icon name="signout" /> Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button onClick={handleLogout}>Sign out</button>
            )}
            <button
              className="cart-button"
              onClick={() => setCartOpen(true)}
              aria-label={`Open cart, ${cartCount} items`}
            >
              <Icon name="basket" /> <span className="cart-label">Cart</span>
              {cartCount > 0 && <span className="cart-count">{cartCount}</span>}
            </button>
          </div>
        </header>

        {/* Phone controls: a dropdown beats a wrapping row of pills on a
            narrow screen, plus a one-up / two-up layout choice. */}
        <div className="shop-controls">
          {categories.length > 0 && (
            <div className="shop-select">
              <select
                value={activeCat}
                onChange={(e) => setActiveCat(e.target.value)}
                aria-label="Filter by category"
              >
                <option value="all">All products ({products.length})</option>
                {categories.map((c) => {
                  const key = c.toLowerCase();
                  const n = products.filter(
                    (p) => p.category?.trim().toLowerCase() === key
                  ).length;
                  return (
                    <option key={c} value={key}>
                      {c} ({n})
                    </option>
                  );
                })}
                {hasUncategorized && (
                  <option value="__other">
                    Other ({products.filter((p) => !p.category?.trim()).length})
                  </option>
                )}
              </select>
            </div>
          )}
          <button
            type="button"
            className="grid-toggle"
            onClick={toggleOneUp}
            aria-pressed={oneUp}
            title={oneUp ? "Show two per row" : "Show one per row"}
          >
            <span aria-hidden="true">{oneUp ? "▤" : "▦"}</span>
            <span className="sr-only">
              {oneUp ? "Switch to two per row" : "Switch to one per row"}
            </span>
          </button>
        </div>

        {/* Category filter pills */}
        {categories.length > 0 && (
          <div className="cat-filter">
            <button
              className={`cat-pill ${activeCat === "all" ? "active" : ""}`}
              onClick={() => setActiveCat("all")}
            >
              All
            </button>
            {categories.map((c) => (
              <button
                key={c}
                className={`cat-pill ${/bundle/i.test(c) ? "bundle" : ""} ${activeCat === c.toLowerCase() ? "active" : ""}`}
                onClick={() => setActiveCat(c.toLowerCase())}
              >
                {c}
              </button>
            ))}
            {hasUncategorized && (
              <button
                className={`cat-pill ${activeCat === "__other" ? "active" : ""}`}
                onClick={() => setActiveCat("__other")}
              >
                Other
              </button>
            )}
          </div>
        )}

        {products.length === 0 ? (
          <div className="empty">
            New offerings are on the way. Thank you for your patience.
          </div>
        ) : visibleProducts.length === 0 ? (
          <div className="empty">Nothing here just yet — check back soon.</div>
        ) : (
          <div className={`grid${oneUp ? " grid-one-up" : ""}`} key={activeCat}>
            {visibleProducts.map((p, idx) => (
              <article
                key={p.id}
                className="card fade-rise"
                style={{ animationDelay: `${Math.min(idx * 60, 480)}ms` }}
              >
                <div className="card-image" onClick={() => setSelected(p)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.image} alt={p.name} loading="lazy" />
                  <ProductFlags product={p} />
                  {p.video && <span className="card-video-chip">▶ Video</span>}
                </div>
                <div className="card-meta" onClick={() => setSelected(p)}>
                  <div>
                    <div className="card-name">{p.name}</div>
                    {p.category && <div className="card-category">{p.category}</div>}
                  </div>
                  <PriceTag product={p} />
                </div>
                <button
                  className={`card-add ${justAdded === p.id ? "added" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    addToCart(p.id);
                  }}
                >
                  {justAdded === p.id ? "✓ Added" : "Add to cart"}
                </button>
              </article>
            ))}
          </div>
        )}
        <footer className="footnotes">
          <div className="footnotes-ornament" aria-hidden="true">
            <span></span><span>{brand.emoji}</span><span></span>
          </div>
          <div className="footnotes-grid">
            <a className="footnote footnote-link" href="/events">
              <div className="footnote-icon" aria-hidden="true">🎟</div>
              <div className="footnote-title">Classes &amp; Events</div>
              <p>
                Workshops, classes, and vendor events. Reserve a spot or join a
                waitlist.
              </p>
              <span className="footnote-cta">See what&rsquo;s coming up&nbsp;→</span>
            </a>
            <a className="footnote footnote-link" href="/retail">
              <div className="footnote-icon" aria-hidden="true">🛍</div>
              <div className="footnote-title">Public shop</div>
              <p>
                Our public shop of {brand.productsPhrase}. Open to everyone, so
                it&rsquo;s easy to share with a friend.
              </p>
              <span className="footnote-cta">Browse the shop&nbsp;→</span>
            </a>
            <div className="footnote">
              <div className="footnote-icon" aria-hidden="true">📦</div>
              <div className="footnote-title">Shipping &amp; Pickup</div>
              <p>
                {brand.shippingNote} Free local pickup at checkout.
                For bulk discounts or retail options, reach us at{" "}
                <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>.
              </p>
            </div>
            {consult ? (
              <div className="footnote">
                <div className="footnote-icon" aria-hidden="true">🌿</div>
                <div className="footnote-title">Phone Consultation</div>
                <p>
                  Want personalized guidance?{" "}
                  <a href="/consultation">Book a free phone consultation</a>{" "}
                  and we'll be in touch.
                </p>
              </div>
            ) : brand.consultationFormUrl ? (
              <div className="footnote">
                <div className="footnote-icon" aria-hidden="true">🌿</div>
                <div className="footnote-title">Consultation</div>
                <p>
                  Want personalized guidance?{" "}
                  <a href={brand.consultationFormUrl} target="_blank" rel="noopener noreferrer">
                    Fill out our consultation form
                  </a>{" "}
                  and we'll be in touch.
                </p>
              </div>
            ) : null}
          </div>
        </footer>
      </div>

      {/* Floating cart pill for mobile / scrolled state */}
      {cartCount > 0 && !cartOpen && !checkoutOpen && (
        <button className="cart-fab" onClick={() => setCartOpen(true)}>
          <Icon name="basket" /> {cartCount} · ${subtotal.toFixed(2)}
        </button>
      )}

      {/* Quick view modal */}
      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ overflowX: "hidden" }}>
            <button className="modal-close" onClick={() => setSelected(null)} aria-label="Close">×</button>
            <div className="modal-image">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={selected.image} alt={selected.name} />
            </div>
            <div className="modal-body">
              <ProductVideo url={selected.video} title={selected.name} />
              <div>
                <h2 className="modal-name">{selected.name}</h2>
                {selected.category && (
                  <div className="card-category" style={{ marginTop: "0.5rem" }}>{selected.category}</div>
                )}
              </div>
              <div className="modal-price"><PriceTag product={selected} /></div>
              {promoLabel(selected) && (
                <div className="promo-callout">✨ {promoLabel(selected)}</div>
              )}
              <FormattedDescription text={selected.description} />
              <div className="divider" />
              <div className="shipping-reminder">
                Flat $10 shipping, or free local pickup — you'll choose at checkout.
              </div>
              <RestockNote product={selected} />
              <button
                className="submit"
                onClick={() => {
                  addToCart(selected.id);
                  setSelected(null);
                  setCartOpen(true);
                }}
              >
                Add to cart
              </button>
              <AskAboutProduct product={selected} onAsk={() => setSelected(null)} />
              <StoreHint productId={selected.id} />
            </div>
          </div>
        </div>
      )}

      {/* Cart drawer */}
      {cartOpen && (
        <div className="drawer-backdrop" onClick={() => setCartOpen(false)}>
          <aside className="cart-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="cart-drawer-head">
              <h2>Your basket</h2>
              <button className="history-close" style={{ position: "static" }} onClick={() => setCartOpen(false)} aria-label="Close">×</button>
            </div>
            {cartDetailed.length === 0 ? (
              <div className="empty" style={{ padding: "3rem 1rem" }}>
                Your basket is empty. Wander the gallery and gather what calls to you.
              </div>
            ) : (
              <>
                <div className="cart-items">
                  {cartDetailed.map(({ product, quantity }) => (
                    <div key={product.id} className="cart-item">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={product.image} alt={product.name} />
                      <div className="cart-item-info">
                        <div className="cart-item-name">{product.name}</div>
                        <div className="cart-item-price"><PriceTag product={product} /></div>
                        <RestockNote product={product} compact />
                        <div className="cart-item-qty">
                          <button onClick={() => setQuantity(product.id, quantity - 1)} aria-label="Decrease">−</button>
                          <span>{quantity}</span>
                          <button onClick={() => setQuantity(product.id, quantity + 1)} aria-label="Increase">+</button>
                          <button className="cart-item-remove" onClick={() => removeFromCart(product.id)}>Remove</button>
                        </div>
                      </div>
                      <div className="cart-item-total">${(parsePrice(effectivePrice(product)) * quantity).toFixed(2)}</div>
                    </div>
                  ))}
                </div>
                <div className="cart-drawer-foot">
                  {bundleHint && <div className="cart-bundle-hint">🌿 {bundleHint}</div>}
                  {cartPriced.bundles.map((b) => (
                    <div key={b.id} className="cart-subtotal" style={{ color: "var(--accent-strong)", fontSize: "0.9rem" }}>
                      <span>{b.name} bundle{b.sets > 1 ? ` ×${b.sets}` : ""}</span>
                      <strong>−${b.savings.toFixed(2)}</strong>
                    </div>
                  ))}
                  {cartPriced.promoSavings > 0 && (
                    <div className="cart-subtotal" style={{ color: "var(--accent-strong)", fontSize: "0.9rem" }}>
                      <span>Promo savings</span>
                      <strong>−${cartPriced.promoSavings.toFixed(2)}</strong>
                    </div>
                  )}
                  <div className="cart-subtotal">
                    <span>Subtotal</span>
                    <strong>${(subtotal - cartDiscount).toFixed(2)}</strong>
                  </div>
                  <div style={{ fontSize: "0.8rem", color: "var(--ink-soft)", marginBottom: "0.9rem" }}>
                    + $10 shipping, or free local pickup — chosen at checkout.
                  </div>
                  {isAdminPreview ? (
                    <div className="notice" style={{ fontSize: "0.85rem" }}>Checkout is disabled in admin preview.</div>
                  ) : (
                    <button
                      className="submit"
                      onClick={() => {
                        setCartOpen(false);
                        setCheckoutOpen(true);
                      }}
                    >
                      Checkout
                    </button>
                  )}
                </div>
              </>
            )}
          </aside>
        </div>
      )}

      {/* Checkout modal */}
      {checkoutOpen && (
        <CheckoutModal
          items={cartDetailed}
          subtotal={subtotal}
          discount={cartDiscount}
          bundles={bundles}
          settings={settings}
          loyalty={loyalty}
          onOrderPlaced={loadLoyalty}
          defaultAddress={{ addressLine1, addressLine2, city, state, postalCode }}
          onClose={() => setCheckoutOpen(false)}
          onComplete={() => clearCart()}
        />
      )}

      {/* Points & rewards modal */}
      {loyaltyOpen && loyalty && (
        <div className="history-backdrop" onClick={() => setLoyaltyOpen(false)}>
          <div className="history-modal" onClick={(e) => e.stopPropagation()}>
            <button className="history-close" onClick={() => setLoyaltyOpen(false)} aria-label="Close">×</button>
            <div className="history-header">
              <div className="history-kicker">Points &amp; Rewards</div>
              <h2 className="history-name">{userName}</h2>
              <div className="history-email">{userEmail}</div>
            </div>
            <div className="history-body">
              <div className="points-hero">
                <div className="points-value">{loyalty.points}</div>
                <div className="points-label">points</div>
                <div className="points-worth">worth ${loyalty.dollarValue.toFixed(2)} off your next order</div>
              </div>


              <div className="notice" style={{ fontSize: "0.85rem", margin: "1rem 0" }}>
                Earn {loyalty.pointsPerDollar} point{loyalty.pointsPerDollar === 1 ? "" : "s"} per $1 spent.
                {" "}{loyalty.pointsPerDollarRedeemed} points = $1 off.
                {loyalty.minPointsToRedeem > 0 && ` Redeem from ${loyalty.minPointsToRedeem} points at checkout.`}
              </div>

              {loyalty.history.length > 0 && (
                <>
                  <div className="history-count">Recent activity</div>
                  <div className="history-list">
                    {loyalty.history.map((h, i) => (
                      <div key={i} className="history-item" style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
                        <div>
                          <div className="history-product" style={{ fontSize: "0.92rem" }}>{h.reason}</div>
                          <div className="history-date">{new Date(h.date).toLocaleDateString("en-US", { timeZone: brand.timezone })}</div>
                        </div>
                        <div style={{ fontWeight: 700, color: h.amount >= 0 ? "var(--accent-strong)" : "var(--ink-soft)", whiteSpace: "nowrap" }}>
                          {h.amount >= 0 ? "+" : ""}{h.amount}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* My orders modal */}
      {ordersOpen && (
        <div className="history-backdrop" onClick={() => setOrdersOpen(false)}>
          <div className="history-modal" onClick={(e) => e.stopPropagation()}>
            <button className="history-close" onClick={() => setOrdersOpen(false)} aria-label="Close">×</button>
            <div className="history-header">
              <div className="history-kicker">My Orders</div>
              <h2 className="history-name">{userName}</h2>
              <div className="history-email">{userEmail}</div>
            </div>
            <div className="history-body">
              {ordersLoading ? (
                <div className="history-empty">Loading…</div>
              ) : myOrders.length === 0 ? (
                <div className="history-empty">No orders yet — your basket awaits. {brand.emoji}</div>
              ) : (
                <div className="my-orders">
                  {myOrders.map((o) => (
                    <div key={o.id} className="my-order">
                      <div className="my-order-top">
                        <span className={`my-order-status status-${o.status}`}>
                          {MEMBER_STATUS_LABELS[o.status]}
                        </span>
                        <span className="my-order-date">
                          {new Date(o.createdAt).toLocaleDateString("en-US", { timeZone: brand.timezone, month: "short", day: "numeric", year: "numeric" })}
                          {" · "}#{o.shortId}
                        </span>
                      </div>
                      <div className="my-order-items">
                        {o.items.map((i, idx) => (
                          <div key={idx} className="pay-item">
                            <span>{i.productName} ×&nbsp;{i.quantity}</span>
                            <span>{i.price}</span>
                          </div>
                        ))}
                        {o.discount > 0 && (
                          <div className="pay-item" style={{ color: "var(--accent-strong)" }}>
                            <span>Promo savings</span>
                            <span>−${o.discount.toFixed(2)}</span>
                          </div>
                        )}
                        {!o.isInquiry && (
                          <div className="pay-item pay-total">
                            <span>{o.shippingMethod === "pickup" ? "Total (pickup)" : "Total (incl. shipping)"}</span>
                            <span>${o.total.toFixed(2)}</span>
                          </div>
                        )}
                      </div>
                      {o.trackingNumber && (
                        <div className="my-order-note">📦 Tracking: {o.trackingNumber}</div>
                      )}
                      {o.status === "pending" && o.paymentToken && (
                        <a className="my-order-pay" href={`/pay/${o.paymentToken}`}>
                          {o.paymentMethod === "cash" && o.shippingMethod === "pickup"
                            ? "I picked up and paid cash →"
                            : "I've sent my payment →"}
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Password change modal */}
      {faceIdPrompt.show && !faceIdOpen && <FaceIdPrompt email={userEmail} onClose={faceIdPrompt.close} />}
      {faceIdOpen && (
        <div className="history-backdrop" onClick={() => setFaceIdOpen(false)}>
          <div className="history-modal" onClick={(e) => e.stopPropagation()}>
            <button className="history-close" onClick={() => setFaceIdOpen(false)} aria-label="Close">×</button>
            <div className="history-header">
              <div className="history-kicker">Face ID &amp; Touch ID</div>
              <h2 className="history-name">{userName}</h2>
              <div className="history-email">{userEmail}</div>
            </div>
            <div className="history-body">
              <FaceIdDevices email={userEmail} />
            </div>
          </div>
        </div>
      )}
      {pwOpen && (
        <div className="history-backdrop" onClick={() => setPwOpen(false)}>
          <div className="history-modal" onClick={(e) => e.stopPropagation()}>
            <button className="history-close" onClick={() => setPwOpen(false)} aria-label="Close">×</button>
            <div className="history-header">
              <div className="history-kicker">Change Password</div>
              <h2 className="history-name">{userName}</h2>
              <div className="history-email">{userEmail}</div>
            </div>
            <div className="history-body">
              <form onSubmit={submitPwChange} style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
                <div className="field">
                  <label>Current password</label>
                  <input type="password" value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} required autoFocus />
                </div>
                <div className="field">
                  <label>New password</label>
                  <input type="password" value={pwNew} onChange={(e) => setPwNew(e.target.value)} required minLength={8} />
                  <div style={{ fontSize: "0.78rem", color: "var(--ink-soft)", marginTop: "0.3rem" }}>At least 8 characters.</div>
                </div>
                <div className="field">
                  <label>Confirm new password</label>
                  <input type="password" value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)} required minLength={8} />
                </div>
                {!pwSuccess && (
                  <button type="submit" className="submit" disabled={pwSubmitting}>
                    {pwSubmitting ? "Updating…" : "Update password"}
                  </button>
                )}
                {pwMsg && (
                  <div style={{ padding: "0.85rem 1rem", background: pwSuccess ? "rgba(15,199,163,0.1)" : "rgba(200,97,100,0.1)", borderLeft: `3px solid ${pwSuccess ? "var(--mint)" : "var(--red)"}`, borderRadius: "0 4px 4px 0", fontSize: "0.92rem", color: "var(--ink)", lineHeight: 1.5 }}>
                    {pwMsg}
                  </div>
                )}
                {pwSuccess && (
                  <button type="button" className="submit" onClick={() => setPwOpen(false)}>Close</button>
                )}
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Address modal */}
      {addressOpen && (
        <div className="history-backdrop" onClick={() => setAddressOpen(false)}>
          <div className="history-modal" onClick={(e) => e.stopPropagation()}>
            <button className="history-close" onClick={() => setAddressOpen(false)} aria-label="Close">×</button>
            <div className="history-header">
              <div className="history-kicker">Shipping Address</div>
              <h2 className="history-name">{userName}</h2>
              <div className="history-email">{userEmail}</div>
            </div>
            <div className="history-body">
              <form onSubmit={submitAddress} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div className="field">
                  <label>Street address</label>
                  <input type="text" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} required />
                </div>
                <div className="field">
                  <label>Apt, suite, etc. (optional)</label>
                  <input type="text" value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} />
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <div className="field" style={{ flex: 2 }}>
                    <label>City</label>
                    <input type="text" value={city} onChange={(e) => setCity(e.target.value)} required />
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label>State</label>
                    <input type="text" value={state} onChange={(e) => setState(e.target.value)} required />
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label>ZIP</label>
                    <input type="text" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} required />
                  </div>
                </div>
                <div className="notice" style={{ fontSize: "0.85rem", margin: "0.5rem 0" }}>
                  <strong>Optional but recommended:</strong> saving your address pre-fills checkout.
                </div>
                <button type="submit" className="submit" disabled={addressLoading}>
                  {addressLoading ? "Saving…" : "Save address"}
                </button>
                {addressMsg && <div style={{ fontSize: "0.9rem", color: "var(--green)", textAlign: "center" }}>{addressMsg}</div>}
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ============================================================
// CheckoutModal — address, ship/pickup, note, inquiry flag
// ============================================================
function CheckoutModal({
  items: cartItems,
  bundles,
  settings,
  loyalty,
  onOrderPlaced,
  defaultAddress,
  onClose,
  onComplete,
}: {
  items: Array<CartItem & { product: Product }>;
  subtotal: number;
  discount: number;
  bundles: Bundle[];
  settings: SiteSettingsLite | null;
  loyalty: { enabled: boolean; points: number; pointsPerDollarRedeemed: number; minPointsToRedeem: number } | null;
  onOrderPlaced: () => void;
  defaultAddress: {
    addressLine1: string;
    addressLine2: string;
    city: string;
    state: string;
    postalCode: string;
  };
  onClose: () => void;
  onComplete: () => void;
}) {
  const [shippingMethod, setShippingMethod] = useState<"ship" | "pickup">("ship");
  const [paymentMethod, setPaymentMethod] = useState<"invoice" | "cash">("invoice");
  const [isInquiry, setIsInquiry] = useState(false);

  // Discount code
  const [codeInput, setCodeInput] = useState("");
  const [codeChecking, setCodeChecking] = useState(false);
  const [codeError, setCodeError] = useState("");
  const [applied, setApplied] = useState<null | { code: string; amount: number }>(null);
  // Came through an ambassador's page: their code is ready in the box (press Apply).
  useEffect(() => {
    const code = ambassadorRef()?.code;
    if (code) setCodeInput((v) => v || code);
  }, []);

  async function applyCode() {
    const code = codeInput.trim();
    if (!code) return;
    setCodeChecking(true);
    setCodeError("");
    try {
      const res = await fetch("/api/discounts/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, subtotal: Math.max(0, subtotal - discount - bundleSavings) }),
      });
      const data = await res.json();
      if (data.ok) {
        setApplied({ code: data.code, amount: data.amount });
        setCodeError("");
      } else {
        setApplied(null);
        setCodeError(data.error || "That code isn't valid.");
      }
    } catch {
      setCodeError("Could not check that code. Try again.");
    }
    setCodeChecking(false);
  }

  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [placed, setPlaced] = useState<null | {
    isInquiry: boolean;
    emailed: boolean;
    pickup: boolean;
    cash: boolean;
    total: number;
  }>(null);
  const [error, setError] = useState("");

  const [addressLine1, setAddressLine1] = useState(defaultAddress.addressLine1);
  const [addressLine2, setAddressLine2] = useState(defaultAddress.addressLine2);
  const [city, setCity] = useState(defaultAddress.city);
  const [state, setState] = useState(defaultAddress.state);
  const [postalCode, setPostalCode] = useState(defaultAddress.postalCode);

  // Cash-pickup-only sales apply once Local pickup + Cash at pickup is chosen (same as the server).
  const cash = shippingMethod === "pickup" && paymentMethod === "cash" && !isInquiry;
  const items = useMemo(() => (cash ? cartItems.map((i) => ({ ...i, product: asCash(i.product) })) : cartItems), [cartItems, cash]);
  const subtotal = items.reduce((n, i) => n + parsePrice(effectivePrice(i.product)) * i.quantity, 0);
  const hasCashDeals = cartItems.some((i) => i.product.cashOnly);
  const itemCount = items.reduce((n, i) => n + i.quantity, 0);
  // Same calculation the server charges (lib/bundles.ts).
  const priced = useMemo(
    () =>
      priceCart(
        items,
        isInquiry ? [] : bundles,
        !isInquiry && settings ? { enabled: settings.bundleRuleEnabled, minItems: settings.bundleRuleMinItems, percent: settings.bundleRulePercent } : null
      ),
    [items, bundles, settings, isInquiry]
  );
  const discount = Math.round((priced.promoSavings + priced.bundleSavings) * 100) / 100;
  // What paying cash at pickup would save on cash-only sales (shown until they choose it).
  const cashSaves = useMemo(() => {
    if (!hasCashDeals || cash || isInquiry) return 0;
    const rule = settings ? { enabled: settings.bundleRuleEnabled, minItems: settings.bundleRuleMinItems, percent: settings.bundleRulePercent } : null;
    const now = priceCart(cartItems, bundles, rule);
    const asCashCart = priceCart(cartItems.map((i) => ({ ...i, product: asCash(i.product) })), bundles, rule);
    return Math.round((now.subtotal - now.discount - (asCashCart.subtotal - asCashCart.discount)) * 100) / 100;
  }, [hasCashDeals, cash, isInquiry, cartItems, bundles, settings]);
  // A code's amount depends on the prices: check it again when cash deals switch on or off.
  const cashRef = useRef(cash);
  useEffect(() => {
    if (cashRef.current === cash) return;
    cashRef.current = cash;
    if (applied && hasCashDeals) applyCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cash]);
  const mixSavings = priced.bundleSavings;
  const bundleSavings = priced.ruleSavings; // the "buy N, save X%" rule
  // A bundle OR a discount code, never both.
  const codeSavings = isInquiry || mixSavings > 0 ? 0 : applied?.amount || 0;

  // Loyalty redemption
  const [redeemPoints, setRedeemPoints] = useState(0);
  const maxRedeemable = useMemo(() => {
    if (!loyalty?.enabled || isInquiry) return 0;
    const remaining = Math.max(0, subtotal - discount - bundleSavings - codeSavings);
    const pointsForRemaining = Math.floor(remaining * loyalty.pointsPerDollarRedeemed);
    return Math.min(loyalty.points, pointsForRemaining);
  }, [loyalty, isInquiry, subtotal, discount, bundleSavings, codeSavings]);
  const pointsCredit =
    loyalty && redeemPoints > 0
      ? Math.round((redeemPoints / loyalty.pointsPerDollarRedeemed) * 100) / 100
      : 0;

  const shippingCost =
    isInquiry ? 0 : shippingMethod === "ship" ? SHIPPING_FLAT : 0;
  const total = isInquiry
    ? 0
    : Math.max(0, subtotal - discount - bundleSavings - codeSavings - pointsCredit + shippingCost);
  const addressRequired = shippingMethod === "ship" && !isInquiry;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    // "Ask a question" — no order, no invoice: goes to the team, cart is kept.
    if (isInquiry) {
      try {
        if (!note.trim()) {
          setError("Type your question so we know how to help.");
          setSubmitting(false);
          return;
        }
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })), question: note.trim() }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
        setPlaced({ isInquiry: true, emailed: true, pickup: false, cash: false, total: 0 });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error. Please try again.");
      }
      setSubmitting(false);
      return;
    }
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
          shippingMethod,
          paymentMethod: shippingMethod === "pickup" ? paymentMethod : "invoice",
          discountCode: mixSavings > 0 ? undefined : applied?.code,
          redeemPoints: redeemPoints > 0 ? redeemPoints : undefined,
          note: note.trim() || undefined,
          address: { addressLine1, addressLine2, city, state, postalCode },
          ambassador: ambassadorRef(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }

      // The address is saved to the profile server-side inside /api/checkout.
      // Firing a second request from here raced that one and could undo the
      // loyalty points awarded during checkout.

      if (!isInquiry) track("order_placed", { value: total, shop: "member", campaign: sessionCampaign() });
      onComplete();
      onOrderPlaced(); // refresh points balance
      setPlaced({
        isInquiry,
        emailed: !!data.emailed,
        pickup: shippingMethod === "pickup",
        cash: shippingMethod === "pickup" && paymentMethod === "cash",
        total,
      });
    } catch {
      setError("Network error. Please try again.");
    }
    setSubmitting(false);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal checkout-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <div className="modal-body" style={{ width: "100%" }}>
          {placed ? (
            <div className="success fade-rise" style={{ textAlign: "center" }}>
              {placed.isInquiry ? (
                <>
                  Thank you — your question is with our team. 🌿
                  <div style={{ fontSize: "0.9rem", marginTop: "1rem", fontStyle: "normal", color: "var(--ink-soft)" }}>
                    We'll reply by email, usually within a business day. Your cart is still here whenever you're ready.
                  </div>
                </>
              ) : (
                <>
                  Thank you — your order has been placed! 🌿
                  <div style={{ fontSize: "0.9rem", marginTop: "1rem", fontStyle: "normal", color: "var(--ink-soft)" }}>
                    {placed.cash
                      ? `No payment needed now — just bring $${placed.total.toFixed(2)} in cash when you pick up. A confirmation with pickup details is on its way to your inbox, along with a button to tap once you've collected it.`
                      : placed.emailed
                      ? "An invoice with payment instructions is on its way to your inbox. Once you've paid, use the link in the email to let us know."
                      : "We've received your order and will email you an invoice with payment instructions shortly."}
                  </div>
                </>
              )}

              {placed.pickup && !placed.isInquiry && (
                <div className="pickup-instructions">
                  <div className="pickup-title">How to pick up your order</div>
                  <div className="pickup-row">
                    <span>Pick-up address</span>
                    <strong>{brand.pickup.address}</strong>
                  </div>
                  <div className="pickup-row">
                    <span>Where to go</span>
                    <span>{brand.pickup.where}</span>
                  </div>
                  {brand.pickup.notes.length > 0 && (
                    <>
                      <div className="pickup-sub">A few notes to make it easy:</div>
                      <ul>
                        {brand.pickup.notes.map((n) => <li key={n}>{n}</li>)}
                      </ul>
                    </>
                  )}
                  <p className="pickup-thanks">Thanks so much for supporting {brand.name} — we appreciate you! {brand.emoji}</p>
                </div>
              )}

              <button className="submit" style={{ marginTop: "1.5rem" }} onClick={onClose}>Back to gallery</button>
            </div>
          ) : (
            <>
              <h2 className="modal-name" style={{ fontSize: "1.7rem" }}>Checkout</h2>

              <div className="checkout-summary">
                {items.map(({ product, quantity }) => (
                  <div key={product.id} className="pay-item">
                    <span>{product.name} ×&nbsp;{quantity}</span>
                    <span>${(parsePrice(effectivePrice(product)) * quantity).toFixed(2)}</span>
                  </div>
                ))}
                {!isInquiry && priced.bundles.map((b) => (
                  <div key={b.id} className="pay-item" style={{ color: "var(--accent-strong)" }}>
                    <span>{b.name} bundle{b.sets > 1 ? ` ×${b.sets}` : ""}</span>
                    <span>−${b.savings.toFixed(2)}</span>
                  </div>
                ))}
                {priced.promoSavings > 0 && (
                  <div className="pay-item" style={{ color: "var(--accent-strong)" }}>
                    <span>Promo savings</span>
                    <span>−${priced.promoSavings.toFixed(2)}</span>
                  </div>
                )}
                {bundleSavings > 0 && (
                  <div className="pay-item" style={{ color: "var(--accent-strong)" }}>
                    <span>Bundle &amp; save ({settings?.bundleRulePercent}% off {priced.ruleItems} items)</span>
                    <span>−${bundleSavings.toFixed(2)}</span>
                  </div>
                )}
                {codeSavings > 0 && applied && (
                  <div className="pay-item" style={{ color: "var(--accent-strong)" }}>
                    <span>Code {applied.code}</span>
                    <span>−${codeSavings.toFixed(2)}</span>
                  </div>
                )}
                {pointsCredit > 0 && (
                  <div className="pay-item" style={{ color: "var(--accent-strong)" }}>
                    <span>{redeemPoints} points redeemed</span>
                    <span>−${pointsCredit.toFixed(2)}</span>
                  </div>
                )}
                <div className="pay-item">
                  <span>
                    {shippingMethod === "pickup" || isInquiry ? "Shipping" : "Shipping (flat)"}
                  </span>
                  <span>{shippingCost === 0 ? "Free" : `$${shippingCost.toFixed(2)}`}</span>
                </div>
                <div className="pay-item pay-total">
                  <span>{isInquiry ? "Total (just asking — no order)" : "Total"}</span>
                  <span>${total.toFixed(2)}</span>
                </div>
              </div>

              <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
                <div className="field">
                  <label>Delivery</label>
                  <div className="choice-row">
                    <label className={`choice ${shippingMethod === "ship" ? "active" : ""}`}>
                      <input type="radio" name="method" checked={shippingMethod === "ship"} onChange={() => setShippingMethod("ship")} />
                      <span>📦 Ship to me<small>$10 flat</small></span>
                    </label>
                    <label className={`choice ${shippingMethod === "pickup" ? "active" : ""}`}>
                      <input type="radio" name="method" checked={shippingMethod === "pickup"} onChange={() => setShippingMethod("pickup")} />
                      <span>🌄 Local pickup<small>Free</small></span>
                    </label>
                  </div>
                  {cashSaves > 0 && <p className="cash-hint">💵 Choose Local pickup and Cash at pickup to save ${cashSaves.toFixed(2)} with cash pickup deals.</p>}
                </div>

                {shippingMethod === "pickup" && !isInquiry && (
                  <div className="field">
                    <label>How would you like to pay?</label>
                    <div className="choice-row">
                      <label className={`choice ${paymentMethod === "invoice" ? "active" : ""}`}>
                        <input type="radio" name="paymethod" checked={paymentMethod === "invoice"} onChange={() => setPaymentMethod("invoice")} />
                        <span>✉️ Pay by invoice<small>Payment instructions emailed to you</small></span>
                      </label>
                      <label className={`choice ${paymentMethod === "cash" ? "active" : ""}`}>
                        <input type="radio" name="paymethod" checked={paymentMethod === "cash"} onChange={() => setPaymentMethod("cash")} />
                        <span>💵 Cash at pickup<small>Bring ${total.toFixed(2)}</small></span>
                      </label>
                    </div>
                  </div>
                )}

                {shippingMethod === "pickup" && (
                  <div className="pickup-box">
                    <div className="pickup-title">Pickup location</div>
                    <div className="pickup-addr">{brand.pickup.address}</div>
                    <p>{brand.pickup.where} Full instructions are included in your confirmation email.</p>
                  </div>
                )}

                <div className="field">
                  <label>
                    Shipping address{addressRequired ? "" : " (optional)"}
                  </label>
                  <input type="text" placeholder="Street address" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} required={addressRequired} />
                  <input type="text" placeholder="Apt, suite, etc. (optional)" value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} style={{ marginTop: "0.5rem" }} />
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "0.5rem", marginTop: "0.5rem" }}>
                    <input type="text" placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} required={addressRequired} />
                    <input type="text" placeholder="State" value={state} onChange={(e) => setState(e.target.value)} required={addressRequired} />
                    <input type="text" placeholder="ZIP" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} required={addressRequired} />
                  </div>
                </div>

                {!isInquiry && mixSavings > 0 && (
                  <div className="field">
                    <label>Discount code</label>
                    <div className="field-hint" style={{ margin: 0 }}>Your bundle savings are applied — discount codes can&apos;t be combined with a bundle. Points still work.</div>
                  </div>
                )}
                {!isInquiry && mixSavings === 0 && (
                  <div className="field">
                    <label>Discount code (optional)</label>
                    {applied ? (
                      <div className="code-applied">
                        <span>✓ <strong>{applied.code}</strong> applied — saving ${applied.amount.toFixed(2)}</span>
                        <button
                          type="button"
                          onClick={() => { setApplied(null); setCodeInput(""); }}
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="code-row">
                          <input
                            type="text"
                            value={codeInput}
                            onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                            placeholder="Enter code"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") { e.preventDefault(); applyCode(); }
                            }}
                          />
                          <button type="button" onClick={applyCode} disabled={codeChecking || !codeInput.trim()}>
                            {codeChecking ? "Checking…" : "Apply"}
                          </button>
                        </div>
                        {codeError && <div className="code-error">{codeError}</div>}
                      </>
                    )}
                  </div>
                )}

                {loyalty?.enabled && !isInquiry && loyalty.points >= loyalty.minPointsToRedeem && maxRedeemable > 0 && (
                  <div className="field">
                    <label>Use your points ({loyalty.points} available)</label>
                    <div className="points-redeem">
                      <input
                        type="range"
                        min={0}
                        max={maxRedeemable}
                        step={Math.max(1, Math.floor(loyalty.pointsPerDollarRedeemed / 4))}
                        value={redeemPoints}
                        onChange={(e) => setRedeemPoints(parseInt(e.target.value) || 0)}
                      />
                      <div className="points-redeem-row">
                        <span>
                          {redeemPoints > 0
                            ? `${redeemPoints} points = $${pointsCredit.toFixed(2)} off`
                            : "Slide to apply points"}
                        </span>
                        {redeemPoints > 0 && (
                          <button type="button" onClick={() => setRedeemPoints(0)}>Clear</button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {settings?.bundleRuleEnabled && !isInquiry && bundleSavings === 0 && mixSavings === 0 && (
                  <div className="bundle-hint">
                    🌿 Add {settings.bundleRuleMinItems - itemCount} more{" "}
                    {settings.bundleRuleMinItems - itemCount === 1 ? "item" : "items"} to save{" "}
                    {settings.bundleRulePercent}% on your order.
                  </div>
                )}

                <div className="field">
                  <label>{isInquiry ? "Your question" : "Note (optional)"}</label>
                  <textarea
                    rows={3}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    required={isInquiry}
                    autoFocus={isInquiry}
                    placeholder={isInquiry ? "What would you like to know about these items?" : "Requests, or anything we should know…"}
                  />
                </div>

                <button type="submit" className="submit" disabled={submitting}>
                  {submitting ? (isInquiry ? "Sending…" : "Placing…") : isInquiry ? "Send my question" : `Place order · $${total.toFixed(2)}`}
                </button>
                <button type="button" className="ask-instead" onClick={() => { setIsInquiry(!isInquiry); setError(""); }}>
                  {isInquiry ? "← Back to placing an order" : "Not ready to buy? Ask a question about these items"}
                </button>
                {error && <div className="gate-error">{error}</div>}
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
