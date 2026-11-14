import { getAccounts, getRequests, requestsFor, shippedTracking, STAFF_MOVES, STATUS_LABEL, type RequestStatus, type StockRequest } from "../retail";
import { linkedLocation, monthOf, portalProducts, requestView, type PortalProduct } from "../retailPortal";
import { addressLine } from "../stores";
import { isEnabled } from "../flags";
import { getStock } from "../stock";
import { pacificDateTime } from "../periods";
import type { GatewayTool } from "./gateway";
import type { ToolContext } from "./tools";
import type { ActionProposal, Audience } from "./shared";
import { brand } from "../brand";

/**
 * Retail stores and the Concierge (switch retail_portal).
 *
 *  - For a store signed in to /store-portal: look up their requests, what
 *    we've shipped them and the products they can ask for, and prepare cards
 *    for everything the portal does (request stock, cancel a pending request,
 *    confirm a delivery arrived, message the team). The store presses Confirm;
 *    each card calls the same /api/store-portal endpoint as the portal's buttons.
 *  - For staff: list stores' requests and prepare a card to move one along.
 *    Stock counts are never touched from chat; the Retail tab asks about them.
 *
 * No prices or money for stores (2026-11-10).
 */

type Def = GatewayTool & { audiences: Audience[] };
type Result = Record<string, unknown>;

const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: "string", description, ...extra });
const fn = (audiences: Audience[], name: string, description: string, properties: Record<string, unknown>, required: string[] = []): Def => ({
  audiences,
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required } },
});

export const STORE_DEFS: Def[] = [
  fn(["store"], "my_store", "The store you're helping: its name, contact, logins, and its address/hours on the public store map (if linked).", {}),
  fn(["store"], "store_products", "Products this store can request (names only, never prices). Optional search text.", { search: str("Optional: part of a product name") }),
  fn(["store"], "my_stock_requests", "This store's stock requests: reference, status, products and quantities (and how many were actually shipped), notes, dates. Newest first.", { status: str("Optional filter: pending | approved | shipped | received | declined | cancelled") }),
  fn(["store"], "shipped_to_us", `Everything ${brand.shortName} has shipped to this store: total units, units per product (with the last shipment date) and units per month. Units only.`, {}),
  fn(
    ["store"],
    "propose_stock_request",
    "Prepare a new stock request for the store to confirm (it's sent to the team only when they press Send). Use product names from store_products and whole-number quantities.",
    {
      items: { type: "array", description: "Products and quantities", items: { type: "object", properties: { product: str("Product name"), qty: { type: "number", description: "Units wanted" } }, required: ["product", "qty"] } },
      note: str("Optional note for the team (delivery timing, anything else)"),
    },
    ["items"],
  ),
  fn(["store"], "propose_cancel_request", "Prepare cancelling one of this store's requests that is still waiting for review (pending). The store confirms.", { ref: str("The request reference, e.g. R7K2QD") }, ["ref"]),
  fn(["store"], "propose_mark_received", "Prepare confirming that a shipped request arrived. The store confirms.", { ref: str("The request reference, e.g. R7K2QD") }, ["ref"]),
  fn(["store"], "propose_message_team", `Prepare a message from the store to the ${brand.shortName} team (e.g. change our hours or address on the map, add a login, a question). Emailed when the store presses Send.`, { message: str("The message, in the store's words") }, ["message"]),
  // ------------------------------------------------ staff
  fn(["admin"], "retail_requests", "Read-only: retail stores' stock requests (Retail tab), newest first, with store, reference, status, products and units. Optional filters. Also lists the store accounts.", { status: str("Optional: pending | approved | shipped | received | declined | cancelled | open (= pending + approved)"), store: str("Optional: part of a store name") }),
  fn(
    ["admin"],
    "propose_retail_request_status",
    "Prepare moving a store's stock request to approved, shipped, received, declined or back to pending, with an optional note the store sees. Never changes stock counts (the Retail tab asks about those when marking shipped). Staff confirm.",
    { ref: str("Request reference or id"), status: str("approved | shipped | received | declined | pending"), note: str("Optional note shown to the store") },
    ["ref", "status"],
  ),
];

export const STORE_TOOL_NAMES = new Set(STORE_DEFS.map((d) => d.function.name));

let n = 0;
const newId = () => `act_${Date.now().toString(36)}_s${(n++).toString(36)}`;
const READY = { proposed: true, say: "The card is ready for them to confirm. Nothing has been sent or changed yet." };
const s = (v: unknown, max = 500) => String(v ?? "").trim().slice(0, max);
const day = (t?: number) => (t ? pacificDateTime(t) : undefined);
function push(ctx: ToolContext, a: Omit<ActionProposal, "id">) {
  ctx.actions.push({ id: newId(), ...a });
}

