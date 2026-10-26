"use client";

import { useEffect, useState } from "react";
import { addDays, pacificDay, pacificMidnight } from "@/lib/periods";
import { brand } from "@/lib/brand";

// Marketing → Event sign-up QR code → "Offer for this event".
// Picks one of the existing discount codes; people who sign up on that event's
// QR page get it in their welcome email, and the page mentions it.

type Offer = { id: string; event: string; discountId: string; code: string | null; text: string | null; live: boolean };
type Disc = { id: string; code: string; type: "percentage" | "fixed"; value: number; active: boolean; expiresAt?: number; maxUses?: number; uses: number; perCustomerLimit?: number };

const keyOf = (e: string) => e.trim().replace(/\s+/g, " ").toLowerCase().slice(0, 80);
const textOf = (d: Pick<Disc, "type" | "value">) => (d.type === "percentage" ? `${d.value}% off` : `$${d.value} off`);
const usable = (d: Disc) => d.active && !(d.expiresAt && d.expiresAt < Date.now()) && !(d.maxUses && d.uses >= d.maxUses);
// "Farmers Market, Sept 2026" + 15 → "FARMERS15"
const suggestCode = (event: string, value: string) =>
  `${(event.split(/[\s,]+/)[0] || "EVENT").replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 10) || "EVENT"}${value.replace(/[^0-9]/g, "")}`;
const day = (t: number) => new Date(t).toLocaleDateString("en-US", { timeZone: brand.timezone, month: "short", day: "numeric" });

