"use client";

import { useState } from "react";

/** Their discount code with a one-tap Copy (ambassador pages). */
export default function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };
  return (
    <button type="button" className="amb-code" onClick={copy} aria-label={`Copy code ${code}`}>
      <span className="amb-code-text">{code}</span>
      <span className="amb-code-copy">{copied ? "Copied ✓" : "Copy"}</span>
    </button>
  );
}
