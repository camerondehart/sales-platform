"use client";

import { useEffect, useMemo, useState } from "react";
import { brand } from "@/lib/brand";
import { DEFAULT_GIFT_BONUS, giftBonusFor, giftMoney, GIFT_AMOUNTS, occasionLabel } from "@/lib/giftCardRules";

// Settings → Gift cards (switch `gift_cards`, lib/giftCards.ts): the buyer's
// bonus rule, and every card with its state and balance. A card is sent when
// its order's payment is confirmed (Venmo/Zelle match, or Paid / Completed).

type Card = {
  id: string;
  code: string;
  kind: "gift" | "bonus";
  amount: number;
  balance: number;
  occasion: string;
  toName: string;
  toEmail: string;
  fromName: string;
  fromEmail: string;
  state: "awaiting" | "active" | "void";
  ownerId?: string;
  orderId: string;
  ref: string;
  createdAt: number;
  deliveredAt?: number;
  emailedAt?: number;
  entries: Array<{ at: number; amount: number; note: string }>;
};

const day = (ms?: number) => (ms ? new Date(ms).toLocaleDateString("en-US", { timeZone: brand.timezone, month: "short", day: "numeric" }) : "");
const STATE: Record<Card["state"], string> = { awaiting: "Waiting for payment", active: "Active", void: "Void" };

