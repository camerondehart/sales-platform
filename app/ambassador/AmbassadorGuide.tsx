"use client";

import { brand } from "@/lib/brand";

/**
 * "How your panel works": the guide for ambassadors, inside /ambassador.
 * Opened from the hero; shown once on an ambassador's first visit.
 * Reuses the store portal guide's look (.sp-guide*, app/globals.css).
 */

export const AMB_GUIDE_SEEN = "fp_amb_guide_seen";

const STEPS: Array<{ icon: string; title: string; body: string }> = [
  { icon: "🔗", title: "Share your link", body: "Copy your link or download your QR code and share it anywhere. Orders from people who visit through it count for you for the number of days shown under Your terms." },
  { icon: "🏷️", title: "Your code", body: "If you have a code, customers type it at checkout for the discount shown. Orders that use it count for you too, even if they never visited your page." },
  { icon: "📊", title: "Read your numbers", body: "Pick a range (7 days to All time). The tiles show page visits (and QR scans), products opened from your page, membership requests, orders, sales and your commission, each compared with the period before. Over time charts them by day, week or month." },
  { icon: "💚", title: "Your earnings", body: "Commission is on product sales after discounts, not shipping, once an order is paid. Earned so far, Paid to you and Coming to you show where it stands; payouts we send show under Recent payouts." },
  { icon: "✨", title: "Choose your picks", body: "Under Your picks, add up to 24 products for your page and put them in order with ↑ ↓, then press Save my picks. Members-only picks show locked to visitors who aren't members. Pick nothing and your page shows the whole shop." },
  { icon: "🧾", title: "Your orders", body: "Each order's number, date, status, products and what you earn. We never show who bought." },
  { icon: "📄", title: "Your terms", body: "Your commission rate, any growth rate and its goal, how long a visit counts, your start date and any trial. Only the team can change them: email us with any questions." },
  { icon: "🔑", title: "Getting back here", body: "Sign in the usual way (password, emailed code or Face ID) and you land here. You can still shop as a member any time: the panel link is in the Account menu on phones and the top bar on computers." },
];

export default function AmbassadorGuide({ onClose }: { onClose: () => void }) {
  return (
    <section className="sp-card sp-guide abp-guide" aria-labelledby="abp-guide-h">
      <div className="sp-guide-top">
        <h2 id="abp-guide-h" className="sp-h2">How your panel works</h2>
        <button type="button" className="sp-btn sp-btn-ghost" onClick={onClose}>Got it</button>
      </div>
      <p className="sp-muted">Everything about your page in one place. Only you (and the {brand.shortName} team) can see this panel.</p>
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
    </section>
  );
}
