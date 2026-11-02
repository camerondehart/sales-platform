"use client";

import { useEffect, useMemo, useState } from "react";
import { brand } from "@/lib/brand";
import { CONSULT_ACK, CONSULT_INTERESTS, SLOT_TIMES, bookableDates, slotLabel, slotMs, slotText } from "@/lib/consultSlots";

type Prefill = { firstName: string; lastName: string; email: string; phone: string };

const dayLabel = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });

export default function ConsultationForm({ prefill }: { prefill?: Prefill }) {
  const [firstName, setFirstName] = useState(prefill?.firstName || "");
  const [lastName, setLastName] = useState(prefill?.lastName || "");
  const [phone, setPhone] = useState(prefill?.phone || "");
  const [email, setEmail] = useState(prefill?.email || "");
  const [interest, setInterest] = useState("");
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  const [comments, setComments] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [signature, setSignature] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [taken, setTaken] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);

  // Worked out in the browser (dates move with the clock).
  const [now, setNow] = useState(0);
  useEffect(() => setNow(Date.now()), []);
  const days = useMemo(() => (now ? bookableDates(now) : []), [now]);
  useEffect(() => {
    if (!day && days.length) setDay(days[0]);
  }, [days, day]);

  const loadTaken = () =>
    fetch("/api/consultation", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { taken: [] }))
      .then((d) => setTaken(Array.isArray(d.taken) ? d.taken : []))
      .catch(() => {});
  useEffect(() => {
    loadTaken();
  }, []);

  const slots = day
    ? SLOT_TIMES.map((t) => ({ t, ms: slotMs(day, t) })).filter((s) => s.ms >= now + 2 * 3600_000).map((s) => ({ ...s, taken: taken.includes(s.ms) }))
    : [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!time) return setError("Please pick a time.");
    setBusy(true);
    try {
      const at = slotMs(day, time);
      const res = await fetch("/api/consultation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, phone, email, interest, at, comments, acknowledged: agreed, signature, website }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) setDone(slotText(at));
      else {
        setError(d.error || "Something went wrong. Please try again.");
        if (res.status === 409) {
          setTime("");
          loadTaken();
        }
      }
    } catch {
      setError("Couldn't reach us. Check your connection and try again.");
    }
    setBusy(false);
  }

  if (done) {
    return (
      <div className="consult-done" role="status">
        <div className="pay-check" aria-hidden="true">✓</div>
        <h3>Thanks{firstName ? `, ${firstName}` : ""}!</h3>
        <p>You asked for <strong>{done}</strong>. We&rsquo;ll confirm by phone or email, usually within one business day. A copy is on its way to {email}.</p>
        <a className="gate-button" href="/">Back to the shop</a>
      </div>
    );
  }

  return (
    <form className="consult-form" onSubmit={submit} noValidate>
      <fieldset>
        <legend>Your details</legend>
        <div className="consult-row">
          <label>First name<input className="gate-input" required autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} /></label>
          <label>Last name<input className="gate-input" required autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} /></label>
        </div>
        <div className="consult-row">
          <label>Phone number<input className="gate-input" required type="tel" autoComplete="tel" placeholder="(555) 555-0123" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
          <label>Email<input className="gate-input" required type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        </div>
        {prefill && <p className="consult-hint">Filled in from your account. Change anything that&rsquo;s different for this call.</p>}
        <label className="consult-hp" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
      </fieldset>

      <fieldset>
        <legend>What would you like to talk about?</legend>
        <select className="gate-input" required value={interest} onChange={(e) => setInterest(e.target.value)} aria-label="Consultation interest">
          <option value="">Please choose…</option>
          {CONSULT_INTERESTS.map((i) => (
            <option key={i} value={i}>{i}</option>
          ))}
        </select>
      </fieldset>

      <fieldset>
        <legend>Pick a day and time <span className="consult-tz">{brand.timezoneLabel} time</span></legend>
        <div className="consult-days" role="radiogroup" aria-label="Day">
          {days.map((d) => (
            <button key={d} type="button" role="radio" aria-checked={day === d} className={day === d ? "is-on" : ""} onClick={() => { setDay(d); setTime(""); }}>
              {dayLabel(d)}
            </button>
          ))}
        </div>
        <div className="consult-times" role="radiogroup" aria-label="Time">
          {slots.length === 0 && day && <p className="consult-hint">No times left that day. Please pick another.</p>}
          {slots.map((s) => (
            <button key={s.t} type="button" role="radio" aria-checked={time === s.t} disabled={s.taken} className={time === s.t ? "is-on" : ""} onClick={() => setTime(s.t)} title={s.taken ? "Already requested" : undefined}>
              {slotLabel(s.t)}
            </button>
          ))}
        </div>
        <p className="consult-hint">Weekdays, 9 AM to 4:30 PM. This is a request: we&rsquo;ll confirm the time with you.</p>
      </fieldset>

      <fieldset>
        <legend>Anything else we should know? <span className="consult-tz">optional</span></legend>
        <textarea className="gate-input" rows={4} maxLength={1500} value={comments} onChange={(e) => setComments(e.target.value)} placeholder="What you've tried, what you're hoping for, questions…" />
      </fieldset>

      <fieldset className="consult-ack">
        <label className="consult-check">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>{CONSULT_ACK}</span>
        </label>
        <label>Type your full name to sign<input className="gate-input consult-sign" required value={signature} onChange={(e) => setSignature(e.target.value)} placeholder={`${firstName} ${lastName}`.trim() || "Your full name"} /></label>
      </fieldset>

      {error && <p className="gate-error" role="alert">{error}</p>}
      <button type="submit" className="gate-button" disabled={busy}>{busy ? "Sending…" : "Request my consultation"}</button>
      <p className="consult-hint">We use these details only to arrange your call. See our <a href="/privacy">Privacy Policy</a>.</p>
    </form>
  );
}
