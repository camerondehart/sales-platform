"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { THEME_KEYS, THEMES, type ThemeChoice } from "@/lib/campaignThemes";
import { brand } from "@/lib/brand";
import MediaUpload from "./MediaUpload";

// Marketing → Email campaigns: the theme picker, the "Arrange" block editor
// (move photos, text and buttons around) and the live preview. The message
// itself stays plain text in the composer's format, so everything else
// (templates, Concierge drafts, sending) works unchanged.

// ---------------------------------------------------------------- theme picker

export function ThemePicker({ value, onChange, resolved }: { value: ThemeChoice; onChange: (v: ThemeChoice) => void; resolved?: string }) {
  const autoLabel = resolved && resolved !== "none" && THEMES[resolved as keyof typeof THEMES] ? THEMES[resolved as keyof typeof THEMES].label : "";
  return (
    <div className="cc-themes" role="radiogroup" aria-label="Look">
      <button type="button" role="radio" aria-checked={value === "auto"} className={`cc-theme cc-theme-auto${value === "auto" ? " is-on" : ""}`} onClick={() => onChange("auto")}>
        <span className="cc-theme-art" aria-hidden="true">✨</span>
        <span className="cc-theme-name">Auto{value === "auto" && autoLabel ? ` · ${autoLabel}` : ""}</span>
      </button>
      {THEME_KEYS.map((k) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} className={`cc-theme${value === k ? " is-on" : ""}`} onClick={() => onChange(k)} title={THEMES[k].label}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="cc-theme-art" src={`/email-art/${k}-header.jpg`} alt="" loading="lazy" />
          <span className="cc-theme-name">{THEMES[k].emoji} {THEMES[k].label}</span>
        </button>
      ))}
      <button type="button" role="radio" aria-checked={value === "none"} className={`cc-theme cc-theme-plain${value === "none" ? " is-on" : ""}`} onClick={() => onChange("none")}>
        <span className="cc-theme-art" aria-hidden="true">▭</span>
        <span className="cc-theme-name">Plain</span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- blocks

type Kind = "image" | "button" | "heading" | "divider" | "list" | "photo-slot" | "text";
type Block = { id: number; text: string };

const IMG_RE = /^!\[([^\]]*)\]\((https:\/\/[^\s)]+)\)$/;
const BTN_RE = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/;

