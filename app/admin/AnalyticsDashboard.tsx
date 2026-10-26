"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dashboard } from "@/lib/dashboard";
import { AreaChart, BarList, CountUp, Donut, Funnel, Heatmap, Sparkline, money, num } from "./charts";
import { brand } from "@/lib/brand";

// Admin → Analytics. Sales from real orders; visitors from the cookie-free
// counters (lib/traffic.ts). Everything is computed server-side in
// lib/dashboard.ts — this file only draws it.

const TOPIC_NAMES: Record<string, string> = {
  orders: "Orders & tracking", payment: "Payment", shipping: "Shipping & pickup", products: "Products",
  membership: "Membership", login: "Sign-in & account", events: "Events", deals: "Deals & points", complaint: "Complaints", other: "Other",
};

const RANGES: Array<[number, string]> = [
  [7, "7 days"],
  [30, "30 days"],
  [90, "90 days"],
  [365, "1 year"],
];

function Delta({ change, suffix = "%", invert = false }: { change: number | null | undefined; suffix?: string; invert?: boolean }) {
  if (change === null || change === undefined) return <span className="delta flat">new</span>;
  const up = change > 0;
  const good = invert ? !up : up;
  if (change === 0) return <span className="delta flat">±0{suffix}</span>;
  return (
    <span className={`delta ${good ? "up" : "down"}`}>
      {up ? "▲" : "▼"} {Math.abs(change)}
      {suffix}
    </span>
  );
}

function Kpi({
  label,
  value,
  format,
  change,
  series,
  color,
  hint,
  suffix,
}: {
  label: string;
  value: number | null;
  format: (n: number) => string;
  change: number | null | undefined;
  series?: number[];
  color?: string;
  hint?: string;
  suffix?: string;
}) {
  return (
    <div className="kpi-card">
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        <Delta change={change} suffix={suffix} />
      </div>
      <div className="kpi-value">{value === null ? "—" : <CountUp value={value} format={format} />}</div>
      {series ? <Sparkline values={series} color={color} /> : <div className="kpi-hint">{hint}</div>}
    </div>
  );
}

