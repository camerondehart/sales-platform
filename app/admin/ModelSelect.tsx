"use client";

import { useMemo, useState } from "react";
import Glyph from "./Glyph";

// One model picker for both the main and the backup model: a search box
// that narrows a dropdown of every model on the AI Gateway (with prices),
// plus sort buttons (cheapest, fastest, smartest, newest, most memory) and
// filters (tools only, no training, company).

export type ModelInfo = {
  id: string;
  name: string;
  provider: string;
  inputPerM: number | null;
  outputPerM: number | null;
  toolUse: boolean | null;
  released?: number | null;
  contextWindow?: number | null;
  noTraining?: "all" | "some" | "none" | null;
  zdr?: "all" | "some" | "none" | null;
};

/** Plain-English privacy warning for a model, or "" when its providers all promise not to train on chats. */
export function trainingWarning(m?: Pick<ModelInfo, "noTraining"> | null): string {
  if (m?.noTraining === "none") return "may train on your data";
  if (m?.noTraining === "some") return "may train on your data (depends which provider answers)";
  return "";
}

const label = (id: string, m?: ModelInfo) =>
  `${id}${m && m.inputPerM !== null ? ` — $${m.inputPerM} / $${m.outputPerM} per 1M` : ""}${m?.toolUse === false ? " · no tools" : ""}${
    m?.noTraining === "none" || m?.noTraining === "some" ? " · ⚠\uFE0E may train on your data" : ""
  }`;

type SortKey = "az" | "cheapest" | "fastest" | "smartest" | "newest" | "memory";
const SORTS: Array<{ key: SortKey; label: string; hint: string }> = [
  { key: "az", label: "A–Z", hint: "" },
  { key: "cheapest", label: "Cheapest", hint: "Cheapest = lowest input + output price per 1M tokens." },
  {
    key: "fastest",
    label: "Fastest",
    hint: "Fastest = the gateway doesn't publish speed, so this puts the quick families first (Haiku, Flash, mini, nano, Luna, Lite…), then cheapest, since smaller models answer faster.",
  },
  {
    key: "smartest",
    label: "Smartest",
    hint: "Smartest = the gateway doesn't publish a smarts score, so this puts the top families first (Opus, Pro, Ultra, Large, reasoning…), then mid-size (Sonnet etc.), then highest price, then newest.",
  },
  { key: "newest", label: "Newest", hint: "Newest = most recent release date first." },
  { key: "memory", label: "Most memory", hint: "Most memory = largest context window (how much of a conversation it can read at once)." },
];

const FAST = /haiku|flash|[-_ ]mini\b|\bmini\b|nano|lite|luna|small|instant|fast|turbo|tiny|air\b|\b[1-9]b\b/i;
const TOP = /opus|ultra|-pro\b|\bpro\b|large|-max\b|reason|thinking|\b4\d\db\b/i;
const MID = /sonnet|medium|plus|\b70b\b/i;
/** 2 = top family, 1 = mid, 0 = quick/small family. A name-based stand-in for smarts and speed. */
function tier(m: ModelInfo): number {
  const n = `${m.id} ${m.name}`;
  if (FAST.test(n)) return 0;
  if (TOP.test(n)) return 2;
  if (MID.test(n)) return 1;
  return 1;
}
const price = (m?: ModelInfo) => (m && m.inputPerM !== null && m.outputPerM !== null ? m.inputPerM + m.outputPerM : Infinity);
const when = (sec?: number | null) =>
  sec ? new Date(sec * 1000).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "America/Los_Angeles" }) : "";
