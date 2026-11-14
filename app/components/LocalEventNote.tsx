"use client";

import { useEffect, useState } from "react";
import { brand } from "@/lib/brand";
import type { LocalEventNote as Note } from "@/lib/localEvents";

/**
 * The one-time events note for members near the town in Settings → Events popup (switch local_events_note,
 * lib/localEvents.ts). A small card in the corner, not a blocking pop-up: it
 * slides in a moment after the gallery settles, and the server is told it was
 * shown so it never appears again for this member, on any device.
 */
const when = (ms: number) =>
  new Date(ms).toLocaleString("en-US", { timeZone: brand.timezone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function LocalEventNote({ event }: { event: Note }) {
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setOpen(true);
      fetch("/api/account/events-note", { method: "POST" }).catch(() => {});
    }, 1200);
    return () => clearTimeout(t);
  }, []);

  function close() {
    setLeaving(true);
    setTimeout(() => setGone(true), 280);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open || gone) return null;
  const [day, time] = (() => {
    const s = when(event.date);
    const i = s.lastIndexOf(", ");
    return i > 0 ? [s.slice(0, i), s.slice(i + 2)] : [s, ""];
  })();

  return (
    <aside className={`lev-card${leaving ? " lev-leaving" : ""}`} aria-label="Upcoming events near you">
      <button type="button" className="lev-close" onClick={close} aria-label="Close">×</button>
      <div className="lev-kicker">{event.kicker}</div>
      <h2 className="lev-title">{event.heading}</h2>
      <div className="lev-event">
        <strong>{event.title}</strong>
        <span>
          {day}
          {time && <> · {time}</>}
          {event.location && <> · {event.location}</>}
        </span>
      </div>
      {event.more > 0 && <p className="lev-more">and {event.more} more coming up</p>}
      <a className="lev-go" href="/events" onClick={() => setGone(true)}>
        See events <span aria-hidden="true">→</span>
      </a>
    </aside>
  );
}
