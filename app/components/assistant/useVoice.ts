"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Concierge voice in the chat widget (server: /api/assistant/voice).
//  - Mic: tap to talk, tap to stop (stops itself at 60 s). The words go into
//    the message box so people see them before sending.
//  - Play: reads one answer aloud. "Read answers aloud" does it for each new
//    answer. Nothing plays unless the person asked for it.
//  - Conversation mode: a back-and-forth. The mic listens, sends when you
//    pause, the answer is read aloud, then it listens again. While an answer
//    is being read the mic keeps listening (echo-cancelled): start talking and
//    it stops speaking and takes your words; tapping the mic does the same.
//    It ends itself when the Concierge hears you're done (a goodbye), after a
//    stretch of silence, when the chat closes, or when switched off.
// If the browser can't record, or listening fails, the mic hides itself and
// typing carries on as normal.

const MAX_SECONDS = 60;
const READ_KEY = "fp_voice_read";
const TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];
// Conversation mode: how long a pause ends a turn, and how long to wait for any speech.
const PAUSE_MS = 900;
const NO_SPEECH_MS = 8000;
// Talking over an answer: how long the mic learns the speaker's echo, then how
// many 100 ms frames of clearly louder sound count as the person speaking.
// The echo level keeps being tracked through the whole answer (its loudest
// recent level), so talking over it works however the phone's levels shift.
const ECHO_LEARN_MS = 500;
const BARGE_FRAMES = 3;
const BARGE_MIN = 0.018; // never needs more than ordinary speaking volume
const BARGE_OVER_ECHO = 1.6; // how much louder than the answer's own echo
// A tiny silent clip: playing it during a tap "unlocks" audio on iPhones, so
// answers can be read aloud later without another tap.
function silentWav(): string {
  const n = 800; // 0.1 s at 8 kHz, 8-bit mono
  const b = new Uint8Array(44 + n);
  const v = new DataView(b.buffer);
  const w = (o: number, t: string) => [...t].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + n, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  w(36, "data"); v.setUint32(40, n, true); b.fill(128, 44);
  let bin = "";
  b.forEach((x) => (bin += String.fromCharCode(x)));
  return `data:audio/wav;base64,${btoa(bin)}`;
}

function pickType(): string | null {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") return null;
  for (const t of TYPES) if (MediaRecorder.isTypeSupported?.(t)) return t;
  return "";
}

const toB64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

