"use client";

import { useEffect, useState } from "react";
import { brand } from "@/lib/brand";
import { useAdminRefresh } from "./useAdminRefresh";
import type { AdminRefreshKey } from "@/lib/assistant/shared";
import type { NoteArea, NoteSettings } from "@/lib/localEvents";

// Settings → Events popup (switch `local_events_note`, lib/localEvents.ts):
// the main area and heading, "Show it again to everyone", and each upcoming
// event's control. The same per-event control sits in the event forms
// (EventNoteControls below). Every change is in the Activity log.

type Ev = { id: string; title: string; date: number; location: string; published: boolean; notePopup: boolean; noteArea: NoteArea | null };
type Status = { switchOn: boolean; settings: NoteSettings; events: Ev[] };

const when = (ms: number) =>
  new Date(ms).toLocaleString("en-US", { timeZone: brand.timezone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The main area, for the per-event hints ("blank = the main town and miles"). */
function useMainArea(): NoteArea | null {
  const [a, setA] = useState<NoteArea | null>(null);
  useEffect(() => {
    fetch("/api/admin/events-note", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setA(d.settings.area))
      .catch(() => {});
  }, []);
  return a;
}

/**
 * The popup controls for one event, used in the create and edit forms.
 * Values are sent with the event as notePopup / notePlace / noteMiles.
 */
export function EventNoteControls({
  on,
  place,
  miles,
  found,
  onChange,
}: {
  on: boolean;
  place: string;
  miles: string;
  /** The saved area of the event being edited, to show which place the map found. */
  found?: NoteArea | null;
  onChange: (v: { on: boolean; place: string; miles: string }) => void;
}) {
  const main = useMainArea();
  return (
    <div className="field full evn-controls">
      <label className="check-row">
        <input type="checkbox" checked={on} onChange={(e) => onChange({ on: e.target.checked, place, miles })} />
        <span>Show in the events popup for locals</span>
      </label>
      {on && (
        <div className="evn-area">
          <input value={place} onChange={(e) => onChange({ on, place: e.target.value, miles })} placeholder={main ? `Town (blank = ${main.place})` : "Town (blank = the main area)"} aria-label="Popup town for this event" />
          <input type="number" min="1" max="500" value={miles} onChange={(e) => onChange({ on, place, miles: e.target.value })} placeholder={main ? `${main.miles} miles` : "Miles"} aria-label="Popup miles for this event" />
        </div>
      )}
      {on && place.trim() && (found ? <Found area={found} typed={place} /> : <small className="evn-found">Saving checks this town on the map (US only).</small>)}
      <div className="field-hint">
        {on
          ? "Members who sign in nearby get one small note about the next event. Leave the town blank to use the main area in Settings → Events popup."
          : "This event is never in the popup."}
      </div>
    </div>
  );
}

/** Which place the map matched the town to, so a wrong match is obvious. */
function Found({ area, typed }: { area: NoteArea; typed: string }) {
  if (typed.trim() !== area.place) return <small className="evn-found">Press Save to look this town up.</small>;
  if (!area.found) return <small className="evn-found">Not checked on the map yet. Press Save to see which place it finds.</small>;
  return <small className="evn-found">Found: <strong>{area.found}</strong></small>;
}

function EventRow({ ev, main, onSaved }: { ev: Ev; main: NoteArea; onSaved: (s: Status) => void }) {
  const [on, setOn] = useState(ev.notePopup);
  const [place, setPlace] = useState(ev.noteArea?.place || "");
  const [miles, setMiles] = useState(ev.noteArea ? String(ev.noteArea.miles) : "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = on !== ev.notePopup || place.trim() !== (ev.noteArea?.place || "") || miles.trim() !== (ev.noteArea ? String(ev.noteArea.miles) : "");

  async function save() {
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/admin/events-note", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: ev.id, notePopup: on, notePlace: place, noteMiles: miles }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: d.error || "That didn't save. Try again." });
    setMsg({ ok: true, text: "Saved." });
    onSaved(d);
  }

  const area = ev.noteArea || main;
  return (
    <li className={on ? "" : "is-off"}>
      <div className="evn-ev-main">
        <strong>{ev.title}</strong>
        <small>
          {when(ev.date)} · {ev.location}
          {!ev.published && " · Draft (not shown until published)"}
        </small>
        <small className="evn-reach">{on ? `Popup reaches ${area.miles} miles around ${area.place}${ev.noteArea ? " (its own area)" : ""}` : "Not in the popup"}</small>
        {on && ev.noteArea && <Found area={ev.noteArea} typed={place} />}
      </div>
      <div className="evn-ev-controls">
        <label className="check-row">
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
          <span>In popup</span>
        </label>
        {on && (
          <div className="evn-area">
            <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder={`Town (blank = ${main.place})`} aria-label={`Popup town for ${ev.title}`} />
            <input type="number" min="1" max="500" value={miles} onChange={(e) => setMiles(e.target.value)} placeholder={`${main.miles} miles`} aria-label={`Popup miles for ${ev.title}`} />
          </div>
        )}
        {(dirty || msg) && (
          <div className="evn-save">
            {dirty && <button type="button" className="esc-btn" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>}
            {msg && <span className={msg.ok ? "ap-ok" : "ap-bad"}>{msg.text}</span>}
          </div>
        )}
      </div>
    </li>
  );
}

export default function EventsNotePanel() {
  const [st, setSt] = useState<Status | null>(null);
  const [place, setPlace] = useState("");
  const [miles, setMiles] = useState("");
  const [heading, setHeading] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const apply = (d: Status) => {
    setSt(d);
    setPlace(d.settings.area.place);
    setMiles(String(d.settings.area.miles));
    setHeading(d.settings.heading);
  };
  const load = () =>
    fetch("/api/admin/events-note", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(apply)
      .catch(() => setMsg({ ok: false, text: "Couldn't load the popup settings." }));
  useEffect(() => {
    load();
  }, []);
  useAdminRefresh(["events", "flags", "settings"] as AdminRefreshKey[], () => load());

  async function send(method: "PUT" | "POST", body: unknown, done: string) {
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/admin/events-note", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: d.error || "That didn't save. Try again." });
    apply(d);
    setMsg({ ok: true, text: done });
  }

  if (!st) return <p className="field-hint">{msg?.text || "Loading…"}</p>;
  const s = st.settings;
  return (
    <section className="admin-section evn">
      <h2>Events popup</h2>
      <div className="notice">
        Members who sign in near the town below see one small note about the next upcoming event, with a link to the Events page.
        Each member sees it once, until you press <em>Show it again to everyone</em>. Their rough area comes from their internet
        address and is never stored.
        {!st.switchOn && <> <strong>The “Events note for locals” switch is off, so nobody sees it right now.</strong></>}
      </div>

      <form
        className="admin-form"
        onSubmit={(e) => {
          e.preventDefault();
          send("PUT", { place, miles, heading }, "Saved.");
        }}
      >
        <div className="field">
          <label>Center town</label>
          <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder={brand.eventsArea.place} required />
          <Found area={s.area} typed={place} />
        </div>
        <div className="field">
          <label>Miles around it</label>
          <input type="number" min="1" max="500" value={miles} onChange={(e) => setMiles(e.target.value)} required />
        </div>
        <div className="field full">
          <label>Heading</label>
          <input value={heading} maxLength={80} onChange={(e) => setHeading(e.target.value)} placeholder="Gather with us, close to home" />
          <div className="field-hint">Above it, small: “Near {(place.split(",")[0] || place).trim() || "…"}”. Leave blank for the usual heading.</div>
        </div>
        <div className="full" style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
          <button type="submit" className="submit" disabled={busy} style={{ width: "auto" }}>{busy ? "Saving…" : "Save"}</button>
          <button
            type="button"
            className="esc-btn"
            disabled={busy}
            onClick={() => confirm("Show the popup once more to every member nearby, including those who've already seen it?") && send("POST", { action: "show-again" }, "Done. Members nearby will see it once more on their next visit.")}
          >
            Show it again to everyone
          </button>
          {s.resetAt && <span className="field-hint">Last shown again {when(s.resetAt)}</span>}
        </div>
      </form>
      {msg && <div className={msg.ok ? "ap-ok" : "ap-bad"} style={{ marginTop: "0.7rem" }}>{msg.text}</div>}

      <h3 className="evn-h3">Upcoming events</h3>
      {st.events.length === 0 ? (
        <p className="field-hint">No upcoming events. Add one in the Events tab; it&rsquo;s in the popup unless you untick it.</p>
      ) : (
        <ul className="evn-list">
          {st.events.map((ev) => (
            <EventRow key={`${ev.id}:${ev.notePopup}:${ev.noteArea?.place || ""}:${ev.noteArea?.miles || ""}`} ev={ev} main={s.area} onSaved={apply} />
          ))}
        </ul>
      )}
      <p className="field-hint" style={{ marginTop: "0.6rem" }}>The popup shows the soonest published event that reaches the member, and says how many more are coming up.</p>
    </section>
  );
}
