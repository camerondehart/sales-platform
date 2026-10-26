"use client";

import { useEffect, useState } from "react";

// Assistant tab → "Where the spend goes": cost by audience and by model,
// for this month, the last 30 days or everything kept (120 days).

type Totals = { requests: number; inputTokens: number; outputTokens: number; costUsd: number; toolCalls: number; errors: number; latencyMs?: number };
type Row = Totals & { key: string };
export type SpendBlock = { totals: Totals; byModel: Row[]; byAudience: Row[] };
type Range = "month" | "d30" | "d120";

const RANGES: Array<[Range, string]> = [
  ["month", "This month"],
  ["d30", "Last 30 days"],
  ["d120", "Last 120 days"],
];
const AUD: Array<[string, string, string]> = [
  ["admin", "Staff", "#2f5d3a"],
  ["member", "Members", "#85ba45"],
  ["public", "Visitors", "#d8b36a"],
];
const PROVIDER_COLOR: Record<string, string> = {
  anthropic: "#d97757",
  openai: "#10a37f",
  google: "#4285f4",
  meta: "#0866ff",
  xai: "#1f1f1f",
  spacexai: "#1f1f1f",
  amazon: "#ff9900",
  deepseek: "#4d6bfe",
  alibaba: "#ff6a00",
  zai: "#6c5ce7",
  mistral: "#fa520f",
  cohere: "#39594d",
  perplexity: "#20808d",
};

const PROVIDER_NAME: Record<string, string> = {
  openai: "OpenAI", xai: "xAI", spacexai: "SpaceX AI", zai: "Z.ai", deepseek: "DeepSeek", mistral: "Mistral", alibaba: "Alibaba",
  anthropic: "Anthropic", google: "Google", meta: "Meta", amazon: "Amazon", cohere: "Cohere", perplexity: "Perplexity",
};
const providerName = (p: string) => PROVIDER_NAME[p.toLowerCase()] || p.charAt(0).toUpperCase() + p.slice(1);

