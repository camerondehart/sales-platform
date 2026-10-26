"use client";

import { useMemo, useState } from "react";

// One model picker for both the main and the backup model: a search box
// that narrows a dropdown of every model on the AI Gateway (with prices).

export type ModelInfo = {
  id: string;
  name: string;
  provider: string;
  inputPerM: number | null;
  outputPerM: number | null;
  toolUse: boolean | null;
  released?: number | null;
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
    m?.noTraining === "none" || m?.noTraining === "some" ? " · ⚠ may train on your data" : ""
  }`;

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
  const byId = useMemo(() => new Map(models.map((m) => [m.id, m])), [models]);
  const needle = q.trim().toLowerCase();
  const matches = (id: string) => !needle || id.toLowerCase().includes(needle) || (byId.get(id)?.name || "").toLowerCase().includes(needle);
  const rec = recommended.filter(matches);
  // Keep the saved choice selectable even if the list hasn't loaded or no longer has it.
  const others = Array.from(new Set([value, ...models.map((m) => m.id)].filter(Boolean)))
    .filter((id) => !recommended.includes(id))
    .filter((id) => id === value || matches(id))
    .sort((a, b) => a.localeCompare(b));
  const shown = rec.length + others.filter((id) => id !== value || matches(id)).length;

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
          <optgroup label={needle ? `Matching “${q.trim()}”` : "All models"}>
            {others.map((id) => (
              <option key={id} value={id}>{label(id, byId.get(id))}</option>
            ))}
          </optgroup>
        )}
      </select>
      {trainingWarning(byId.get(value)) && (
        <div className="msel-warn">
          ⚠ This model {trainingWarning(byId.get(value))}: customer chats sent to it could be used to train AI models. Prefer one
          without this warning for customer chat.
        </div>
      )}
      {needle && <div className="msel-count">{shown === 0 ? "No models match — clear the search." : `${shown} match${shown === 1 ? "" : "es"} — pick from the list`}</div>}
    </div>
  );
}
