"use client";

import { useEffect, useMemo, useState } from "react";
import type { Product } from "@/lib/storage";
import type { Ambassador, AmbassadorTerms } from "@/lib/ambassadors";
import type { AmbassadorStats } from "@/lib/ambassadorStats";
import { qrSvg } from "@/lib/qr";
import MediaUpload from "./MediaUpload";
import { useAdminRefresh } from "./useAdminRefresh";
import type { AdminRefreshKey } from "@/lib/assistant/shared";
import { brand, isOwnHost, TEAM } from "@/lib/brand";

// Dashboard → Ambassadors. Make each ambassador's page (<site>/<address>,
// shared only by link or QR code), set their terms, see how they're doing,
// record payouts and email them a progress report. Orders are credited to
// them (their page, or their linked code); prices never change.

type Overview = { live: number; total: number; visits: number; orders: number; sales: number; earned: number; paidOut: number; owed: number };
type TermsForm = {
  commissionPct: string; growthPct: string; growthGoal: string; growthOn: boolean; discountPct: string;
  trialDays: string; startDate: string; trialReviewed: boolean; windowDays: string; repeatPurchases: boolean;
  payoutSchedule: AmbassadorTerms["payoutSchedule"]; notes: string;
};
type Form = {
  id?: string;
  name: string; slug: string; slugTouched: boolean; email: string;
  headline: string; bio: string; photo: string;
  productIds: string[];
  socials: Array<{ url: string; label: string }>;
  discountCode: string;
  active: boolean;
  terms: TermsForm;
};

const todayPacific = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
const blankTerms = (): TermsForm => ({
  commissionPct: "15", growthPct: "20", growthGoal: "", growthOn: false, discountPct: "10",
  trialDays: "90", startDate: todayPacific(), trialReviewed: false, windowDays: "30", repeatPurchases: true, payoutSchedule: "monthly", notes: "",
});
const blank = (): Form => ({ name: "", slug: "", slugTouched: false, email: "", headline: "", bio: "", photo: "", productIds: [], socials: [{ url: "", label: "" }], discountCode: "", active: true, terms: blankTerms() });

const numStr = (n: number | undefined) => (typeof n === "number" ? String(n) : "");
function termsForm(a: Ambassador): TermsForm {
  const t = a.terms;
  if (!t) return { ...blankTerms(), startDate: new Date(a.createdAt).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }) };
  return {
    commissionPct: numStr(t.commissionPct), growthPct: numStr(t.growthPct), growthGoal: t.growthGoal || "", growthOn: t.growthOn, discountPct: numStr(t.discountPct),
    trialDays: numStr(t.trialDays), startDate: t.startDate, trialReviewed: !!t.trialReviewed, windowDays: numStr(t.windowDays), repeatPurchases: t.repeatPurchases,
    payoutSchedule: t.payoutSchedule, notes: t.notes || "",
  };
}
const toForm = (a: Ambassador): Form => ({
  id: a.id, name: a.name, slug: a.slug, slugTouched: true, email: a.email || "", headline: a.headline || "", bio: a.bio || "", photo: a.photo || "",
  productIds: a.productIds.slice(), socials: a.socials.length ? a.socials.map((s) => ({ url: s.url, label: s.label || "" })) : [{ url: "", label: "" }],
  discountCode: a.discountCode || "", active: a.active, terms: termsForm(a),
});

const suggest = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "").slice(0, 40);
const isPublic = (p: Product) => {
  const v = p.visibility || (p.retail ? "both" : "internal");
  return v === "external" || v === "both";
};
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (t: number) => new Date(t).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric" });
const ymdLong = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
const rateOf = (a: Ambassador) => (a.terms?.growthOn && typeof a.terms.growthPct === "number" ? a.terms.growthPct : a.terms?.commissionPct ?? 15);

type Sort = "owed" | "sales" | "newest" | "name";
type Period = "this-month" | "last-month" | "30-days" | "since-start";

function TrialChip({ s }: { s?: AmbassadorStats }) {
  if (!s || s.trial.status === "none") return null;
  if (s.trial.status === "trial") return <span className="dc-chip soon">Trial · day {s.trial.day} of {s.trial.length}</span>;
  if (s.trial.status === "review") return <span className="dc-chip ended">Trial over · review due</span>;
  return null;
}

