"use client";

import { useState, useMemo, useEffect } from "react";
import type { Product } from "@/lib/storage";
import { parsePrice, effectivePrice, onSale, promoLabel } from "@/lib/pricing";
import { priceCart, nextBundleHint, type AppliedBundle, type Bundle } from "@/lib/bundles";
import { ProductFlags, PriceTag } from "@/app/components/ProductPrice";
import FormattedDescription from "@/app/components/FormattedDescription";
import ProductVideo, { useProductDeepLink } from "@/app/components/ProductVideo";
import { useChatShopBridge } from "@/app/components/assistant/shopBridge";
import { track, sessionCampaign } from "@/lib/track";
import { AskAboutProduct, AskAssistantLink } from "@/app/components/assistant/AskAssistant";
import { brand } from "@/lib/brand";

type CartItem = { productId: string; quantity: number };
const CART_KEY = "fp_retail_cart_v1";
const SHIPPING_FLAT = 10;

/**
 * The public shop.
 *
 * `embedded` renders just the shopping part — controls, grid, cart and
 * modals — without the page header, intro or footer. The homepage uses that
 * to place the shop underneath the sign-in hero without duplicating any of
 * the cart logic.
 */
export default function RetailClient({
  products,
  embedded = false,
}: {
  products: Product[];
  embedded?: boolean;
}) {
  const [cart, setCart] = useState<CartItem[]>([]);
  // Phone layout: two per row by default, one per row if they prefer.
  const [oneUp, setOneUp] = useState(false);
  useEffect(() => {
    try { setOneUp(localStorage.getItem("collective_grid_oneup") === "1"); } catch {}
  }, []);
  function toggleOneUp() {
    setOneUp((v) => {
      const next = !v;
      try { localStorage.setItem("collective_grid_oneup", next ? "1" : "0"); } catch {}
      return next;
    });
  }

  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [selected, setSelected] = useState<Product | null>(null);
  // Printed product QR codes land here as ?product=<id>.
  useProductDeepLink(products, setSelected);
  useEffect(() => {
    if (selected) track("product_view", { id: selected.id });
  }, [selected]);
  useEffect(() => {
    if (cartOpen) track("cart_open");
  }, [cartOpen]);
  useEffect(() => {
    if (checkoutOpen) track("checkout_open", { shop: "public" });
  }, [checkoutOpen]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CART_KEY);
      if (raw) setCart(JSON.parse(raw));
    } catch {}
  }, []);

  function persist(next: CartItem[]) {
    setCart(next);
    try { localStorage.setItem(CART_KEY, JSON.stringify(next)); } catch {}
  }

  function addToCart(productId: string, openDrawer = true) {
    track("add_to_cart", { id: productId });
    const next = [...cart];
    const found = next.find((i) => i.productId === productId);
    if (found) found.quantity += 1;
    else next.push({ productId, quantity: 1 });
    persist(next);
    if (openDrawer) setCartOpen(true);
  }

  // The Concierge's product cards add to this cart (quietly — the chat shows
  // "Added") and open these pop-ups.
  useChatShopBridge({
    shop: "public",
    products,
    add: (id) => addToCart(id, false),
    view: (p) => setSelected(p),
    openCart: () => setCartOpen(true),
  });

  function setQty(productId: string, quantity: number) {
    if (quantity < 1) return persist(cart.filter((i) => i.productId !== productId));
    persist(cart.map((i) => (i.productId === productId ? { ...i, quantity } : i)));
  }

  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const detailed = useMemo(
    () =>
      cart
        .map((i) => ({ ...i, product: productMap.get(i.productId) }))
        .filter((i): i is CartItem & { product: Product } => !!i.product),
    [cart, productMap]
  );
  const count = detailed.reduce((n, i) => n + i.quantity, 0);
  // Mix-and-match bundles made only of public-shop products (empty unless switched on).
  const [bundles, setBundles] = useState<Bundle[]>([]);
  useEffect(() => {
    fetch("/api/bundles", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { bundles: [] }))
      .then((d) => setBundles(d.bundles || []))
      .catch(() => {});
  }, []);
  const priced = useMemo(() => priceCart(detailed, bundles, null), [detailed, bundles]);
  const bundleHint = useMemo(() => nextBundleHint(detailed, bundles, new Map(products.map((p) => [p.id, p.name]))), [detailed, bundles, products]);
  // Mirrors /api/retail/checkout exactly: unit price after any sale price or
  // percent promo, then quantity promos (BOGO) come off as a discount.
  const subtotal = detailed.reduce((n, i) => n + parsePrice(effectivePrice(i.product)) * i.quantity, 0);
  const cartDiscount = priced.discount;
  const payable = Math.max(0, subtotal - cartDiscount);

  return (
    <>
      <div className={embedded ? "shell shell-embedded" : "shell"}>
        {!embedded && (
        <header className="masthead">
          <a className="masthead-brand" href="/" aria-label={`${brand.name} home`}>
            <div className="logo-mark floaty" aria-hidden="true">
              <span></span><span></span><span></span><span></span>
            </div>
            <h1 className="masthead-title">{brand.name}</h1>
          </a>
          <div className="masthead-meta">
            <a href="/about" className="masthead-link">About</a>
            <a href="/events" className="masthead-link">Events</a>
            <a href="/" className="masthead-link">Member sign in</a>
            <AskAssistantLink className="masthead-link ask-link" label="Ask our Concierge" />
            <button className="cart-button" onClick={() => setCartOpen(true)}>
              🧺 Cart{count > 0 && <span className="cart-count">{count}</span>}
            </button>
          </div>
        </header>
        )}

        {!embedded && (
        <div className="retail-intro">
          <h2>{brand.name}</h2>
          <p>{brand.tagline}</p>
          <a className="retail-about-link" href="/about">Read about us&nbsp;→</a>
        </div>
        )}

        {products.length === 0 ? (
          <div className="empty">Our shop is being restocked. Please check back soon.</div>
        ) : (
          <>
          <div className="shop-controls shop-controls-solo">
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
          <div className={`grid${oneUp ? " grid-one-up" : ""}`}>
            {products.map((p, idx) => (
              <article key={p.id} className="card fade-rise" style={{ animationDelay: `${Math.min(idx * 60, 480)}ms` }}>
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
                <button className="card-add" onClick={(e) => { e.stopPropagation(); addToCart(p.id); }}>
                  Add to cart
                </button>
              </article>
            ))}
          </div>
          </>
        )}

        {!embedded && (
        <footer className="footnotes">
          <div className="footnotes-ornament" aria-hidden="true">
            <span></span><span>{brand.emoji}</span><span></span>
          </div>
          <div className="footnotes-grid">
            <div className="footnote">
              <div className="footnote-icon" aria-hidden="true">📦</div>
              <div className="footnote-title">Shipping</div>
              <p>{brand.shippingNote} Questions? Email{" "}
                <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>.
              </p>
            </div>
            <div className="footnote">
              <div className="footnote-icon" aria-hidden="true">🌿</div>
              <div className="footnote-title">Join {brand.members}</div>
              <p>
                Our members enjoy a private catalog, member pricing, and early access to events.{" "}
                <a href="/">Request access&nbsp;→</a>
              </p>
            </div>
          </div>
        </footer>
        )}
      </div>

      {/* A running basket total that follows the shopper down the page.
          Embedded mode has no header at all; on /retail the masthead cart
          scrolls out of sight, so it earns its place on both. */}
      {count > 0 && !cartOpen && !checkoutOpen && (
        <button className="cart-fab" onClick={() => setCartOpen(true)}>
          🧺 {count} · ${payable.toFixed(2)}
        </button>
      )}

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
              <h2 className="modal-name">{selected.name}</h2>
              {selected.category && <div className="card-category" style={{ marginTop: "0.5rem" }}>{selected.category}</div>}
              <div className="modal-price">
                {onSale(selected) && <span className="price-was">{selected.price}</span>}
                {effectivePrice(selected)}
                {promoLabel(selected) && (
                  <span className="promo-note">{promoLabel(selected)}</span>
                )}
              </div>
              <FormattedDescription text={selected.description} />
              <button className="submit" onClick={() => { addToCart(selected.id); setSelected(null); }}>
                Add to cart
              </button>
              <AskAboutProduct product={selected} onAsk={() => setSelected(null)} />
            </div>
          </div>
        </div>
      )}

      {cartOpen && (
        <div className="drawer-backdrop" onClick={() => setCartOpen(false)}>
          <aside className="cart-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="cart-drawer-head">
              <h2>Your basket</h2>
              <button className="history-close" style={{ position: "static" }} onClick={() => setCartOpen(false)}>×</button>
            </div>
            {detailed.length === 0 ? (
              <div className="empty" style={{ padding: "3rem 1rem" }}>Your basket is empty.</div>
            ) : (
              <>
                <div className="cart-items">
                  {detailed.map(({ product, quantity }) => (
                    <div key={product.id} className="cart-item">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={product.image} alt={product.name} />
                      <div className="cart-item-info">
                        <div className="cart-item-name">{product.name}</div>
                        <div className="cart-item-price">{effectivePrice(product)}</div>
                        <div className="cart-item-qty">
                          <button onClick={() => setQty(product.id, quantity - 1)}>−</button>
                          <span>{quantity}</span>
                          <button onClick={() => setQty(product.id, quantity + 1)}>+</button>
                        </div>
                      </div>
                      <div className="cart-item-total">
                        ${(parsePrice(effectivePrice(product)) * quantity).toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="cart-drawer-foot">
                  <div className="cart-subtotal">
                    <span>Subtotal</span><strong>${subtotal.toFixed(2)}</strong>
                  </div>
                  {priced.bundles.map((b) => (
                    <div key={b.id} className="cart-subtotal cart-savings">
                      <span>{b.name} bundle{b.sets > 1 ? ` ×${b.sets}` : ""}</span><strong>−${b.savings.toFixed(2)}</strong>
                    </div>
                  ))}
                  {priced.promoSavings > 0 && (
                    <div className="cart-subtotal cart-savings">
                      <span>Promo savings</span><strong>−${priced.promoSavings.toFixed(2)}</strong>
                    </div>
                  )}
                  {bundleHint && <div className="cart-bundle-hint">🌿 {bundleHint}</div>}
                  <div style={{ fontSize: "0.8rem", color: "var(--ink-soft)", marginBottom: "0.9rem" }}>
                    + $10 shipping
                  </div>
                  <button className="submit" onClick={() => { setCartOpen(false); setCheckoutOpen(true); }}>
                    Checkout
                  </button>
                </div>
              </>
            )}
          </aside>
        </div>
      )}

      {checkoutOpen && (
        <RetailCheckout
          items={detailed}
          subtotal={subtotal}
          discount={cartDiscount}
          bundleLines={priced.bundles}
          onClose={() => setCheckoutOpen(false)}
          onComplete={() => persist([])}
        />
      )}
    </>
  );
}

function RetailCheckout({
  items,
  subtotal,
  discount,
  bundleLines = [],
  onClose,
  onComplete,
}: {
  items: Array<CartItem & { product: Product }>;
  subtotal: number;
  discount: number;
  bundleLines?: AppliedBundle[];
  onClose: () => void;
  onComplete: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [note, setNote] = useState("");
  const [subscribe, setSubscribe] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [placed, setPlaced] = useState(false);
  const [invoiceEmailed, setInvoiceEmailed] = useState(true);
  const [error, setError] = useState("");

  const total = Math.max(0, subtotal - discount) + SHIPPING_FLAT;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/retail/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
          name, email, phone, note, subscribe,
          address: { addressLine1, addressLine2, city, state, postalCode },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }
      track("order_placed", { value: total, shop: "public", campaign: sessionCampaign() });
      onComplete();
      setInvoiceEmailed(data.emailed !== false);
      setPlaced(true);
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
              Thank you — your order has been placed! 🌿
              <div style={{ fontSize: "0.9rem", marginTop: "1rem", fontStyle: "normal", color: "var(--ink-soft)" }}>
                {invoiceEmailed ? (
                  <>
                    An invoice with payment instructions is on its way to your inbox.
                    Once you've paid, use the link in the email to let us know.
                  </>
                ) : (
                  <>
                    We couldn't email your invoice just now — our team has been told and will send it to you shortly.
                    Your order is saved, so there's no need to order again.
                  </>
                )}
              </div>
              <button className="submit" style={{ marginTop: "1.5rem" }} onClick={onClose}>
                Back to the shop
              </button>
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
                {bundleLines.map((b) => (
                  <div key={b.id} className="pay-item pay-savings">
                    <span>{b.name} bundle{b.sets > 1 ? ` ×${b.sets}` : ""}</span><span>−${b.savings.toFixed(2)}</span>
                  </div>
                ))}
                {discount - bundleLines.reduce((n, b) => n + b.savings, 0) > 0.004 && (
                  <div className="pay-item pay-savings">
                    <span>Promo savings</span><span>−${(discount - bundleLines.reduce((n, b) => n + b.savings, 0)).toFixed(2)}</span>
                  </div>
                )}
                <div className="pay-item"><span>Shipping</span><span>${SHIPPING_FLAT.toFixed(2)}</span></div>
                <div className="pay-item pay-total"><span>Total</span><span>${total.toFixed(2)}</span></div>
              </div>

              <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
                <div className="field">
                  <label>Name</label>
                  <input required value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="field">
                  <label>Email</label>
                  <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="field">
                  <label>Phone (optional)</label>
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
                <div className="field">
                  <label>Shipping address</label>
                  <input required placeholder="Street address" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} />
                  <input placeholder="Apt, suite (optional)" value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} style={{ marginTop: "0.5rem" }} />
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "0.5rem", marginTop: "0.5rem" }}>
                    <input required placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} />
                    <input required placeholder="State" value={state} onChange={(e) => setState(e.target.value)} />
                    <input required placeholder="ZIP" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
                  </div>
                </div>
                <div className="field">
                  <label>Note (optional)</label>
                  <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
                <label className="inquiry-check">
                  <input type="checkbox" checked={subscribe} onChange={(e) => setSubscribe(e.target.checked)} />
                  <span>
                    <strong>Email me about new products and events</strong>
                    <small>Unsubscribe any time.</small>
                  </span>
                </label>
                <button type="submit" className="submit" disabled={submitting}>
                  {submitting ? "Placing…" : `Place order · $${total.toFixed(2)}`}
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
