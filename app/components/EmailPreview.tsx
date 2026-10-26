"use client";

import { useState } from "react";

/**
 * "Preview email" for staff: shows the real email HTML (house header, body,
 * footer, sample name "Alex") in a sandboxed frame — no scripts, can't touch
 * the page. Used in Marketing → Templates and on the Concierge's template and
 * campaign-draft cards.
 */
export default function EmailPreview({ subject, body, label = "Preview email" }: { subject?: string; body: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [shownFor, setShownFor] = useState("");

  async function toggle() {
    if (open) return setOpen(false);
    setOpen(true);
    const key = `${subject || ""}\n${body}`;
    if (html && shownFor === key) return;
    setLoading(true);
    setErr("");
    try {
      const r = await fetch("/api/admin/templates/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Couldn't build the preview.");
      setHtml(d.html);
      setShownFor(key);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't build the preview.");
    }
    setLoading(false);
  }

  return (
    <div className="email-preview">
      <button type="button" className="email-preview-btn" onClick={toggle} aria-expanded={open}>
        {open ? "Hide preview" : label}
      </button>
      {open && (
        <div className="email-preview-box">
          {subject !== undefined && (
            <div className="email-preview-subject">
              <span>Subject</span> {subject || <em>(no subject yet)</em>}
            </div>
          )}
          {loading ? (
            <div className="email-preview-note">Building preview…</div>
          ) : err ? (
            <div className="email-preview-note bad">{err}</div>
          ) : html ? (
            <iframe className="email-preview-frame" title="Email preview" sandbox="" srcDoc={html} />
          ) : null}
        </div>
      )}
    </div>
  );
}