export default function EventOfferPicker({
  event,
  discounts,
  onPickEvent,
  onOfferText,
  onDiscountCreated,
}: {
  event: string;
  discounts: Disc[];
  onPickEvent: (event: string) => void;
  onOfferText?: (text: string | null) => void;
  /** A code made here — so the Discount codes list shows it straight away. */
  onDiscountCreated?: (d: Disc) => void;
}) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // "Make a new code" right here, then it becomes this event's offer.
  const [making, setMaking] = useState(false);
  const [nType, setNType] = useState<"percentage" | "fixed">("percentage");
  const [nValue, setNValue] = useState("15");
  const [nCode, setNCode] = useState("");
  const [nCodeTouched, setNCodeTouched] = useState(false);
  const [nOnce, setNOnce] = useState(true);
  const [nEnds, setNEnds] = useState(() => addDays(pacificDay(), 30));
  const [nMin, setNMin] = useState("");
  const shownCode = nCodeTouched ? nCode : suggestCode(event, nValue);

  async function makeCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/discounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: shownCode,
          type: nType,
          value: nValue,
          label: `Event: ${event.trim()}`.slice(0, 100),
          // Works through the end of that day, local.
          expiresAt: nEnds ? pacificMidnight(addDays(nEnds, 1)) - 1 : undefined,
          perCustomerLimit: nOnce ? 1 : undefined,
          minOrderAmount: nMin || undefined,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Couldn't create the code.");
      onDiscountCreated?.(d.discount);
      setBusy(false);
      setMaking(false);
      setNCodeTouched(false);
      await save(d.discount.id);
      return;
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Couldn't create the code." });
    }
    setBusy(false);
  }

  useEffect(() => {
    fetch("/api/admin/event-offers", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setOffers(d.offers || []))
      .catch(() => {});
  }, []);

  const key = keyOf(event);
  const current = key ? offers.find((o) => o.id === key) : undefined;
  useEffect(() => {
    onOfferText?.(current?.live ? current.text : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.live, current?.text]);

  async function save(discountId: string | null, forEvent = event) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/event-offers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: forEvent, discountId }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Couldn't save the offer.");
      setOffers(d.offers || []);
      setMsg({ ok: true, text: discountId ? "Saved." : "Offer removed." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Couldn't save the offer." });
    }
    setBusy(false);
  }

  const choices = discounts.filter((d) => usable(d) || d.id === current?.discountId);

  return (
    <div className="field" style={{ marginTop: "0.75rem" }}>
      <label>Offer for this event (optional)</label>
      <select value={current?.discountId || ""} disabled={!key || busy} onChange={(e) => save(e.target.value || null)}>
        <option value="">No offer</option>
        {choices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.code} — {textOf(d)}
            {d.perCustomerLimit === 1 ? " · once per person" : ""}
            {d.expiresAt ? ` · until ${day(d.expiresAt)}` : ""}
            {usable(d) ? "" : " · NOT WORKING"}
          </option>
        ))}
      </select>
      <p className="field-hint" style={{ marginTop: "0.35rem" }}>
        {!key
          ? "Type the event name first, then pick a code."
          : current && !current.live
            ? `⚠ ${current.code || "That code"} is switched off, expired or used up, so sign-ups get no code right now. Pick another or fix it under Discount codes.`
            : current
              ? `People who sign up at “${event.trim()}” get ${current.code} (${current.text}) in their welcome email, and the page mentions it. The code's own limits still apply at checkout.`
              : "Pick one of your discount codes, or make a new one just for this event. It's emailed to new sign-ups only."}
      </p>
      {msg && <div className={msg.ok ? "ap-ok" : "ap-bad"} style={{ fontSize: "0.85rem" }}>{msg.text}</div>}

      {key && !making && (
        <button type="button" className="link-btn" style={{ marginTop: "0.35rem" }} onClick={() => setMaking(true)}>
          + Make a new code for this event
        </button>
      )}
      {key && making && (
        <form className="event-offer-new" onSubmit={makeCode}>
          <div className="eon-title">New code for “{event.trim()}”</div>
          <div className="eon-grid">
            <label className="eon-field">
              <span>Discount</span>
              <span className="eon-amount">
                <input type="number" inputMode="decimal" min="1" max={nType === "percentage" ? 100 : undefined} step="1" value={nValue} onChange={(e) => setNValue(e.target.value)} required aria-label="Discount amount" />
                <select value={nType} onChange={(e) => setNType(e.target.value as "percentage" | "fixed")} aria-label="Percent or dollars">
                  <option value="percentage">% off</option>
                  <option value="fixed">$ off</option>
                </select>
              </span>
            </label>
            <label className="eon-field">
              <span>Code</span>
              <input value={shownCode} onChange={(e) => { setNCodeTouched(true); setNCode(e.target.value.toUpperCase().replace(/\s+/g, "")); }} maxLength={24} required />
            </label>
            <label className="eon-field">
              <span>Ends</span>
              <input type="date" value={nEnds} onChange={(e) => setNEnds(e.target.value)} aria-label="Last day it works (optional)" />
            </label>
            <label className="eon-field">
              <span>Min. order</span>
              <input type="number" inputMode="decimal" min="0" step="1" value={nMin} onChange={(e) => setNMin(e.target.value)} placeholder="None" aria-label="Minimum order in dollars (optional)" />
            </label>
          </div>
          <div className="eon-foot">
            <label className="eon-once">
              <input type="checkbox" checked={nOnce} onChange={(e) => setNOnce(e.target.checked)} /> Once per person
            </label>
            <span className="eon-actions">
              <button type="button" className="esc-btn" onClick={() => setMaking(false)}>Cancel</button>
              <button type="submit" className="esc-btn primary" disabled={busy}>{busy ? "Creating…" : `Create ${shownCode || "code"} & use it`}</button>
            </span>
          </div>
          <p className="eon-note">Ends and minimum order are optional. It also appears under Discount codes, where you can switch it off any time.</p>
        </form>
      )}

      {offers.length > 0 && (
        <div className="event-offers">
          <div className="event-offers-title">Event offers</div>
          {offers.map((o) => (
            <div key={o.id} className="event-offers-row">
              <span>
                <strong>{o.event}</strong> → {o.code ? `${o.code} (${o.text})` : "deleted code"}
                {!o.live && <em className="event-offers-bad"> · not working</em>}
              </span>
              <span className="event-offers-actions">
                <button type="button" className="link-btn" onClick={() => onPickEvent(o.event)}>Use</button>
                <button type="button" className="link-btn" disabled={busy} onClick={() => save(null, o.event)}>Remove</button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
