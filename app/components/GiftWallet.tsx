"use client";

import { useState } from "react";
import GiftCardArt from "./GiftCardArt";
import { giftMoney } from "@/lib/giftCardRules";

export type WalletCard = {
  id: string;
  code: string;
  kind: "gift" | "bonus";
  amount: number;
  balance: number;
  occasion: string;
  toName: string;
  fromName: string;
  note?: string;
  state: "awaiting" | "active" | "void";
  deliveredAt?: number;
  link: string;
};
export type SentCard = { id: string; amount: number; occasion: string; toName: string; state: "awaiting" | "active" | "void"; createdAt: number; deliveredAt?: number };
export type GiftData = { enabled: boolean; balance: number; cards: WalletCard[]; sent: SentCard[] };

const SEEN_KEY = "fp_gift_seen";
/** Cards this device has already shown with the envelope. */
export function seenGiftIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) || "[]");
  } catch {
    return [];
  }
}
export function markGiftsSeen(ids: string[]) {
  try {
    const all = Array.from(new Set([...seenGiftIds(), ...ids])).slice(-200);
    localStorage.setItem(SEEN_KEY, JSON.stringify(all));
  } catch {
    /* private mode: they'll see the envelope again, that's fine */
  }
}

const sentState = (s: SentCard) => (s.state === "active" ? "Delivered" : s.state === "awaiting" ? "Waiting for payment" : "Cancelled");

// Account → Gift cards: balance, each card (new ones come out of their envelope), claim by code, cards sent.
export default function GiftWallet({ data, fresh, onClose, onChanged }: { data: GiftData; fresh: string[]; onClose: () => void; onChanged: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function claim(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/gift-cards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "claim", code }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "That code didn't work.");
      setMsg({ ok: true, text: `Added: ${giftMoney(d.card.balance)} is ready to spend.` });
      setCode("");
      onChanged();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "That code didn't work." });
    }
    setBusy(false);
  }

  const live = data.cards.filter((c) => c.state === "active");
  return (
    <div className="history-backdrop" onClick={onClose}>
      <div className="history-modal" onClick={(e) => e.stopPropagation()}>
        <button className="history-close" onClick={onClose} aria-label="Close">×</button>
        <div className="history-header">
          <div className="history-kicker">Gift cards</div>
          <h2 className="history-name">{fresh.length ? "You've got a gift card! 🎁" : "Your gift cards"}</h2>
        </div>
        <div className="history-body">
          <div className="gift-wallet-total">
            Balance to spend
            <strong>{giftMoney(data.balance)}</strong>
            <span style={{ fontSize: "0.85rem", color: "var(--ink-soft)" }}>Comes off automatically at checkout.</span>
          </div>
          {live.length === 0 ? (
            <div className="history-empty">No gift cards yet.</div>
          ) : (
            <div className="gift-wallet-list">
              {live.map((c) => (
                <div key={c.id} className="gift-wallet-item">
                  <GiftCardArt occasion={c.occasion} amount={c.amount} toName={c.toName} fromName={c.fromName} bonus={c.kind === "bonus"} reveal={fresh.includes(c.id)} />
                  {c.note && <div className="gift-wallet-note">“{c.note}” — {c.fromName}</div>}
                  <div className="gift-wallet-meta">
                    <span>{c.balance < c.amount ? `${giftMoney(c.balance)} left of ${giftMoney(c.amount)}` : `${giftMoney(c.balance)} to spend`}</span>
                    <code>{c.code}</code>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="gift-section-title">Have a code?</div>
          <form className="gift-claim" onSubmit={claim}>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="GIFT-XXXX-XXXX" aria-label="Gift card code" />
            <button type="submit" disabled={busy || !code.trim()}>{busy ? "Adding…" : "Add"}</button>
          </form>
          {msg && <div style={{ marginTop: "0.5rem", fontSize: "0.88rem", color: msg.ok ? "var(--accent-strong)" : "var(--danger-strong)" }}>{msg.text}</div>}

          <div className="gift-section-title">Send one</div>
          <a className="gift-btn" href="/gift-cards">🎁 Send a gift card</a>

          {data.sent.length > 0 && (
            <>
              <div className="gift-section-title">Cards you&apos;ve sent</div>
              {data.sent.map((s) => (
                <div key={s.id} className="gift-sent-row">
                  <span>{giftMoney(s.amount)} for {s.toName}</span>
                  <span style={{ color: s.state === "active" ? "var(--accent-strong)" : "var(--ink-soft)" }}>{sentState(s)}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
