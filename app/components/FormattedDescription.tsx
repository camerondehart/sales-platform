"use client";

import { useMemo } from "react";

// ============================================================
// FormattedDescription — turns raw description text into clean
// typography: a lede, short paragraphs, bullet lists, and
// "Label: value" spec rows, all detected automatically.
// ============================================================
export default function FormattedDescription({ text }: { text: string }) {
  const blocks = useMemo(() => parseDescription(text), [text]);
  return (
    <div className="desc">
      {blocks.map((block, i) => {
        if (block.type === "list") {
          return (
            <ul key={i} className="desc-list">
              {block.items.map((item, j) => <li key={j}>{item}</li>)}
            </ul>
          );
        }
        if (block.type === "spec") {
          return (
            <div key={i} className="desc-spec">
              <span className="desc-spec-label">{block.label}</span>
              <span>{block.value}</span>
            </div>
          );
        }
        return (
          <p key={i} className={i === 0 ? "desc-lede" : undefined}>
            {block.text}
          </p>
        );
      })}
    </div>
  );
}

type DescBlock =
  | { type: "para"; text: string }
  | { type: "list"; items: string[] }
  | { type: "spec"; label: string; value: string };

function parseDescription(raw: string): DescBlock[] {
  const lines = raw.split(/\r?\n/).map((l) => l.trim());
  const blocks: DescBlock[] = [];
  let list: string[] = [];

  const flushList = () => {
    if (list.length) {
      blocks.push({ type: "list", items: list });
      list = [];
    }
  };

  for (const line of lines) {
    if (!line) { flushList(); continue; }

    // Bullets: "- item", "• item", "* item"
    const bullet = line.match(/^[-•*]\s+(.+)/);
    if (bullet) { list.push(bullet[1]); continue; }
    flushList();

    // Spec rows: "Dosage: 2 drops" (short label followed by colon)
    const spec = line.match(/^([A-Za-z][A-Za-z\s/&']{1,24}):\s+(.+)/);
    if (spec && spec[2].length <= 120) {
      blocks.push({ type: "spec", label: spec[1], value: spec[2] });
      continue;
    }

    // Long unbroken paragraph → split into ~2-sentence paragraphs
    if (line.length > 260) {
      const sentences = splitSentences(line);
      for (let i = 0; i < sentences.length; i += 2) {
        blocks.push({ type: "para", text: sentences.slice(i, i + 2).join(" ").trim() });
      }
      continue;
    }

    blocks.push({ type: "para", text: line });
  }
  flushList();
  return blocks;
}

/**
 * Split a paragraph into sentences without ever losing text. A sentence ends
 * at . ! or ? followed by a space and then a capital letter (or a quote or
 * bracket) — so decimals like ".15g", "2.5 ml" or "approx. 3" stay intact.
 * If anything looks off, the paragraph is returned whole.
 */
export function splitSentences(line: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c !== "." && c !== "!" && c !== "?") continue;
    let j = i + 1;
    while (j < line.length && /[.!?"”’)]/.test(line[j])) j++; // "...", ."  ?)
    if (j >= line.length || !/\s/.test(line[j])) continue;
    let k = j;
    while (k < line.length && /\s/.test(line[k])) k++;
    if (k < line.length && /[A-Z"“'‘(\[]/.test(line[k])) {
      out.push(line.slice(start, j).trim());
      start = k;
      i = k - 1;
    }
  }
  if (start < line.length) out.push(line.slice(start).trim());
  const parts = out.filter(Boolean);
  // Safety net: the pieces must add back up to the original text.
  return parts.join("").replace(/\s+/g, "") === line.replace(/\s+/g, "") ? parts : [line];
}