const usd = (n: number) => (n > 0 && n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);
const per = (n: number) => (n > 0 && n < 0.001 ? "<$0.001" : `$${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`);
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k` : String(n));

export default function ModelSpend({
  spend,
  mainModel,
  backupModel,
}: {
  spend: Partial<Record<Range, SpendBlock>> | undefined;
  mainModel: string;
  backupModel: string;
}) {
  const [range, setRange] = useState<Range>("month");
  // Collapsed to a one-line summary by default; remembered on this browser.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("fp_spend_open") === "1");
    } catch {}
  }, []);
  const toggle = (v: boolean) => {
    setOpen(v);
    try {
      localStorage.setItem("fp_spend_open", v ? "1" : "0");
    } catch {}
  };
  const block = spend?.[range];
  if (!block) return null;
  const total = block.totals.costUsd;
  const maxModel = Math.max(...block.byModel.map((m) => m.costUsd), 0.000001);
  const aud = new Map(block.byAudience.map((r) => [r.key, r]));

  // Colour per model: the provider's colour, a little lighter for each further model from the same provider.
  const seen = new Map<string, number>();
  const colorOf = new Map<string, { color: string; opacity: number }>();
  for (const m of block.byModel) {
    const prov = m.key.split("/")[0].toLowerCase();
    const k = seen.get(prov) || 0;
    seen.set(prov, k + 1);
    colorOf.set(m.key, { color: PROVIDER_COLOR[prov] || "#85ba45", opacity: Math.max(0.35, 1 - k * 0.22) });
  }

  if (!open) {
    const big = block.byModel.filter((m) => total > 0 && m.costUsd / total >= 0.02);
    const rest = total - big.reduce((n, m) => n + m.costUsd, 0);
    return (
      <button type="button" className="ms-summary" onClick={() => toggle(true)} aria-expanded={false}>
        <span className="ms-sum-left">
          <span className="ms-sum-label">Spend · {RANGES.find(([k]) => k === range)?.[1]}</span>
          <strong>{usd(total)}</strong>
          <span className="ms-sum-sub">{block.totals.requests.toLocaleString("en-US")} turns</span>
        </span>
        <span className="ms-sum-mid">
          <span className="ms-stack" aria-hidden="true">
            {total > 0 ? (
              <>
                {big.map((m) => (
                  <i key={m.key} style={{ width: `${(m.costUsd / total) * 100}%`, background: colorOf.get(m.key)!.color, opacity: colorOf.get(m.key)!.opacity }} title={`${m.key}: ${usd(m.costUsd)}`} />
                ))}
                {rest > 0.000001 && <i style={{ width: `${(rest / total) * 100}%`, background: "#c9c6bb" }} title={`Others: ${usd(rest)}`} />}
              </>
            ) : (
              <i style={{ width: "100%", background: "rgba(0,0,0,0.06)" }} />
            )}
          </span>
          <span className="ms-sum-top">
            {block.byModel.slice(0, 3).map((m) => (
              <span key={m.key}>
                <em style={{ background: colorOf.get(m.key)!.color, opacity: colorOf.get(m.key)!.opacity }} />
                {m.key.split("/").slice(1).join("/") || m.key} <b>{usd(m.costUsd)}</b>
              </span>
            ))}
            {block.byModel.length > 3 && <span className="ms-sum-more">+{block.byModel.length - 3} more</span>}
          </span>
        </span>
        <span className="ms-sum-open">Details ▾</span>
      </button>
    );
  }

  return (
    <div className="ms">
      <div className="ms-head">
        <div>
          <h3>
            Where the spend goes{" "}
            <button type="button" className="ms-collapse" onClick={() => toggle(false)} aria-expanded={true}>
              Collapse ▴
            </button>
          </h3>
          <div className="ms-total">
            <strong>{usd(total)}</strong> · {block.totals.requests.toLocaleString("en-US")} turns
            {block.totals.requests ? ` · ${per(total / block.totals.requests)} a turn on average` : ""}
          </div>
        </div>
        <div className="seg" role="tablist" aria-label="Period">
          {RANGES.map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={range === k} className={range === k ? "on" : ""} onClick={() => setRange(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Who it was spent on */}
      <div className="ms-aud">
        {AUD.map(([k, label, color]) => {
          const r = aud.get(k);
          const cost = r?.costUsd || 0;
          const share = total > 0 ? Math.round((cost / total) * 100) : 0;
          return (
            <div key={k} className="ms-aud-card">
              <div className="ms-aud-top">
                <span className="ms-dot" style={{ background: color }} />
                {label}
                <span className="ms-share">{share}%</span>
              </div>
              <div className="ms-aud-cost">{usd(cost)}</div>
              <div className="ms-aud-sub">
                {(r?.requests || 0).toLocaleString("en-US")} turn{r?.requests === 1 ? "" : "s"}{r?.requests ? ` · ${per(cost / r.requests)} each` : ""}
              </div>
              <div className="ms-bar"><i style={{ width: `${share}%`, background: color }} /></div>
            </div>
          );
        })}
      </div>

      {/* Which models it was spent on */}
      {block.byModel.length === 0 ? (
        <div className="an-empty">No messages in this period.</div>
      ) : (
        <div className="ms-models">
          {block.byModel.map((m, i) => {
            const [provider, ...rest] = m.key.split("/");
            const name = rest.join("/") || m.key;
            const color = PROVIDER_COLOR[provider.toLowerCase()] || "#85ba45";
            const share = total > 0 ? (m.costUsd / total) * 100 : 0;
            return (
              <div key={m.key} className="ms-model" style={{ animationDelay: `${i * 35}ms` }}>
                <div className="ms-model-name">
                  <span className="ms-prov" style={{ background: color }}>{provider.slice(0, 1).toUpperCase()}</span>
                  <div>
                    <strong>{name}</strong>
                    <span className="ms-prov-name">
                      {providerName(provider)}
                      {m.key === mainModel && <em className="ms-chip main">Main</em>}
                      {m.key === backupModel && <em className="ms-chip">Backup</em>}
                    </span>
                  </div>
                </div>
                <div className="ms-model-bar" title={`${share.toFixed(1)}% of spend`}>
                  <i style={{ width: `${Math.max(m.costUsd > 0 ? 2 : 0, (m.costUsd / maxModel) * 100)}%`, background: color }} />
                </div>
                <div className="ms-model-cost">
                  <strong>{usd(m.costUsd)}</strong>
                  <span>{share >= 0.5 ? `${Math.round(share)}%` : share > 0 ? "<1%" : "0%"}</span>
                </div>
                <div className="ms-model-meta">
                  <span><b>{m.requests.toLocaleString("en-US")}</b> turn{m.requests === 1 ? "" : "s"}</span>
                  <span><b>{m.requests ? per(m.costUsd / m.requests) : "—"}</b> / turn</span>
                  <span><b>{compact(m.inputTokens)}</b> in · <b>{compact(m.outputTokens)}</b> out</span>
                  {m.requests && m.latencyMs ? <span><b>{(m.latencyMs / m.requests / 1000).toFixed(1)}s</b> avg reply</span> : null}
                  {m.errors ? <span className="ms-err"><b>{m.errors}</b> error{m.errors === 1 ? "" : "s"}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