export function useVoice(opts: {
  enabled: boolean;
  mode: "site" | "admin";
  /** Tap-to-talk: put the words in the box. */
  onText: (text: string) => void;
  /** Hands-free: send the words straight away. */
  onSend: (text: string) => void;
}) {
  const [canRecord, setCanRecord] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [heard, setHeard] = useState(false); // hands-free: speech detected this turn
  const [listening, setListening] = useState(false); // waiting for the words
  const [note, setNote] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [readAloud, setReadAloudState] = useState(false);
  const [handsFree, setHandsFreeState] = useState(false);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  // Audio per answer part ("<id>#0" = first sentence, "<id>#1" = the rest).
  const clips = useRef<Map<string, { url: string; parts: number }>>(new Map());
  // Bumped whenever playback stops or a new answer starts, so a part still
  // loading never plays after it's been cut off.
  const playToken = useRef(0);
  const fails = useRef(0);
  const cancelTurn = useRef(false);
  const vad = useRef<{ ctx: AudioContext; timer: ReturnType<typeof setInterval> } | null>(null);
  const handsRef = useRef(false);
  // A recording running while an answer is read aloud (for talking over it).
  // learnFrom: re-measure the answer's echo from this moment (a new clip started).
  const overRef = useRef<{ spoke: boolean; learnFrom?: number } | null>(null);
  // The Concierge said goodbye: end conversation mode once it finishes speaking.
  const endAfterRef = useRef(false);
  const cb = useRef(opts);
  cb.current = opts;

  useEffect(() => {
    setCanRecord(opts.enabled && pickType() !== null && !!navigator.mediaDevices?.getUserMedia);
    try {
      setReadAloudState(localStorage.getItem(READ_KEY) === "1");
    } catch {}
  }, [opts.enabled]);

  /** One audio element, unlocked during a tap so later answers can play on iPhones. */
  const unlock = () => {
    if (!player.current) player.current = new Audio();
    const a = player.current;
    if (a.src && !a.paused) return;
    a.src = silentWav();
    a.play().catch(() => {});
  };

  const setReadAloud = (on: boolean) => {
    setReadAloudState(on);
    if (on) unlock();
    try {
      localStorage.setItem(READ_KEY, on ? "1" : "0");
    } catch {}
  };

  // Conversation mode keeps ONE mic stream open for the whole conversation.
  // Opening/closing the mic each turn makes phones switch audio modes, and the
  // first words of the next answer were swallowed during that switch.
  const liveMic = useRef<MediaStream | null>(null);
  const releaseMic = () => {
    liveMic.current?.getTracks().forEach((t) => t.stop());
    liveMic.current = null;
  };
  const stopTracks = () => {
    const st = rec.current?.stream;
    if (st && st === liveMic.current && handsRef.current) return; // still in a conversation: keep it open
    st?.getTracks().forEach((t) => t.stop());
    if (st && st === liveMic.current) liveMic.current = null;
  };
  const stopVad = () => {
    if (!vad.current) return;
    clearInterval(vad.current.timer);
    vad.current.ctx.close().catch(() => {});
    vad.current = null;
  };

  const stop = useCallback((cancel = false) => {
    cancelTurn.current = cancel;
    if (tick.current) clearInterval(tick.current);
    tick.current = null;
    stopVad();
    if (rec.current && rec.current.state !== "inactive") rec.current.stop();
    else stopTracks();
    setRecording(false);
  }, []);

  const stopAudio = () => {
    playToken.current++;
    const a = player.current;
    if (a && !a.paused) a.pause();
    setPlaying(null);
  };

  const start = useCallback(async (opts?: { overPlayback?: boolean }) => {
    if (rec.current?.state === "recording" || listening) return;
    const over = !!opts?.overPlayback;
    if (!over) {
      setNote(null);
      stopAudio();
    }
    let stream: MediaStream;
    try {
      const live = liveMic.current;
      if (handsRef.current && live && live.getAudioTracks().some((t) => t.readyState === "live")) stream = live;
      else {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        if (handsRef.current) liveMic.current = stream;
      }
    } catch {
      setNote("The microphone isn't available. Check the browser's permission, or type instead.");
      if (handsRef.current) setHandsFree(false);
      return;
    }
    const type = pickType() || undefined;
    const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    rec.current = r;
    chunks.current = [];
    cancelTurn.current = false;
    setHeard(false);
    const hands = handsRef.current;
    overRef.current = over ? { spoke: false } : null;
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = async () => {
      stopTracks();
      if (cancelTurn.current) return;
      const blob = new Blob(chunks.current, { type: r.mimeType || type || "audio/webm" });
      if (blob.size < 1200) return; // a tap, not speech
      setListening(true);
      try {
        const res = await fetch("/api/assistant/voice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "transcribe", mode: cb.current.mode, audio: await toB64(blob), mediaType: blob.type }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || "Couldn't hear that.");
        fails.current = 0;
        const text = String(d.text || "").trim();
        if (!text) {
          setNote("I didn't catch any words. Try again a little closer to the mic.");
          if (hands && handsRef.current) setTimeout(() => startRef.current(), 400);
        } else if (hands && handsRef.current) cb.current.onSend(text);
        else cb.current.onText(text);
      } catch (err) {
        fails.current += 1;
        setNote(err instanceof Error ? err.message : "Couldn't hear that. Please type instead.");
        if (handsRef.current) setHandsFree(false);
        // Keeps failing: hide the mic so typing is the obvious path.
        if (fails.current >= 2) setCanRecord(false);
      } finally {
        setListening(false);
      }
    };
    r.start(1000);
    setSeconds(0);
    // Listening under an answer is quiet: the button only turns red once they talk.
    if (!over) setRecording(true);
    let began = Date.now();
    tick.current = setInterval(() => {
      const s = Math.floor((Date.now() - began) / 1000);
      setSeconds(s);
      if (s >= MAX_SECONDS) stop();
    }, 250);

    // Hands-free: end the turn when they pause; give up if nobody speaks.
    if (hands) {
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        await ctx.resume().catch(() => {});
        const an = ctx.createAnalyser();
        an.fftSize = 1024;
        ctx.createMediaStreamSource(stream).connect(an);
        const buf = new Float32Array(an.fftSize);
        let floor = 0, samples = 0, spoke = false, loudFrames = 0, quietSince = 0, learnStart = began, echo = 0;
        const timer = setInterval(() => {
          an.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          const rms = Math.sqrt(sum / buf.length);
          const now = Date.now();
          const o = overRef.current;
          if (o && !o.spoke) {
            // An answer is playing: learn how loud its echo gets, then wait for
            // something clearly louder for a moment — that's them talking.
            // A new clip of the answer started: phones can change levels between clips, so measure again.
            if (o.learnFrom) { learnStart = o.learnFrom; o.learnFrom = undefined; echo = 0; loudFrames = 0; }
            if (now - learnStart < ECHO_LEARN_MS) { echo = Math.max(echo, rms); return; }
            const bargeThr = Math.max(BARGE_MIN, echo * BARGE_OVER_ECHO);
            if (rms > bargeThr) {
              if (++loudFrames >= BARGE_FRAMES) {
                o.spoke = true;
                spoke = true;
                quietSince = 0;
                setHeard(true);
                setRecording(true);
                began = now; // the 60 s limit counts from when they start talking
                // Background level for spotting their pause: not their own voice (that would
                // end the turn mid-sentence) — the quieter of the echo and ordinary speech.
                floor = Math.min(echo, BARGE_MIN) / 2.2;
                samples = 1;
                stopAudio(); // they're talking: stop the answer, keep their words
              }
            } else {
              loudFrames = 0;
              echo = Math.max(rms, echo * 0.98); // follow the answer's echo, slowly letting old peaks go
            }
            return;
          }
          if (!spoke && now - began < 350) { floor += rms; samples++; return; } // learn the room's background noise
          const thr = Math.max(0.012, (samples ? floor / samples : 0.005) * 2.2);
          if (rms > thr) {
            loudFrames++;
            quietSince = 0;
            if (loudFrames >= 2 && !spoke) { spoke = true; setHeard(true); }
          } else {
            loudFrames = 0;
            if (spoke) {
              if (!quietSince) quietSince = now;
              if (now - quietSince >= PAUSE_MS) stop();
            } else if (now - began >= NO_SPEECH_MS) {
              stop(true);
              setHandsFree(false);
              setNote("Conversation mode paused. Tap the mic or switch it back on when you're ready.");
            }
          }
        }, 100);
        vad.current = { ctx, timer };
      } catch {
        // No pause detection on this browser: they tap ■ to send instead.
      }
    }
  }, [listening, stop]);
  const startRef = useRef(start);
  startRef.current = start;

  function setHandsFree(on: boolean) {
    handsRef.current = on;
    endAfterRef.current = false;
    // Not remembered between visits: the mic never switches itself on at page load.
    setHandsFreeState(on);
    if (on) {
      unlock();
      setNote(null);
      startRef.current();
    } else {
      if (rec.current?.state === "recording") stop(true);
      releaseMic();
    }
  }

  /** Mic button: in hands-free, cuts off an answer being read and listens. */
  const micTap = useCallback(() => {
    unlock();
    // Tapping while an answer is read: stop it and listen afresh (drop the echo recorded so far).
    if (overRef.current && !overRef.current.spoke && rec.current?.state === "recording") {
      overRef.current = null;
      stop(true);
      stopAudio();
      setTimeout(() => startRef.current(), 60);
      return;
    }
    if (rec.current?.state === "recording") stop();
    else start();
  }, [start, stop]);

  /** The Concierge said goodbye: switch conversation mode off when it finishes speaking. */
  const endAfterSpeaking = useCallback(() => {
    endAfterRef.current = true;
  }, []);

  /** Close the chat (or unmount): stop listening and talking. */
  const stopAll = useCallback(() => {
    handsRef.current = false;
    endAfterRef.current = false;
    setHandsFreeState(false);
    if (rec.current?.state === "recording") stop(true);
    releaseMic();
    stopAudio();
  }, [stop]);

  useEffect(() => () => {
    if (tick.current) clearInterval(tick.current);
    stopVad();
    stopTracks();
    releaseMic();
    player.current?.pause();
  }, []);

  /** Play (or stop) one answer. In hands-free, listening starts again when it ends. */
  const speak = useCallback(
    async (id: string, text: string, sig: string) => {
      if (playing === id) {
        stopAudio();
        return;
      }
      stopAudio();
      setNote(null);
      const token = playToken.current;
      // The first sentence is made and played on its own, so the voice starts
      // sooner; the rest is made while it plays and follows straight on.
      const fetchPart = async (i: number) => {
        const key = `${id}#${i}`;
        const hit = clips.current.get(key);
        if (hit) return hit;
        const res = await fetch("/api/assistant/voice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "speak", mode: cb.current.mode, text, sig, part: i }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok || !d.audio) throw new Error(d.error || "Couldn't read that aloud.");
        const clip = { url: `data:${d.mediaType || "audio/mpeg"};base64,${d.audio}`, parts: Number(d.parts) || 1 };
        clips.current.set(key, clip);
        return clip;
      };

      let first: { url: string; parts: number };
      setLoadingId(id);
      try {
        first = await fetchPart(0);
      } catch (err) {
        setNote(err instanceof Error ? err.message : "Couldn't read that aloud.");
        setLoadingId(null);
        if (handsRef.current) setHandsFree(false);
        return;
      }
      setLoadingId(null);
      if (token !== playToken.current) return; // stopped or replaced while loading
      const rest = first.parts > 1 ? fetchPart(1) : null;
      rest?.catch(() => {}); // a failure is handled when it's needed

      const finished = () => {
        setPlaying((p) => (p === id ? null : p));
        if (!handsRef.current) return;
        // Nobody talked over it: drop that recording (it's only echo) and listen fresh.
        if (overRef.current && !overRef.current.spoke) {
          overRef.current = null;
          stop(true);
        }
        if (endAfterRef.current) {
          setHandsFree(false);
          setNote("Conversation ended — tap the mic or switch conversation mode on anytime.");
          return;
        }
        if (rec.current?.state !== "recording") setTimeout(() => startRef.current(), 250);
      };

      if (!player.current) player.current = new Audio();
      const a = player.current;
      const playPart = (i: number, url: string) => {
        a.onended = async () => {
          if (token !== playToken.current) return;
          if (i === 0 && rest) {
            try {
              const next = await rest;
              if (token !== playToken.current) return;
              playPart(1, next.url);
            } catch {
              finished();
            }
          } else finished();
        };
        a.onpause = () => {
          if (a.ended) return; // just moving on to the next part
          setPlaying((p) => (p === id ? null : p));
        };
        a.src = url;
        setPlaying(id);
        if (i > 0 && overRef.current && !overRef.current.spoke) overRef.current.learnFrom = Date.now();
        a.play()
          .then(() => {
            // Conversation mode: keep listening under the answer so they can talk over it.
            if (i === 0 && handsRef.current && !endAfterRef.current) startRef.current({ overPlayback: true });
          })
          .catch(() => {
            if (token !== playToken.current) return;
            setPlaying(null);
            // Blocked by the browser: in conversation mode, listen anyway rather than stall.
            if (endAfterRef.current) setHandsFree(false);
            else if (handsRef.current) startRef.current();
          });
      };
      playPart(0, first.url);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [playing]
  );

  return {
    canRecord, recording, seconds, heard, listening, note, setNote,
    start, stop, micTap, stopAll, speak, playing, loadingId, endAfterSpeaking,
    readAloud, setReadAloud, handsFree, setHandsFree, maxSeconds: MAX_SECONDS,
  };
}
