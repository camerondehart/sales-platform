import { Resend } from "resend";
import { getProducts, isExternal } from "./storage";
import { getStores, addressLine, type StoreLocation } from "./stores";
import { pacificDay, pacificDateTime } from "./periods";
import { createRequest, requestsFor, shippedTracking, storeView, STATUS_LABEL, type RequestItem, type RetailAccount, type RetailLogin, type StockRequest } from "./retail";
import { isEnabled } from "./flags";

/**
 * What the store portal shows and does, shared by its own pages/routes and
 * by the Concierge when it helps a store (lib/assistant/storeTools.ts), so
 * both always agree. No prices anywhere (2026-11-10).
 */

export type PortalProduct = { id: string; name: string; image: string; category?: string };

/** Products a store can ask for: the public shop's single products (no bundles). */
export async function portalProducts(): Promise<PortalProduct[]> {
  return (await getProducts())
    .filter(isExternal)
    .filter((p) => !p.isBundle)
    .map((p) => ({ id: p.id, name: p.name, image: p.image, ...(p.category ? { category: p.category } : {}) }));
}

export const monthOf = (t: number) => pacificDay(t).slice(0, 7);

/** The store's map details (address, hours…) when its account is linked to a map pin. */
export async function linkedLocation(account: RetailAccount): Promise<StoreLocation | undefined> {
  if (!account.storeId) return undefined;
  return (await getStores().catch(() => [] as StoreLocation[])).find((s) => s.id === account.storeId);
}

/** A request as the store sees it. */
export const requestView = (r: StockRequest) => ({
  id: r.id,
  ref: r.ref,
  status: r.status,
  statusLabel: STATUS_LABEL[r.status],
  items: r.items.map((it) => ({ productId: it.productId, name: it.name, qty: it.qty, ...(it.shippedQty !== undefined ? { shippedQty: it.shippedQty } : {}) })),
  note: r.note,
  staffNote: r.staffNote,
  requestedBy: r.requestedBy,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  shippedAt: r.shippedAt,
  receivedAt: r.receivedAt,
});

export async function portalData(account: RetailAccount, login: RetailLogin) {
  const [products, list, location] = await Promise.all([portalProducts(), requestsFor(account.id), linkedLocation(account)]);
  return {
    me: { name: login.name, email: login.email },
    account: storeView(account),
    location: location
      ? { name: location.name, address: addressLine(location), phone: location.phone, website: location.website, hours: location.hours, onMap: location.active }
      : null,
    products,
    requests: list.map(requestView),
    tracking: shippedTracking(list, monthOf),
  };
}

/** Create a request from the store (portal form or a Concierge card) and tell the team. */
export async function submitRequest(account: RetailAccount, login: RetailLogin, items: RequestItem[], note: string, siteUrl: string): Promise<StockRequest> {
  const req = await createRequest(account, items, note, login.email);
  await alertStaff(req, account, login, siteUrl).catch((err) => console.error("[retail] staff alert failed", err));
  return req;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Same staff inbox as new orders (INQUIRY_TO_EMAIL). */
async function alertStaff(req: StockRequest, account: RetailAccount, login: RetailLogin, siteUrl: string): Promise<void> {
  const to = process.env.INQUIRY_TO_EMAIL;
  const apiKey = process.env.RESEND_API_KEY;
  if (!to || !apiKey) return;
  const units = req.items.reduce((n, it) => n + it.qty, 0);
  const rows = req.items.map((it) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;">${esc(it.name)}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-weight:700;">${it.qty}</td></tr>`).join("");
  const r = await new Resend(apiKey).emails.send({
    from: process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev",
    to,
    reply_to: login.email,
    subject: `New stock request from ${account.name} — ${units} unit${units === 1 ? "" : "s"} (Ref ${req.ref})`,
    html: `<div style="font-family:Arial,sans-serif;color:#333;max-width:560px">
      <h2 style="margin:0 0 8px">New stock request · ${esc(account.name)}</h2>
      <p style="margin:0 0 12px;color:#666">Ref ${req.ref} · from ${esc(login.name)} &lt;${esc(login.email)}&gt; · ${esc(pacificDateTime(req.createdAt))}</p>
      <table style="border-collapse:collapse;width:100%;margin:0 0 12px"><tr><th style="text-align:left;padding:6px 10px;background:#f4f6f1">Product</th><th style="text-align:right;padding:6px 10px;background:#f4f6f1">Units</th></tr>${rows}</table>
      ${req.note ? `<p style="background:#f9f9f8;border-left:3px solid #85ba45;padding:10px 12px;margin:0 0 12px">${esc(req.note)}</p>` : ""}
      <p><a href="${esc(siteUrl)}/admin?tab=retail" style="color:#4f7f22;font-weight:700">Review it in the Retail tab</a></p>
    </div>`,
    tags: [{ name: "kind", value: "retail_request" }],
  });
  if (r.error) console.error("[retail] staff alert rejected", r.error);
}

/** A note from the store to the team (e.g. "please update our hours"). */
export async function messageTeam(account: RetailAccount, login: RetailLogin, message: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const to = process.env.INQUIRY_TO_EMAIL;
  const apiKey = process.env.RESEND_API_KEY;
  if (!to || !apiKey) return { ok: false, error: "Messages can't be sent right now. Please email us instead." };
  try {
    const r = await new Resend(apiKey).emails.send({
      from: process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev",
      to,
      reply_to: login.email,
      subject: `Message from ${account.name} (store portal)`,
      html: `<div style="font-family:Arial,sans-serif;color:#333;max-width:560px">
        <h2 style="margin:0 0 8px">Message from ${esc(account.name)}</h2>
        <p style="margin:0 0 12px;color:#666">From ${esc(login.name)} &lt;${esc(login.email)}&gt; via the store portal. Reply to this email to answer them.</p>
        <p style="white-space:pre-wrap;background:#f9f9f8;border-left:3px solid #85ba45;padding:10px 12px">${esc(message)}</p>
      </div>`,
      tags: [{ name: "kind", value: "retail_message" }],
    });
    if (r.error) return { ok: false, error: "The message didn't send. Please try again." };
    return { ok: true };
  } catch {
    return { ok: false, error: "The message didn't send. Please try again." };
  }
}

export const portalOn = () => isEnabled("retail_portal").catch(() => false);

export const siteUrlOf = (req: Request) => process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || new URL(req.url).origin;
