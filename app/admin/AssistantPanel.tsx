"use client";

import { useEffect, useMemo, useState } from "react";
import ModelSelect, { trainingWarning } from "./ModelSelect";
import ConciergeNotes from "./ConciergeNotes";
import ModelSpend, { type SpendBlock } from "./ModelSpend";
import { useAdminRefresh } from "./useAdminRefresh";
import type { AdminRefreshKey } from "@/lib/assistant/shared";
import EscalationsList, { type EscalationItem } from "./EscalationsList";
import ConversationsPanel from "./ConversationsPanel";
import SourcesPanel from "./SourcesPanel";
import { brand } from "@/lib/brand";

// Admin → Assistant tab: switch it on/off per audience, pick the model,
// set the monthly ceiling, teach it about the business, and see usage.

type Config = {
  enabledPublic: boolean;
  enabledMembers: boolean;
  enabledStaff: boolean;
  model: string;
  fallbackModel: string;
  monthlyCapUsd: number;
  assistantName: string;
  persona: string;
  knowledge: string;
  escalationEmail: string;
  updatedAt: number;
};

type Totals = { requests: number; inputTokens: number; outputTokens: number; costUsd: number; toolCalls: number; errors: number; latencyMs?: number };

type Overview = {
  config: Config;
  keyConfigured: boolean;
  keySource: "api-key" | "oidc" | "none";
  month: string;
  totals: Totals;
  byAudience: Array<Totals & { key: string }>;
  byModel: Array<Totals & { key: string }>;
  spend?: Partial<Record<"month" | "d30" | "d120", SpendBlock>>;
  days: Array<{ day: string; requests: number; costUsd: number }>;
  escalations: EscalationItem[];
  escalationsOpen: number;
  escalationsThisMonth: number;
};

type ModelInfo = {
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

// A short, sensible list to show first. The full gateway catalogue is below.
// Three tested all-rounders from different companies, so one provider's
// outage or price change never leaves you without a good option. Each slot
// uses the first of its candidates the gateway actually offers; if none are
// listed, it picks that company's cheapest tool-capable "mini/flash" model.
//
// SELF-UPDATING: when the gateway publishes release dates, each slot picks
// that company's NEWEST model in its fast, low-cost family (Haiku / Luna or
// mini / Flash) that supports tools, costs at most $2 per 1M input tokens and
// whose providers all promise not to train on your chats. So when a new
// Haiku, Luna or Flash comes out, it shows up here by itself.
const RECOMMENDED_SLOTS: Array<{ provider: string; family: RegExp; candidates: string[]; why: string }> = [
  { provider: "anthropic", family: /haiku/i, candidates: ["anthropic/claude-haiku-4.5", "anthropic/claude-haiku-5"], why: "Fast, careful and inexpensive — the best default for customer chat" },
  { provider: "openai", family: /luna|-mini\b/i, candidates: ["openai/gpt-6-luna", "openai/gpt-6-mini", "openai/gpt-5.1-mini", "openai/gpt-5-mini"], why: "OpenAI's quick all-rounder — a good alternative or backup" },
  { provider: "google", family: /flash/i, candidates: ["google/gemini-3.6-flash", "google/gemini-3.5-flash", "google/gemini-3-flash", "google/gemini-2.5-flash"], why: "Google's fast, low-cost model — usually the cheapest" },
];
// Not for a live chat: media/specialist models, previews, and the slow "batch" /
// "flex" variants (queued, cheaper, can take minutes to answer).
const NOT_CHAT = /lite|image|tts|audio|live|realtime|search|preview|exp|embed|codex|transcribe|-fast\b|fastvariant|batch|flex/i;

function newestInFamily(models: ModelInfo[], slot: (typeof RECOMMENDED_SLOTS)[number]): ModelInfo | undefined {
  return models
    .filter(
      (m) =>
        m.id.startsWith(`${slot.provider}/`) &&
        slot.family.test(m.id) &&
        !NOT_CHAT.test(m.id) &&
        !/batch|flex/i.test(m.name || "") &&
        m.toolUse === true &&
        m.noTraining === "all" &&
        typeof m.released === "number" &&
        m.inputPerM !== null &&
        m.inputPerM <= 2
    )
    .sort((a, b) => (b.released as number) - (a.released as number) || (a.inputPerM ?? 99) - (b.inputPerM ?? 99))[0];
}

function recommendedFrom(models: ModelInfo[]): Array<{ id: string; why: string }> {
  const ids = new Set(models.map((m) => m.id));
  return RECOMMENDED_SLOTS.map((slot) => {
    if (models.length === 0) return { id: slot.candidates[0], why: slot.why };
    const newest = newestInFamily(models, slot);
    if (newest) {
      const when = new Date((newest.released as number) * 1000).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: brand.timezone });
      return { id: newest.id, why: `${slot.why} · newest (${when})` };
    }
    // No release dates from the gateway: fall back to the tested list.
    const hit = slot.candidates.find((c) => ids.has(c));
    if (hit) return { id: hit, why: slot.why };
    const cheap = models
      .filter((m) => m.id.startsWith(`${slot.provider}/`) && m.toolUse !== false && /mini|flash|haiku|lite|luna/i.test(m.id))
      .sort((a, b) => (a.inputPerM ?? 99) - (b.inputPerM ?? 99))[0];
    return { id: cheap?.id || slot.candidates[0], why: slot.why };
  });
}