function kindOf(text: string): Kind {
  const t = text.trim();
  if (t === "[[PHOTO]]") return "photo-slot";
  if (IMG_RE.test(t)) return "image";
  if (BTN_RE.test(t)) return "button";
  if (/^#{1,3}\s/.test(t) && !t.includes("\n")) return "heading";
  if (/^-{3,}$/.test(t)) return "divider";
  if (t.split("\n").every((l) => /^[-*•]\s+/.test(l.trim()))) return "list";
  return "text";
}
const KIND_LABEL: Record<Kind, string> = { image: "Photo", button: "Button", heading: "Heading", divider: "Divider", list: "List", "photo-slot": "Photo from chat", text: "Text" };
const KIND_ICON: Record<Kind, string> = { image: "🖼", button: "🔘", heading: "H", divider: "—", list: "•", "photo-slot": "📷", text: "¶" };

let nextId = 1;
const split = (body: string): Block[] =>
  body
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((text) => ({ id: nextId++, text }));
const join = (blocks: Block[]) => blocks.map((b) => b.text.trim()).filter(Boolean).join("\n\n");

/**
 * "Arrange": the message as cards. Drag a card (or use ↑ ↓) to move it, change
 * a photo's size or description, edit text in place, add new pieces.
 */
export function BlockArranger({ body, onChange }: { body: string; onChange: (b: string) => void }) {
  const [blocks, setBlocks] = useState<Block[]>(() => split(body));
  const lastSent = useRef(body);
  // The message changed elsewhere (Write tab, a template, a Concierge draft): re-read it.
  useEffect(() => {
    if (body !== lastSent.current) {
      setBlocks(split(body));
      lastSent.current = body;
    }
  }, [body]);
  const commit = (next: Block[]) => {
    setBlocks(next);
    const b = join(next);
    lastSent.current = b;
    onChange(b);
  };
  const move = (i: number, to: number) => {
    if (to < 0 || to >= blocks.length || to === i) return;
    const next = blocks.slice();
    const [b] = next.splice(i, 1);
    next.splice(to, 0, b);
    commit(next);
  };
  const update = (i: number, text: string) => commit(blocks.map((b, k) => (k === i ? { ...b, text } : b)));
  const remove = (i: number) => commit(blocks.filter((_, k) => k !== i));
  const add = (text: string, at = blocks.length) => {
    const next = blocks.slice();
    next.splice(at, 0, { id: nextId++, text });
    commit(next);
  };

  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);

  return (
    <div className="cc-arrange">
      {blocks.length === 0 && <p className="field-hint">Nothing here yet. Add a heading, some text or a photo below, or use a template.</p>}
      <ol className="cc-blocks">
        {blocks.map((b, i) => {
          const kind = kindOf(b.text);
          const img = kind === "image" ? b.text.trim().match(IMG_RE) : null;
          const [alt, size] = img ? img[1].split("|").map((x) => x.trim()) : ["", ""];
          const btn = kind === "button" ? b.text.trim().match(BTN_RE) : null;
          return (
            <li
              key={b.id}
              className={`cc-block cc-k-${kind}${drag === i ? " is-drag" : ""}${over === i && drag !== null && drag !== i ? " is-over" : ""}`}
              draggable={editing !== i}
              onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = "move"; }}
              onDragOver={(e) => { e.preventDefault(); setOver(i); }}
              onDragLeave={() => setOver((o) => (o === i ? null : o))}
              onDrop={(e) => { e.preventDefault(); if (drag !== null) move(drag, i); setDrag(null); setOver(null); }}
              onDragEnd={() => { setDrag(null); setOver(null); }}
            >
              <span className="cc-grip" aria-hidden="true" title="Drag to move">⋮⋮</span>
              <span className="cc-kind" title={KIND_LABEL[kind]}>{KIND_ICON[kind]}</span>
              <div className="cc-block-main">
                {img ? (
                  <div className="cc-img">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img[2]} alt="" />
                    <div className="cc-img-ctl">
                      <input value={alt} placeholder="Describe the photo" aria-label="Photo description" onChange={(e) => update(i, `![${e.target.value.replace(/[\[\]|]/g, "")}${size ? `|${size}` : ""}](${img[2]})`)} />
                      <div className="cc-sizes" role="radiogroup" aria-label="Size">
                        {(["small", "medium", ""] as const).map((s) => (
                          <button key={s || "large"} type="button" role="radio" aria-checked={(size || "") === s} className={(size || "") === s ? "is-on" : ""} onClick={() => update(i, `![${alt}${s ? `|${s}` : ""}](${img[2]})`)}>
                            {s === "small" ? "S" : s === "medium" ? "M" : "L"}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : btn ? (
                  <div className="cc-btn-edit">
                    <input value={btn[1]} aria-label="Button text" onChange={(e) => update(i, `[${e.target.value.replace(/[\[\]]/g, "")}](${btn[2]})`)} />
                    <input value={btn[2]} aria-label="Button link" onChange={(e) => update(i, `[${btn[1]}](${e.target.value.trim()})`)} />
                  </div>
                ) : kind === "divider" ? (
                  <div className="cc-divider-line" aria-label="Divider" />
                ) : kind === "photo-slot" ? (
                  <p className="cc-slot">The photo from the chat goes here once it&rsquo;s uploaded.</p>
                ) : editing === i ? (
                  <textarea autoFocus rows={Math.min(10, Math.max(2, b.text.split("\n").length + 1))} value={b.text} onChange={(e) => update(i, e.target.value)} onBlur={() => setEditing(null)} />
                ) : (
                  <button type="button" className={`cc-text${kind === "heading" ? " is-heading" : ""}`} onClick={() => setEditing(i)} title="Click to edit">
                    {kind === "heading" ? b.text.replace(/^#{1,3}\s+/, "") : b.text.length > 220 ? `${b.text.slice(0, 220)}…` : b.text}
                  </button>
                )}
              </div>
              <div className="cc-block-actions">
                <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label="Move up">↑</button>
                <button type="button" onClick={() => move(i, i + 1)} disabled={i === blocks.length - 1} aria-label="Move down">↓</button>
                <button type="button" className="danger" onClick={() => remove(i)} aria-label={`Delete this ${KIND_LABEL[kind].toLowerCase()}`}>✕</button>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="cc-add">
        <span>Add:</span>
        <button type="button" onClick={() => add("# A heading")}>Heading</button>
        <button type="button" onClick={() => { add("Write something here."); setEditing(blocks.length); }}>Text</button>
        <button type="button" onClick={() => add(`[Shop now](${brand.siteUrl}/retail)`)}>Button</button>
        <button type="button" onClick={() => add("---")}>Divider</button>
        <MediaUpload kind="image" value="" onUploaded={(url) => add(`![Photo](${url})`)} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- live preview

/** The email exactly as it will look (same renderer as sending), on a desktop or phone width. */
export function LivePreview({ subject, body, theme, when, onResolved }: { subject: string; body: string; theme: ThemeChoice; when?: number; onResolved?: (key: string) => void }) {
  const [html, setHtml] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [phone, setPhone] = useState(false);
  const key = useMemo(() => JSON.stringify([subject, body, theme, when || 0]), [subject, body, theme, when]);
  useEffect(() => {
    if (!body.trim()) {
      setHtml("");
      setErr("");
      return;
    }
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      fetch("/api/admin/templates/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject, body, theme, when }) })
        .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
        .then(({ ok, d }) => {
          if (!live) return;
          if (!ok) throw new Error(d.error || "Couldn't build the preview.");
          setHtml(d.html);
          setErr("");
          if (d.theme) onResolved?.(d.theme);
        })
        .catch((e) => live && setErr(e instanceof Error ? e.message : "Couldn't build the preview."))
        .finally(() => live && setLoading(false));
    }, 450);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div className="cc-preview">
      <div className="cc-preview-bar">
        <span className="cc-preview-title">Preview{loading ? " · updating…" : ""}</span>
        <div className="cc-preview-size" role="radiogroup" aria-label="Preview width">
          <button type="button" role="radio" aria-checked={!phone} className={!phone ? "is-on" : ""} onClick={() => setPhone(false)}>Desktop</button>
          <button type="button" role="radio" aria-checked={phone} className={phone ? "is-on" : ""} onClick={() => setPhone(true)}>Phone</button>
        </div>
      </div>
      <div className="cc-preview-subject"><span>Subject</span> {subject || <em>(no subject yet)</em>}</div>
      <div className={`cc-preview-frame${phone ? " is-phone" : ""}`}>
        {html ? (
          <iframe title="Email preview" sandbox="" srcDoc={html} />
        ) : (
          <div className="cc-preview-empty">{err || "Start writing and the email appears here, exactly as it will arrive."}</div>
        )}
      </div>
      {err && html && <div className="ap-bad">{err}</div>}
    </div>
  );
}
