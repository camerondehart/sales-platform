"use client";

import { useEffect, useMemo, useState } from "react";
import AmbassadorGuide, { AMB_GUIDE_SEEN } from "./AmbassadorGuide";
import type { PanelData } from "@/lib/ambassadorPanel";
import { PANEL_RANGES, type PanelRange } from "@/lib/ambassadorPanelMath";
import { qrSvg } from "@/lib/qr";
import { brand } from "@/lib/brand";

/**
 * The Ambassador panel screens (app/ambassador/page.tsx). Data and picks go
 * through /api/ambassador. Read-only apart from "Your picks".
 */

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const whole = (n: number) => n.toLocaleString("en-US");
const day = (t: number) => new Date(t).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric" });
const ymd = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;

type Metric = "visits" | "orders" | "sales";

function Delta({ now, before }: { now: number; before: number | undefined }) {
  if (before === undefined) return null;
  if (before === 0 && now === 0) return <span className="abp-delta flat">no change</span>;
  if (before === 0) return <span className="abp-delta up">new</span>;
  const d = Math.round(((now - before) / before) * 100);
  if (d === 0) return <span className="abp-delta flat">no change</span>;
  return <span className={`abp-delta ${d > 0 ? "up" : "down"}`}>{d > 0 ? "▲" : "▼"} {Math.abs(d)}%</span>;
}

function Chart({ data, metric }: { data: PanelData["chart"]; metric: Metric }) {
  const pts = data.points;
  const vals = pts.map((p) => p[metric]);
  const max = Math.max(1, ...vals);
  const W = 640, H = 200, padL = 4, padB = 2, top = 10;
  const bw = (W - padL) / Math.max(1, pts.length);
  const gap = Math.min(6, bw * 0.28);
  // A few labels along the bottom, never crowded.
  const every = Math.max(1, Math.ceil(pts.length / 5));
  const fmt = (v: number) => (metric === "sales" ? money(v) : whole(v));
  const unitWord = data.unit === "day" ? "" : data.unit === "week" ? "Week of " : "";
  const total = vals.reduce((a, b) => a + b, 0);
  if (!total)
    return (
      <div className="abp-chart-empty">
        <span aria-hidden="true">🌱</span>
        Nothing in this range yet. Share your link and this fills up.
      </div>
    );
  return (
    <div className="abp-chart-wrap">
    <svg className="abp-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${metric} by ${data.unit}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="abp-bar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#85ba45" />
          <stop offset="1" stopColor="#0fc7a3" stopOpacity="0.75" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={0} x2={W} y1={top + (H - padB - top) * (1 - f)} y2={top + (H - padB - top) * (1 - f)} className="abp-grid" />
      ))}
      {pts.map((p, i) => {
        const v = p[metric];
        const h = v ? Math.max(3, ((H - padB - top) * v) / max) : 0;
        const x = padL + i * bw + gap / 2;
        return (
          <g key={p.key}>
            <rect x={x} y={H - padB - h} width={Math.max(1, bw - gap)} height={h} rx={Math.min(4, (bw - gap) / 2)} fill="url(#abp-bar)">
              <title>{`${unitWord}${p.label}: ${fmt(v)}`}</title>
            </rect>
          </g>
        );
      })}
    </svg>
    {/* Labels as text under the chart, so they stay readable however wide the chart is stretched. */}
    <div className="abp-axis" aria-hidden="true">
      {pts.map((p, i) => (i % every === 0 ? <span key={p.key} style={{ left: `${((padL + i * bw + bw / 2) / W) * 100}%` }}>{p.label}</span> : null))}
    </div>
    </div>
  );
}

