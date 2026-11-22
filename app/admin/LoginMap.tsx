"use client";

import { useEffect, useMemo, useState } from "react";
import { placeLabel, type LoginKind, type PlaceSummary } from "@/lib/loginPlaces";
import { num } from "./charts";

// Analytics → Where people sign in (switch login_map). Draws the rough towns
// from /api/admin/login-places on a plain inline map: no map service, no
// tiles, nothing leaves the site. The outlines (app/admin/mapShapes.ts) load
// only when this card is on screen.

type Shapes = typeof import("./mapShapes");
type Resp =
  | { on: false }
  | { on: true; days: number; kind: string; total: number; towns: number; places: PlaceSummary[]; firstDay: string | null; error?: string };

const KINDS: Array<["" | LoginKind, string]> = [
  ["", "Everyone"],
  ["member", "Members"],
  ["staff", "Staff"],
  ["store", "Stores"],
];

// The lower 48 in map units (see project() in mapShapes.ts), used when there's nothing to fit.
const US_VIEW = { x: -985, y: -505, w: 470, h: 285 };
const ASPECT = 0.6; // height / width

function fitView(pts: Array<[number, number]>) {
  if (!pts.length) return US_VIEW;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  // Pad, keep at least a region's worth of map around a single town, and keep the shape.
  let w = Math.max(150, (x1 - x0) * 1.3);
  let h = Math.max(w * ASPECT, (y1 - y0) * 1.35);
  w = Math.max(w, h / ASPECT);
  h = w * ASPECT;
  w = Math.min(w, 2840);
  h = Math.min(h, 1450);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

const fmtDay = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export default function LoginMap({ days, rangeLabel }: { days: number; rangeLabel: string }) {
  const [kind, setKind] = useState<"" | LoginKind>("");
  const [data, setData] = useState<Resp | null>(null);
  const [err, setErr] = useState("");
  const [shapes, setShapes] = useState<Shapes | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setErr("");
    fetch(`/api/admin/login-places?days=${days}${kind ? `&kind=${kind}` : ""}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!live) return;
        if (!r.ok) setErr(j.error || "Couldn't load sign-in places.");
        else setData(j as Resp);
      })
      .catch(() => live && setErr("Couldn't load sign-in places."));
    return () => {
      live = false;
    };
  }, [days, kind]);

  useEffect(() => {
    if (data && data.on && !shapes) import("./mapShapes").then(setShapes).catch(() => {});
  }, [data, shapes]);

  const places = data && data.on ? data.places : [];
  const view = useMemo(() => (shapes ? fitView(places.map((p) => shapes.project(p.lat, p.lon))) : US_VIEW), [places, shapes]);
  const max = places.reduce((m, p) => Math.max(m, p.count), 0);

  if (data && !data.on) return null;
  if (!data && !err) return <div className="an-card an-wide lm-card"><div className="lm-skeleton" /></div>;

  const total = data && data.on ? data.total : 0;
  const firstDay = data && data.on ? data.firstDay : null;
  const sel = places.find((p) => p.key === picked) || null;
  const selParts = sel && !kind
    ? ([["member", "member"], ["staff", "staff"], ["store", "store"]] as const).filter(([k]) => sel.byKind[k]).map(([k, w]) => `${num(sel.byKind[k])} ${w}`)
    : [];
  const rMin = view.w * 0.01, rMax = view.w * 0.036;
  const radius = (c: number) => rMin + (rMax - rMin) * Math.sqrt(max ? c / max : 0);

  return (
    <div className="an-card an-wide lm-card">
      <div className="an-card-head">
        <h3>Where people sign in</h3>
        <div className="seg small" role="tablist" aria-label="Who">
          {KINDS.map(([k, label]) => (
            <button key={k || "all"} type="button" role="tab" aria-selected={kind === k} className={kind === k ? "on" : ""} onClick={() => { setKind(k); setPicked(null); }}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {err && <div className="notice">{err}</div>}
      <div className="lm-body">
        <div className="lm-map-wrap">
          <svg
            className="lm-map"
            viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
            preserveAspectRatio="xMidYMid slice"
            role="img"
            aria-label={`Map of sign-ins, last ${rangeLabel}`}
            onClick={() => setPicked(null)}
          >
            <rect x={view.x} y={view.y} width={view.w} height={view.h} className="lm-sea" />
            {shapes && (
              <>
                <path d={shapes.WORLD_PATH} className="lm-land" vectorEffect="non-scaling-stroke" />
                <path d={shapes.US_STATES_PATH} className="lm-states" vectorEffect="non-scaling-stroke" />
                {places
                  .slice()
                  .reverse()
                  // Smallest on top so they stay tappable; the picked town on top of all.
                  .sort((a, b) => (a.key === picked ? 1 : 0) - (b.key === picked ? 1 : 0))
                  .map((p) => {
                    const [x, y] = shapes.project(p.lat, p.lon);
                    const on = picked === p.key;
                    return (
                      <g
                        key={p.key}
                        className={`lm-dot${on ? " on" : ""}`}
                        onClick={(e) => { e.stopPropagation(); setPicked(on ? null : p.key); }}
                      >
                        <circle cx={x} cy={y} r={radius(p.count)} vectorEffect="non-scaling-stroke" />
                        <title>{`${placeLabel(p)}: ${num(p.count)} sign-in${p.count === 1 ? "" : "s"}`}</title>
                      </g>
                    );
                  })}
              </>
            )}
          </svg>
          {sel && (
            <div className="lm-tip">
              <strong>{placeLabel(sel)}</strong>
              <span>
                {num(sel.count)} sign-in{sel.count === 1 ? "" : "s"}
                {selParts.length > 1 ? ` · ${selParts.join(", ")}` : ""}
              </span>
            </div>
          )}
          {data && data.on && total === 0 && (
            <div className="lm-empty">
              No sign-ins noted in the last {rangeLabel}.
            </div>
          )}
        </div>
        <div className="lm-side">
          <div className="lm-total">
            <strong>{num(total)}</strong>
            <span>sign-in{total === 1 ? "" : "s"} · {num(data && data.on ? data.towns : 0)} town{data && data.on && data.towns === 1 ? "" : "s"}</span>
          </div>
          <ol className="lm-list">
            {places.slice(0, 8).map((p) => (
              <li key={p.key}>
                <button type="button" className={picked === p.key ? "on" : ""} onClick={() => setPicked(picked === p.key ? null : p.key)}>
                  <span className="lm-name">{placeLabel(p)}</span>
                  <em>{num(p.count)}</em>
                  <i style={{ width: `${max ? Math.max(4, (p.count / max) * 100) : 0}%` }} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ol>
          {places.length > 8 && <div className="an-muted">+ {num(places.length - 8)} more town{places.length - 8 === 1 ? "" : "s"}</div>}
        </div>
      </div>
      <div className="an-foot">
        Rough town from each sign-in&apos;s internet address (city-level, can be off by a few miles or show the provider&apos;s town). Only daily totals per town
        are kept, never who signed in or their internet address. Staff sign-ins (including staff signing in to a member or store account) show only under Staff.
        {firstDay ? ` Noted since ${fmtDay(firstDay)}; earlier sign-ins weren't recorded.` : " Sign-ins are noted from now on; earlier ones weren't recorded."}
      </div>
    </div>
  );
}
