"use client";

import { useEffect, useState } from "react";
import { track } from "@/lib/track";
import { brand } from "@/lib/brand";
import SiteNav from "@/app/components/SiteNav";

type PublicEvent = {
  id: string;
  title: string;
  description: string;
  date: number;
  endDate: number | null;
  location: string;
  price: string | null;
  type: string;
  image: string | null;
  capacity: number;
  spotsLeft: number | null;
  registered: number;
  waitlisted: number;
  waitlistOpen: boolean;
  full: boolean;
};

const TYPE_LABELS: Record<string, string> = {
  class: "Class",
  workshop: "Workshop",
  vendor: "Vendor event",
  other: "Event",
};

function formatDate(ts: number): string {
  // Events happen here, so their times are always local.
  return new Date(ts).toLocaleString("en-US", {
    timeZone: brand.timezone,
    weekday: "short", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

export default function EventsClient({ stores = false }: { stores?: boolean }) {
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PublicEvent | null>(null);
  const [detail, setDetail] = useState<PublicEvent | null>(null);
  const [inquiryOpen, setInquiryOpen] = useState(false);

  // Keep scrolling inside whichever overlay is open.
  useEffect(() => {
    const open = !!selected || !!detail || inquiryOpen;
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [selected, detail, inquiryOpen]);

  function load() {
    fetch("/api/events")
      .then((r) => r.json())
      .then((d) => setEvents(d.events || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  return (
    <>
      <div className="shell">
        <header className="masthead">
          <a className="masthead-brand" href="/" aria-label={`${brand.name} home`}>
            <div className="logo-mark floaty" aria-hidden="true">
              <span></span><span></span><span></span><span></span>
            </div>
            <h1 className="masthead-title">Classes &amp; Events</h1>
          </a>
          <SiteNav current="events" stores={stores} />
        </header>

        <div className="retail-intro">
          <h2>Gather with us</h2>
          <p>
            Classes, workshops, and vendor events. Reserve your spot below, or ask us about
            booking a private workshop for your group.
          </p>
        </div>

        {loading ? (
          <div className="empty">Loading events…</div>
        ) : events.length === 0 ? (
          <div className="empty">
            No events on the calendar right now. Check back soon, or ask about a private workshop.
          </div>
        ) : (
          <div className="events-list">
            {events.map((e, idx) => (
              <article key={e.id} className="event-card fade-rise" style={{ animationDelay: `${Math.min(idx * 60, 300)}ms` }}>
                {e.image && (
                  <div
                    className="event-img"
                    onClick={() => setDetail(e)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(k) => { if (k.key === "Enter") setDetail(e); }}
                    aria-label={`View details for ${e.title}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={e.image} alt={e.title} loading="lazy" />
                  </div>
                )}
                <div className="event-body">
                  <div className="event-type">{TYPE_LABELS[e.type] || "Event"}</div>
                  <h3
                    className="event-title event-title-link"
                    onClick={() => setDetail(e)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(k) => { if (k.key === "Enter") setDetail(e); }}
                  >
                    {e.title}
                  </h3>
                  <div className="event-meta">
                    <span>🗓 {formatDate(e.date)}</span>
                    <span>📍 {e.location}</span>
                    {e.price && <span>🎟 {e.price}</span>}
                  </div>
                  {e.description && <p className="event-desc">{e.description}</p>}
                  <div className="event-foot">
                    <span className="event-spots">
                      {e.full
                        ? "Fully booked"
                        : e.spotsLeft === null
                        ? "Open registration"
                        : e.spotsLeft > 0
                        ? `${e.spotsLeft} spot${e.spotsLeft === 1 ? "" : "s"} left`
                        : `Waitlist open · ${e.waitlisted} waiting`}
                    </span>
                    <div className="event-actions">
                      <button className="event-details-btn" onClick={() => setDetail(e)}>
                        Details
                      </button>
                      <button
                        className="submit"
                        style={{ width: "auto", padding: "0.6rem 1.3rem", marginTop: 0 }}
                        disabled={e.full}
                        onClick={() => setSelected(e)}
                      >
                        {e.full ? "Full" : e.spotsLeft === 0 ? "Join waitlist" : "Register"}
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        <footer className="footnotes">
          <div className="footnotes-ornament" aria-hidden="true">
            <span></span><span>{brand.emoji}</span><span></span>
          </div>
          <div className="footnotes-grid">
            <div className="footnote">
              <div className="footnote-icon" aria-hidden="true">✨</div>
              <div className="footnote-title">Private workshops</div>
              <p>
                Want something for your own group? We host private sessions.{" "}
                <a href="#" onClick={(e) => { e.preventDefault(); setInquiryOpen(true); }}>
                  Send an inquiry&nbsp;→
                </a>
              </p>
            </div>
            <div className="footnote">
              <div className="footnote-icon" aria-hidden="true">🌿</div>
              <div className="footnote-title">Join {brand.members}</div>
              <p>Members get early access to events and a private catalog. <a href="/">Request access&nbsp;→</a></p>
            </div>
          </div>
        </footer>
      </div>

      {/* Event details */}
      {detail && (
        <div className="modal-backdrop" onClick={() => setDetail(null)}>
          <div className="modal event-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setDetail(null)} aria-label="Close">×</button>
            {detail.image && (
              <div className="modal-image">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={detail.image} alt={detail.title} />
              </div>
            )}
            <div className="modal-body">
              <div className="event-type">{TYPE_LABELS[detail.type] || "Event"}</div>
              <h2 className="modal-name">{detail.title}</h2>

              <div className="event-detail-rows">
                <div className="event-detail-row">
                  <span aria-hidden="true">🗓</span>
                  <div>
                    <strong>{formatDate(detail.date)}</strong>
                    {detail.endDate && (
                      <div className="event-detail-sub">
                        until {new Date(detail.endDate).toLocaleTimeString("en-US", { timeZone: brand.timezone, hour: "numeric", minute: "2-digit" })}
                      </div>
                    )}
                  </div>
                </div>
                <div className="event-detail-row">
                  <span aria-hidden="true">📍</span>
                  <div><strong>{detail.location}</strong></div>
                </div>
                {detail.price && (
                  <div className="event-detail-row">
                    <span aria-hidden="true">🎟</span>
                    <div><strong>{detail.price}</strong></div>
                  </div>
                )}
                <div className="event-detail-row">
                  <span aria-hidden="true">👥</span>
                  <div>
                    <strong>
                      {detail.full
                        ? "Fully booked"
                        : detail.spotsLeft === null
                        ? "Open registration"
                        : detail.spotsLeft > 0
                        ? `${detail.spotsLeft} spot${detail.spotsLeft === 1 ? "" : "s"} left`
                        : "Waitlist open"}
                    </strong>
                    {detail.capacity > 0 && (
                      <div className="event-detail-sub">
                        {detail.registered} of {detail.capacity} registered
                        {detail.waitlisted > 0 ? ` · ${detail.waitlisted} waiting` : ""}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {detail.description && (
                <>
                  <div className="divider" />
                  <div className="desc">
                    {detail.description.split(/\n\s*\n/).map((para, i) => (
                      <p key={i} className={i === 0 ? "desc-lede" : undefined}>{para}</p>
                    ))}
                  </div>
                </>
              )}

              <button
                className="submit"
                disabled={detail.full}
                onClick={() => { const e = detail; setDetail(null); setSelected(e); }}
              >
                {detail.full
                  ? "Fully booked"
                  : detail.spotsLeft === 0
                  ? "Join the waitlist"
                  : "Register for this event"}
              </button>
              {detail.spotsLeft === 0 && !detail.full && (
                <p className="event-waitlist-note">
                  We'll move you up automatically if a spot opens.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {selected && (
        <RegisterModal event={selected} onClose={() => setSelected(null)} onDone={load} />
      )}
      {inquiryOpen && <PrivateWorkshopModal onClose={() => setInquiryOpen(false)} />}
    </>
  );
}

function RegisterModal({
  event,
  onClose,
  onDone,
}: {
  event: PublicEvent;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [subscribe, setSubscribe] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<null | string>(null);
  const [error, setError] = useState("");

  const waitlisting = event.spotsLeft === 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/events/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: event.id, name, email, phone, notes, subscribe }),
      });
      const data = await res.json();
      if (res.ok) {
        track("event_signup");
        setDone(data.status);
        onDone();
      } else {
        setError(data.error || "Something went wrong.");
      }
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
          {done ? (
            <div className="success fade-rise" style={{ textAlign: "center" }}>
              {done === "registered" ? "You're registered! 🌿" : "You're on the waitlist."}
              <div style={{ fontSize: "0.9rem", marginTop: "1rem", fontStyle: "normal", color: "var(--ink-soft)" }}>
                {done === "registered"
                  ? "A confirmation is on its way to your inbox. We can't wait to see you."
                  : "We'll email you right away if a spot opens up."}
              </div>
              <button className="submit" style={{ marginTop: "1.5rem" }} onClick={onClose}>Close</button>
            </div>
          ) : (
            <>
              <h2 className="modal-name" style={{ fontSize: "1.6rem" }}>
                {waitlisting ? "Join the waitlist" : "Register"}
              </h2>
              <div className="event-meta" style={{ marginBottom: "1.25rem" }}>
                <span>{event.title}</span>
                <span>🗓 {formatDate(event.date)}</span>
                {event.price && <span>🎟 {event.price}</span>}
              </div>
              {waitlisting && (
                <div className="notice" style={{ fontSize: "0.87rem", marginBottom: "1rem" }}>
                  This event is full. Join the waitlist and we'll contact you if a spot opens.
                </div>
              )}
              <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
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
                  <label>Anything we should know? (optional)</label>
                  <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
                <label className="inquiry-check">
                  <input type="checkbox" checked={subscribe} onChange={(e) => setSubscribe(e.target.checked)} />
                  <span><strong>Email me about future events</strong><small>Unsubscribe any time.</small></span>
                </label>
                <button type="submit" className="submit" disabled={submitting}>
                  {submitting ? "Submitting…" : waitlisting ? "Join waitlist" : "Confirm registration"}
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

function PrivateWorkshopModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/events/private-inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone, details }),
      });
      if (res.ok) setSent(true);
      else setError((await res.json().catch(() => ({}))).error || "Something went wrong.");
    } catch {
      setError("Network error.");
    }
    setSubmitting(false);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal checkout-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <div className="modal-body" style={{ width: "100%" }}>
          {sent ? (
            <div className="success fade-rise" style={{ textAlign: "center" }}>
              Thank you — we've got your request.
              <div style={{ fontSize: "0.9rem", marginTop: "1rem", fontStyle: "normal", color: "var(--ink-soft)" }}>
                We'll be in touch soon to talk through the details.
              </div>
              <button className="submit" style={{ marginTop: "1.5rem" }} onClick={onClose}>Close</button>
            </div>
          ) : (
            <>
              <h2 className="modal-name" style={{ fontSize: "1.6rem" }}>Book a private workshop</h2>
              <p style={{ color: "var(--ink-soft)", fontSize: "0.92rem", margin: "0.5rem 0 1.25rem", lineHeight: 1.6 }}>
                Tell us a little about what you have in mind and we'll follow up with options.
              </p>
              <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
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
                  <label>What are you thinking?</label>
                  <textarea required rows={4} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Group size, rough dates, what you'd like to explore…" />
                </div>
                <button type="submit" className="submit" disabled={submitting}>
                  {submitting ? "Sending…" : "Send inquiry"}
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