export default function AmbassadorsPanel({ products }: { products: Product[] }) {
  const [list, setList] = useState<Ambassador[] | null>(null);
  const [stats, setStats] = useState<Record<string, AmbassadorStats>>({});
  const [overview, setOverview] = useState<Overview | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [switchOn, setSwitchOn] = useState<boolean | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pq, setPq] = useState("");
  const [sort, setSort] = useState<Sort>("owed");
  const [payout, setPayout] = useState({ amount: "", at: todayPacific(), note: "" });
  // Progress report
  const [report, setReport] = useState<{ period: Period; note: string; signoff: string; testTo: string } | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string; to: string | null } | null>(null);

  const site = (process.env.NEXT_PUBLIC_SITE_URL || (typeof window !== "undefined" ? window.location.origin : brand.siteUrl)).replace(/\/$/, "");
  const shown = site.replace(/^https?:\/\/(www\.)?/, "");
  const isLive = isOwnHost(shown) && shown !== "example.com";

  const load = () => {
    fetch("/api/admin/ambassadors", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setList(d.ambassadors || []); setStats(d.stats || {}); setOverview(d.overview || null); } })
      .catch(() => {});
  };
  // A confirmed Concierge card (new ambassador, payout, report) refreshes the numbers.
  useAdminRefresh(["ambassadors", "orders", "discounts"] as AdminRefreshKey[], () => load());
  useEffect(() => {
    load();
    fetch("/api/admin/discounts", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setCodes(((d?.discounts || []) as Array<{ code: string; active: boolean }>).filter((x) => x.active).map((x) => x.code)))
      .catch(() => {});
    fetch("/api/admin/flags", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const f = (d?.flags || []).find((x: { key: string; on: boolean }) => x.key === "ambassador_pages");
        if (f) setSwitchOn(!!f.on);
      })
      .catch(() => {});
  }, []);

  const publicProducts = useMemo(() => products.filter(isPublic).sort((a, b) => a.name.localeCompare(b.name)), [products]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const sorted = useMemo(() => {
    const l = (list || []).slice();
    const st = (a: Ambassador) => stats[a.id];
    if (sort === "owed") l.sort((a, b) => (st(b)?.owed || 0) - (st(a)?.owed || 0) || a.name.localeCompare(b.name));
    if (sort === "sales") l.sort((a, b) => (st(b)?.sales || 0) - (st(a)?.sales || 0) || a.name.localeCompare(b.name));
    if (sort === "newest") l.sort((a, b) => b.createdAt - a.createdAt);
    if (sort === "name") l.sort((a, b) => a.name.localeCompare(b.name));
    return l;
  }, [list, stats, sort]);
  const open = openId ? (list || []).find((a) => a.id === openId) || null : null;
  const os = open ? stats[open.id] : undefined;

  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const setT = (patch: Partial<TermsForm>) => setForm((f) => (f ? { ...f, terms: { ...f.terms, ...patch } } : f));
  const top = () => document.getElementById("ambassadors")?.scrollIntoView({ behavior: "smooth" });

  async function call(method: string, body: unknown, ok: string): Promise<Ambassador | null> {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/ambassadors", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Couldn't save.");
      setMsg({ ok: true, text: ok });
      load();
      return d.ambassador || null;
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Couldn't save." });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const t = form.terms;
    const body = {
      id: form.id, name: form.name, slug: form.slug, email: form.email, headline: form.headline, bio: form.bio, photo: form.photo,
      productIds: form.productIds, socials: form.socials.filter((s) => s.url.trim()), discountCode: form.discountCode, active: form.active,
      terms: { ...t },
    };
    const saved = await call(form.id ? "PUT" : "POST", body, form.id ? "Saved." : `Created. Their page is ${shown}/${form.slug}`);
    if (saved) { setForm(null); setOpenId(saved.id); top(); }
  }

  async function remove(a: Ambassador) {
    if (!confirm(`Delete ${a.name}? ${shown}/${a.slug} stops working and their payout history is deleted. Orders already credited to them keep their name. To pause instead, use Turn off.`)) return;
    setBusy(true);
    const r = await fetch(`/api/admin/ambassadors?id=${encodeURIComponent(a.id)}`, { method: "DELETE" });
    setMsg(r.ok ? { ok: true, text: `${a.name} is deleted.` } : { ok: false, text: "Couldn't delete." });
    setBusy(false);
    setOpenId(null);
    load();
  }

  function copy(url: string) {
    navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  }

  function qrFile(a: Ambassador, kind: "download" | "print") {
    const url = `${site}/${a.slug}?qr=1`;
    if (kind === "download") {
      const blob = new Blob([qrSvg(url, { size: 1200, margin: 4 })], { type: "image/svg+xml" });
      const href = URL.createObjectURL(blob);
      const el = document.createElement("a");
      el.href = href;
      el.download = `qr-${a.slug}.svg`;
      el.click();
      URL.revokeObjectURL(href);
      return;
    }
    const w = window.open("", "_blank", "width=700,height=900");
    if (!w) return;
    const safe = (a.headline || `${a.name.split(" ")[0]}'s favorites`).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
    w.document.write(`<!doctype html><html><head><title>${safe}</title>
<style>body{margin:0;display:grid;place-items:center;min-height:100vh;font-family:Optima,"Segoe UI",system-ui,sans-serif;color:#2b2f27;text-align:center}
.wrap{padding:2rem} h1{font-family:Georgia,serif;font-style:italic;font-weight:400;font-size:2rem;margin:0 0 1rem} p{font-size:1.1rem;color:#61676d;margin:1rem 0 0} svg{width:min(70vw,480px);height:auto}</style>
</head><body><div class="wrap"><h1>${safe}</h1>${qrSvg(url, { size: 480, margin: 3 })}<p>Scan to shop ${brand.shortName.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!)}</p></div><script>window.onload=function(){window.print()}</script></body></html>`);
    w.document.close();
  }

  async function loadPreview(r = report) {
    if (!open || !r) return;
    const res = await fetch("/api/admin/ambassadors/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: open.id, period: r.period, note: r.note, signoff: r.signoff }) });
    const d = await res.json().catch(() => ({}));
    if (res.ok) setPreview({ subject: d.subject, html: d.html, to: d.to });
  }
  useEffect(() => {
    if (!report) return;
    const t = setTimeout(() => loadPreview(report), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.period, report?.note, report?.signoff, openId]);

  async function sendReport(test: boolean) {
    if (!open || !report) return;
    if (!test && !confirm(`Email this report to ${open.name} (${open.email})?`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/ambassadors/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: open.id, period: report.period, note: report.note, signoff: report.signoff, send: true, testTo: test ? report.testTo : undefined }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Couldn't send.");
      setMsg({ ok: true, text: test ? `Test sent to ${d.sentTo}.` : `Report sent to ${d.sentTo}.` });
      if (!test) { setReport(null); setPreview(null); load(); }
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Couldn't send." });
    }
    setBusy(false);
  }

  function moveProduct(id: string, dir: -1 | 1) {
    if (!form) return;
    const ids = form.productIds.slice();
    const i = ids.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    set({ productIds: ids });
  }

  // ---------------------------------------------------------------- form
  const formView = form && (
    <form className="amb-form" onSubmit={save}>
      <h3 className="amb-form-title">{form.id ? `Edit ${form.name || "ambassador"}` : "New ambassador"}</h3>
      <div className="amb-form-grid">
        <div className="amb-form-sec full">Their page</div>
        <div className="field">
          <label htmlFor="amb-name">Name</label>
          <input id="amb-name" value={form.name} required maxLength={80} onChange={(e) => set({ name: e.target.value, ...(form.slugTouched ? {} : { slug: suggest(e.target.value) }) })} placeholder="Alex Rivera" />
        </div>
        <div className="field">
          <label htmlFor="amb-slug">Page address</label>
          <div className="amb-slug">
            <span>{shown}/</span>
            <input id="amb-slug" value={form.slug} required maxLength={40} onChange={(e) => set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""), slugTouched: true })} placeholder="alexrivera" />
          </div>
          <div className="field-hint">The link they share. Letters, numbers and dashes. Not shown in the site&rsquo;s menus.</div>
        </div>
        <div className="field full">
          <label htmlFor="amb-headline">Headline (optional)</label>
          <input id="amb-headline" value={form.headline} maxLength={120} onChange={(e) => set({ headline: e.target.value })} placeholder={`${form.name.split(" ")[0] || "Alex"}'s favorites`} />
        </div>
        <div className="field full">
          <label htmlFor="amb-bio">A few words (optional)</label>
          <textarea id="amb-bio" rows={3} value={form.bio} maxLength={1200} onChange={(e) => set({ bio: e.target.value })} placeholder={`Why they love ${brand.shortName}, in their own words. A blank line starts a new paragraph.`} />
        </div>
        <div className="field full">
          <label htmlFor="amb-photo">Photo (optional)</label>
          <div className="amb-photo-row">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {form.photo && <img src={form.photo} alt="" className="amb-thumb" />}
            <input id="amb-photo" value={form.photo} onChange={(e) => set({ photo: e.target.value })} placeholder="Upload, or paste an image link" />
          </div>
          <MediaUpload kind="image" value={form.photo} onUploaded={(url) => set({ photo: url })} />
        </div>
        <div className="field full">
          <label>Featured products ({form.productIds.length})</label>
          {form.productIds.length > 0 && (
            <ol className="amb-picked">
              {form.productIds.map((id, i) => (
                <li key={id}>
                  <span className="amb-picked-name">{byId.get(id)?.name || "Removed product"}{byId.get(id) && !isPublic(byId.get(id)!) && <span className="dc-chip ended">Members only — won&rsquo;t show</span>}</span>
                  <span className="prod-move">
                    <button type="button" onClick={() => moveProduct(id, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                    <button type="button" onClick={() => moveProduct(id, 1)} disabled={i === form.productIds.length - 1} aria-label="Move down">↓</button>
                    <button type="button" onClick={() => set({ productIds: form.productIds.filter((x) => x !== id) })} aria-label="Remove">×</button>
                  </span>
                </li>
              ))}
            </ol>
          )}
          <input type="search" value={pq} onChange={(e) => setPq(e.target.value)} placeholder="Filter products…" className="store-pq" />
          <div className="store-products">
            {publicProducts.filter((p) => !pq || p.name.toLowerCase().includes(pq.toLowerCase())).map((p) => {
              const on = form.productIds.includes(p.id);
              return (
                <label key={p.id} className={`store-product${on ? " on" : ""}`}>
                  <input type="checkbox" checked={on} onChange={() => set({ productIds: on ? form.productIds.filter((x) => x !== p.id) : [...form.productIds, p.id] })} />
                  {p.name}
                </label>
              );
            })}
          </div>
          <div className="field-hint">Only public-shop products can be featured. None picked = the page shows the whole shop.</div>
        </div>
        <div className="field full">
          <label>Their socials</label>
          {form.socials.map((s, i) => (
            <div key={i} className="amb-social-row">
              <input value={s.url} onChange={(e) => set({ socials: form.socials.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} placeholder="instagram.com/theirname" aria-label="Link" />
              <input value={s.label} onChange={(e) => set({ socials: form.socials.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} placeholder="Label (optional)" aria-label="Label" maxLength={40} />
              <button type="button" className="esc-btn" onClick={() => set({ socials: form.socials.filter((_, j) => j !== i) })} aria-label="Remove link">×</button>
            </div>
          ))}
          {form.socials.length < 8 && <button type="button" className="ap-linkbtn" onClick={() => set({ socials: [...form.socials, { url: "", label: "" }] })}>+ Add a link</button>}
        </div>

        <div className="amb-form-sec full">Their terms</div>
        <div className="field">
          <label htmlFor="amb-email">Their email (for progress reports)</label>
          <input id="amb-email" type="email" value={form.email} maxLength={200} onChange={(e) => set({ email: e.target.value })} placeholder="alex@example.com" />
        </div>
        <div className="field">
          <label htmlFor="amb-code">Their discount code (optional)</label>
          <select id="amb-code" value={form.discountCode} onChange={(e) => set({ discountCode: e.target.value })}>
            <option value="">None</option>
            {form.discountCode && !codes.includes(form.discountCode) && <option value={form.discountCode}>{form.discountCode} (not active)</option>}
            {codes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="field-hint">Members who use it are credited to them. Make the code (e.g. 10% off) under Marketing → Discount codes.</div>
        </div>
        <div className="field">
          <label htmlFor="amb-rate">Commission %</label>
          <input id="amb-rate" inputMode="decimal" value={form.terms.commissionPct} onChange={(e) => setT({ commissionPct: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="amb-disc">Community discount % (their code)</label>
          <input id="amb-disc" inputMode="decimal" value={form.terms.discountPct} onChange={(e) => setT({ discountPct: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="amb-grow">Room to grow: higher rate %</label>
          <input id="amb-grow" inputMode="decimal" value={form.terms.growthPct} onChange={(e) => setT({ growthPct: e.target.value })} />
          <label className="check-row" style={{ marginTop: "0.4rem" }}>
            <input type="checkbox" checked={form.terms.growthOn} onChange={(e) => setT({ growthOn: e.target.checked })} /> <span>Goals met: use the higher rate from now on</span>
          </label>
        </div>
        <div className="field">
          <label htmlFor="amb-goal">Goals for the higher rate</label>
          <input id="amb-goal" value={form.terms.growthGoal} maxLength={300} onChange={(e) => setT({ growthGoal: e.target.value })} placeholder="e.g. 25 orders in a quarter" />
        </div>
        <div className="field">
          <label htmlFor="amb-start">Started on</label>
          <input id="amb-start" type="date" value={form.terms.startDate} onChange={(e) => setT({ startDate: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="amb-trial">Trial (days, 0 = none)</label>
          <input id="amb-trial" inputMode="numeric" value={form.terms.trialDays} onChange={(e) => setT({ trialDays: e.target.value })} />
          <label className="check-row" style={{ marginTop: "0.4rem" }}>
            <input type="checkbox" checked={form.terms.trialReviewed} onChange={(e) => setT({ trialReviewed: e.target.checked })} /> <span>We&rsquo;ve had the end-of-trial review</span>
          </label>
        </div>
        <div className="field">
          <label htmlFor="amb-window">Attribution window (days after visiting their page)</label>
          <input id="amb-window" inputMode="numeric" value={form.terms.windowDays} onChange={(e) => setT({ windowDays: e.target.value })} />
          <label className="check-row" style={{ marginTop: "0.4rem" }}>
            <input type="checkbox" checked={form.terms.repeatPurchases} onChange={(e) => setT({ repeatPurchases: e.target.checked })} /> <span>Repeat purchases count (off = each customer&rsquo;s first order only)</span>
          </label>
        </div>
        <div className="field">
          <label htmlFor="amb-sched">Payouts</label>
          <select id="amb-sched" value={form.terms.payoutSchedule} onChange={(e) => setT({ payoutSchedule: e.target.value as AmbassadorTerms["payoutSchedule"] })}>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="on request">On request</option>
          </select>
        </div>
        <div className="field full">
          <label htmlFor="amb-notes">Other terms &amp; notes (staff only)</label>
          <textarea id="amb-notes" rows={3} value={form.terms.notes} maxLength={2000} onChange={(e) => setT({ notes: e.target.value })} placeholder="Complimentary products sent, content permissions, posting plan, exclusivity…" />
        </div>
        <div className="field full">
          <label className="check-row"><input type="checkbox" checked={form.active} onChange={(e) => set({ active: e.target.checked })} /> <span>Page is live</span></label>
        </div>
      </div>
      <div className="store-form-actions">
        <button type="submit" className="esc-btn primary" disabled={busy}>{busy ? "Saving…" : form.id ? "Save changes" : "Create"}</button>
        <button type="button" className="esc-btn" onClick={() => { setForm(null); setMsg(null); }} disabled={busy}>Cancel</button>
      </div>
    </form>
  );

  // ---------------------------------------------------------------- one ambassador
  const detail = open && os && (
    <div className="amb-detail">
      <button type="button" className="ap-linkbtn" onClick={() => { setOpenId(null); setReport(null); setPreview(null); }}>← All ambassadors</button>
      <div className="amb-detail-head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {open.photo ? <img src={open.photo} alt="" className="amb-thumb lg" /> : <span className="amb-thumb lg amb-initial">{open.name[0]}</span>}
        <div className="amb-detail-who">
          <h3>{open.name} {!open.active && <span className="dc-chip inactive">Off</span>} <TrialChip s={os} /></h3>
          <div className="amb-link-row">
            <a href={`/${open.slug}`} target="_blank" rel="noopener">{shown}/{open.slug}</a>
            <button type="button" className="ap-linkbtn" onClick={() => copy(`${site}/${open.slug}`)}>{copied ? "Copied ✓" : "Copy link"}</button>
            <button type="button" className="ap-linkbtn" onClick={() => qrFile(open, "download")}>QR code ⬇</button>
            <button type="button" className="ap-linkbtn" onClick={() => qrFile(open, "print")}>Print QR</button>
          </div>
          {!isLive && <div className="field-hint">⚠ You&rsquo;re not on the live site, so links and QR codes point here. Share them from the live dashboard.</div>}
          <div className="user-meta">{rateOf(open)}% commission{open.discountCode ? ` · code ${open.discountCode}` : ""}{open.email ? ` · ${open.email}` : " · no email yet"}{open.lastReportAt ? ` · last report ${day(open.lastReportAt)}` : ""}</div>
        </div>
        <div className="amb-detail-actions">
          <button className="esc-btn primary" onClick={() => { setReport({ period: "this-month", note: "", signoff: "", testTo: "" }); setPreview(null); }} disabled={busy}>✉ Email a progress report</button>
          <button className="esc-btn" onClick={() => { setForm(toForm(open)); setMsg(null); setPq(""); top(); }}>Edit</button>
          <button className="esc-btn" onClick={() => call("PUT", { ...open, active: !open.active }, open.active ? `${open.name}'s page is off.` : `${open.name}'s page is live.`)} disabled={busy}>{open.active ? "Turn off" : "Turn on"}</button>
          <button className="esc-btn danger" onClick={() => remove(open)} disabled={busy}>Delete</button>
        </div>
      </div>

      {report && (
        <div className="amb-report">
          <div className="amb-report-form">
            <h4>Progress report for {open.name.split(" ")[0]}</h4>
            <div className="field">
              <label htmlFor="rep-period">Covering</label>
              <select id="rep-period" value={report.period} onChange={(e) => setReport({ ...report, period: e.target.value as Period })}>
                <option value="this-month">This month so far</option>
                <option value="last-month">Last month</option>
                <option value="30-days">The last 30 days</option>
                <option value="since-start">Since they started</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="rep-note">Your note (optional)</label>
              <textarea id="rep-note" rows={5} value={report.note} maxLength={3000} onChange={(e) => setReport({ ...report, note: e.target.value })} placeholder="Leave blank for a warm thank-you, or write your own." />
            </div>
            <div className="field">
              <label htmlFor="rep-sign">Sign-off (optional)</label>
              <textarea id="rep-sign" rows={2} value={report.signoff} maxLength={300} onChange={(e) => setReport({ ...report, signoff: e.target.value })} placeholder={`With gratitude,\n${TEAM}`} />
            </div>
            <div className="field-hint">Shows totals and product names only, never customers&rsquo; names. Replies go to the support inbox.</div>
            <div className="amb-report-send">
              <button type="button" className="esc-btn primary" onClick={() => sendReport(false)} disabled={busy || !open.email}>{open.email ? `Send to ${open.name.split(" ")[0]}` : "Add their email first (Edit)"}</button>
            </div>
            <div className="amb-report-test">
              <input type="email" value={report.testTo} onChange={(e) => setReport({ ...report, testTo: e.target.value })} placeholder="you@… (send a test first)" aria-label="Send a test to" />
              <button type="button" className="esc-btn" onClick={() => sendReport(true)} disabled={busy || !report.testTo.includes("@")}>Send test</button>
            </div>
            <button type="button" className="ap-linkbtn" onClick={() => { setReport(null); setPreview(null); }}>Close</button>
          </div>
          <div className="amb-report-preview">
            {preview ? (
              <>
                <div className="amb-report-subject"><strong>Subject:</strong> {preview.subject}</div>
                <iframe title="Report preview" srcDoc={preview.html} sandbox="" />
              </>
            ) : <div className="empty" style={{ padding: "2rem 0" }}>Preparing the preview…</div>}
          </div>
        </div>
      )}

      <div className="amb-tiles">
        <div className="amb-tile"><span>Page visits</span><strong>{os.visits.toLocaleString()}</strong><em>{os.qrScans ? `${os.qrScans} by QR` : " "}</em></div>
        <div className="amb-tile"><span>Orders</span><strong>{os.orders}</strong><em>{os.conversion !== undefined ? `${os.conversion}% of visits` : `${os.units} items`}</em></div>
        <div className="amb-tile"><span>Sales (paid)</span><strong>{money(os.sales)}</strong><em>{os.pendingSales ? `+ ${money(os.pendingSales)} unpaid` : "after discounts"}</em></div>
        <div className="amb-tile"><span>Earned</span><strong>{money(os.earnedAllTime)}</strong><em>{os.pending ? `+ ${money(os.pending)} when paid` : `${rateOf(open)}% commission`}</em></div>
        <div className="amb-tile"><span>Paid to them</span><strong>{money(os.paidOut)}</strong><em>{(open.payouts || []).length} payout{(open.payouts || []).length === 1 ? "" : "s"}</em></div>
        <div className="amb-tile is-owed"><span>Owed now</span><strong>{money(os.owed)}</strong><em>paid {termsForm(open).payoutSchedule}</em></div>
      </div>

      {os.trial.status !== "none" && (
        <div className={`amb-trial is-${os.trial.status}`}>
          {os.trial.status === "trial" && <>Trial: day {os.trial.day} of {os.trial.length}, ends {ymdLong(os.trial.ends!)} ({os.trial.daysLeft} day{os.trial.daysLeft === 1 ? "" : "s"} left).</>}
          {os.trial.status === "review" && (
            <>
              Trial ended {ymdLong(os.trial.ends!)}: time to review together.{" "}
              <button type="button" className="ap-linkbtn" disabled={busy} onClick={() => call("PUT", { ...open, terms: { ...termsForm(open), trialReviewed: true } }, "Marked as reviewed.")}>Mark review done</button>
            </>
          )}
          {os.trial.status === "done" && <>Trial reviewed (ended {ymdLong(os.trial.ends!)}).</>}
        </div>
      )}

      <div className="amb-cols">
        <div className="amb-box">
          <h4>Month by month</h4>
          {os.months.length ? (
            <table className="amb-table">
              <thead><tr><th>Month</th><th>Visits</th><th>Orders</th><th>Sales</th><th>Earned</th></tr></thead>
              <tbody>{os.months.slice(0, 12).map((m) => <tr key={m.month}><td>{monthLabel(m.month)}</td><td>{m.visits}</td><td>{m.orders}</td><td>{money(m.sales)}</td><td>{money(m.earned)}{m.pending ? <em> +{money(m.pending)}</em> : null}</td></tr>)}</tbody>
            </table>
          ) : <p className="field-hint">Nothing yet.</p>}
        </div>
        <div className="amb-box">
          <h4>Their top products</h4>
          {os.topProducts.length ? <ol className="amb-top">{os.topProducts.map((p) => <li key={p.name}>{p.name} <em>{p.units} sold</em></li>)}</ol> : <p className="field-hint">No sales yet.</p>}
          <h4 style={{ marginTop: "1.1rem" }}>Terms</h4>
          <ul className="amb-terms">
            <li>{rateOf(open)}% commission{open.terms?.growthPct && !open.terms.growthOn ? `, rising to ${open.terms.growthPct}%${open.terms.growthGoal ? ` once ${open.terms.growthGoal}` : " after agreed goals"}` : ""}</li>
            {typeof open.terms?.discountPct === "number" && <li>{open.terms.discountPct}% off for their community{open.discountCode ? ` (code ${open.discountCode})` : ""}</li>}
            <li>Orders count for {termsForm(open).windowDays || "30"} days after visiting their page{open.terms?.repeatPurchases === false ? ", first order per customer only" : ", repeat purchases included"}</li>
            <li>Started {ymdLong(termsForm(open).startDate)}{os.trial.length ? `, ${os.trial.length}-day trial` : ""}</li>
            {open.terms?.notes && <li className="amb-notes">{open.terms.notes}</li>}
          </ul>
        </div>
      </div>

      <div className="amb-box">
        <h4>Payouts</h4>
        <form className="amb-payout-form" onSubmit={async (e) => { e.preventDefault(); if (await call("PUT", { id: open.id, payout }, `Recorded ${money(Number(payout.amount) || 0)} paid to ${open.name}.`)) setPayout({ amount: "", at: todayPacific(), note: "" }); }}>
          <input inputMode="decimal" placeholder={os.owed ? `e.g. ${os.owed.toFixed(2)}` : "Amount"} value={payout.amount} onChange={(e) => setPayout({ ...payout, amount: e.target.value })} aria-label="Amount paid" required />
          <input type="date" value={payout.at} onChange={(e) => setPayout({ ...payout, at: e.target.value })} aria-label="Paid on" />
          <input placeholder="Note, e.g. Zelle, October commission" value={payout.note} maxLength={200} onChange={(e) => setPayout({ ...payout, note: e.target.value })} aria-label="Note" />
          <button type="submit" className="esc-btn primary" disabled={busy}>Record payout</button>
        </form>
        {(open.payouts || []).length > 0 ? (
          <ul className="amb-payouts">
            {(open.payouts || []).slice().sort((a, b) => b.at - a.at).map((p) => (
              <li key={p.id}>
                <strong>{money(p.amount)}</strong> · {day(p.at)}{p.note ? ` · ${p.note}` : ""}
                <button type="button" className="ap-linkbtn" disabled={busy} onClick={() => { if (confirm(`Remove the ${money(p.amount)} payout from ${day(p.at)}?`)) call("PUT", { id: open.id, removePayout: p.id }, "Payout removed."); }}>Remove</button>
              </li>
            ))}
          </ul>
        ) : <p className="field-hint">No payouts recorded yet. Record each one here after you pay them (Zelle, Venmo…), so “Owed now” stays right.</p>}
      </div>

      <div className="amb-box">
        <h4>Their orders ({os.orders})</h4>
        {os.list.length ? (
          <ul className="amb-sales">
            {os.list.map((x) => (
              <li key={x.orderId}>
                <strong>#{x.ref}</strong> · {day(x.at)} · {money(x.net)} · <span className={x.earned ? "amb-paid" : "amb-unpaid"}>{x.earned ? `earned ${money(x.commission)}` : `${money(x.commission)} when paid`}</span> · {x.status}
                {x.via === "code" && <span className="dc-chip soon">code</span>}
                <span className="amb-sale-items">{x.items.map((i) => `${i.name} ×${i.qty}`).join(", ")}</span>
              </li>
            ))}
          </ul>
        ) : <p className="field-hint">No orders yet. Orders placed after visiting their page{open.discountCode ? " or with their code" : ""} show up here.</p>}
      </div>
    </div>
  );

  // ---------------------------------------------------------------- everyone
  return (
    <section className="admin-section amb-admin" id="ambassadors">
      <h2>Ambassadors</h2>
      <p className="field-hint" style={{ marginTop: "-0.4rem" }}>
        Each ambassador gets their own page at <strong>{shown}/their-name</strong>, shared only by its link or QR code: their photo, words, socials and the
        products they pick. Orders are credited to them when the shopper came through their page (within their attribution window) or a member used their
        code. Commission is worked out on product sales after discounts, without shipping, and is earned once an order is paid. Cancelled orders don&rsquo;t count.
        {switchOn === false && <> Customers can&rsquo;t open the pages until <strong>Ambassador pages</strong> is on in Settings → Feature switches (you can still preview them).</>}
      </p>
      {msg && <p className={msg.ok ? "ap-ok" : "ap-bad"}>{msg.text}</p>}

      {form ? formView : open ? detail : (
        <>
          {overview && overview.total > 0 && (
            <div className="amb-tiles">
              <div className="amb-tile"><span>Live pages</span><strong>{overview.live}</strong><em>of {overview.total}</em></div>
              <div className="amb-tile"><span>Page visits</span><strong>{overview.visits.toLocaleString()}</strong><em> </em></div>
              <div className="amb-tile"><span>Orders</span><strong>{overview.orders}</strong><em> </em></div>
              <div className="amb-tile"><span>Sales (paid)</span><strong>{money(overview.sales)}</strong><em> </em></div>
              <div className="amb-tile"><span>Commission earned</span><strong>{money(overview.earned)}</strong><em>{money(overview.paidOut)} paid</em></div>
              <div className="amb-tile is-owed"><span>Owed now</span><strong>{money(overview.owed)}</strong><em>all ambassadors</em></div>
            </div>
          )}
          <div className="amb-toolbar">
            <button type="button" className="esc-btn primary" onClick={() => { setForm(blank()); setMsg(null); setPq(""); }}>+ Add an ambassador</button>
            {(list || []).length > 1 && (
              <label className="amb-sort">Sort
                <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                  <option value="owed">Most owed</option>
                  <option value="sales">Most sales</option>
                  <option value="newest">Newest</option>
                  <option value="name">Name</option>
                </select>
              </label>
            )}
          </div>
          {list === null ? (
            <div className="empty" style={{ padding: "1rem 0" }}>Loading…</div>
          ) : list.length === 0 ? (
            <div className="empty" style={{ padding: "1rem 0" }}>No ambassadors yet. Add the first one above.</div>
          ) : (
            <div className="amb-cards">
              {sorted.map((a) => {
                const s = stats[a.id];
                return (
                  <button key={a.id} type="button" className={`amb-acard${a.active ? "" : " is-off"}`} onClick={() => { setOpenId(a.id); setMsg(null); top(); }}>
                    <span className="amb-acard-head">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {a.photo ? <img src={a.photo} alt="" className="amb-thumb" /> : <span className="amb-thumb amb-initial">{a.name[0]}</span>}
                      <span className="amb-acard-who">
                        <strong>{a.name}</strong>
                        <em>{shown}/{a.slug}</em>
                      </span>
                    </span>
                    <span className="amb-acard-chips">
                      {!a.active && <span className="dc-chip inactive">Off</span>}
                      <TrialChip s={s} />
                      <span className="dc-chip">{rateOf(a)}%</span>
                    </span>
                    {s && (
                      <span className="amb-acard-nums">
                        <span><b>{s.visits}</b> visits</span>
                        <span><b>{s.orders}</b> orders</span>
                        <span><b>{money(s.sales)}</b> sales</span>
                        <span className={s.owed > 0 ? "owed" : ""}><b>{money(s.owed)}</b> owed</span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
