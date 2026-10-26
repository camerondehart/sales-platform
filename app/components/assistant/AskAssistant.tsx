"use client";

import { useEffect, useState } from "react";
import { EVT_ASK, EVT_OPEN, SUPPORT_EMAIL, hiddenFromAssistant } from "@/lib/assistant/shared";

/**
 * Entry points into the chat from elsewhere on the page.
 *
 * They only render once the chat widget has confirmed the assistant is live
 * for this visitor (it puts `has-assistant` on <body>), so there's never a
 * button that opens nothing.
 */
function useAssistantLive(): boolean {
  const [live, setLive] = useState(false);
  useEffect(() => {
    const check = () => setLive(document.body.classList.contains("has-assistant"));
    check();
    // The widget decides a moment after page load; watch for it.
    const obs = new MutationObserver(check);
    obs.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return live;
}

export function openAssistant(question?: string) {
  if (question) window.dispatchEvent(new CustomEvent(EVT_ASK, { detail: { question } }));
  else window.dispatchEvent(new CustomEvent(EVT_OPEN));
}

/** A small text link / pill that opens the chat. */
export function AskAssistantLink({
  label = "Ask our Concierge",
  shortLabel,
  question,
  className = "ask-link",
}: {
  label?: string;
  /** Shorter wording for phones (shown instead of `label` on narrow screens). */
  shortLabel?: string;
  question?: string;
  className?: string;
}) {
  const live = useAssistantLive();
  if (!live) return null;
  return (
    <button type="button" className={className} onClick={() => openAssistant(question)} aria-label={label}>
      <span className="ask-spark" aria-hidden="true">✦</span>{" "}
      {shortLabel ? (
        <>
          <em className="nl-long">{label}</em>
          <em className="nl-short">{shortLabel}</em>
        </>
      ) : (
        label
      )}
    </button>
  );
}

/**
 * "Questions about this product?" callout for the product pop-up.
 * `onAsk` closes the pop-up first so the chat isn't hidden behind it.
 */
export function AskAboutProduct({
  product,
  onAsk,
}: {
  product: { name: string; category?: string; description?: string };
  onAsk: () => void;
}) {
  const live = useAssistantLive();
  if (hiddenFromAssistant(product)) {
    // The team answers questions about these personally.
    const href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Question about ${product.name}`)}`;
    return (
      <a className="ask-product" href={href}>
        <span className="ask-product-icon" aria-hidden="true">✉</span>
        <span className="ask-product-text">
          <strong>Questions about this product?</strong>
          <span>Our team answers these personally — email support</span>
        </span>
        <span className="ask-product-arrow" aria-hidden="true">→</span>
      </a>
    );
  }
  if (!live) return null;
  return (
    <button
      type="button"
      className="ask-product"
      onClick={() => {
        onAsk();
        // Let the pop-up close before the chat opens.
        setTimeout(() => openAssistant(`Tell me about ${product.name}`), 60);
      }}
    >
      <span className="ask-product-icon" aria-hidden="true">✦</span>
      <span className="ask-product-text">
        <strong>Questions about this product?</strong>
        <span>Ask our Concierge — answers in seconds</span>
      </span>
      <span className="ask-product-arrow" aria-hidden="true">→</span>
    </button>
  );
}
