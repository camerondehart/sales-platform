"use client";

import { useEffect, useState } from "react";
import { useAdminRefresh } from "./useAdminRefresh";
import type { AdminRefreshKey } from "@/lib/assistant/shared";
import { brand } from "@/lib/brand";

// Marketing → Campaigns sent & scheduled, with results. Opens/clicks need the
// Resend webhook (see HANDOFF.md); visits and sales come from the links.

type Row = {
  id: string;
  subject: string;
  body: string;
  audience: string;
  groups?: string[];
  customEmails?: string[];
  theme?: string;
  startedAt?: number;
  status: "scheduled" | "sending" | "sent" | "cancelled";
  createdAt: number;
  scheduledFor: number;
  total?: number;
  sent: number;
  failed: number;
  remaining: number;
  opens: number;
  clicks: number;
  visits: number;
  orders: number;
  revenue: number;
};

const when = (t: number) =>
  new Date(t).toLocaleString("en-US", { timeZone: brand.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const AUD: Record<string, string> = { all: "Everyone", members: "Members", nonmembers: "Non-members", custom: "Pasted list", subscribers: "Subscribers" };
const GROUP_LABEL: Record<string, string> = { ms: "Members subscribed", mn: "Non-subscribed members", ls: "Mailing list – not member" };
const audLabel = (r: { audience: string; groups?: string[] }) =>
  r.audience === "groups" && r.groups?.length ? r.groups.map((g) => GROUP_LABEL[g] || g).join(" + ") : AUD[r.audience] || r.audience;
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");

export type CampaignRow = Row;

export default function CampaignHistory({
  refreshKey,
  onDuplicate,
  onEdit,
  editingId,
}: {
  refreshKey: number;
  onDuplicate: (subject: string, body: string) => void;
  onEdit?: (c: Row) => void;
  editingId?: string | null;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const load = () =>
    fetch("/api/admin/campaigns", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setRows(d.campaigns || []))
      .catch(() => setRows([]));

  useAdminRefresh(["campaigns"] as AdminRefreshKey[], () => load());
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [refreshKey]);

  async function cancel(r: Row) {
    if (!confirm(`Cancel "${r.subject}"? It won't be sent.`)) return;
    setBusy(r.id);
    setMsg("");
    try {
      const res = await fetch("/api/admin/campaigns", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel", id: r.id }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Couldn't cancel.");
      setMsg("Cancelled — it won't be sent.");
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Couldn't cancel.");
    }
    setBusy(null);
  }

  if (!rows || rows.length === 0) return null;
  return (
    <div className="ch">
      <h3 className="ch-title">Campaigns</h3>
      <div className="ch-list">
        {rows.map((r) => (
          <div key={r.id} className={`ch-row ${r.status}${editingId === r.id ? " is-editing" : ""}`}>
            <div className="ch-main">
              <strong>{r.subject}</strong>
              <span className="ch-meta">
                <span className={`ch-status ${r.status}`}>
                  {r.status === "scheduled" ? `Scheduled · ${when(r.scheduledFor)}` : r.status === "sending" ? `Sending · ${r.sent}/${r.total}` : r.status === "sent" ? `Sent · ${when(r.scheduledFor)}` : "Cancelled"}
                </span>
                {audLabel(r)}
                {r.total !== undefined && r.status !== "scheduled" ? ` · ${r.sent} delivered${r.failed ? `, ${r.failed} failed` : ""}` : ""}
              </span>
            </div>
            {(r.status === "sent" || r.status === "sending") && (
              <div className="ch-stats">
                <span><strong>{pct(r.opens, r.sent)}</strong>opened</span>
                <span><strong>{pct(r.clicks, r.sent)}</strong>clicked</span>
                <span><strong>{r.visits}</strong>visits</span>
                <span><strong>{r.orders}</strong>orders</span>
                <span><strong>${r.revenue.toFixed(0)}</strong>sales</span>
              </div>
            )}
            <div className="ch-actions">
              {r.status === "scheduled" && onEdit && (
                <button type="button" className="esc-btn" disabled={editingId === r.id} onClick={() => onEdit(r)}>
                  {editingId === r.id ? "Editing…" : "Edit"}
                </button>
              )}
              {r.status === "scheduled" && (
                <button type="button" className="esc-btn" disabled={busy === r.id} onClick={() => cancel(r)}>Cancel</button>
              )}
              <button type="button" className="ap-linkbtn esc-quiet" onClick={() => onDuplicate(r.subject, r.body)}>Duplicate</button>
            </div>
          </div>
        ))}
      </div>
      {msg && <div className="field-hint">{msg}</div>}
      <div className="field-hint">Open and click rates appear once the Resend webhook is set up. Visits, orders and sales come from people clicking the email's links.</div>
    </div>
  );
}
