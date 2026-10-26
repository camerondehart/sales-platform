"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

// useLayoutEffect warns during server rendering; fall back to useEffect there.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

// Small, dependency-free SVG charts for the Analytics tab.

export const money = (n: number, dp = 0) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
export const num = (n: number) => n.toLocaleString("en-US");

/** Number that counts up when it appears or changes. */
export function CountUp({ value, format = num, ms = 900 }: { value: number; format?: (n: number) => string; ms?: number }) {
  // Starts at the real value (so nothing ever renders a wrong number), then
  // counts up from zero before the first paint on the client.
  const [shown, setShown] = useState(value);
  const from = useRef(0);
  useIsoLayoutEffect(() => {
    const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(a + (value - a) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return <>{format(shown)}</>;
}

/**
 * Smooth line through the points (monotone cubic / Fritsch–Carlson): curves
 * nicely but never overshoots, so a day with $0 never dips below the axis.
 */
export function smoothPath(pts: Array<[number, number]>): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n < 3) return pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    m.push((pts[i + 1][1] - pts[i][1]) / (dx[i] || 1));
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const h = a * a + b * b;
    if (h > 9) {
      const k = 3 / Math.sqrt(h);
      t[i] = k * a * m[i];
      t[i + 1] = k * b * m[i];
    }
  }
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const h = dx[i] / 3;
    d += ` C${(x0 + h).toFixed(1)},${(y0 + t[i] * h).toFixed(1)} ${(x1 - h).toFixed(1)},${(y1 - t[i + 1] * h).toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}

function pathFor(values: number[], w: number, h: number, max: number, pad = 2) {
  if (values.length === 0) return "";
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  return smoothPath(values.map((v, i) => [pad + i * step, h - pad - (max > 0 ? (v / max) * (h - pad * 2) : 0)]));
}

export function Sparkline({ values, color = "#85ba45", height = 34 }: { values: number[]; color?: string; height?: number }) {
  const id = useId().replace(/:/g, "");
  const w = 120;
  const max = Math.max(...values, 0);
  const line = pathFor(values, w, height, max);
  if (!line || max === 0) return <svg className="spark" viewBox={`0 0 ${w} ${height}`} aria-hidden="true"><line x1="0" y1={height - 2} x2={w} y2={height - 2} stroke="currentColor" strokeOpacity="0.15" /></svg>;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`sg${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w - 2},${height} L2,${height} Z`} fill={`url(#sg${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" className="spark-line" />
    </svg>
  );
}