function Picks({ data, onSaved }: { data: PanelData["picks"]; onSaved: (ids: string[]) => void }) {
  const [sel, setSel] = useState<string[]>(data.selected);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const byId = useMemo(() => new Map(data.products.map((p) => [p.id, p])), [data.products]);
  const dirty = sel.join("|") !== data.selected.join("|");
  const shown = useMemo(() => {
    const f = q.trim().toLowerCase();
    return data.products.filter((p) => !sel.includes(p.id) && (!f || p.name.toLowerCase().includes(f) || (p.category || "").toLowerCase().includes(f)));
  }, [data.products, sel, q]);
  const move = (i: number, d: -1 | 1) => setSel((s) => {
    const j = i + d;
    if (j < 0 || j >= s.length) return s;
    const n = s.slice();
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });
  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/ambassador", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productIds: sel }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Couldn't save your picks.");
      onSaved(d.selected || sel);
      setMsg({ ok: true, text: "Saved. Your page shows these now." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't save your picks." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="abp-card" id="picks">
      <div className="abp-card-head">
        <div>
          <h2>Your picks</h2>
          <p className="abp-muted">The products on your page, in this order. Members-only ones show locked to visitors who aren&rsquo;t members.</p>
        </div>
        <div className="abp-pick-count">{sel.length}/24</div>
      </div>
      <div className="abp-picks">
        <div>
          <h3 className="abp-mini">On your page</h3>
          {sel.length ? (
            <ol className="abp-sel">
              {sel.map((id, i) => {
                const p = byId.get(id);
                if (!p) return null;
                return (
                  <li key={id}>
                    <span className="abp-num">{i + 1}</span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {p.image ? <img src={p.image} alt="" className="abp-thumb" /> : <span className="abp-thumb" />}
                    <span className="abp-pname">{p.name}{p.membersOnly && <em className="abp-tag">Members only</em>}</span>
                    <span className="abp-sel-btns">
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${p.name} up`}>↑</button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === sel.length - 1} aria-label={`Move ${p.name} down`}>↓</button>
                      <button type="button" onClick={() => setSel((s) => s.filter((x) => x !== id))} aria-label={`Take ${p.name} off your page`}>×</button>
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : <p className="abp-muted">Nothing picked yet: your page shows the whole shop.</p>}
        </div>
        <div>
          <h3 className="abp-mini">Add from the shop</h3>
          <input className="abp-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products" aria-label="Search products" />
          <ul className="abp-add">
            {shown.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => setSel((s) => (s.length >= 24 ? s : [...s, p.id]))} disabled={sel.length >= 24}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {p.image ? <img src={p.image} alt="" className="abp-thumb" /> : <span className="abp-thumb" />}
                  <span className="abp-pname">{p.name}{p.membersOnly && <em className="abp-tag">Members only</em>}</span>
                  <span className="abp-plus" aria-hidden="true">+</span>
                </button>
              </li>
            ))}
            {!shown.length && <li className="abp-muted">No other products match.</li>}
          </ul>
        </div>
      </div>
      <div className="abp-save">
        {msg && <span className={msg.ok ? "abp-ok" : "abp-err"} role="status">{msg.text}</span>}
        <button type="button" className="sp-btn sp-btn-ghost" onClick={() => { setSel(data.selected); setMsg(null); }} disabled={!dirty || busy}>Undo changes</button>
        <button type="button" className="sp-btn sp-btn-primary" onClick={save} disabled={!dirty || busy}>{busy ? "Saving…" : "Save my picks"}</button>
      </div>
    </section>
  );
}

export default function AmbassadorPanelClient({ initial }: { initial: PanelData }) {
  const [data, setData] = useState<PanelData>(initial);
  const [loading, setLoading] = useState(false);
  const [metric, setMetric] = useState<Metric>("visits");
  const [copied, setCopied] = useState("");
  // "How it works": opens by itself on an ambassador's first visit on this browser (not in a staff view).
  const [guide, setGuide] = useState(false);
  useEffect(() => {
    if (initial.me.actingAs) return;
    try {
      if (!localStorage.getItem(AMB_GUIDE_SEEN)) {
        setGuide(true);
        localStorage.setItem(AMB_GUIDE_SEEN, "1");
      }
    } catch {}
  }, [initial.me.actingAs]);
  const a = data.ambassador;
  const site = typeof window !== "undefined" ? window.location.origin : brand.siteUrl;
  const link = `${site}/${a.slug}`;
  const shownLink = link.replace(/^https?:\/\/(www\.)?/, "");
  const t = data.totals;
  const p = data.previous;
  const rangeLabel = PANEL_RANGES.find((r) => r.key === data.range.key)?.label || "";

  async function pick(range: PanelRange) {
    if (range === data.range.key) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/ambassador?range=${range}`, { cache: "no-store" });
      if (r.status === 401) return window.location.assign("/ambassador");
      if (r.ok) setData(await r.json());
    } finally {
      setLoading(false);
    }
  }
  function copy(text: string, what: string) {
    navigator.clipboard?.writeText(text).then(() => { setCopied(what); setTimeout(() => setCopied(""), 1600); }).catch(() => {});
  }
  function qr() {
    const blob = new Blob([qrSvg(`${link}?qr=1`, { size: 1200, margin: 4 })], { type: "image/svg+xml" });
    const href = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = href;
    el.download = `qr-${a.slug}.svg`;
    el.click();
    URL.revokeObjectURL(href);
  }
  async function signOut() {
    await fetch("/api/logout", { method: "POST" });
    window.location.assign("/");
  }

  const trial = data.terms.trial;
  const tiles: Array<{ k: string; label: string; value: string; sub?: React.ReactNode; delta?: React.ReactNode; icon: string }> = [
    { k: "visits", icon: "👀", label: "Page visits", value: whole(t.visits), sub: t.qrScans ? `${whole(t.qrScans)} from your QR code` : "Visits to your page", delta: <Delta now={t.visits} before={p?.visits} /> },
    { k: "views", icon: "✨", label: "Product views", value: whole(t.views), sub: "Products opened from your page" },
    { k: "joins", icon: "🌿", label: "Membership requests", value: whole(t.joins), sub: "From people who came through you" },
    { k: "orders", icon: "🛍️", label: "Orders", value: whole(t.orders), sub: t.conversion !== undefined ? `${pct(t.conversion)} of visits ordered` : `${whole(t.units)} item${t.units === 1 ? "" : "s"}`, delta: <Delta now={t.orders} before={p?.orders} /> },
    { k: "sales", icon: "📈", label: "Sales", value: money(t.sales), sub: t.pendingSales ? `+ ${money(t.pendingSales)} awaiting payment` : "Paid, before shipping", delta: <Delta now={t.sales} before={p?.sales} /> },
    { k: "earned", icon: "💚", label: "Commission earned", value: money(t.earned), sub: t.pending ? `+ ${money(t.pending)} once paid` : `At ${pct(data.terms.rate)}`, delta: <Delta now={t.earned} before={p?.earned} /> },
  ];

  return (
    <div className="abp-shell">
      {data.me.actingAs && <div className="abp-acting">Staff view: you&rsquo;re logged in as {data.me.name}. Changes to picks are recorded in the Activity log.</div>}
      <header className="abp-hero">
        <div className="abp-aura" aria-hidden="true"><span /><span /><span /></div>
        <div className="abp-portrait">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {a.photo ? <img src={a.photo} alt="" /> : <span className="abp-initial">{a.first.slice(0, 1)}</span>}
          {a.emoji && <span className="abp-emoji" aria-hidden="true">{a.emoji}</span>}
        </div>
        <div className="abp-hero-text">
          <div className="abp-kicker">{brand.shortName} · Ambassador panel</div>
          <h1>Hi, {a.first}</h1>
          <p className="abp-sub">Here&rsquo;s how your page is doing. Thank you for sharing {brand.shortName}.</p>
          <div className="abp-hero-actions">
            <a className="sp-btn sp-btn-primary" href={`/${a.slug}`} target="_blank" rel="noopener">See my page</a>
            <a className="sp-btn sp-btn-ghost" href="/gallery">Shop as a member</a>
            <button type="button" className="sp-btn sp-btn-ghost" onClick={() => setGuide((g) => !g)} aria-expanded={guide}>📖 How it works</button>
            <button type="button" className="sp-btn sp-btn-ghost" onClick={signOut}>Sign out</button>
          </div>
        </div>
      </header>

      {guide && <AmbassadorGuide onClose={() => setGuide(false)} />}

      <section className="abp-share">
        <div className="abp-share-item">
          <span className="abp-mini">Your link</span>
          <div className="abp-share-row">
            <a href={`/${a.slug}`} target="_blank" rel="noopener" className="abp-link">{shownLink}</a>
            <button type="button" className="abp-chip" onClick={() => copy(link, "link")}>{copied === "link" ? "Copied ✓" : "Copy"}</button>
            <button type="button" className="abp-chip" onClick={qr}>QR code ⬇</button>
          </div>
        </div>
        <div className="abp-share-item">
          <span className="abp-mini">Your code</span>
          {data.code ? (
            <div className="abp-share-row">
              <strong className="abp-code">{data.code.code}</strong>
              <span className="abp-muted-inline">{data.code.off}{data.code.min ? ` over $${data.code.min.toFixed(2).replace(/\.00$/, "")}` : ""}</span>
              <button type="button" className="abp-chip" onClick={() => copy(data.code!.code, "code")}>{copied === "code" ? "Copied ✓" : "Copy"}</button>
            </div>
          ) : <div className="abp-muted-inline">No code linked right now.</div>}
        </div>
      </section>

      <div className="abp-range" role="group" aria-label="Date range">
        {PANEL_RANGES.map((r) => (
          <button key={r.key} type="button" className={r.key === data.range.key ? "on" : ""} onClick={() => pick(r.key)} aria-pressed={r.key === data.range.key} disabled={loading}>{r.label}</button>
        ))}
        <span className="abp-range-dates">{ymd(data.range.from)} – {ymd(data.range.to)}{p ? " · vs the period before" : ""}</span>
      </div>

      <section className={`abp-tiles${loading ? " loading" : ""}`}>
        {tiles.map((x) => (
          <div key={x.k} className={`abp-tile abp-tile-${x.k}`}>
            <div className="abp-tile-top"><span className="abp-tile-icon" aria-hidden="true">{x.icon}</span>{x.label}</div>
            <div className="abp-tile-value">{x.value}</div>
            <div className="abp-tile-sub">{x.sub} {x.delta}</div>
          </div>
        ))}
      </section>

      <section className={`abp-card${loading ? " loading" : ""}`}>
        <div className="abp-card-head">
          <div>
            <h2>Over time</h2>
            <p className="abp-muted">{rangeLabel}, by {data.chart.unit}. Tap a bar for its number.</p>
          </div>
          <div className="abp-seg" role="group" aria-label="Show">
            {(["visits", "orders", "sales"] as Metric[]).map((m) => (
              <button key={m} type="button" className={metric === m ? "on" : ""} onClick={() => setMetric(m)} aria-pressed={metric === m}>{m === "visits" ? "Visits" : m === "orders" ? "Orders" : "Sales"}</button>
            ))}
          </div>
        </div>
        <Chart data={data.chart} metric={metric} />
      </section>

      <div className="abp-two">
        <section className="abp-card">
          <h2>Your earnings</h2>
          <div className="abp-earn">
            <div><span>Earned so far</span><strong>{money(data.allTime.earned)}</strong></div>
            <div><span>Paid to you</span><strong>{money(data.allTime.paidOut)}</strong></div>
            <div className="abp-owed"><span>Coming to you</span><strong>{money(data.allTime.owed)}</strong></div>
          </div>
          <p className="abp-muted">Paid {data.terms.payoutSchedule === "on request" ? "when you ask" : data.terms.payoutSchedule}. Commission is on product sales after discounts, not shipping, once an order is paid.</p>
          {data.payouts.length > 0 && (
            <>
              <h3 className="abp-mini">Recent payouts</h3>
              <ul className="abp-list">
                {data.payouts.slice(0, 6).map((x, i) => <li key={i}><span>{day(x.at)}</span><strong>{money(x.amount)}</strong></li>)}
              </ul>
            </>
          )}
        </section>
        <section className="abp-card">
          <h2>Your terms</h2>
          <dl className="abp-dl">
            <dt>Commission</dt>
            <dd>{pct(data.terms.rate)}{data.terms.growthOn ? " (your growth rate)" : ""}</dd>
            {!data.terms.growthOn && data.terms.growthPct !== undefined && (<><dt>Room to grow</dt><dd>{pct(data.terms.growthPct)}{data.terms.growthGoal ? `: ${data.terms.growthGoal}` : ""}</dd></>)}
            <dt>Orders count for</dt>
            <dd>{data.terms.windowDays} days after a visit{data.terms.repeatPurchases ? ", repeat orders too" : ", first order per customer"}</dd>
            <dt>Started</dt>
            <dd>{ymd(data.terms.startDate)}</dd>
            {trial.status !== "none" && (<><dt>Trial</dt><dd>{trial.status === "trial" ? `Day ${trial.day} of ${trial.length}, ends ${ymd(trial.ends!)}` : trial.status === "review" ? "Finished: we'll be in touch about what's next" : "Finished"}</dd></>)}
          </dl>
          <p className="abp-muted">Questions about your terms? Email <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>.</p>
        </section>
      </div>

      <section className="abp-card">
        <div className="abp-card-head">
          <h2>Top products</h2>
          <span className="abp-muted-inline">{whole(data.allTime.orders)} order{data.allTime.orders === 1 ? "" : "s"} since you started</span>
        </div>
        {data.topProducts.length ? (
          <ul className="abp-bars">
            {data.topProducts.map((x) => (
              <li key={x.name}>
                <span className="abp-bar-name">{x.name}</span>
                <span className="abp-bar"><span style={{ width: `${Math.max(6, (x.units / data.topProducts[0].units) * 100)}%` }} /></span>
                <strong>{x.units}</strong>
              </li>
            ))}
          </ul>
        ) : <p className="abp-muted">No orders in this range yet.</p>}
      </section>

      <section className={`abp-card${loading ? " loading" : ""}`}>
        <h2>Your orders</h2>
        <p className="abp-muted">We never share who bought: just each order&rsquo;s number, date, products and amounts.</p>
        {data.orders.length ? (
          <div className="abp-table-wrap">
            <table className="abp-table">
              <thead><tr><th>Order</th><th>Products</th><th>Status</th><th className="num">Sale</th><th className="num">You earn</th></tr></thead>
              <tbody>
                {data.orders.map((o) => (
                  <tr key={o.ref}>
                    <td><strong>#{o.ref}</strong><span>{day(o.at)}{o.via === "code" ? " · your code" : ""}</span></td>
                    <td>{o.items.map((i) => `${i.qty} × ${i.name}`).join(", ")}</td>
                    <td><span className={`abp-pill${o.earned ? " ok" : ""}`}>{o.status}</span></td>
                    <td className="num">{money(o.net)}</td>
                    <td className="num">{money(o.commission)}<span>{pct(o.rate)}{o.earned ? "" : " · once paid"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="abp-muted">No orders in this range yet. Orders placed after visiting your page{data.code ? " or with your code" : ""} show here.</p>}
      </section>

      <Picks data={data.picks} onSaved={(ids) => setData((d) => ({ ...d, picks: { ...d.picks, selected: ids } }))} />

      <p className="abp-foot">Signed in as {data.me.email}. Numbers are counted without cookies and never include who visited or bought.</p>
    </div>
  );
}
