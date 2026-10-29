"use client";

import { useEffect, useRef, useState } from "react";

// Assistant → Voice: pick the Concierge's voice (play a sample first), the
// speech model, and see daily voice use. Only shown while the
// "Concierge voice" switch is on.

type Day = { id: string; sttSeconds: number; sttCalls: number; ttsChars: number; ttsCalls: number; cacheHits: number; errors: number };
type Family = "elevenlabs" | "google" | "microsoft";
const familyOf = (model: string): Family => (model.startsWith("google/") ? "google" : model.startsWith("microsoft/") ? "microsoft" : "elevenlabs");
const FAMILY_NAME: Record<Family, string> = { elevenlabs: "ElevenLabs", google: "Google", microsoft: "Microsoft" };
const FAMILIES: Family[] = ["elevenlabs", "google", "microsoft"];
// Blank voice = the model's own default voice (Microsoft models).
const isListed = (x: Data, voiceId: string, model: string) => x.presets.some((p) => p.id === voiceId) || (!voiceId && familyOf(model) === "microsoft");
const OTHER = "__other__";

type Data = {
  on: boolean;
  settings: { ttsModel: string; voiceId: string; sttModel: string };
  usage: Day[];
  presets: Array<{ id: string; name: string; note: string; family: Family }>;
  ttsModels: Array<{ id: string; name: string; family: Family }>;
  limits: { sttCalls: number; ttsCalls: number };
};

