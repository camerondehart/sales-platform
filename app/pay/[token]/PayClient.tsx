"use client";

import { useEffect, useState } from "react";
import { brand } from "@/lib/brand";

// Mirrors paymentMemo() in lib/invoiceEmail.ts.
function payMemo(customerName: string, ref?: string): string {
  const name = customerName.trim().replace(/\s+/g, " ");
  const base = name ? `Order for ${name}` : "Order";
  return ref ? `${base} #${ref}` : base;
}

type OrderSummary = {
  shortId: string;
  userName: string;
  items: Array<{ productName: string; price: string; quantity: number }>;
  shippingMethod: "ship" | "pickup";
  shippingCost: number;
  subtotal: number;
  discount: number;
  total: number;
  status: string;
  paymentMethod: "invoice" | "cash";
  createdAt: number;
};

export default function PayClient({ token }: { token: string }) {
  const [order, setOrder] = useState<OrderSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    // Retry a few times: a freshly created order can take a moment to be
    // visible in storage, and we'd rather wait than show "not found".
    async function load() {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const res = await fetch(`/api/orders/mark-paid?token=${encodeURIComponent(token)}`);
          if (cancelled) return;
          if (res.ok) {
            const data = await res.json();
            setOrder(data.order);
            const s = data.order.status;
            if (s === "paid" || s === "completed" || s === "shipped" || s === "picked-up") {
              setDone(true);
            }
            setLoading(false);
            return;
          }
        } catch {}
        if (attempt < 4) await new Promise((r) => setTimeout(r, 2500));
      }
      if (!cancelled) {
        setNotFound(true);
        setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [token]);

  // Cash-at-pickup orders confirm collection, not a transfer.
  const isCash = order?.paymentMethod === "cash" && order?.shippingMethod === "pickup";

  async function confirmPaid() {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/orders/mark-paid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (res.ok) {
        setDone(true);
      } else {
        setError(data.error || "Something went wrong. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
    }
    setSubmitting(false);
  }

  return (
    <div className="pay-shell">
      <div className="pay-card fade-rise">
        <div className="logo-mark" aria-hidden="true" style={{ margin: "0 auto 1rem" }}>
          <span></span><span></span><span></span><span></span>
        </div>
        <div className="pay-kicker">{brand.name} · {brand.members}</div>

        {loading ? (
          <p className="pay-muted">Looking up your order…</p>
        ) : notFound ? (
          <>
            <h1 className="pay-title">Hmm, we can't find that order.</h1>
            <p className="pay-muted">
              This payment link may be invalid or out of date. If you think this is a
              mistake, reach out to{" "}
              <a href={`mailto:${brand.supportEmail}`} style={{ color: "var(--accent-strong)", fontWeight: 600 }}>
                {brand.supportEmail}
              </a>{" "}
              and we'll sort it out.
            </p>
          </>
        ) : done ? (
          <>
            <div className="pay-check" aria-hidden="true">✓</div>
            <h1 className="pay-title">Thank you, {order?.userName.split(" ")[0]}!</h1>
            <p className="pay-muted">
              {isCash ? (
                <>
                  Order {order?.shortId} is marked as picked up. Thanks so much for
                  supporting {brand.name}. We appreciate you.
                </>
              ) : (
                <>
                  Order {order?.shortId} is marked as paid. We'll verify the payment and
                  get your order moving. You'll hear from us soon.
                </>
              )}
            </p>
          </>
        ) : order ? (
          <>
            <h1 className="pay-title">
              {isCash ? "Confirm your pickup" : "Confirm your payment"}
            </h1>
            <p className="pay-muted">
              Order {order.shortId} · placed {new Date(order.createdAt).toLocaleDateString("en-US", { timeZone: brand.timezone })}
            </p>
            <div className="pay-items">
              {order.items.map((i, idx) => (
                <div key={idx} className="pay-item">
                  <span>{i.productName} × {i.quantity}</span>
                  <span>{i.price}</span>
                </div>
              ))}
              {order.discount > 0 && (
                <div className="pay-item" style={{ color: "var(--accent-strong)" }}>
                  <span>Promo savings</span>
                  <span>−${order.discount.toFixed(2)}</span>
                </div>
              )}
              <div className="pay-item">
                <span>{order.shippingMethod === "pickup" ? "Local pickup" : "Shipping"}</span>
                <span>{order.shippingCost === 0 ? "Free" : `$${order.shippingCost.toFixed(2)}`}</span>
              </div>
              <div className="pay-item pay-total">
                <span>{isCash ? "Due at pickup" : "Total"}</span>
                <span>${order.total.toFixed(2)}</span>
              </div>
            </div>
            {order.status === "cancelled" || order.status === "inquiry" ? (
              <p className="pay-muted">This order can no longer be confirmed.</p>
            ) : isCash ? (
              /* Cash at pickup: nothing to send, just confirm collection. */
              <>
                <div className="pay-cash-due">
                  <span>Bring with you</span>
                  <strong>${order.total.toFixed(2)}</strong>
                  <small>in cash</small>
                </div>

                <div className="pay-step">
                  <div className="pay-step-head">
                    <span className="pay-step-num">1</span> Collect your order
                  </div>
                  <p className="pay-step-text">
                    <strong>{brand.pickup.address}</strong>
                    <br />
                    {brand.pickup.where}{brand.pickup.notes[0] ? ` ${brand.pickup.notes[0]}` : ""}
                  </p>
                </div>

                <div className="pay-arrow" aria-hidden="true">↓</div>

                <div className="pay-step final">
                  <div className="pay-step-head">
                    <span className="pay-step-num">2</span> Then let us know
                  </div>
                  <p className="pay-step-text">
                    Once you've picked up your order and left your cash, tap below so we
                    can close it out on our end.
                  </p>
                  <button className="submit" onClick={confirmPaid} disabled={submitting}>
                    {submitting ? "Confirming…" : "I picked up and paid cash"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="pay-step">
                  <div className="pay-step-head">
                    <span className="pay-step-num venmo">1</span> Send your payment
                  </div>
                  {/* No target="_blank": iOS only hands a universal link to the
                      Venmo app on a same-tab navigation. Opening a new tab just
                      loads venmo.com in Safari, which is why this button worked
                      from the email but not from here. */}
                  {brand.payments.venmoHandle && (
                    <>
                      <a
                        className="venmo-btn"
                        href={`https://venmo.com/${brand.payments.venmoHandle}?txn=pay&amount=${order.total.toFixed(2)}&note=${encodeURIComponent(payMemo(order.userName, order.shortId))}`}
                        rel="noopener"
                      >
                        Pay ${order.total.toFixed(2)} with Venmo
                      </a>
                      <div className="pay-ref">
                        Put <strong>#{order.shortId}</strong> in your Venmo note so we can match your payment.
                        <CopyRef text={`#${order.shortId}`} />
                      </div>
                    </>
                  )}
                  {brand.payments.zelle && (
                    <div className="pay-alt">
                      {brand.payments.venmoHandle ? "or " : ""}Zelle to <strong>{brand.payments.zelle}</strong> with{" "}
                      <strong>&ldquo;{payMemo(order.userName, order.shortId)}&rdquo;</strong> in the memo
                    </div>
                  )}
                  {!brand.payments.venmoHandle && !brand.payments.zelle && (
                    <div className="pay-alt">Follow the payment instructions in your invoice email, with <strong>&ldquo;{payMemo(order.userName, order.shortId)}&rdquo;</strong> in the memo.</div>
                  )}
                  <div className="pay-note-warn">
                    Paying {brand.payments.venmoHandle ? "in Venmo " : ""}does <strong>not</strong> notify us on its own.
                  </div>
                </div>

                <div className="pay-arrow" aria-hidden="true">↓</div>

                <div className="pay-step final">
                  <div className="pay-step-head">
                    <span className="pay-step-num">2</span> Then confirm it here
                  </div>
                  <p className="pay-step-text">
                    Once you've paid, click below so we know it's on the way. Your order
                    isn't confirmed until you do.
                  </p>
                  <button className="submit" onClick={confirmPaid} disabled={submitting}>
                    {submitting ? "Confirming…" : "I've sent my payment"}
                  </button>
                </div>
              </>
            )}
            {error && <div className="gate-error" style={{ marginTop: "1rem" }}>{error}</div>}
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Copies "#4K9Q2X" for the Venmo note. */
function CopyRef({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="pay-ref-copy"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        }).catch(() => {});
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
