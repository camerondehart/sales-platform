"use client";

import { useCallback, useEffect, useRef } from "react";
import AssistantWidget from "@/app/components/assistant/AssistantWidget";
import { openAssistant } from "@/app/components/assistant/AskAssistant";
import { useAdminTheme } from "@/app/admin/useAdminTheme";

// The staff guide page: the guide in its sandboxed frame, plus the staff
// Concierge beside it. The frame has no access to this page, so the two talk
// with postMessage only (see the "Guide shell" script in the course):
//   page → guide  {type:"fp-guide-init"|"fp-guide-go", concierge, theme, hash}
//   guide → page  {type:"fp-guide-ready"} · {type:"fp-guide-ask", question} · {type:"fp-guide-at", id}
export default function HelpFrame({ html, title }: { html: string; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  // Same dark/light as the dashboard, so the Concierge chat here follows it too.
  useAdminTheme();

  const theme = useCallback((): "dark" | "light" => {
    try {
      const v = localStorage.getItem("fp_admin_theme");
      if (v === "dark" || v === "light") return v;
    } catch {}
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }, []);

  // The frame's own background and colour scheme match the guide's theme, so
  // nothing light shows through while the guide repaints during a scroll.
  const paint = useCallback(() => {
    const f = frame.current;
    if (!f) return;
    const dark = theme() === "dark";
    f.style.background = dark ? "#121810" : "#f2f4ef";
    f.style.colorScheme = dark ? "dark" : "light";
  }, [theme]);

  const post = useCallback(
    (type: "fp-guide-init" | "fp-guide-go") => {
      const w = frame.current?.contentWindow;
      if (!w) return;
      paint();
      w.postMessage(
        { type, theme: theme(), concierge: document.body.classList.contains("has-assistant"), hash: window.location.hash.slice(1) },
        "*"
      );
    },
    [theme, paint]
  );

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const d = (e.data || {}) as { type?: string; question?: unknown; id?: unknown };
      if (d.type === "fp-guide-ready") post("fp-guide-init");
      else if (d.type === "fp-guide-ask") openAssistant(typeof d.question === "string" && d.question.trim() ? d.question : undefined);
      else if (d.type === "fp-guide-at" && typeof d.id === "string" && /^[a-z0-9-]+$/.test(d.id)) {
        // Keep the address on the section you're reading, so a refresh or a shared link opens it.
        window.history.replaceState(null, "", `#${d.id}`);
      }
    };
    // Links to /help#section from the Concierge's answers (same page) jump the guide.
    const onHash = () => post("fp-guide-go");
    // The Concierge decides it's live a moment after load; tell the guide when it does.
    const obs = new MutationObserver(() => {
      const w = frame.current?.contentWindow;
      if (w) w.postMessage({ type: "fp-guide-go", concierge: document.body.classList.contains("has-assistant") }, "*");
    });
    obs.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onScheme = () => {
      paint();
      frame.current?.contentWindow?.postMessage({ type: "fp-guide-go", theme: theme() }, "*");
    };
    window.addEventListener("message", onMsg);
    window.addEventListener("hashchange", onHash);
    // The frame can finish loading before this page hydrates, so its "ready"
    // may have gone unheard: say hello now too (the guide only acts on the first).
    post("fp-guide-init");
    mq?.addEventListener?.("change", onScheme);
    return () => {
      window.removeEventListener("message", onMsg);
      window.removeEventListener("hashchange", onHash);
      mq?.removeEventListener?.("change", onScheme);
      obs.disconnect();
    };
  }, [post, theme, paint]);

  return (
    <>
      <iframe
        ref={frame}
        className="help-frame"
        title={title}
        srcDoc={html}
        onLoad={() => post("fp-guide-init")}
        sandbox="allow-scripts allow-popups allow-modals allow-top-navigation-by-user-activation"
      />
      <AssistantWidget mode="admin" />
    </>
  );
}