function matchProduct(list: PortalProduct[], q: string): PortalProduct[] {
  const needle = q.toLowerCase().trim();
  if (!needle) return [];
  const exact = list.filter((p) => p.name.toLowerCase() === needle || p.id === q);
  if (exact.length) return exact;
  const words = needle.split(/\s+/).filter((w) => w.length > 1);
  return list
    .map((p) => ({ p, score: (p.name.toLowerCase().includes(needle) ? 10 : 0) + words.filter((w) => p.name.toLowerCase().includes(w)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.p);
}

const brief = (r: StockRequest) => ({
  ...requestView(r),
  createdAt: day(r.createdAt),
  updatedAt: day(r.updatedAt),
  shippedAt: day(r.shippedAt),
  receivedAt: day(r.receivedAt),
});

export async function runStoreTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<Result | null> {
  if (!STORE_TOOL_NAMES.has(name)) return null;
  if (!(await isEnabled("retail_portal").catch(() => false)) && ctx.audience === "store") return { error: "The store portal is closed right now." };

  if (ctx.audience === "admin") return runStaff(name, args, ctx);
  const me = ctx.store;
  if (ctx.audience !== "store" || !me) return { error: "Not available." };
  const { account, login } = me;

  switch (name) {
    case "my_store": {
      const loc = await linkedLocation(account);
      return {
        store: account.name,
        contact: account.contactName,
        phone: account.phone,
        signedInAs: `${login.name} <${login.email}>`,
        logins: account.logins.filter((l) => l.active).map((l) => `${l.name} <${l.email}>`),
        onTheMap: loc
          ? { name: loc.name, address: addressLine(loc), phone: loc.phone, website: loc.website, hours: loc.hours, listed: loc.active ? "shown on the public store map" : "not shown on the map right now" }
          : "Not linked to a store map listing. The team can add it (propose_message_team).",
        changes: `Details are kept by the ${brand.shortName} team: to change anything, prepare a message to them with propose_message_team.`,
      };
    }
    case "store_products": {
      const list = await portalProducts();
      const q = s(args.search, 80);
      const hits = q ? matchProduct(list, q) : list;
      return { count: hits.length, products: hits.slice(0, 80).map((p) => p.name), ...(q && !hits.length ? { note: "No product by that name. Show them the list instead." } : {}) };
    }
    case "my_stock_requests": {
      const want = s(args.status, 20) as RequestStatus;
      const list = (await requestsFor(account.id)).filter((r) => !want || r.status === want);
      return { count: list.length, requests: list.slice(0, 25).map(brief) };
    }
    case "shipped_to_us": {
      const t = shippedTracking(await requestsFor(account.id), monthOf);
      return { ...t, lastShippedAt: day(t.lastShippedAt), products: t.products.map((p) => ({ ...p, lastAt: day(p.lastAt) })) };
    }
    case "propose_stock_request": {
      const list = await portalProducts();
      const raw = Array.isArray(args.items) ? args.items.slice(0, 40) : [];
      const items: Array<{ productId: string; name: string; qty: number }> = [];
      const unclear: string[] = [];
      for (const r of raw as Array<{ product?: unknown; qty?: unknown }>) {
        const q = s(r?.product, 120);
        const qty = Math.floor(Number(r?.qty));
        let hits = matchProduct(list, q);
        if (hits.length > 1) {
          // Several loose matches: use the one whose name holds the whole phrase, if only one does.
          const whole = hits.filter((h) => h.name.toLowerCase().includes(q.toLowerCase()));
          if (whole.length === 1) hits = whole;
        }
        if (hits.length !== 1) {
          unclear.push(hits.length ? `"${q}" matches several: ${hits.slice(0, 5).map((h) => h.name).join(", ")}` : `"${q}" isn't a product they can request`);
          continue;
        }
        if (!Number.isFinite(qty) || qty < 1 || qty > 10_000) {
          unclear.push(`${hits[0].name}: quantity must be a whole number from 1 to 10,000`);
          continue;
        }
        const prev = items.find((i) => i.productId === hits[0].id);
        if (prev) prev.qty += qty;
        else items.push({ productId: hits[0].id, name: hits[0].name, qty });
      }
      if (unclear.length) return { error: "Some lines need checking before a card can be made.", unclear, hint: "Ask the store which product they mean (use store_products), then try again." };
      if (!items.length) return { error: "No products given." };
      const note = s(args.note, 1000);
      push(ctx, {
        kind: "store_request",
        title: `Request stock: ${items.reduce((n, i) => n + i.qty, 0)} units`,
        lines: [...items.map((i) => `${i.name} × ${i.qty}`), ...(note ? [`Note: ${note}`] : []), `Goes to the ${brand.shortName} team for review`],
        confirmLabel: "Send request",
        busyLabel: "Sending…",
        request: { method: "POST", url: "/api/store-portal", body: { items: items.map((i) => ({ productId: i.productId, qty: i.qty })), note } },
        refresh: ["retail"],
      });
      return READY;
    }
    case "propose_cancel_request":
    case "propose_mark_received": {
      const ref = s(args.ref, 40).replace(/^#/, "").toUpperCase();
      const r = (await requestsFor(account.id)).find((x) => x.ref === ref || x.id === s(args.ref, 80));
      if (!r) return { error: `No request ${ref} for this store. Check my_stock_requests for the right reference.` };
      const cancel = name === "propose_cancel_request";
      if (cancel && r.status !== "pending") return { error: `Request ${r.ref} is “${STATUS_LABEL[r.status]}”, so it can't be cancelled here. Offer to message the team instead.` };
      if (!cancel && r.status !== "shipped") return { error: `Request ${r.ref} is “${STATUS_LABEL[r.status]}”. Only shipped requests can be marked received.` };
      push(ctx, {
        kind: cancel ? "store_request_cancel" : "store_request_received",
        title: cancel ? `Cancel request ${r.ref}` : `Mark request ${r.ref} received`,
        lines: [...r.items.map((i) => `${i.name} × ${cancel ? i.qty : i.shippedQty ?? i.qty}`), `Sent ${day(r.createdAt)}`],
        confirmLabel: cancel ? "Cancel request" : "Mark received",
        danger: cancel,
        request: { method: "PATCH", url: "/api/store-portal", body: { id: r.id, action: cancel ? "cancel" : "received" } },
        refresh: ["retail"],
      });
      return READY;
    }
    case "propose_message_team": {
      const message = s(args.message, 2000);
      if (message.length < 2) return { error: "What should the message say?" };
      push(ctx, {
        kind: "store_message",
        title: `Message the ${brand.shortName} team`,
        lines: [`From ${login.name} <${login.email}>, ${account.name}`, "They'll reply by email"],
        preview: message,
        confirmLabel: "Send message",
        busyLabel: "Sending…",
        request: { method: "PUT", url: "/api/store-portal", body: { message } },
        refresh: [],
      });
      return READY;
    }
  }
  return { error: "Not available." };
}

async function runStaff(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<Result> {
  if (name === "retail_requests") {
    const want = s(args.status, 20);
    const storeQ = s(args.store, 80).toLowerCase();
    const [list, accounts] = await Promise.all([getRequests(), getAccounts()]);
    const hits = list.filter((r) => (!want ? true : want === "open" ? r.status === "pending" || r.status === "approved" : r.status === want)).filter((r) => !storeQ || r.storeName.toLowerCase().includes(storeQ));
    return {
      portalSwitch: (await isEnabled("retail_portal").catch(() => false)) ? "on" : "off",
      count: hits.length,
      requests: hits.slice(0, 30).map((r) => ({ id: r.id, ref: r.ref, store: r.storeName, status: r.status, statusLabel: STATUS_LABEL[r.status], items: r.items.map((i) => `${i.name} × ${i.qty}${i.shippedQty !== undefined && i.shippedQty !== i.qty ? ` (shipped ${i.shippedQty})` : ""}`), note: r.note, staffNote: r.staffNote, by: r.requestedBy, sent: day(r.createdAt), shipped: day(r.shippedAt), stockCountsTaken: r.stockTaken?.length ? "yes" : "no" })),
      stores: accounts.map((a) => ({ name: a.name, active: a.active, logins: a.logins.length })),
    };
  }
  if (name === "propose_retail_request_status") {
    if (ctx.allowActions === false) return { error: "Preparing changes is switched off right now." };
    const ref = s(args.ref, 80).replace(/^#/, "");
    const r = (await getRequests()).find((x) => x.id === ref || x.ref === ref.toUpperCase());
    if (!r) return { error: `No retail request ${ref}. Use retail_requests to find it.` };
    const status = s(args.status, 20) as RequestStatus;
    if (!STAFF_MOVES[r.status].includes(status)) return { error: `Request ${r.ref} is “${STATUS_LABEL[r.status]}”; it can move to: ${STAFF_MOVES[r.status].join(", ")}.` };
    const note = s(args.note, 1000);
    const stockOn = await isEnabled("stock_counts").catch(() => false);
    const counted = stockOn ? await getStock().catch(() => new Map<string, number>()) : new Map<string, number>();
    const tracked = r.items.some((i) => counted.has(i.productId));
    push(ctx, {
      kind: "retail_request_status",
      title: `${r.storeName}: request ${r.ref} → ${STATUS_LABEL[status]}`,
      lines: [
        ...r.items.map((i) => `${i.name} × ${i.qty}`),
        ...(note ? [`Note to the store: ${note}`] : []),
        ...(status === "shipped" && tracked ? ["Stock counts are not changed from here. To take these off stock counts, mark it shipped in the Retail tab instead (it asks)."] : []),
      ],
      confirmLabel: "Save",
      danger: status === "declined",
      request: { method: "PATCH", url: "/api/admin/retail", body: { requestId: r.id, status, ...(note ? { staffNote: note } : {}) } },
      refresh: ["retail", "today"],
    });
    return READY;
  }
  return { error: "Not available." };
}