const ctx = (n?: number | null) => (!n ? "" : n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}K`);

function compare(sort: SortKey, a: ModelInfo | undefined, b: ModelInfo | undefined, ida: string, idb: string): number {
  const az = ida.localeCompare(idb);
  if (!a || !b) return a ? -1 : b ? 1 : az;
  switch (sort) {
    case "cheapest":
      return price(a) - price(b) || az;
    case "fastest":
      return tier(a) - tier(b) || price(a) - price(b) || az;
    case "smartest": {
      const pa = price(a) === Infinity ? -1 : price(a);
      const pb = price(b) === Infinity ? -1 : price(b);
      return tier(b) - tier(a) || pb - pa || (b.released ?? 0) - (a.released ?? 0) || az;
    }
    case "newest":
      return (b.released ?? 0) - (a.released ?? 0) || az;
    case "memory":
      return (b.contextWindow ?? 0) - (a.contextWindow ?? 0) || az;
    default:
      return az;
  }
}

function extra(sort: SortKey, m?: ModelInfo): string {
  if (!m) return "";
  if (sort === "newest" && m.released) return ` · ${when(m.released)}`;
  if (sort === "memory" && m.contextWindow) return ` · ${ctx(m.contextWindow)} context`;
  if (sort === "fastest" || sort === "smartest") return ` · ${["quick", "mid-size", "top"][tier(m)]} family`;
  return "";
}

export default function ModelSelect({
  models,
  value,
  onChange,
  recommended,
  allowNone = false,
  ariaLabel,
}: {
  models: ModelInfo[];
  value: string;
  onChange: (id: string) => void;
  recommended: string[];
  allowNone?: boolean;
  ariaLabel: string;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("az");
  const [toolsOnly, setToolsOnly] = useState(false);
  const [privateOnly, setPrivateOnly] = useState(false);
  const [provider, setProvider] = useState("");
  const byId = useMemo(() => new Map(models.map((m) => [m.id, m])), [models]);
  const providers = useMemo(() => Array.from(new Set(models.map((m) => m.provider).filter(Boolean))).sort(), [models]);
  const needle = q.trim().toLowerCase();
  const filtering = !!needle || toolsOnly || privateOnly || !!provider;
  const matches = (id: string) => {
    const m = byId.get(id);
    if (needle && !id.toLowerCase().includes(needle) && !(m?.name || "").toLowerCase().includes(needle)) return false;
    if (toolsOnly && m?.toolUse !== true) return false;
    if (privateOnly && m?.noTraining !== "all") return false;
    if (provider && m?.provider !== provider) return false;
    return true;
  };
  const rec = recommended.filter(matches);
  // Keep the saved choice selectable even if the list hasn't loaded or no longer has it.
  const others = Array.from(new Set([value, ...models.map((m) => m.id)].filter(Boolean)))
    .filter((id) => !recommended.includes(id))
    .filter((id) => id === value || matches(id))
    .sort((a, b) => compare(sort, byId.get(a), byId.get(b), a, b));
  const shown = rec.length + others.filter((id) => id !== value || matches(id)).length;
  const sortInfo = SORTS.find((x) => x.key === sort)!;
  const groupLabel = `${sort === "az" ? (needle ? `Matching “${q.trim()}”` : "All models") : `${sortInfo.label} first`}${filtering && !needle ? " (filtered)" : ""}`;

  return (
    <div className="msel">
      <div className="msel-search">
        <span aria-hidden="true">⌕</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${models.length || ""} models… (e.g. claude, gpt, gemini, flash)`}
          aria-label={`Search models for ${ariaLabel}`}
        />
        {q && (
          <button type="button" onClick={() => setQ("")} aria-label="Clear search">
            ×
          </button>
        )}
      </div>
      <div className="msel-tools">
        <div className="msel-sort" role="group" aria-label={`Sort models for ${ariaLabel}`}>
          {SORTS.map((x) => (
            <button key={x.key} type="button" aria-pressed={sort === x.key} onClick={() => setSort(x.key)}>
              {x.label}
            </button>
          ))}
        </div>
        <div className="msel-filters">
          <label>
            <input type="checkbox" checked={toolsOnly} onChange={(e) => setToolsOnly(e.target.checked)} /> Supports tools
          </label>
          <label>
            <input type="checkbox" checked={privateOnly} onChange={(e) => setPrivateOnly(e.target.checked)} /> Won&apos;t train on chats
          </label>
          <select value={provider} onChange={(e) => setProvider(e.target.value)} aria-label={`Company filter for ${ariaLabel}`}>
            <option value="">All companies</option>
            {providers.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
      </div>
      {sortInfo.hint && <div className="msel-hint">{sortInfo.hint}</div>}
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel}>
        {allowNone && <option value="">None</option>}
        {rec.length > 0 && (
          <optgroup label="Recommended">
            {rec.map((id) => (
              <option key={id} value={id}>{label(id, byId.get(id))}</option>
            ))}
          </optgroup>
        )}
        {others.length > 0 && (
          <optgroup label={groupLabel}>
            {others.map((id) => (
              <option key={id} value={id}>{label(id, byId.get(id))}{extra(sort, byId.get(id))}</option>
            ))}
          </optgroup>
        )}
      </select>
      {trainingWarning(byId.get(value)) && (
        <div className="msel-warn">
          <Glyph name="alert" /> This model {trainingWarning(byId.get(value))}: customer chats sent to it could be used to train AI models. Prefer one
          without this warning for customer chat.
        </div>
      )}
      {filtering && (
        <div className="msel-count">
          {shown === 0 ? "No models match — clear the search or filters." : `${shown} match${shown === 1 ? "" : "es"} — pick from the list`}
        </div>
      )}
    </div>
  );
}