export default function VoiceSettings() {
  const [d, setD] = useState<Data | null>(null);
  const [voiceId, setVoiceId] = useState("");
  const [model, setModel] = useState("");
  const [custom, setCustom] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [voiceOther, setVoiceOther] = useState(false);
  const [modelOther, setModelOther] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const load = () =>
    fetch("/api/admin/voice", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((x: Data | null) => {
        if (!x) return;
        setD(x);
        setVoiceId(x.settings.voiceId);
        setModel(x.settings.ttsModel);
        setVoiceOther(!isListed(x, x.settings.voiceId, x.settings.ttsModel));
        setModelOther(!x.ttsModels.some((m) => m.id === x.settings.ttsModel));
        if (!isListed(x, x.settings.voiceId, x.settings.ttsModel)) setCustom(x.settings.voiceId);
        if (!x.ttsModels.some((m) => m.id === x.settings.ttsModel)) setCustomModel(x.settings.ttsModel);
      })
      .catch(() => {});
  useEffect(() => { load(); }, []);

  if (!d || !d.on) return null;

  async function preview(id: string) {
    setBusy(`p:${id}`);
    setMsg(null);
    audio.current?.pause();
    try {
      const r = await fetch("/api/admin/voice/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ voiceId: id, model }) });
      const x = await r.json().catch(() => ({}));
      if (!r.ok || !x.audio) throw new Error(x.error || "Couldn't make the sample.");
      audio.current = new Audio(`data:${x.mediaType || "audio/mpeg"};base64,${x.audio}`);
      await audio.current.play();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Couldn't make the sample." });
    }
    setBusy(null);
  }

  async function save() {
    setBusy("save");
    setMsg(null);
    try {
      const r = await fetch("/api/admin/voice", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ voiceId, ttsModel: model }) });
      const x = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(x.error || "Couldn't save.");
      setMsg({ ok: true, text: "Saved. New answers use this voice." });
      load();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Couldn't save." });
    }
    setBusy(null);
  }

  const changed = voiceId !== d.settings.voiceId || model !== d.settings.ttsModel;
  const today = d.usage[0];
  const mins = (s: number) => (s >= 60 ? `${(s / 60).toFixed(1)} min` : `${Math.round(s)} s`);

  return (
    <section className="admin-section vs">
      <h2>Concierge voice</h2>
      <p className="field-hint" style={{ marginTop: "-0.4rem" }}>
        People can tap the mic to talk, and tap ▶ Listen (or turn on “Read answers aloud”) to hear answers. Speech goes through the AI Gateway on
        the same bill as the chat, and its estimated cost is included in the Assistant's monthly spend and limit (at full list prices, so it runs a little high during the Gateway's half-price launch). Answers are read up to about 600 characters; the full text stays on screen.
      </p>

      <div className="vs-pick">
        <div className="field">
          <label htmlFor="vs-model">Speech model</label>
          <select
            id="vs-model"
            value={modelOther ? OTHER : model}
            onChange={(e) => {
              const v = e.target.value;
              if (v === OTHER) { setModelOther(true); if (customModel) setModel(customModel); return; }
              setModelOther(false);
              // Switching between ElevenLabs, Google and Microsoft: voices differ, so pick that family's first voice.
              if (familyOf(v) !== familyOf(model)) { setVoiceOther(false); setVoiceId(d.presets.find((p) => p.family === familyOf(v))?.id || ""); }
              setModel(v);
            }}
          >
            {FAMILIES.map((f) => (
              <optgroup key={f} label={FAMILY_NAME[f]}>
                {d.ttsModels.filter((m) => m.family === f).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </optgroup>
            ))}
            <option value={OTHER}>Other model (type its Gateway ID)…</option>
          </select>
          {modelOther && (
            <input className="vs-custom" value={customModel} onChange={(e) => { setCustomModel(e.target.value.trim()); if (e.target.value.trim()) setModel(e.target.value.trim()); }} placeholder="e.g. elevenlabs/eleven-v4" aria-label="Other speech model ID" />
          )}
        </div>

        <div className="field">
          <label htmlFor="vs-voice">Voice ({FAMILY_NAME[familyOf(model)]})</label>
          <div className="vs-voice-row">
            <select
              id="vs-voice"
              value={voiceOther ? OTHER : voiceId}
              onChange={(e) => {
                const v = e.target.value;
                if (v === OTHER) { setVoiceOther(true); if (custom) setVoiceId(custom); return; }
                setVoiceOther(false);
                setVoiceId(v);
              }}
            >
              {familyOf(model) === "microsoft" && <option value="">The model's own voice</option>}
              {d.presets.filter((p) => p.family === familyOf(model)).map((p) => <option key={p.id} value={p.id}>{p.name} — {p.note}</option>)}
              <option value={OTHER}>Other {FAMILY_NAME[familyOf(model)]} voice…</option>
            </select>
            <button type="button" className="esc-btn" disabled={!!busy || (!voiceId && familyOf(model) !== "microsoft")} onClick={() => preview(voiceId)}>{busy === `p:${voiceId}` ? "…" : "▶ Play"}</button>
          </div>
          {voiceOther && (
            <input className="vs-custom" value={custom} onChange={(e) => { setCustom(e.target.value.trim()); if (e.target.value.trim()) setVoiceId(e.target.value.trim()); }} placeholder={familyOf(model) === "elevenlabs" ? "ElevenLabs voice ID" : familyOf(model) === "google" ? "Voice name, e.g. Kore" : "Microsoft voice name"} aria-label="Other voice" />
          )}
          <div className="field-hint">Play a voice before saving. Models sound a little different, so play it again after changing the model.</div>
        </div>
      </div>

      <div className="sw-foot">
        <button type="button" className="submit" disabled={!!busy || !changed} onClick={save}>{busy === "save" ? "Saving…" : changed ? "Save voice" : "Saved"}</button>
        {msg && <span className={msg.ok ? "ap-ok" : "ap-bad"}>{msg.text}</span>}
      </div>

      <h3>Voice use</h3>
      <p className="field-hint">
        Today: {today ? `${mins(today.sttSeconds)} listened (${today.sttCalls}) · ${today.ttsCalls} answers read (${today.ttsChars.toLocaleString()} characters) · ${today.cacheHits} replayed free` : "nothing yet"}.
        Daily safety limit: {d.limits.sttCalls} recordings and {d.limits.ttsCalls} read-alouds for the whole site.
      </p>
      {d.usage.length > 0 && (
        <table className="vs-usage">
          <thead><tr><th>Day</th><th>Listened</th><th>Read aloud</th><th>Characters</th><th>Replays</th><th>Errors</th></tr></thead>
          <tbody>
            {d.usage.map((u) => (
              <tr key={u.id}><td>{u.id}</td><td>{mins(u.sttSeconds)} ({u.sttCalls})</td><td>{u.ttsCalls}</td><td>{u.ttsChars.toLocaleString()}</td><td>{u.cacheHits}</td><td>{u.errors}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
