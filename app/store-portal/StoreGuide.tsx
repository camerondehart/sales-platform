"use client";

import { EVT_ASK } from "@/lib/assistant/shared";

/**
 * "How the portal works": the guide for store staff, inside the portal.
 * Opened from the header; shown once on a store login's first visit.
 * The Ask buttons send the question to the portal's Concierge.
 */

export const STORE_GUIDE_SEEN = "fp_store_guide_seen";

const ask = (question: string) => window.dispatchEvent(new CustomEvent(EVT_ASK, { detail: { question } }));

const STEPS: Array<{ icon: string; title: string; body: string }> = [
  { icon: "🛒", title: "Request stock", body: "Under Request stock, type how many units you'd like of each product (tap a product to see its picture and description), add a note if you like, and press Send request. The team gets it straight away." },
  { icon: "🔎", title: "Follow it", body: "Your requests shows each one with its progress, below. The team may add a note, such as a delivery day or tracking number." },
  { icon: "📦", title: "When it lands", body: "Press It arrived on the request so we know it got to you. Changed your mind before we've looked at it? Press Cancel request." },
  { icon: "📊", title: "What we've sent", body: "Shipped to you adds up every unit we've shipped you, with the last shipment and a month-by-month view." },
  { icon: "✉️", title: "Changes and questions", body: "Need your address, hours or logins changed, or have a question? Use Message the team under Your store. It goes to our inbox and we reply by email." },
  { icon: "🔑", title: "Signing in", body: "Each person at your shop has their own login. Sign in with your password, an emailed 6-digit code, or Face ID / Touch ID once you add it at the bottom of this page. Forgot your password? Use the link on the sign-in page." },
];

const STATUSES: Array<[string, string, string]> = [
  ["wait", "Waiting for review", "We've got it and will look soon"],
  ["go", "Approved, being packed", "It's being put together"],
  ["ship", "Shipped", "On its way to you"],
  ["done", "Received", "You pressed It arrived (or we marked it)"],
  ["no", "Declined / Cancelled", "Not going ahead; any note says why"],
];

const QUESTIONS = ["How do I request more stock?", "Where's my latest request?", "What have you shipped us this year?", "Please update our store hours"];

export default function StoreGuide({ onClose }: { onClose: () => void }) {
  return (
    <section className="sp-card sp-guide" aria-labelledby="sp-guide-h">
      <div className="sp-guide-top">
        <h2 id="sp-guide-h" className="sp-h2">How the portal works</h2>
        <button type="button" className="sp-btn sp-btn-ghost" onClick={onClose}>Got it</button>
      </div>
      <p className="sp-muted">Everything your shop needs from us in one place. There are no prices or invoices here; for those, message the team.</p>
      <ol className="sp-guide-steps">
        {STEPS.map((s) => (
          <li key={s.title}>
            <span className="sp-guide-ico" aria-hidden="true">{s.icon}</span>
            <div>
              <strong>{s.title}</strong>
              <p>{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <h3>What each status means</h3>
      <ul className="sp-guide-status">
        {STATUSES.map(([pill, label, means]) => (
          <li key={label}><span className={`sp-pill sp-pill-${pill}`}>{label}</span> <span className="sp-muted">{means}</span></li>
        ))}
      </ul>
      <h3>Or just ask</h3>
      <p className="sp-muted">Our Concierge can do all of this for you: request stock, check a request, cancel one, confirm a delivery or message the team. It shows you what it will do, and nothing happens until you press its button.</p>
      <div className="sp-guide-asks">
        {QUESTIONS.map((q) => (
          <button key={q} type="button" className="sp-btn sp-btn-ghost" onClick={() => ask(q)}>✦ {q}</button>
        ))}
      </div>
    </section>
  );
}