export default function AnalyticsDashboard({ initialData }: { initialData?: Dashboard } = {}) {
  const [days, setDays] = useState(initialData?.range.days || 30);
  const [data, setData] = useState<Dashboard | null>(initialData || null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [metric, setMetric] = useState<"revenue" | "orders" | "visits">("revenue");
  const [heatOf, setHeatOf] = useState<"visits" | "orders">(initialData?.hasTraffic && initialData.kpis.visitors.value > 20 ? "visits" : "orders");
  const [updated, setUpdated] = useState<number>(0);

  const load = useCallback(async (d: number) => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`/api/admin/analytics?days=${d}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setData(j);
      setUpdated(Date.now());
      setHeatOf(j.hasTraffic && j.kpis.visitors.value > 20 ? "visits" : "orders");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load analytics.");
    }
    setLoading(false);
  }, []);

  const skipFirst = useRef(!!initialData);
  useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false;
      return;
    }
    load(days);
  }, [days, load]);

  // Gentle auto-refresh every 2 minutes while the tab is open.
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && load(days), 120_000);
    return () => clearInterval(t);
  }, [days, load]);

  if (error && !data) return <section className="admin-section"><div className="notice">{error}</div></section>;
  if (!data) {
    return (
      <section className="an-shell">
        <div className="an-hero an-skeleton" />
        <div className="kpi-grid">{Array.from({ length: 8 }, (_, i) => <div key={i} className="kpi-card an-skeleton" />)}</div>
      </section>
    );
  }

  const k = data.kpis;
  const dayLabels = data.daily.map((d) => d.day);
  const series =
    metric === "revenue"
      ? { values: data.daily.map((d) => d.revenue), prev: data.daily.map((d) => d.prevRevenue), format: (n: number) => money(n) }
      : metric === "orders"
        ? { values: data.daily.map((d) => d.orders), prev: undefined, format: (n: number) => `${num(Math.round(n))} orders` }
        : { values: data.daily.map((d) => d.visits), prev: data.daily.map((d) => d.prevVisits), format: (n: number) => `${num(Math.round(n))} visits` };
  const rangeLabel = RANGES.find(([d]) => d === data.range.days)?.[1] || `${data.range.days} days`;
  const devices = data.sources.devices;

  return (
    <section className={`an-shell${loading ? " is-loading" : ""}`}>
      {/* ------------------------------------------------ hero */}
      <div className="an-hero">
        <div className="an-hero-glow" aria-hidden="true" />
        <div className="an-hero-top">
          <div>
            <div className="an-kicker">
              <span className="live-dot" aria-hidden="true" /> Analytics · last {rangeLabel}
            </div>
            <div className="an-headline">
              <CountUp value={k.revenue.value} format={(n) => money(n)} ms={1200} />
              <Delta change={k.revenue.change} />
            </div>
            <div className="an-sub">
              {num(k.orders.value)} paid orders · {money(k.aov.value)} average ·{" "}
              {data.hasTraffic ? `${num(k.visitors.value)} visits` : "visitor counting just started"}
            </div>
          </div>
          <div className="an-range" role="tablist" aria-label="Period">
            {RANGES.map(([d, l]) => (
              <button key={d} type="button" role="tab" aria-selected={days === d} className={days === d ? "on" : ""} onClick={() => setDays(d)}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="an-hero-chart">
          <Sparkline values={k.revenue.series} color="#d8f0a8" height={70} />
        </div>
        <div className="an-updated">
          Updated {new Date(updated).toLocaleTimeString("en-US", { timeZone: brand.timezone, hour: "numeric", minute: "2-digit" })}
          <button type="button" onClick={() => load(days)} disabled={loading} aria-label="Refresh">↻</button>
        </div>
      </div>

      {/* ------------------------------------------------ highlights */}
      {data.highlights.length > 0 && (
        <div className="an-highlights">
          {data.highlights.map((h, i) => (
            <div key={i} className={`an-hl ${h.tone}`} style={{ animationDelay: `${i * 70}ms` }}>
              <span className="an-hl-icon" aria-hidden="true">{h.tone === "good" ? "↗" : h.tone === "watch" ? "!" : "✦"}</span>
              {h.text}
            </div>
          ))}
        </div>
      )}
      {!data.hasTraffic && (
        <div className="an-note">
          Visitor counting is new. Visits, the funnel and traffic sources fill in as people browse the site. Sales, customers and members are
          already complete. Nothing personal is stored, and there are no cookies.
        </div>
      )}

      {/* ------------------------------------------------ KPI grid */}
      <div className="kpi-grid">
        <Kpi label="Revenue" value={k.revenue.value} format={(n) => money(n)} change={k.revenue.change} series={k.revenue.series} />
        <Kpi label="Paid orders" value={k.orders.value} format={(n) => num(Math.round(n))} change={k.orders.change} series={k.orders.series} color="#6fa336" />
        <Kpi label="Average order" value={k.aov.value} format={(n) => money(n, 2)} change={k.aov.change} series={k.aov.series} color="#a2a434" />
        <Kpi label="Visits" value={data.hasTraffic ? k.visitors.value : null} format={(n) => num(Math.round(n))} change={data.hasTraffic ? k.visitors.change : null} series={k.visitors.series} color="#4f8fb8" />
        <Kpi label="Visit → order" value={k.conversion.value} format={(n) => `${n.toFixed(1)}%`} change={k.conversion.change} suffix=" pts" hint="Share of visits that placed an order" />
        <Kpi label="New members" value={k.newMembers.value} format={(n) => num(Math.round(n))} change={k.newMembers.change} series={k.newMembers.series} color="#8a6fb8" />
        <Kpi label="New subscribers" value={k.newSubscribers.value} format={(n) => num(Math.round(n))} change={k.newSubscribers.change} series={k.newSubscribers.series} color="#d08b3a" />
        <Kpi label="Concierge chats" value={k.assistantChats.value} format={(n) => num(Math.round(n))} change={undefined} series={k.assistantChats.series} color="#3aa39a" />
      </div>

      {/* ------------------------------------------------ main chart */}
      <div className="an-card an-wide">
        <div className="an-card-head">
          <h3>Over time</h3>
          <div className="seg">
            {(["revenue", "orders", "visits"] as const).map((m) => (
              <button key={m} type="button" className={metric === m ? "on" : ""} onClick={() => setMetric(m)}>
                {m === "revenue" ? "Revenue" : m === "orders" ? "Orders" : "Visits"}
              </button>
            ))}
          </div>
        </div>
        <AreaChart days={dayLabels} values={series.values} prev={series.prev} format={series.format} color={metric === "visits" ? "#4f8fb8" : "#85ba45"} />
        <div className="an-legend">
          <span><i className="lg-now" /> This period</span>
          {series.prev && <span><i className="lg-prev" /> Previous {rangeLabel}</span>}
        </div>
      </div>

      {/* ------------------------------------------------ funnel + heatmap */}
      <div className="an-row">
        <div className="an-card">
          <div className="an-card-head">
            <h3>Shopping funnel</h3>
            <span className="an-muted">sessions</span>
          </div>
          {data.hasTraffic ? <Funnel steps={data.funnel} /> : <div className="an-empty">Fills in as visitors browse the shop.</div>}
        </div>
        <div className="an-card">
          <div className="an-card-head">
            <h3>When people {heatOf === "visits" ? "visit" : "order"}</h3>
            <div className="seg small">
              <button type="button" className={heatOf === "visits" ? "on" : ""} onClick={() => setHeatOf("visits")}>Visits</button>
              <button type="button" className={heatOf === "orders" ? "on" : ""} onClick={() => setHeatOf("orders")}>Orders</button>
            </div>
          </div>
          <Heatmap grid={heatOf === "visits" ? data.heat.visits : data.heat.orders} unit={heatOf} />
        </div>
      </div>

      {/* ------------------------------------------------ products */}
      <div className="an-card an-wide">
        <div className="an-card-head">
          <h3>Products</h3>
          <span className="an-muted">views · added to cart · sold</span>
        </div>
        {data.products.length === 0 ? (
          <div className="an-empty">No product activity in this period yet.</div>
        ) : (
          <div className="prod-table">
            {data.products.map((p, i) => {
              const maxRev = Math.max(...data.products.map((x) => x.revenue), 1);
              return (
                <div key={p.id} className="prod-row" style={{ animationDelay: `${i * 40}ms` }}>
                  <div className="prod-name">
                    {p.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.image} alt="" loading="lazy" onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = "hidden")} />
                    ) : (
                      <span className="prod-ph" />
                    )}
                    <div>
                      <strong>{p.name}</strong>
                      <div className="prod-meta">
                        {data.hasTraffic && <>{num(p.views)} views · {num(p.adds)} to cart · </>}
                        {num(p.units)} sold
                        {p.viewToCart !== null && <span className={`pill ${p.viewToCart < 5 ? "warn" : ""}`}>{p.viewToCart}% view→cart</span>}
                      </div>
                    </div>
                  </div>
                  <div className="prod-bar"><span style={{ width: `${(p.revenue / maxRev) * 100}%` }} /></div>
                  <div className="prod-rev">
                    {money(p.revenue)}
                    {p.trend !== null && <Delta change={p.trend} />}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {data.notSelling.length > 0 && (
          <div className="not-selling">
            <span>No sales this period:</span>
            {data.notSelling.map((p) => (
              <em key={p.id}>{p.name}{p.views ? ` (${p.views} views)` : ""}</em>
            ))}
          </div>
        )}
      </div>

      {/* ------------------------------------------------ audience */}
      <div className="an-row three">
        <div className="an-card">
          <div className="an-card-head"><h3>Where visitors come from</h3></div>
          <BarList
            rows={data.sources.referrers.map((r) => ({ label: r.key === "direct" ? "Direct / typed in" : r.key, value: r.value }))}
            empty="Fills in as people visit."
          />
          {data.sources.qr.scans > 0 && (
            <div className="an-foot">
              <strong>{num(data.sources.qr.scans)}</strong> product QR scans
              {data.sources.qr.byProduct[0] ? ` · most: ${data.sources.qr.byProduct[0].name}` : ""}
            </div>
          )}
        </div>
        <div className="an-card">
          <div className="an-card-head"><h3>Devices</h3></div>
          <Donut
            center="visits"
            parts={[
              { label: "Phone", value: devices.phone, color: "#85ba45" },
              { label: "Desktop", value: devices.desktop, color: "#4f8fb8" },
              { label: "Tablet", value: devices.tablet, color: "#d08b3a" },
            ]}
          />
        </div>
        <div className="an-card">
          <div className="an-card-head"><h3>Most visited pages</h3></div>
          <BarList rows={data.sources.pages.map((p) => ({ label: p.key, value: p.value }))} empty="Fills in as people visit." />
        </div>
      </div>

      {/* ------------------------------------------------ customers */}
      <div className="an-row three">
        <div className="an-card">
          <div className="an-card-head"><h3>Customers</h3></div>
          <Donut
            center="buyers"
            parts={[
              { label: "First-time", value: data.customers.newBuyers, color: "#85ba45" },
              { label: "Returning", value: data.customers.returningBuyers, color: "#2f5d3a" },
            ]}
          />
        </div>
        <div className="an-card">
          <div className="an-card-head"><h3>Top customers</h3></div>
          <BarList rows={data.customers.top.map((c) => ({ label: c.name, value: c.spend, sub: `${c.orders} order${c.orders === 1 ? "" : "s"}` }))} format={(n) => money(n)} empty="No paid orders in this period." />
        </div>
        <div className="an-card">
          <div className="an-card-head"><h3>Where sales happen</h3></div>
          <Donut
            center="sales"
            parts={[
              { label: "Members' shop", value: Math.round(data.shopSplit.member), color: "#6fa336" },
              { label: "Public shop", value: Math.round(data.shopSplit.public), color: "#d8b36a" },
            ]}
          />
        </div>
      </div>

      {/* ------------------------------------------------ growth + marketing */}
      <div className="an-row three">
        <div className="an-card">
          <div className="an-card-head"><h3>Community</h3></div>
          <div className="growth">
            <div>
              <span className="an-muted">Members</span>
              <strong><CountUp value={data.customers.members} /></strong>
              <Sparkline values={data.customers.memberTotals} color="#8a6fb8" height={40} />
            </div>
            <div>
              <span className="an-muted">Mailing list</span>
              <strong><CountUp value={data.customers.subscribers} /></strong>
              <Sparkline values={data.customers.subscriberTotals} color="#d08b3a" height={40} />
            </div>
          </div>
        </div>
        <div className="an-card">
          <div className="an-card-head"><h3>Campaigns</h3></div>
          {data.sources.campaigns.length === 0 ? (
            <div className="an-empty">Campaign visits and sales show here once a campaign goes out.</div>
          ) : (
            <BarList
              rows={data.sources.campaigns.map((c) => ({ label: c.id, value: c.visits, sub: `${c.orders} order${c.orders === 1 ? "" : "s"} · ${money(c.revenue)} in sales` }))}
              format={(n) => `${num(n)} visits`}
            />
          )}
          {(data.sources.email.opens > 0 || data.sources.email.clicks > 0) && (
            <div className="an-foot">
              <strong>{num(data.sources.email.opens)}</strong> opens · <strong>{num(data.sources.email.clicks)}</strong> clicks
            </div>
          )}
        </div>
        <div className="an-card">
          <div className="an-card-head"><h3>Concierge &amp; events</h3></div>
          <div className="mini-stats">
            <div><strong>{num(k.assistantChats.value)}</strong><span>chat messages</span></div>
            <div><strong>{num(k.assistantChats.escalated)}</strong><span>handed to team</span></div>
            <div><strong>{money(k.assistantChats.cost, 2)}</strong><span>AI cost</span></div>
            <div><strong>{num(k.assistantChats.addsFromChat)}</strong><span>added to cart from chat</span></div>
            <div><strong>{num(data.events.registrations)}</strong><span>event sign-ups</span></div>
          </div>
          {k.assistantChats.topics.length > 0 && (
            <>
              <div className="cv-sub" style={{ marginTop: "0.2rem" }}>What people ask the Concierge</div>
              <BarList rows={k.assistantChats.topics.map((t) => ({ label: TOPIC_NAMES[t.key] || t.key, value: t.value }))} />
            </>
          )}
          {k.assistantChats.seriousFlags > 0 && (
            <div className="an-foot" style={{ color: "#9b2f1d" }}>
              ⚠ {k.assistantChats.seriousFlags} chat{k.assistantChats.seriousFlags === 1 ? "" : "s"} flagged as serious — see Assistant → Conversations.
            </div>
          )}
          {data.events.upcoming.map((e) => (
            <div key={e.title + e.date} className="event-fill">
              <span>{e.title}</span>
              <div className="event-bar"><i style={{ width: `${e.capacity ? Math.min(100, (e.registered / e.capacity) * 100) : 0}%` }} /></div>
              <em>{e.registered}{e.capacity ? `/${e.capacity}` : ""}</em>
            </div>
          ))}
        </div>
      </div>
      <p className="field-hint" style={{ textAlign: "center", marginTop: "0.5rem" }}>
        Sales count paid and completed orders. Visits are counted without cookies or personal data. Visitors with “Do Not Track” or Global
        Privacy Control switched on aren't counted.
      </p>
    </section>
  );
}