const usd = (n: number) => (n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(2)}`);
const num = (n: number) => n.toLocaleString("en-US");
const AUDIENCE_LABEL: Record<string, string> = { public: "Visitors", member: "Members", admin: "Staff" };

export default function AssistantPanel() {
  const [data, setData] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState<Config | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    setLoadError("");
    try {
      const res = await fetch("/api/admin/assistant", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as Overview;
      setData(d);
      setDraft((cur) => cur ?? d.config);
    } catch (err) {
      setLoadError("Couldn't load the assistant settings. Refresh to try again.");
    }
  }

  useAdminRefresh(["assistant","escalations"] as AdminRefreshKey[], () => load());
  useEffect(() => {
    load();
    fetch("/api/admin/assistant/models", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { models: [] }))
      .then((d) => setModels(Array.isArray(d.models) ? d.models : []))
      .catch(() => {});
  }, []);

  const dirty = useMemo(() => {
    if (!data || !draft) return false;
    return JSON.stringify({ ...data.config, updatedAt: 0 }) !== JSON.stringify({ ...draft, updatedAt: 0 });
  }, [data, draft]);

  const priceOf = (id: string) => models.find((m) => m.id === id);

  async function save() {
    if (!draft) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/assistant", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabledPublic: draft.enabledPublic,
          enabledMembers: draft.enabledMembers,
          enabledStaff: draft.enabledStaff,
          model: draft.model,
          fallbackModel: draft.fallbackModel,
          monthlyCapUsd: draft.monthlyCapUsd,
          assistantName: draft.assistantName,
          persona: draft.persona,
          knowledge: draft.knowledge,
          escalationEmail: draft.escalationEmail,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.config) throw new Error(d.error || "Could not save.");
      setDraft(d.config);
      setData((cur) => (cur ? { ...cur, config: d.config } : cur));
      setMsg({ ok: true, text: "Saved. Changes reach the live chat within about a minute." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Could not save." });
    }
    setSaving(false);
  }

  async function runTest() {
    if (!draft) return;
    setTesting(true);
    setTest(null);
    try {
      const res = await fetch("/api/admin/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: draft.model }),
      });
      const d = await res.json().catch(() => ({}));
      if (d.ok) {
        setTest({
          ok: true,
          text: `“${d.reply}” — ${d.model} answered in ${(d.ms / 1000).toFixed(1)}s for ${usd(d.costUsd)}${
            d.usedTool ? ", including a tool lookup — ready for real chats." : ". It didn’t use the test tool, so order lookups may not work with this model."
          }`,
        });
      } else {
        setTest({ ok: false, text: `${d.error || "The test failed."}${d.detail ? ` Gateway said: “${d.detail}”` : ""}` });
      }
    } catch {
      setTest({ ok: false, text: "Network error." });
    }
    setTesting(false);
  }

  if (loadError) return <section className="admin-section"><div className="notice">{loadError}</div></section>;
  if (!data || !draft) return <section className="admin-section"><div className="empty" style={{ padding: "2rem 0" }}>Loading the assistant…</div></section>;

  const cap = draft.monthlyCapUsd;
  const spent = data.totals.costUsd;
  const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
  const maxDay = Math.max(0.0001, ...data.days.map((d) => d.requests));
  const set = <K extends keyof Config>(k: K, v: Config[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  const RECOMMENDED = recommendedFrom(models);

  return (
    <>
      {/* ---------------- status + usage ---------------- */}
      <section className="admin-section">
        <h2>AI assistant</h2>
        {!data.keyConfigured ? (
          <div className="notice ap-warn">
            <strong>Not connected yet.</strong> Add an <code>AI_GATEWAY_API_KEY</code> environment variable in Vercel
            (Project → Settings → Environment Variables), then redeploy. Until then the chat button stays hidden for customers.
          </div>
        ) : (
          <div className="notice">
            Connected to Vercel AI Gateway{data.keySource === "oidc" ? " (using the project's built-in token)" : ""}. The chat bubble appears
            for anyone the assistant is switched on for below.
          </div>
        )}

        <div className="ap-kpis">
          <div className="ap-kpi">
            <div className="ap-kpi-label">Spent this month</div>
            <div className="ap-kpi-value">{usd(spent)}</div>
            {cap > 0 ? (
              <>
                <div className="ap-bar"><span style={{ width: `${pct}%` }} className={pct >= 90 ? "hot" : ""} /></div>
                <div className="ap-kpi-sub">of {usd(cap)} limit{pct >= 100 ? " — paused" : ""}</div>
              </>
            ) : (
              <div className="ap-kpi-sub">no monthly limit</div>
            )}
          </div>
          <div className="ap-kpi">
            <div className="ap-kpi-label">Messages answered</div>
            <div className="ap-kpi-value">{num(data.totals.requests)}</div>
            <div className="ap-kpi-sub">{data.totals.requests ? `${usd(spent / data.totals.requests)} each on average` : "none yet this month"}</div>
          </div>
          <div className="ap-kpi">
            <div className="ap-kpi-label">Handed to the team</div>
            <div className="ap-kpi-value">{num(data.escalationsThisMonth)}</div>
            <div className="ap-kpi-sub">
              this month
              {data.escalationsOpen > 0 && (
                <>
                  {" · "}
                  <a href="#handed-to-team" className="ap-kpi-link">{data.escalationsOpen} waiting for a reply</a>
                </>
              )}
            </div>
          </div>
          <div className="ap-kpi">
            <div className="ap-kpi-label">Errors</div>
            <div className="ap-kpi-value">{num(data.totals.errors)}</div>
            <div className="ap-kpi-sub">
              {data.totals.requests ? `${((data.totals.errors / data.totals.requests) * 100).toFixed(1)}% of turns` : "—"}
              {data.totals.requests && data.totals.latencyMs ? ` · ${(data.totals.latencyMs / data.totals.requests / 1000).toFixed(1)}s avg reply` : ""}
            </div>
          </div>
        </div>

        <div className="ap-chart" aria-label="Messages per day, last 30 days">
          {data.days.map((d) => (
            <div key={d.day} className="ap-chart-col" title={`${d.day}: ${d.requests} messages, ${usd(d.costUsd)}`}>
              <span style={{ height: `${Math.max(d.requests ? 6 : 0, (d.requests / maxDay) * 100)}%` }} />
            </div>
          ))}
        </div>
        <div className="ap-chart-legend"><span>30 days ago</span><span>Messages per day</span><span>Today</span></div>

        <ModelSpend spend={data.spend} mainModel={data.config.model} backupModel={data.config.fallbackModel} />
        <p className="field-hint" style={{ marginTop: "0.75rem" }}>
          Costs are worked out by the site from each model's published price and refresh every couple of minutes, so they may trail by a
          few messages. Your AI Gateway balance in Vercel is the exact bill.
        </p>
      </section>

      {/* ---------------- settings ---------------- */}
      <section className="admin-section">
        <h2>Settings</h2>

        <div className="ap-toggles">
          {([
            ["enabledPublic", "Visitors", "Anyone on the public site"],
            ["enabledMembers", "Members", `Signed-in ${brand.members} members`],
            ["enabledStaff", "Staff", "This dashboard"],
          ] as const).map(([k, label, sub]) => (
            <label key={k} className={`ap-toggle${draft[k] ? " on" : ""}`}>
              <input type="checkbox" checked={draft[k]} onChange={(e) => set(k, e.target.checked)} />
              <span className="ap-switch" aria-hidden="true" />
              <span><strong>{label}</strong><small>{sub}</small></span>
            </label>
          ))}
        </div>

        <div className="admin-form" style={{ marginTop: "1.25rem" }}>
          <div className="field full">
            <label>Model</label>
            <div className="ap-models">
              {RECOMMENDED.map((r) => {
                const p = priceOf(r.id);
                return (
                  <button
                    type="button"
                    key={r.id}
                    className={`ap-model${draft.model === r.id ? " selected" : ""}`}
                    onClick={() => set("model", r.id)}
                  >
                    <span className="ap-model-name">{p?.name || r.id}</span>
                    <span className="ap-model-why">{r.why}</span>
                    {p && p.inputPerM !== null && (
                      <span className="ap-model-price">${p.inputPerM} in · ${p.outputPerM} out per 1M tokens</span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="ap-anymodel">
              <span className="ap-anymodel-label">Or choose any model ({models.length} available)</span>
              <ModelSelect models={models} value={draft.model} onChange={(id) => set("model", id)} recommended={RECOMMENDED.map((r) => r.id)} ariaLabel="Main model" />
            </div>
            <div className="field-hint">
              Currently selected: <span className="ap-mono">{draft.model}</span>. Models marked “no tools” can’t look
              up orders or reset passwords — stick to ones that support tools.
            </div>
            <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.6rem" }}>
              <button type="button" className="export-btn" onClick={runTest} disabled={testing || !data.keyConfigured}>
                {testing ? "Testing…" : "Test this model"}
              </button>
              {test && <span className={test.ok ? "ap-ok" : "ap-bad"}>{test.text}</span>}
            </div>
          </div>

          <div className="field">
            <label>Backup model</label>
            <ModelSelect models={models} value={draft.fallbackModel} onChange={(id) => set("fallbackModel", id)} recommended={RECOMMENDED.map((r) => r.id)} allowNone ariaLabel="Backup model" />
            <div className="field-hint">
              Answers only when the main model fails. Pick one from a different family (e.g. a Sonnet behind an Opus) so one
              outage doesn’t take out both.
              {draft.fallbackModel && draft.fallbackModel === draft.model ? " ⚠ This is the same as the main model, so it can’t help." : ""}
            </div>
          </div>

          <div className="field">
            <label>Monthly spending limit (USD)</label>
            <input
              type="number"
              min={0}
              step={1}
              value={Number.isFinite(draft.monthlyCapUsd) ? draft.monthlyCapUsd : 0}
              onChange={(e) => set("monthlyCapUsd", Math.max(0, Number(e.target.value) || 0))}
            />
            <div className="field-hint">At the limit the chat goes offline until the 1st and you get an email. 0 = no limit.</div>
          </div>

          <div className="field">
            <label>Assistant name</label>
            <input value={draft.assistantName} maxLength={60} onChange={(e) => set("assistantName", e.target.value)} />
          </div>

          <div className="field">
            <label>Send escalations to</label>
            <input
              type="email"
              placeholder="Leave blank to use the site's inbox"
              value={draft.escalationEmail}
              onChange={(e) => set("escalationEmail", e.target.value)}
            />
          </div>

          <div className="field full">
            <label>Tone</label>
            <textarea rows={2} maxLength={2000} value={draft.persona} onChange={(e) => set("persona", e.target.value)} />
          </div>

          <div className="field full">
            <label>What the assistant should know</label>
            <textarea
              rows={12}
              maxLength={30000}
              value={draft.knowledge}
              onChange={(e) => set("knowledge", e.target.value)}
              placeholder={`Write it like you're briefing a new hire. For example:

