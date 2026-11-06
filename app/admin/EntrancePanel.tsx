"use client";

import { useEffect, useState } from "react";
import EntrancePlayer from "@/app/components/EntrancePlayer";
import { ENTRANCE_THEMES, type EntranceChoice, type EntranceKey } from "@/lib/entranceThemes";
import { useAdminRefresh } from "./useAdminRefresh";
import type { AdminRefreshKey } from "@/lib/assistant/shared";

type Status = {
  switchOn: boolean;
  siteSwitchOn?: boolean;
  siteShowing?: string;
  choice: EntranceChoice;
  showing: EntranceKey;
  showingLabel: string;
  upcoming: Array<{ from: string; key: EntranceKey; label: string }>;
};

const day = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

/** Settings → Entrance animation: preview every theme and choose one, or Auto. */
export default function EntrancePanel() {
  const [st, setSt] = useState<Status | null>(null);
  const [playing, setPlaying] = useState<EntranceKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = () =>
    fetch("/api/admin/entrance", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setSt)
      .catch(() => setMsg("Couldn't load the entrance settings."));
  useEffect(() => {
    load();
  }, []);
  useAdminRefresh(["entrance", "flags"] as AdminRefreshKey[], () => load());

  async function choose(choice: EntranceChoice) {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/admin/entrance", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ choice }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Couldn't save.");
      setSt(d);
      setMsg(choice === "auto" ? `Saved: Auto. Members now see ${d.showingLabel}.` : `Saved: members now see ${ENTRANCE_THEMES[choice].label}.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't save.");
    }
    setBusy(false);
  }

  if (!st) return <p className="field-hint">{msg || "Loading…"}</p>;
  return (
    <div className="ent">
      <p className="ent-now">
        Members see <strong>{ENTRANCE_THEMES[st.showing].emoji} {st.showingLabel}</strong> right now
        {st.switchOn ? (st.choice === "auto" ? " (Auto)." : ".") : ". Seasonal entrances are switched off, so it's always Classic."}
        <button type="button" className="esc-btn" onClick={() => setPlaying(st.showing)}>▶ Play it</button>
      </p>
      <p className="field-hint">
        {st.siteSwitchOn
          ? <>The site&rsquo;s background follows the same theme (soft colours and a few leaves, snowflakes or petals drifting down): now <strong>{st.siteShowing}</strong>. Staff pages never change.</>
          : <>Switch on <strong>Seasonal site backgrounds</strong> in Feature switches to have the site&rsquo;s background follow this theme too.</>}
      </p>
      {!st.switchOn && (
        <p className="field-hint">Switch on <strong>Seasonal entrance animations</strong> in Feature switches to use the themes below. You can still preview them.</p>
      )}

      <div className="ent-grid">
        <div className={`ent-card ent-auto${st.choice === "auto" ? " is-on" : ""}`}>
          <div className="ent-swatch" aria-hidden="true">✨</div>
          <strong>Auto</strong>
          <span className="ent-when">Holidays first, then the season</span>
          <div className="ent-actions">
            <button type="button" className="esc-btn primary" disabled={busy || st.choice === "auto"} onClick={() => choose("auto")}>{st.choice === "auto" ? "In use" : "Use Auto"}</button>
          </div>
        </div>
        {Object.values(ENTRANCE_THEMES).map((t) => (
          <div key={t.key} className={`ent-card${st.choice === t.key ? " is-on" : ""}`}>
            <div
              className="ent-swatch"
              aria-hidden="true"
              style={{ background: `linear-gradient(180deg, ${t.vars["--en-sky-top"] || "#3a7a90"} 0%, ${t.vars["--en-sky-low"] || "#f1c992"} 55%, ${t.vars["--en-meadow"] || "#77a25e"} 56%, ${t.vars["--en-meadow2"] || "#5d8a4d"} 100%)` }}
            >
              {t.emoji}
            </div>
            <strong>{t.label}</strong>
            <span className="ent-when">{t.when}</span>
            <div className="ent-actions">
              <button type="button" className="esc-btn" onClick={() => setPlaying(t.key)}>▶ Preview</button>
              <a className="esc-btn" href={`/api/admin/season-preview?key=${t.key}&to=/`} target="_blank" rel="noopener" title="Open the site with this season's background, just for you (for an hour)">Preview background</a>
              <button type="button" className="esc-btn primary" disabled={busy || st.choice === t.key} onClick={() => choose(t.key)}>{st.choice === t.key ? "In use" : "Use"}</button>
            </div>
          </div>
        ))}
      </div>

      {st.upcoming.length > 0 && (
        <div className="ent-next">
          <strong>Coming up on Auto:</strong>{" "}
          {st.upcoming.map((u, i) => (
            <span key={u.from}>
              {i > 0 && " · "}
              {ENTRANCE_THEMES[u.key].emoji} {u.label} from {day(u.from)}
            </span>
          ))}
        </div>
      )}
      <p className="field-hint"><strong>▶ Preview</strong> plays the entrance here. <strong>Preview background</strong> opens the site in a new tab with that season&rsquo;s background, just for you, for up to an hour (nothing changes for anyone else; the bar at the top has Stop).</p>
      {msg && <p className="field-hint" role="status">{msg}</p>}
      <p className="field-hint">The entrance plays once per visit, right after a member signs in. Anyone who has asked their device to reduce motion doesn&rsquo;t see it.</p>
      {playing && <EntrancePlayer theme={playing} onDone={() => setPlaying(null)} />}
    </div>
  );
}