/** Big time-series chart: current period as a glowing area, previous period as a dashed ghost line. */
export function AreaChart({
  days,
  values,
  prev,
  format,
  color = "#85ba45",
  height = 240,
}: {
  days: string[];
  values: number[];
  prev?: number[];
  format: (n: number) => string;
  color?: string;
  height?: number;
}) {
  const id = useId().replace(/:/g, "");
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 800;
  const H = height;
  const padL = 8;
  const padB = 22;
  const max = Math.max(...values, ...(prev || []), 0) * 1.12 || 1;
  const innerH = H - padB;
  const step = values.length > 1 ? (W - padL * 2) / (values.length - 1) : 0;
  const x = (i: number) => padL + i * step;
  const y = (v: number) => innerH - (v / max) * (innerH - 10);
  const line = smoothPath(values.map((v, i) => [x(i), y(v)]));
  const ghost = prev && prev.some((v) => v > 0) ? smoothPath(prev.map((v, i) => [x(i), y(v)])) : "";
  const yMax = max / 1.12;
  const ticks = useMemo(() => {
    const n = days.length;
    const every = n <= 8 ? 1 : n <= 31 ? 5 : n <= 92 ? 14 : 60;
    return days.map((d, i) => ({ d, i })).filter(({ i }) => i % every === 0 || i === n - 1);
  }, [days]);
  const label = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  function onMove(e: React.MouseEvent<SVGSVGElement> | React.TouchEvent<SVGSVGElement>) {
    const svg = ref.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0]?.clientX ?? 0 : e.clientX;
    const rel = ((clientX - rect.left) / rect.width) * W;
    const i = Math.max(0, Math.min(values.length - 1, Math.round((rel - padL) / (step || 1))));
    setHover(i);
  }

  return (
    <div className="area-wrap">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="area-chart"
        onMouseMove={onMove}
        onTouchMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="Chart over time"
      >
        <defs>
          <linearGradient id={`ag${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.42" />
            <stop offset="70%" stopColor={color} stopOpacity="0.06" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
          <filter id={`glow${id}`} x="-5%" y="-20%" width="110%" height="140%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={padL} x2={W - padL} y1={innerH - f * (innerH - 10)} y2={innerH - f * (innerH - 10)} className="grid-line" />
        ))}
        {yMax > 0 &&
          [0.5, 1].map((f) => (
            <text key={f} x={W - padL} y={y(yMax * f) - 5} textAnchor="end" className="axis-label y-label">
              {format(yMax * f)}
            </text>
          ))}
        {ghost && <path d={ghost} className="ghost-line" />}
        {line && <path d={`${line} L${x(values.length - 1)},${innerH} L${x(0)},${innerH} Z`} fill={`url(#ag${id})`} className="area-fill" />}
        {line && <path d={line} fill="none" stroke={color} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" filter={`url(#glow${id})`} className="area-line" />}
        {ticks.map(({ d, i }) => (
          <text key={d} x={x(i)} y={H - 5} className="axis-label" textAnchor={i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"}>
            {label(d)}
          </text>
        ))}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={0} y2={innerH} className="cross" />
            <circle cx={x(hover)} cy={y(values[hover] || 0)} r="5.5" fill="#fff" stroke={color} strokeWidth="3" />
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <strong>{format(values[hover] || 0)}</strong>
          <span>{label(days[hover])}</span>
          {prev && prev[hover] !== undefined && prev.some((v) => v > 0) && <em>prev. {format(prev[hover])}</em>}
        </div>
      )}
    </div>
  );
}

export function Funnel({ steps }: { steps: Array<{ label: string; count: number }> }) {
  const max = Math.max(steps[0]?.count || 0, 1);
  return (
    <div className="funnel">
      {steps.map((s, i) => {
        const pct = (s.count / max) * 100;
        const prev = i > 0 ? steps[i - 1].count : 0;
        const keep = i > 0 && prev > 0 ? Math.round((s.count / prev) * 100) : null;
        return (
          <div key={s.label} className="funnel-row" style={{ animationDelay: `${i * 90}ms` }}>
            <div className="funnel-label">
              <span>{s.label}</span>
              <strong>{num(s.count)}</strong>
            </div>
            <div className="funnel-track">
              <div className="funnel-bar" style={{ width: `${Math.max(pct, s.count ? 2 : 0)}%`, animationDelay: `${i * 90}ms` }} />
            </div>
            {keep !== null && (
              <div className={`funnel-keep${keep < 40 ? " low" : ""}`} title={`${100 - keep}% didn't continue`}>
                {keep}% continue
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function Heatmap({ grid, unit }: { grid: number[][]; unit: string }) {
  const max = Math.max(...grid.flat(), 0);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const [tip, setTip] = useState<string>("");
  return (
    <div className="heat">
      <div className="heat-grid" onMouseLeave={() => setTip("")}>
        {grid.map((row, w) => (
          <div key={w} className="heat-row">
            <span className="heat-day">{days[w]}</span>
            {row.map((v, h) => {
              const a = max ? v / max : 0;
              const hr = h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`;
              return (
                <span
                  key={h}
                  className="heat-cell"
                  style={{ background: a ? `rgba(111, 163, 54, ${0.12 + a * 0.88})` : undefined }}
                  onMouseEnter={() => setTip(`${days[w]} ${hr}: ${v} ${unit}`)}
                />
              );
            })}
          </div>
        ))}
        <div className="heat-row heat-hours">
          <span className="heat-day" />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="heat-hour">{h % 6 === 0 ? (h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`) : ""}</span>
          ))}
        </div>
      </div>
      <div className="heat-tip">{tip || `Darker = more ${unit}. local time.`}</div>
    </div>
  );
}

export function Donut({ parts, size = 132, center }: { parts: Array<{ label: string; value: number; color: string }>; size?: number; center?: string }) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  const r = 44;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="donut">
      <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(", ")}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(43,47,39,0.07)" strokeWidth="16" />
        {total > 0 &&
          parts.map((p) => {
            const len = (p.value / total) * c;
            const el = (
              <circle
                key={p.label}
                cx="60"
                cy="60"
                r={r}
                fill="none"
                stroke={p.color}
                strokeWidth="16"
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 60 60)"
                className="donut-seg"
              />
            );
            offset += len;
            return el;
          })}
        <text x="60" y="57" textAnchor="middle" className="donut-num">{total ? num(total) : "—"}</text>
        <text x="60" y="73" textAnchor="middle" className="donut-cap">{center || "total"}</text>
      </svg>
      <ul className="donut-legend">
        {parts.map((p) => (
          <li key={p.label}>
            <i style={{ background: p.color }} />
            {p.label}
            <strong>{total ? `${Math.round((p.value / total) * 100)}%` : "—"}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BarList({ rows, format = num, empty = "No data yet." }: { rows: Array<{ label: string; value: number; sub?: string }>; format?: (n: number) => string; empty?: string }) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  if (rows.length === 0 || max === 0) return <div className="an-empty">{empty}</div>;
  return (
    <ul className="barlist">
      {rows.map((r, i) => (
        <li key={r.label} style={{ animationDelay: `${i * 50}ms` }}>
          <span className="barlist-fill" style={{ width: `${(r.value / max) * 100}%` }} />
          <span className="barlist-label">{r.label}{r.sub && <small>{r.sub}</small>}</span>
          <strong>{format(r.value)}</strong>
        </li>
      ))}
    </ul>
  );
}