Our best seller is Harmony Blend — people love it in morning coffee.
Lion's Mane is our go-to suggestion for focus.
Returns: unopened items within 30 days, email support first.
Local pickup is Tuesdays and Fridays, 10–4, at the studio.
We don't ship outside the US.`}
            />
            <div className="field-hint">
              It already knows your products, prices, sales, events and how the site works — add the things only you know:
              favourites, pairing ideas, policies, pickup details, FAQs. {draft.knowledge.length.toLocaleString()} / 30,000 characters.
            </div>
          </div>

          <SourcesPanel />

          <div className="full" style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="submit" onClick={save} disabled={saving || !dirty} style={{ width: "auto", padding: "0.7rem 1.4rem" }}>
              {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
            </button>
            {dirty && !saving && (
              <button type="button" className="ap-linkbtn" onClick={() => setDraft(data.config)}>Discard changes</button>
            )}
            {msg && <span className={msg.ok ? "ap-ok" : "ap-bad"}>{msg.text}</span>}
          </div>
        </div>
      </section>

      {/* ---------------- escalations ---------------- */}
      <EscalationsList initial={data.escalations} />

      {/* ---------------- conversations ---------------- */}
      <ConversationsPanel />

      {/* ---------------- what the Concierge has learned ---------------- */}
      <ConciergeNotes />
    </>
  );
}
