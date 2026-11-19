"use client";

import { useState } from "react";

// The gift card code with a Copy button. Falls back to selecting the text
// when the browser won't let us write to the clipboard.
export default function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(code);
      ok = true;
    } catch {
      try {
        const t = document.createElement("textarea");
        t.value = code;
        t.setAttribute("readonly", "");
        t.style.position = "fixed";
        t.style.opacity = "0";
        document.body.appendChild(t);
        t.select();
        ok = document.execCommand("copy");
        t.remove();
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    }
  }

  return (
    <div className="gift-open-coderow">
      <code className="gift-open-code">{code}</code>
      <button type="button" className={`gift-copy-btn${copied ? " done" : ""}`} onClick={copy} aria-live="polite">
        {copied ? "Copied ✓" : "Copy code"}
      </button>
    </div>
  );
}