export default function GiftCardsPanel() {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [switchOn, setSwitchOn] = useState(false);
  const [rule, setRule] = useState({ enabled: DEFAULT_GIFT_BONUS.enabled, per: String(DEFAULT_GIFT_BONUS.per), step: String(DEFAULT_GIFT_BONUS.step), max: String(DEFAULT_GIFT_BONUS.max) });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");

  function load() {
    fetch("/api/admin/gift-cards", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setCards(d.cards);
        setSwitchOn(!!d.switchOn);
      })
      .catch(() => {});
  }
  useEffect(() => {
    load();
    fetch("/api/admin/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const s = d?.settings || {};
        setRule({
          enabled: s.giftBonusEnabled ?? DEFAULT_GIFT_BONUS.enabled,
          per: String(s.giftBonusPer ?? DEFAULT_GIFT_BONUS.per),
          step: String(s.giftBonusStep ?? DEFAULT_GIFT_BONUS.step),
          max: String(s.giftBonusMax ?? DEFAULT_GIFT_BONUS.max),
        });
      })
      .catch(() => {});
  }, []);

  async function saveRule() {
    setSaving(true);
    setMsg("");
    try {
      const r = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partial: true, giftBonusEnabled: rule.enabled, giftBonusPer: Number(rule.per) || 0, giftBonusStep: Number(rule.step) || 50, giftBonusMax: Number(rule.max) || 0 }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Couldn't save.");
      setMsg("Saved. New gift cards use this; cards already bought keep the bonus they were sold with.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Couldn't save.");
    }
    setSaving(false);
  }

  async function voidOne(c: Card) {
    if (!window.confirm(`Void ${c.code}? Its ${giftMoney(c.balance)} can't be spent after this.`)) return;
    const r = await fetch("/api/admin/gift-cards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "void", id: c.id }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) window.alert(d.error || "Couldn't void it.");
    load();
  }

  const preview = { enabled: rule.enabled, per: Number(rule.per) || 0, step: Number(rule.step) || 0, max: Number(rule.max) || 0 };
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!cards) return [];
    return t ? cards.filter((c) => [c.code, c.toName, c.toEmail, c.fromName, c.fromEmail, c.ref].some((v) => String(v || "").toLowerCase().includes(t))) : cards;
  }, [cards, q]);
  const outstanding = (cards || []).filter((c) => c.state === "active").reduce((n, c) => n + c.balance, 0);
  const waiting = (cards || []).filter((c) => c.state === "awaiting").length;

  return (
    <div className="gcp">
      {!switchOn && <div className="notice">The Gift cards switch is off here, so members can't see the page. Turn it on in Settings → Feature switches.</div>}
      <div className="notice">
        A gift card is an order like any other. It&apos;s sent to the recipient (email + their account) only once the payment is <strong>confirmed</strong>: match the Venmo or Zelle payment, or set the order to Paid or Completed. A customer tapping &quot;I&apos;ve paid&quot; on its own doesn&apos;t send it. Cancelling the order voids cards that haven&apos;t been spent.
      </div>

      <h3 style={{ marginTop: "1rem" }}>Buyer&apos;s bonus</h3>
      <label className="check-row">
        <input type="checkbox" checked={rule.enabled} onChange={(e) => setRule({ ...rule, enabled: e.target.checked })} />
        <span>Give the buyer bonus credit</span>
      </label>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.5rem" }}>
        $<input type="number" min="0" step="1" value={rule.per} onChange={(e) => setRule({ ...rule, per: e.target.value })} style={{ width: "5rem" }} aria-label="Bonus dollars" />
        for every $<input type="number" min="1" step="1" value={rule.step} onChange={(e) => setRule({ ...rule, step: e.target.value })} style={{ width: "5rem" }} aria-label="For every dollars" />
        of gift card, up to $<input type="number" min="0" step="1" value={rule.max} onChange={(e) => setRule({ ...rule, max: e.target.value })} style={{ width: "5rem" }} aria-label="Most bonus per card" /> per card
        <button className="submit" style={{ width: "auto", padding: "0.5rem 1.1rem" }} onClick={saveRule} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
      </div>
      <div style={{ fontSize: "0.85rem", color: "var(--ink-soft)", marginTop: "0.4rem" }}>
        {[...GIFT_AMOUNTS, 500].map((a) => `${giftMoney(a)} → ${giftMoney(giftBonusFor(a, preview))}`).join(" · ")}
      </div>
      {msg && <div style={{ marginTop: "0.5rem", fontSize: "0.9rem", color: "var(--mint)" }}>{msg}</div>}

      <h3 style={{ marginTop: "1.4rem" }}>Cards</h3>
      <div style={{ fontSize: "0.9rem", color: "var(--ink-soft)" }}>
        {cards ? `${cards.length} card(s) · ${giftMoney(Math.round(outstanding * 100) / 100)} unspent on active cards · ${waiting} waiting for payment` : "Loading…"}
      </div>
      <input type="search" placeholder="Search name, email, code or order ref" value={q} onChange={(e) => setQ(e.target.value)} style={{ margin: "0.6rem 0", width: "100%", maxWidth: 420 }} />
      <div className="gcp-list">
        {shown.map((c) => (
          <div key={c.id} className={`gcp-row gcp-${c.state}`}>
            <div className="gcp-main">
              <strong>{giftMoney(c.amount)}</strong> {c.kind === "bonus" ? "bonus credit" : `${occasionLabel(c.occasion)} card`} for {c.toName}
              <div className="gcp-sub">
                {c.kind === "gift" ? `From ${c.fromName} (${c.fromEmail}) to ${c.toEmail}` : `For ${c.toEmail}`} · Order {c.ref} · {day(c.createdAt)}
              </div>
              <div className="gcp-sub">
                <code>{c.code}</code> · {STATE[c.state]}
                {c.state === "active" ? ` · ${giftMoney(c.balance)} left` : ""}
                {c.deliveredAt ? ` · sent ${day(c.deliveredAt)}` : ""}
                {c.state === "active" && c.kind === "gift" ? (c.ownerId ? " · in their account" : " · not claimed yet") : ""}
              </div>
            </div>
            {c.state === "active" && (
              <button className="gcp-void-btn" onClick={() => voidOne(c)}>Void</button>
            )}
          </div>
        ))}
        {cards && shown.length === 0 && <div style={{ color: "var(--ink-soft)" }}>No gift cards{q ? " match" : " yet"}.</div>}
      </div>
    </div>
  );
}
