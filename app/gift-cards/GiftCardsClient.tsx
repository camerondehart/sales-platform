"use client";

import { useState } from "react";
import { brand } from "@/lib/brand";
import GiftCardArt from "@/app/components/GiftCardArt";
import {
  GIFT_AMOUNTS,
  GIFT_MAX,
  GIFT_MIN,
  GIFT_NOTE_MAX,
  GIFT_OCCASIONS,
  giftBonusFor,
  giftMoney,
  type GiftBonusRule,
  type GiftOccasion,
} from "@/lib/giftCardRules";

export default function GiftCardsClient({ userName, bonus }: { userName: string; bonus: GiftBonusRule }) {
  const [occasion, setOccasion] = useState<GiftOccasion>("holidays");
  const [preset, setPreset] = useState<number | null>(50);
  const [custom, setCustom] = useState("");
  const [toName, setToName] = useState("");
  const [toEmail, setToEmail] = useState("");
  const [fromName, setFromName] = useState(userName.split(" ")[0] || userName);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<null | { ref: string; total: number; bonus: number; emailed: boolean; payLink: string }>(null);

  const customNum = custom.trim() ? Number(custom) : NaN;
  const amount = preset ?? (Number.isInteger(customNum) ? customNum : 0);
  const amountOk = amount >= GIFT_MIN && amount <= GIFT_MAX && Number.isInteger(amount);
  const extra = amountOk ? giftBonusFor(amount, bonus) : 0;
  const promo = bonus.enabled && bonus.per > 0 && bonus.step > 0;

  async function buy(e: React.FormEvent) {
    e.preventDefault();
    if (!amountOk) {
      setError(`Choose an amount from ${giftMoney(GIFT_MIN)} to ${giftMoney(GIFT_MAX)}.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/gift-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "buy", amount, occasion, toName, toEmail, fromName, note }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Something went wrong. Please try again.");
      setDone({ ref: d.ref, total: d.total, bonus: d.bonus || 0, emailed: !!d.emailed, payLink: d.payLink });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
    }
    setBusy(false);
  }

  return (
    <div className="shell">
      <header className="masthead gallery-masthead">
        <a className="masthead-brand" href="/gallery" aria-label={`${brand.members} home`}>
          <div className="logo-mark floaty" aria-hidden="true">
            <span></span><span></span><span></span><span></span>
          </div>
          <h1 className="masthead-title">{brand.members}</h1>
        </a>
        <div className="masthead-meta">
          <nav className="masthead-nav" aria-label="Other pages">
            <a href="/gallery" className="nav-pill"><em>← Back to the shop</em></a>
          </nav>
        </div>
      </header>

      <main className="gift-page">
        <div className="gift-hero">
          <div className="gift-kicker">Gift cards</div>
          <h1>{`Give a little ${brand.shortName}`}</h1>
          <p>Pick an occasion, add a note, and we&apos;ll send a card they can spend in {brand.members}.</p>
          {promo && (
            <div className="gift-promo">🎁 Get {giftMoney(bonus.per)} for yourself with every {giftMoney(bonus.step)} you give{(bonus.max || 0) > 0 ? ` (up to ${giftMoney(bonus.max!)})` : ""}</div>
          )}
        </div>

        <div className="gift-grid">
          <div className="gift-preview">
            <GiftCardArt key={occasion} occasion={occasion} amount={amountOk ? amount : preset ?? 50} toName={toName.trim() || "someone special"} fromName={fromName.trim() || undefined} reveal />
            {note.trim() && (
              <div className="gift-preview-note">
                “{note.trim()}”
                <small>— {fromName.trim() || userName}</small>
              </div>
            )}
          </div>

          {done ? (
            <div className="gift-form gift-done">
              <h2>Almost there 🌿</h2>
              <p>
                Your {giftMoney(done.total)} card for {toName.trim()} is saved (Ref {done.ref}).{" "}
                {done.emailed ? "We've emailed you how to pay with Venmo or Zelle." : "We'll email you how to pay with Venmo or Zelle shortly."}
              </p>
              <p>
                As soon as we&apos;ve confirmed your payment, the card goes to {toName.trim()} by email and into their account
                {done.bonus > 0 ? `, and your ${giftMoney(done.bonus)} bonus credit lands in yours` : ""}.
              </p>
              <div style={{ display: "flex", gap: "0.6rem", justifyContent: "center", flexWrap: "wrap", marginTop: "1.2rem" }}>
                <a className="gift-btn" href={done.payLink}>Pay now</a>
                <button type="button" className="gift-btn" style={{ background: "var(--ink-soft)" }} onClick={() => { setDone(null); setToName(""); setToEmail(""); setNote(""); }}>
                  Send another
                </button>
              </div>
            </div>
          ) : (
            <form className="gift-form" onSubmit={buy}>
              <div className="field">
                <label>Occasion</label>
                <div className="gift-occasions">
                  {GIFT_OCCASIONS.map((o) => (
                    <button type="button" key={o.key} className={`gift-occasion${occasion === o.key ? " active" : ""}`} onClick={() => setOccasion(o.key)} aria-pressed={occasion === o.key}>
                      <GiftCardArt occasion={o.key} amount={amountOk ? amount : 50} size="small" tilt={false} />
                      <span>{o.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <label>Amount</label>
                <div className="gift-amounts">
                  {GIFT_AMOUNTS.map((a) => {
                    const b = giftBonusFor(a, bonus);
                    return (
                      <button type="button" key={a} className={`gift-amount${preset === a ? " active" : ""}`} onClick={() => { setPreset(a); setCustom(""); }} aria-pressed={preset === a}>
                        {giftMoney(a)}
                        {b > 0 && <small>+{giftMoney(b)} for you</small>}
                      </button>
                    );
                  })}
                </div>
                <label className="gift-custom" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
                  Or another amount: $
                  <input type="number" inputMode="numeric" min={GIFT_MIN} max={GIFT_MAX} step={1} value={custom} placeholder="75" onChange={(e) => { setCustom(e.target.value); setPreset(null); }} />
                </label>
              </div>

              <div className="field">
                <label>Who it&apos;s for</label>
                <div className="gift-two">
                  <input type="text" placeholder="Their name" value={toName} onChange={(e) => setToName(e.target.value)} maxLength={60} required />
                  <input type="email" placeholder="Their email" value={toEmail} onChange={(e) => setToEmail(e.target.value)} maxLength={200} required />
                </div>
              </div>

              <div className="field">
                <label>From</label>
                <input type="text" value={fromName} onChange={(e) => setFromName(e.target.value)} maxLength={60} placeholder="Your name" />
              </div>

              <div className="field">
                <label>A little note (optional)</label>
                <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value.slice(0, GIFT_NOTE_MAX))} placeholder="Happy birthday! Treat yourself to something lovely." />
                <div className="gift-count">{note.length}/{GIFT_NOTE_MAX}</div>
              </div>

              <div className="gift-summary">
                <div className="pay-item"><span>Gift card</span><span>{amountOk ? giftMoney(amount) : "—"}</span></div>
                {extra > 0 && <div className="pay-item gift-bonus-line"><span>Your bonus credit</span><span>+{giftMoney(extra)}</span></div>}
                <div className="pay-item pay-total"><span>You pay</span><span>{amountOk ? giftMoney(amount) : "—"}</span></div>
              </div>

              <button type="submit" className="submit" disabled={busy || !amountOk}>
                {busy ? "Saving…" : `Continue to payment · ${amountOk ? giftMoney(amount) : ""}`}
              </button>
              {error && <div className="gift-error">{error}</div>}
              <p className="gift-small-print">
                You&apos;ll pay by Venmo or Zelle, like any order. The card is sent once we&apos;ve confirmed your payment
                {extra > 0 ? ", and your bonus credit is added to your account at the same time" : ""}. Gift cards never expire and are spent in {brand.members}&apos;s members&apos; shop.
              </p>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
