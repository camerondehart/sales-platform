import crypto from "crypto";
import { getProducts, type Product } from "../storage";
import { getEvents, getRegistrations } from "../events";
import { getUsers } from "../users";
import { getOrders } from "../orders";
import { getDiscounts, normalizeCode } from "../discounts";
import { getSubscribers } from "../subscribers";
import { listTemplates, TEMPLATE_CATEGORIES } from "../emailTemplates";
import { listBundles } from "../bundleStore";
import { bundleOfferLabel, setSavings } from "../bundles";
import { listCampaigns, recipientsFor, inWindow } from "../campaignSchedule";
import { resolveSegment, SEGMENTS, SEGMENT_KEYS } from "../segments";
import { FLAGS, FLAG_KEYS, getFlags, type FlagKey } from "../flags";
import { getAdmins } from "../admins";
import { getReminderSettings } from "../reminders";
import { getSettings } from "../settings";
import { cleanWeightOz, orderWeight, packagingOzOf } from "../shippingWeight";
import { listSources } from "./sources";
import { recentEscalations, escalationStatus } from "./usage";
import { effectivePrice, formatMoney, lineDiscount, parsePrice } from "../pricing";
import { parseVideo } from "../video";
import type { GatewayTool } from "./gateway";
import type { ToolContext } from "./tools";
import type { ActionProposal, Audience } from "./shared";
import { brand } from "@/lib/brand";

/**
 * The rest of the dashboard, for the staff Concierge.
 *
 * Every admin action in the dashboard now has a matching propose_* tool
 * here (or in tools.ts). Same rules as the originals:
 *  - the tool only READS: it checks the request against real records and
 *    builds a card showing exactly what will happen;
 *  - nothing changes until a signed-in admin presses the card's button,
 *    which calls the SAME endpoint the dashboard's own button calls, so all
 *    validation, safety guards and the Activity log apply unchanged (marked
 *    "Concierge");
 *  - anything irreversible or that sends/spends is a red card.
 *
 * Deliberately NOT offered: typing passwords into the chat (the chat is
 * stored and sent to the AI provider) — the Concierge can instead email a
 * member a fresh random password; file uploads and CSV imports (they need a
 * file); the staff password.
 */

type Def = GatewayTool & { audiences: Audience[] };
type Result = Record<string, unknown>;

const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: "string", description, ...extra });
const num = (description: string) => ({ type: "number", description });
const bool = (description: string) => ({ type: "boolean", description });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const SEGMENT_PARAMS = {
  segment: str(`Customer group instead of an audience: ${SEGMENT_KEYS.join(" | ")}`),
  segment_days: num("Group window in days (e.g. 60 for lapsed_members)"),
  segment_limit: num("For top_customers: how many people"),
  segment_product: str("For bought_product: product id or name"),
};
const admin = (name: string, description: string, parameters: Record<string, unknown>): Def => ({
  audiences: ["admin"],
  type: "function",
  function: { name, description, parameters },
});

export const ADMIN_EXTRA_DEFS: Def[] = [
  // ------------------------------------------------------------ look-ups
  admin("list_events_admin", "Events with ids, dates, published/draft, capacity and sign-up counts. Pass event_id to list that event's registrations (with ids).", obj({ event_id: str("Optional: an event id to list registrations for"), include_past: bool("Include past events") })),
  admin("list_mix_bundles", "Mix-and-match bundle discounts (ids, products, deal, active, dates, orders so far).", obj({})),
  admin("list_campaigns", "Recent email campaigns (ids, subject, status sent/scheduled/cancelled, when, reach).", obj({})),
  admin("find_subscribers", "Search the mailing list by email or name (ids, subscribed or unsubscribed).", obj({ query: str("Email or name fragment") })),
  admin("list_templates", "Saved email templates (ids, names, categories, archived). Pass template_id (or an exact name) to read that template's subject and body, e.g. to base a campaign draft on it.", obj({ template_id: str("Optional: id or exact name of one template to read in full") })),
  admin("list_handed_to_team", "Customer requests the Concierge handed to the team (ids, who, topic, open/resolved, summary).", obj({ status: str("open | resolved | any") })),
  admin("get_admin_settings", "Feature switches (on/off), staff sign-in list, payment reminder timing/wording, loyalty settings, assistant settings, and the web pages the Concierge learns from.", obj({})),
  admin("get_export_links", "Links to download spreadsheets (orders, members, subscribers, revenue, inquiries).", obj({})),

  // ------------------------------------------------------------ members
  admin("propose_create_member", "Prepare creating an approved member account. A random password is generated and emailed to them (you never see it).", obj({ name: str("Full name"), email: str("Email"), subscribe: bool("Also add to the mailing list (default true)") }, ["name", "email"])),
  admin("propose_delete_member", "Prepare deleting a member account (red card). Their past orders stay.", obj({ member_id: str("Member id from find_members") }, ["member_id"])),
  admin("propose_member_name", "Prepare correcting a member's name.", obj({ member_id: str("Member id"), name: str("New full name") }, ["member_id", "name"])),
  admin("propose_member_address", "Prepare changing a member's shipping address and/or phone (find_members shows the current one). Send only the parts that change; an empty string clears a line (e.g. address_line2).", obj({ member_id: str("Member id from find_members"), address_line1: str("Street address"), address_line2: str("Apt / suite (\"\" to clear)"), city: str("City"), state: str("State, e.g. OR"), postal_code: str("ZIP code"), phone: str("Phone (\"\" to clear)") }, ["member_id"])),
  admin("propose_member_password_reset", "Prepare emailing a member a fresh random password (you never see it). Never ask for or accept a password in chat.", obj({ member_id: str("Member id") }, ["member_id"])),

  // ------------------------------------------------------------ orders
  admin("propose_manual_invoice", "Prepare a hand-made invoice for a member (creates a pending order and emails the invoice with pay link).", obj({
    member_id: str("Member id"),
    items: { type: "array", items: obj({ product: str("Product id or exact name"), quantity: num("Quantity") }, ["product"]), description: "Products and quantities" },
    note: str("Optional note on the invoice"),
    shipping: num("Shipping charge in dollars (default 10; 0 for pickup)"),
  }, ["member_id", "items"])),
  admin("propose_shipping_label", "Prepare BUYING a USPS shipping label through Shippo for an order (red card — it charges the Shippo account). Leave weight_oz out: the weight is worked out from the products' shipping weights plus the box. Only pass weight_oz if the staff tell you the weighed parcel.", obj({ order_id: str("Order id"), weight_oz: num("Only if staff give the weighed parcel weight, in ounces"), service: str("Shippo service token, default usps_ground_advantage") }, ["order_id"])),
  admin("propose_product_weights", "Prepare setting the shipping weight (ounces, one packed unit) on one or more products, and optionally the box & packing allowance added to every parcel.", obj({ weights: { type: "array", items: obj({ product: str("Product id or exact name"), oz: num("Ounces for one unit (0 clears it)") }, ["product", "oz"]) }, packaging_oz: num("Optional: box & packing ounces added to every parcel") })),
  admin("propose_reminder_action", "One unpaid order: expire (move it to Expired by hand — stays unpaid, not cancelled, no more automatic reminders), revive (bring back from Expired), stop or resume its payment reminders. One card per order.", obj({ order_id: str("Order id"), action: str("expire | revive | stop | resume") }, ["order_id", "action"])),
  admin("propose_run_reminders", "Prepare running payment reminders now (sends any that are due).", obj({})),

  // ------------------------------------------------------------ products
  admin("propose_create_product", "Prepare adding a product. Needs a photo link (an uploaded photo's link or any https image).", obj({
    name: str("Name"), description: str("Description"), price: str("Price, e.g. $32"), image_url: str("https link to the photo"),
    category: str("Category"), visibility: str("internal (members) | external (public shop) | both"), sale_price: str("Optional sale price"), video_url: str("Optional YouTube/Vimeo/.mp4 link"),
    weight_oz: num("Optional shipping weight of one packed unit, in ounces"),
  }, ["name", "description", "price", "image_url"])),
  admin("propose_edit_product", "Prepare editing a product: name, description, price, sale price (\"\" to clear), category, photo link, video link (\"\" to clear), where it sells.", obj({
    product_id: str("Product id"), name: str("New name"), description: str("New description"), price: str("New regular price"), sale_price: str("Sale price, or \"\" to clear"),
    category: str("Category"), image_url: str("New photo link"), video_url: str("Video link, or \"\" to remove"), visibility: str("internal | external | both"),
    cash_pickup_only: { type: "boolean", description: "true: its sale price / promotion only applies to Local pickup paid in cash; false: for everyone" },
  }, ["product_id"])),
  admin("propose_delete_product", "Prepare deleting a product (red card).", obj({ product_id: str("Product id") }, ["product_id"])),
  admin("propose_move_product", "Prepare moving a product one place up or down in the shop order.", obj({ product_id: str("Product id"), direction: str("up | down") }, ["product_id", "direction"])),

  // ------------------------------------------------------------ events
  admin("propose_create_event", "Prepare a new class/event. Dates as YYYY-MM-DD HH:MM local. Saved as a draft unless published is true.", obj({
    title: str("Title"), description: str("Description"), start: str("Start, YYYY-MM-DD HH:MM"), end: str("Optional end, YYYY-MM-DD HH:MM"), location: str("Location"),
    price: str("Display price, e.g. $35 or Free"), capacity: num("Spots (0 = unlimited)"), waitlist: num("Waitlist size (0 = unlimited)"), type: str("class | workshop | vendor | other"),
    image_url: str("Optional photo link"), published: bool("Show it on /events now"),
  }, ["title", "start", "location"])),
  admin("propose_edit_event", "Prepare changing an event (any field) or publishing / unpublishing it.", obj({
    event_id: str("Event id"), title: str("Title"), description: str("Description"), start: str("YYYY-MM-DD HH:MM"), end: str("YYYY-MM-DD HH:MM"), location: str("Location"),
    price: str("Display price (\"\" to clear)"), capacity: num("Spots"), waitlist: num("Waitlist size"), type: str("class | workshop | vendor | other"), image_url: str("Photo link (\"\" to clear)"), published: bool("Published"),
  }, ["event_id"])),
  admin("propose_delete_event", "Prepare deleting an event (red card).", obj({ event_id: str("Event id") }, ["event_id"])),
  admin("propose_registration_action", "Cancel a registration (the first waitlisted person moves in automatically) or promote someone off the waitlist.", obj({ registration_id: str("Registration id from list_events_admin"), action: str("cancel | promote") }, ["registration_id", "action"])),

  // ------------------------------------------------------------ discounts & bundles
  admin("propose_discount_toggle", "Prepare switching a discount code on or off.", obj({ code: str("The code or its id"), active: bool("true = on, false = off") }, ["code", "active"])),
  admin("propose_delete_discount", "Prepare deleting a discount code (red card).", obj({ code: str("The code or its id") }, ["code"])),
  admin("propose_mix_bundle", "Prepare a mix-and-match bundle discount (e.g. these 4 products, 20% off the set). type percent or price (set price in dollars).", obj({
    name: str("Bundle name"), products: { type: "array", items: obj({ product: str("Product id or exact name"), qty: num("How many in the set (default 1)") }, ["product"]) },
    type: str("percent | price"), value: num("Percent off, or the set price in dollars"), starts: str("Optional YYYY-MM-DD HH:MM"), ends: str("Optional YYYY-MM-DD HH:MM"),
  }, ["name", "products", "type", "value"])),
  admin("propose_mix_bundle_update", "Pause/resume, or change a mix-and-match bundle (any of name, products, deal, dates).", obj({
    bundle_id: str("Bundle id"), active: bool("Running (true) or paused (false)"), name: str("New name"),
    products: { type: "array", items: obj({ product: str("Product id or name"), qty: num("Qty") }, ["product"]) }, type: str("percent | price"), value: num("Deal value"), starts: str("YYYY-MM-DD HH:MM or \"\""), ends: str("YYYY-MM-DD HH:MM or \"\""),
  }, ["bundle_id"])),
  admin("propose_delete_mix_bundle", "Prepare deleting a mix-and-match bundle (red card). Past orders keep their savings.", obj({ bundle_id: str("Bundle id") }, ["bundle_id"])),

  // ------------------------------------------------------------ marketing
  admin("propose_campaign", "Prepare SENDING an email campaign (red card) — now, or scheduled (sends 9am–6pm local). Body format like prepare_campaign_draft. For a draft to edit, use prepare_campaign_draft instead. To reach a group of customers (e.g. lapsed members) pass segment — the server works out who's in it; never collect emails yourself.", obj({
    subject: str("Subject"), body: str("Body (plain text; # heading, - bullets, **bold**, [Button](url))"), audience: str("subscribers (the mailing list — default) | all (subscribers + every member) | members | nonmembers | custom"),
    custom_list: str("For custom: emails separated by commas (only subscribed people get it)"), send_at: str("Optional YYYY-MM-DD HH:MM local; blank = now"),
    ...SEGMENT_PARAMS,
  }, ["subject", "body"])),
  admin("product_links", "Shareable links and QR codes for products: the permanent product link (works for printed codes forever, opens the right shop) and a PNG QR image URL. Use when writing social posts, emails, flyers or campaign drafts that mention products, or when staff ask for a link/QR.", obj({ products: { type: "array", items: { type: "string" }, description: "Product ids or names (up to 12)" } }, ["products"])),
  admin("today_item", "Read one item from the staff's Today list on the Overview (their message starts \"Today item <key>:\"). Returns the exact people, orders or products with ids, and which cards to prepare. Call this FIRST for those messages, then prepare every card in the same reply. Never ask the staff for names, emails or ids for these.", obj({ key: str("The item key after \"Today item\", e.g. first-order, lapsed, refill") }, ["key"])),
  admin("find_customer_group", `Preview a customer group for a campaign: who's in it and how many a campaign would reach. Groups: ${SEGMENT_KEYS.map((k) => `${k} (${SEGMENTS[k]})`).join("; ")}.`, obj({ ...SEGMENT_PARAMS }, ["segment"])),
  admin("propose_campaign_test", "Prepare a TEST send of a campaign to the team inbox only.", obj({ subject: str("Subject"), body: str("Body") }, ["subject", "body"])),
  admin("propose_cancel_campaign", "Prepare cancelling a scheduled campaign before it sends.", obj({ campaign_id: str("Campaign id from list_campaigns") }, ["campaign_id"])),
  admin("propose_template", "Prepare saving an email template (new, or update one by id — built-in starter_ templates too, e.g. when staff press \"Redo with AI\" on a template card).", obj({ name: str("Template name"), subject: str("Subject"), body: str("Body"), category: str(`One of ${TEMPLATE_CATEGORIES.join(", ")}`), template_id: str("Optional: id to update") }, ["name", "subject", "body"])),
  admin("propose_template_archive", "Prepare archiving or restoring a template.", obj({ template_id: str("Template id"), archived: bool("true = archive, false = restore") }, ["template_id", "archived"])),
  admin("propose_subscriber_add", "Prepare adding someone to the mailing list.", obj({ email: str("Email"), name: str("Name") }, ["email"])),
  admin("propose_subscriber_remove", "Prepare removing someone from the mailing list (red card).", obj({ email: str("Email (or subscriber id)") }, ["email"])),

  // ------------------------------------------------------------ settings
  admin("propose_loyalty_settings", "Prepare changing loyalty points settings.", obj({ enabled: bool("Loyalty on/off"), points_per_dollar: num("Points earned per $1"), points_per_dollar_redeemed: num("Points that equal $1 off"), min_points_to_redeem: num("Minimum points before redeeming") })),
  admin("propose_feature_switch", `Prepare turning a feature switch on or off (this environment only). Keys: ${FLAG_KEYS.join(", ")}.`, obj({ key: str("Switch key"), on: bool("true = on") }, ["key", "on"])),
  admin("propose_staff_change", "Prepare adding or removing someone from the staff sign-in list (who can get an emailed dashboard link).", obj({ add_email: str("Email to add"), add_name: str("Their name"), remove_email: str("Email to remove") })),
  admin("propose_reminder_settings", "Prepare changing payment reminder timing or wording (reminder number 1–6), or when unpaid orders move to Expired.", obj({ reminder: num("Which reminder (1 = first)"), after_hours: num("Hours after the order"), subject: str("Subject ({name} {ref} {total} fill in)"), message: str("Message"), expire_after_hours: num("Hours until Expired") })),
  admin("propose_send_report", "Prepare emailing the nightly report + spreadsheets now.", obj({})),
  admin("propose_assistant_settings", "Prepare changing the Concierge itself: on/off per audience, monthly limit, name, tone, model, backup model, where hand-offs go, or ADD a note to its knowledge (never replaces what's there).", obj({
    enabled_public: bool("Visitors"), enabled_members: bool("Members"), enabled_staff: bool("Staff"), monthly_cap: num("Monthly limit in dollars (0 = none)"),
    name: str("Display name"), tone: str("Replace the tone notes"), add_knowledge_note: str("A note to ADD to its knowledge"), model: str("Model id"), fallback_model: str("Backup model id"), handoff_email: str("Where hand-offs go"),
  })),
  admin("propose_knowledge_page", "Prepare adding a web page (or sitemap.xml) for the Concierge to learn from, refreshing all pages, or removing one.", obj({ action: str("add | refresh | remove"), url: str("Page address (add/remove)") }, ["action"])),
  admin("propose_handoff_reply", "Prepare replying to a customer request that was handed to the team (emails them), and/or marking it resolved or reopening it.", obj({ request_id: str("Id from list_handed_to_team"), reply: str("Reply to email the customer (optional)"), resolve: bool("Mark resolved (default true when replying)"), reopen: bool("Reopen instead") }, ["request_id"])),
];

export const ADMIN_EXTRA_NAMES = new Set(ADMIN_EXTRA_DEFS.map((d) => d.function.name));

// ---------------------------------------------------------------- helpers

const s = (v: unknown, max = 500) => String(v ?? "").trim().slice(0, max);
const has = (a: Record<string, unknown>, k: string) => a[k] !== undefined && a[k] !== null;
const newId = () => `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const TZ = brand.timezone;
const fmt = (t: number) => new Date(t).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const fmtDay = (t: number) => new Date(t).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" });
const ref = (id: string) => id.slice(-6).toUpperCase();
const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i;
const READY = { proposed: true, say: "Ready — press the button on the card to confirm. Nothing has changed yet." };

/** "2026-10-05 18:00" (local) → epoch ms. */
function pacific(text: string): number | null {
  const m = text.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (!m) return null;
  const [y, mo, d, h, mi] = [+m[1], +m[2], +m[3], m[4] ? +m[4] : 9, m[5] ? +m[5] : 0];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(guess))
      .map((p) => [p.type, p.value])
  );
  const seen = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  const t = guess - (seen - guess);
  return Number.isFinite(t) ? t : null;
}

function findProduct(all: Product[], q: string): Product | null {
  const needle = q.trim().toLowerCase();
  if (!needle) return null;
  return all.find((p) => p.id === q.trim()) || all.find((p) => p.name.toLowerCase() === needle) || (() => {
    const hits = all.filter((p) => p.name.toLowerCase().includes(needle));
    return hits.length === 1 ? hits[0] : null;
  })();
}

function randomPassword(): string {
  const words = ["Ember", "Mountain", "Forest", "River", "Sage", "Cedar", "Pine", "Maple", "Quiet", "Sunlit", "Misty", "Dawn"];
  const nouns = ["Wolf", "Cabin", "Trail", "Stone", "Bloom", "Path", "Fern", "Acorn", "Brook", "Ridge", "Glade", "Heron"];
  return `${words[crypto.randomInt(words.length)]}${nouns[crypto.randomInt(nouns.length)]}-${crypto.randomInt(1000, 10000)}`;
}

const VIS_LABEL: Record<string, string> = { internal: "Members only", external: "Public shop only", both: "Both shops" };
const vis = (v: unknown) => (["internal", "external", "both"].includes(String(v)) ? (String(v) as "internal" | "external" | "both") : null);
const visOf = (p: Product) => p.visibility || (p.retail ? "both" : "internal");

function push(ctx: ToolContext, a: Omit<ActionProposal, "id">) {
  ctx.actions.push({ id: newId(), ...a });
}

// ---------------------------------------------------------------- runner

/** One Today-list item with its exact targets and step-by-step guide (also pre-loaded by the engine). */
export async function todayItemInfo(rawKey: string, monthCap: number): Promise<Record<string, unknown>> {
  const key = rawKey.trim().replace(/:$/, "");
  const { todaySuggestions } = await import("../todayBulletin");
  const { manager, marketing } = await todaySuggestions(monthCap);
  const all = [...manager, ...marketing];
  const it = all.find((x) => x.key === key) || all.find((x) => x.key.startsWith(key) || key.startsWith(x.key));
  if (!it) return { error: "That item isn't on today's list any more (it may already be handled). Say so briefly and offer to help another way." };
  const { notesForToday } = await import("./learnedNotes");
  const learned = await notesForToday(it.key);
  return {
    task: it.task,
    why: it.why,
    targets: it.targets,
    how: it.guide || "Prepare the cards the request describes.",
    ...(learned.length ? { learned_from_past_days: learned } : {}),
    rules:
      "Follow `how` exactly and prepare everything now, in this one reply. Where it says one draft for a group, make ONE draft with that segment — no individual notes. Skip any target a tool refuses and mention it in one line. Then reply in 1–3 short lines saying what's ready. Nothing is sent until staff confirm each card.",
  };
}

export async function runAdminExtra(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<Result | null> {
  if (!ADMIN_EXTRA_NAMES.has(name)) return null;
  if (ctx.audience !== "admin") return { error: "Not available." };

  switch (name) {
    // ================================================= look-ups
    case "list_events_admin": {
      const [events, regs] = await Promise.all([getEvents(), getRegistrations()]);
      const eid = s(args.event_id, 80);
      if (eid) {
        const e = events.find((x) => x.id === eid);
        if (!e) return { error: "No event with that id." };
        return {
          event: e.title,
          registrations: regs.filter((r) => r.eventId === eid).sort((a, b) => a.createdAt - b.createdAt).map((r) => ({ id: r.id, name: r.name, email: r.email, status: r.status, signed_up: fmtDay(r.createdAt) })),
        };
      }
      const now = Date.now();
      return {
        events: events
          .filter((e) => args.include_past === true || (e.endDate || e.date) >= now - 86_400_000)
          .sort((a, b) => a.date - b.date)
          .slice(0, 40)
          .map((e) => ({
            id: e.id, title: e.title, when: fmt(e.date), where: e.location, price: e.price, type: e.type,
            status: e.published ? "published" : "draft",
            capacity: e.capacity || "unlimited",
            registered: regs.filter((r) => r.eventId === e.id && r.status === "registered").length,
            waitlisted: regs.filter((r) => r.eventId === e.id && r.status === "waitlisted").length,
          })),
      };
    }
    case "list_mix_bundles": {
      const [bundles, products, orders] = await Promise.all([listBundles(), getProducts(), getOrders()]);
      const name = new Map(products.map((p) => [p.id, p.name]));
      const on = (await getFlags()).bundles_specific_products;
      return {
        feature_switch: on ? "on — bundles price carts" : "OFF — bundles are saved but not applied (propose_feature_switch bundles_specific_products)",
        bundles: bundles.map((b) => ({
          id: b.id, name: b.name, deal: bundleOfferLabel(b),
          products: b.items.map((i) => `${i.qty > 1 ? `${i.qty}× ` : ""}${name.get(i.productId) || "deleted product"}`),
          active: b.active, starts: b.startsAt ? fmt(b.startsAt) : undefined, ends: b.endsAt ? fmt(b.endsAt) : undefined,
          orders: orders.filter((o) => o.bundles?.some((x) => x.id === b.id) && o.status !== "cancelled").length,
        })),
      };
    }
    case "list_campaigns": {
      const rows = await listCampaigns();
      return {
        campaigns: rows.slice(0, 20).map((c) => ({
          id: c.id, subject: c.subject, audience: c.audience, status: c.status,
          when: fmt(c.scheduledFor), sent: c.sent, failed: c.failed || undefined,
        })),
      };
    }
    case "find_subscribers": {
      const q = s(args.query, 100).toLowerCase();
      const subs = (await getSubscribers()).filter((x) => !q || x.email.toLowerCase().includes(q) || (x.name || "").toLowerCase().includes(q));
      return {
        total_matches: subs.length,
        subscribers: subs.slice(0, 20).map((x) => ({ id: x.id, email: x.email, name: x.name, status: x.unsubscribedAt ? "unsubscribed" : "subscribed", since: fmtDay(x.subscribedAt), source: x.source })),
      };
    }
    case "list_templates": {
      const t = await listTemplates();
      const want = s(args.template_id, 120).toLowerCase();
      if (want) {
        const one = t.find((x) => x.id.toLowerCase() === want || x.name.toLowerCase() === want);
        if (!one) return { error: `No template called ${want}. Call list_templates without template_id to see them.` };
        return { template: { id: one.id, name: one.name, category: one.category, subject: one.subject, body: one.body } };
      }
      return { templates: t.slice(0, 60).map((x) => ({ id: x.id, name: x.name, category: x.category, archived: !!x.archived || undefined, starter: x.id.startsWith("starter_") || undefined })) };
    }
    case "list_handed_to_team": {
      const want = s(args.status, 10) || "open";
      const rows = (await recentEscalations()).filter((e) => want === "any" || escalationStatus(e) === want);
      return {
        requests: rows.slice(0, 20).map((e) => ({ id: e.id, when: fmt(e.at), name: e.name, email: e.email, topic: e.topic, status: escalationStatus(e), summary: e.summary.slice(0, 300), replies: e.replies?.length || 0 })),
      };
    }
    case "get_admin_settings": {
      const [flags, staff, rem, st, sources] = await Promise.all([getFlags({ fresh: true }), getAdmins(), getReminderSettings(), getSettings(), listSources(true)]);
      const c = ctx.config;
      return {
        feature_switches: FLAG_KEYS.map((k) => ({ key: k, label: FLAGS[k].label, on: flags[k] })),
        staff_sign_in_list: staff.map((a) => `${a.name} <${a.email}>`),
        payment_reminders: { reminders: rem.stages.map((x, i) => ({ number: i + 1, after_hours: x.afterHours, subject: x.subject })), expire_after_hours: rem.expireAfterHours },
        loyalty: { enabled: st.loyaltyEnabled, points_per_dollar: st.pointsPerDollar, points_per_dollar_redeemed: st.pointsPerDollarRedeemed, min_points_to_redeem: st.minPointsToRedeem },
        assistant: {
          name: c.assistantName, visitors: c.enabledPublic, members: c.enabledMembers, staff: c.enabledStaff, monthly_cap: c.monthlyCapUsd,
          model: c.model, fallback_model: c.fallbackModel, handoff_email: c.escalationEmail || "(site default)", knowledge_chars: c.knowledge.length, tone: c.persona.slice(0, 300),
        },
        web_pages: sources.map((x) => ({ url: x.url, title: x.title, ok: x.ok })),
      };
    }
    case "get_export_links": {
      return {
        say: "Give these as markdown links; they download in the dashboard's browser.",
        links: {
          orders: "/api/admin/orders/export",
          members: "/api/admin/users/export",
          subscribers: "/api/admin/subscribers/export",
          revenue: "/api/admin/revenue/export",
          inquiries_legacy: "/api/admin/inquiries/export",
        },
      };
    }

    // ================================================= members
    case "propose_create_member": {
      const name = s(args.name, 100);
      const email = s(args.email, 200).toLowerCase();
      if (!name || !EMAIL.test(email)) return { error: "Need a name and a valid email." };
      if ((await getUsers()).some((u) => u.email.toLowerCase() === email)) return { error: "There's already an account with that email. Use find_members." };
      const subscribe = args.subscribe !== false;
      push(ctx, {
        kind: "member_create",
        title: `Create member: ${name}`,
        lines: [email, "Approved straight away", "A random password is emailed to them (change it after signing in)", subscribe ? "Added to the mailing list" : "Not added to the mailing list"],
        confirmLabel: "Create account",
        busyLabel: "Creating…",
        request: { method: "POST", url: "/api/admin/users", body: { name, email, password: randomPassword(), sendEmail: true, subscribe } },
        refresh: ["users", "subscribers"],
      });
      return READY;
    }
    case "propose_delete_member": {
      const u = (await getUsers()).find((x) => x.id === s(args.member_id, 80));
      if (!u) return { error: "No member with that id. Use find_members." };
      const orders = (await getOrders()).filter((o) => o.userId === u.id);
      push(ctx, {
        kind: "member_delete",
        title: `Delete ${u.name}'s account`,
        lines: [u.email, `Status: ${u.status}`, `${orders.length} order${orders.length === 1 ? "" : "s"} stay in Orders`, u.loyaltyPoints ? `${u.loyaltyPoints} loyalty points are lost` : "", "This can't be undone"].filter(Boolean),
        confirmLabel: "Delete account",
        busyLabel: "Deleting…",
        danger: true,
        request: { method: "DELETE", url: `/api/admin/users?id=${encodeURIComponent(u.id)}`, body: undefined },
        refresh: ["users"],
      });
      return READY;
    }
    case "propose_member_name": {
      const u = (await getUsers()).find((x) => x.id === s(args.member_id, 80));
      const name = s(args.name, 100);
      if (!u) return { error: "No member with that id." };
      if (!name) return { error: "Give the new name." };
      if (name === u.name) return { note: "That's already their name." };
      push(ctx, {
        kind: "member_profile",
        title: `Rename member`,
        lines: [`${u.name} → ${name}`, u.email],
        confirmLabel: "Save name",
        request: { method: "PATCH", url: "/api/admin/users/profile", body: { id: u.id, name } },
        refresh: ["users"],
      });
      return READY;
    }
    case "propose_member_address": {
      const u = (await getUsers()).find((x) => x.id === s(args.member_id, 80));
      if (!u) return { error: "No member with that id. Use find_members." };
      const map: Array<[string, "addressLine1" | "addressLine2" | "city" | "state" | "postalCode" | "phone"]> = [
        ["address_line1", "addressLine1"], ["address_line2", "addressLine2"], ["city", "city"], ["state", "state"], ["postal_code", "postalCode"], ["phone", "phone"],
      ];
      const address: Record<string, string> = {};
      for (const [arg, field] of map) if (typeof args[arg] === "string") address[field] = String(args[arg]).replace(/\s+/g, " ").trim().slice(0, 120);
      const changed = Object.entries(address).filter(([k, v]) => v !== ((u as unknown as Record<string, string | undefined>)[k] || ""));
      if (!changed.length) return { note: "That's already what's on file — nothing to change." };
      const fmt = (a: Record<string, string | undefined>) => [a.addressLine1, a.addressLine2, a.city, a.state, a.postalCode].filter(Boolean).join(", ") || "(none)";
      const next = { ...u, ...address } as unknown as Record<string, string | undefined>;
      const lines = [`${u.name} · ${u.email}`];
      if (changed.some(([k]) => k !== "phone")) lines.push(`Address: ${fmt(u as unknown as Record<string, string | undefined>)} → ${fmt(next)}`);
      if (changed.some(([k]) => k === "phone")) lines.push(`Phone: ${u.phone || "(none)"} → ${next.phone || "(none)"}`);
      lines.push("Orders already placed keep their address.");
      push(ctx, {
        kind: "member_profile",
        title: `Update ${u.name.split(/\s+/)[0]}'s address`,
        lines,
        confirmLabel: "Save address",
        request: { method: "PATCH", url: "/api/admin/users/profile", body: { id: u.id, address } },
        refresh: ["users"],
      });
      return READY;
    }
    case "propose_member_password_reset": {
      const u = (await getUsers()).find((x) => x.id === s(args.member_id, 80));
      if (!u) return { error: "No member with that id." };
      push(ctx, {
        kind: "member_password",
        title: `Email ${u.name} a new password`,
        lines: [u.email, "Their old password stops working", "A random new password is emailed to them — nobody else sees it"],
        confirmLabel: "Reset & email",
        busyLabel: "Sending…",
        request: { method: "POST", url: "/api/admin/users/password", body: { id: u.id, newPassword: randomPassword(), sendEmail: true } },
        refresh: ["users"],
      });
      return READY;
    }

    // ================================================= orders
    case "propose_manual_invoice": {
      const u = (await getUsers()).find((x) => x.id === s(args.member_id, 80));
      if (!u) return { error: "No member with that id. Use find_members." };
      const products = await getProducts();
      const raw = Array.isArray(args.items) ? (args.items as Array<Record<string, unknown>>) : [];
      const items: Array<{ productId: string; quantity: number; p: Product }> = [];
      for (const it of raw.slice(0, 30)) {
        const p = findProduct(products, s(it?.product, 120));
        if (!p) return { error: `Couldn't find "${s(it?.product, 60)}". Use list_products for exact names or ids.` };
        items.push({ productId: p.id, quantity: Math.max(1, Math.min(999, Math.floor(Number(it?.quantity) || 1))), p });
      }
      if (items.length === 0) return { error: "Add at least one product." };
      const shipping = has(args, "shipping") ? Math.max(0, Math.round(Number(args.shipping) * 100) / 100) : 10;
      const subtotal = items.reduce((n, i) => n + parsePrice(effectivePrice(i.p)) * i.quantity, 0);
      const promo = items.reduce((n, i) => n + lineDiscount(i.p, i.quantity), 0);
      const note = s(args.note, 1000);
      push(ctx, {
        kind: "manual_invoice",
        title: `Invoice ${u.name}`,
        lines: [
          u.email,
          ...items.map((i) => `${i.p.name} ×${i.quantity} · ${effectivePrice(i.p)}`),
          `About ${formatMoney(Math.max(0, subtotal - promo) + shipping)} incl. ${shipping ? formatMoney(shipping) + " shipping" : "no shipping"}${promo ? ` and ${formatMoney(promo)} promo savings` : ""}`,
          "Creates a pending order and emails the invoice with the pay link",
        ],
        preview: note || undefined,
        confirmLabel: "Create & send invoice",
        busyLabel: "Sending…",
        request: { method: "POST", url: "/api/admin/send-invoice", body: { userId: u.id, items: items.map(({ productId, quantity }) => ({ id: productId, quantity })), note: note || undefined, shippingOverride: shipping } },
        refresh: ["orders"],
      });
      return READY;
    }
    case "propose_shipping_label": {
      const o = (await getOrders()).find((x) => x.id === s(args.order_id, 80));
      if (!o) return { error: "No order with that id. Use find_orders." };
      if (o.shippingMethod === "pickup") return { error: `Order ${ref(o.id)} is local pickup — no label needed.` };
      // Weight: what staff said, else the products' shipping weights + box, else 8 oz with a warning.
      const [allProducts, st] = await Promise.all([getProducts(), getSettings()]);
      const calc = orderWeight(o.items || [], allProducts, packagingOzOf(st.packagingOz));
      const given = Number(args.weight_oz) > 0 ? Math.min(1120, Math.round(Number(args.weight_oz) * 10) / 10) : undefined;
      const weight = given ?? calc.oz ?? 8;
      const weightLine = given
        ? `${weight} oz (as you said)`
        : calc.oz !== null
          ? `${weight} oz, from product weights: ${calc.parts.join(" + ")}`
          : `⚠ ${weight} oz GUESSED — no shipping weight set for ${calc.missing.join(", ")} (Products → Shipping weights)`;
      const service = s(args.service, 60) || "usps_ground_advantage";
      const a = o.shippingAddress;
      push(ctx, {
        kind: "shipping_label",
        title: `Buy a shipping label for ${ref(o.id)}`,
        lines: [
          `${o.userName} · ${a ? `${a.addressLine1}, ${a.city}, ${a.state} ${a.postalCode}` : "address from their profile"}`,
          weightLine,
          service.replace(/_/g, " "),
          "Charges postage to the Shippo account",
          o.labelUrl ? "⚠ This order ALREADY has a label — this buys a second one" : "",
        ].filter(Boolean),
        confirmLabel: "Buy label",
        busyLabel: "Buying…",
        danger: true,
        // The card already warns about an existing label, so confirming it means "buy anyway".
        request: { method: "POST", url: "/api/admin/orders/shipping-label", body: { orderId: o.id, weightOz: weight, serviceToken: service, ...(o.labelUrl ? { force: true } : {}) } },
        refresh: ["orders"],
      });
      return READY;
    }
    case "propose_product_weights": {
      const list = Array.isArray(args.weights) ? (args.weights as Array<Record<string, unknown>>).slice(0, 200) : [];
      const products = await getProducts();
      const weights: Record<string, number> = {};
      const lines: string[] = [];
      const unknown: string[] = [];
      for (const w of list) {
        const want = s(w.product, 120).toLowerCase();
        const p = products.find((x) => x.id.toLowerCase() === want || x.name.toLowerCase() === want);
        if (!p) {
          unknown.push(s(w.product, 60));
          continue;
        }
        const oz = cleanWeightOz(w.oz) ?? 0;
        weights[p.id] = oz;
        lines.push(`${p.name}: ${p.weightOz ? `${p.weightOz} → ` : ""}${oz ? `${oz} oz` : "cleared"}`);
      }
      const pack = args.packaging_oz !== undefined && Number.isFinite(Number(args.packaging_oz)) ? Math.max(0, Math.min(320, Number(args.packaging_oz))) : undefined;
      if (!lines.length && pack === undefined) return { error: unknown.length ? `No products match: ${unknown.join(", ")}. Use list_products.` : "Say which products and how many ounces." };
      if (lines.length) {
        push(ctx, {
          kind: "product_edit",
          title: `Set shipping weight on ${lines.length} product${lines.length === 1 ? "" : "s"}`,
          lines: lines.slice(0, 20),
          confirmLabel: "Save weights",
          request: { method: "PATCH", url: "/api/admin/products", body: { weights } },
          refresh: ["products"],
        });
      }
      if (pack !== undefined) {
        push(ctx, {
          kind: "settings",
          title: `Box & packing: ${pack} oz added to every parcel`,
          lines: ["Used when a shipping label's weight is worked out from the products"],
          confirmLabel: "Save",
          request: { method: "POST", url: "/api/admin/settings", body: { partial: true, packagingOz: pack } },
          refresh: ["settings"],
        });
      }
      return { ...READY, ...(unknown.length ? { not_found: unknown } : {}) };
    }
    case "propose_reminder_action": {
      const act = s(args.action, 10);
      if (!["expire", "revive", "stop", "resume"].includes(act)) return { error: "action must be expire, revive, stop or resume." };
      const o = (await getOrders()).find((x) => x.id === s(args.order_id, 80));
      if (!o) return { error: "No order with that id." };
      if (act === "revive" && !o.expiredAt) return { note: `Order ${ref(o.id)} isn't in Expired.` };
      if (act === "expire" && (o.status !== "pending" || o.isInquiry)) return { error: `Order ${ref(o.id)} isn't unpaid, so it can't move to Expired.` };
      if (act === "expire" && o.expiredAt) return { note: `Order ${ref(o.id)} is already in Expired.` };
      push(ctx, {
        kind: "reminders",
        title: act === "expire" ? `Move order ${ref(o.id)} to Expired` : act === "revive" ? `Bring order ${ref(o.id)} back from Expired` : act === "stop" ? `Stop payment reminders for ${ref(o.id)}` : `Resume payment reminders for ${ref(o.id)}`,
        lines: [
          `${o.userName} · ${formatMoney(o.total)} · placed ${fmtDay(o.createdAt)}`,
          act === "expire" ? "Still unpaid and not cancelled — the pay link keeps working; no more automatic reminders" : act === "revive" ? "Back in Pending payment; automatic reminders stay off for it" : "",
        ].filter(Boolean),
        confirmLabel: act === "expire" ? "Move to Expired" : act === "revive" ? "Revive" : act === "stop" ? "Stop reminders" : "Resume reminders",
        request: { method: "POST", url: "/api/admin/reminders", body: { action: act, orderId: o.id } },
        refresh: ["orders"],
      });
      return READY;
    }
    case "propose_run_reminders": {
      const on = (await getFlags()).invoice_reminders;
      if (!on) return { error: "Automatic payment reminders are switched off. Offer propose_feature_switch invoice_reminders first." };
      push(ctx, {
        kind: "reminders",
        title: "Run payment reminders now",
        lines: ["Emails any unpaid invoices whose reminder is due", "Nobody gets the same reminder twice"],
        confirmLabel: "Run now",
        busyLabel: "Running…",
        request: { method: "POST", url: "/api/admin/reminders", body: { action: "run" } },
        refresh: ["orders"],
      });
      return READY;
    }

    // ================================================= products
    case "propose_create_product": {
      const name = s(args.name, 120);
      const description = s(args.description, 5000);
      const price = s(args.price, 30);
      const image = s(args.image_url, 500);
      if (!name || !description || !price) return { error: "Need a name, description and price." };
      if (!/^https:\/\//i.test(image)) return { error: "Need a photo link (https). They can upload the photo in Products, or paste a link." };
      const video = s(args.video_url, 500);
      if (video && !parseVideo(video)) return { error: "That video link can't be played. Use YouTube, Vimeo or an https .mp4 link." };
      const visibility = vis(args.visibility) || "internal";
      const sale = s(args.sale_price, 30);
      push(ctx, {
        kind: "product_create",
        title: `Add product: ${name}`,
        lines: [`${price}${sale ? ` · on sale ${sale}` : ""}`, VIS_LABEL[visibility], s(args.category, 60) ? `Category: ${s(args.category, 60)}` : "", video ? "With a video" : "", cleanWeightOz(args.weight_oz) ? `Shipping weight ${cleanWeightOz(args.weight_oz)} oz` : ""].filter(Boolean),
        preview: description.slice(0, 600),
        confirmLabel: "Add product",
        request: { method: "POST", url: "/api/admin/products", body: { name, description, price, salePrice: sale || undefined, image, video: video || undefined, category: s(args.category, 60) || undefined, visibility, weightOz: cleanWeightOz(args.weight_oz) } },
        refresh: ["products"],
      });
      return READY;
    }
    case "propose_edit_product": {
      const p = (await getProducts()).find((x) => x.id === s(args.product_id, 80));
      if (!p) return { error: "No product with that id. Use list_products." };
      const next = {
        name: has(args, "name") ? s(args.name, 120) || p.name : p.name,
        description: has(args, "description") ? s(args.description, 5000) || p.description : p.description,
        price: has(args, "price") ? s(args.price, 30) || p.price : p.price,
        salePrice: has(args, "sale_price") ? s(args.sale_price, 30) : p.salePrice || "",
        category: has(args, "category") ? s(args.category, 60) : p.category,
        image: has(args, "image_url") ? s(args.image_url, 500) : p.image,
        video: has(args, "video_url") ? s(args.video_url, 500) : p.video || "",
        visibility: vis(args.visibility) || visOf(p),
      };
      if (!/^https?:\/\//i.test(next.image)) return { error: "The photo must be a link (https)." };
      if (next.video && !parseVideo(next.video)) return { error: "That video link can't be played." };
      const diff: string[] = [];
      if (next.name !== p.name) diff.push(`Name: ${p.name} → ${next.name}`);
      if (next.price !== p.price) diff.push(`Price: ${p.price} → ${next.price}`);
      if ((next.salePrice || "") !== (p.salePrice || "")) diff.push(`Sale price: ${p.salePrice || "none"} → ${next.salePrice || "none"}`);
      if ((next.category || "") !== (p.category || "")) diff.push(`Category: ${p.category || "none"} → ${next.category || "none"}`);
      if (next.image !== p.image) diff.push("New photo");
      if ((next.video || "") !== (p.video || "")) diff.push(next.video ? "New video" : "Video removed");
      if (next.visibility !== visOf(p)) diff.push(`Where it sells: ${VIS_LABEL[visOf(p)]} → ${VIS_LABEL[next.visibility]}`);
      if (next.description !== p.description) diff.push("New description");
      const cashOnly = typeof args.cash_pickup_only === "boolean" ? args.cash_pickup_only : undefined;
      if (cashOnly !== undefined && cashOnly !== !!p.cashOnly) diff.push(cashOnly ? "Sale: cash pickup only (shipped and invoiced orders pay the regular price)" : "Sale: for everyone (not just cash pickup)");
      if (diff.length === 0) return { note: "Nothing would change." };
      push(ctx, {
        kind: "product_edit",
        title: `Edit ${p.name}`,
        lines: diff,
        preview: next.description !== p.description ? next.description.slice(0, 600) : undefined,
        confirmLabel: "Save changes",
        // Full product, as the dashboard's edit form sends it; promo and bundle contents are kept.
        request: {
          method: "PUT",
          url: "/api/admin/products",
          body: { id: p.id, ...next, salePrice: next.salePrice || undefined, video: next.video, promo: p.promo, isBundle: !!p.isBundle, ...(cashOnly !== undefined ? { cashOnly } : {}) },
        },
        refresh: ["products"],
      });
      return READY;
    }
    case "propose_delete_product": {
      const p = (await getProducts()).find((x) => x.id === s(args.product_id, 80));
      if (!p) return { error: "No product with that id." };
      const inBundles = (await listBundles()).filter((b) => b.items.some((i) => i.productId === p.id));
      push(ctx, {
        kind: "product_delete",
        title: `Delete ${p.name}`,
        lines: [`${effectivePrice(p)} · ${VIS_LABEL[visOf(p)]}`, "Past orders keep their line items", inBundles.length ? `⚠ Part of ${inBundles.length} mix & match bundle${inBundles.length === 1 ? "" : "s"} (${inBundles.map((b) => b.name).join(", ")}) — they stop applying` : "", "This can't be undone"].filter(Boolean),
        confirmLabel: "Delete product",
        busyLabel: "Deleting…",
        danger: true,
        request: { method: "DELETE", url: `/api/admin/products?id=${encodeURIComponent(p.id)}`, body: undefined },
        refresh: ["products"],
      });
      return READY;
    }
    case "propose_move_product": {
      const p = (await getProducts()).find((x) => x.id === s(args.product_id, 80));
      const dir = s(args.direction, 5);
      if (!p) return { error: "No product with that id." };
      if (dir !== "up" && dir !== "down") return { error: "direction must be up or down." };
      push(ctx, {
        kind: "product_move",
        title: `Move ${p.name} ${dir}`,
        lines: ["One place in the shop order"],
        confirmLabel: `Move ${dir}`,
        request: { method: "PATCH", url: "/api/admin/products", body: { id: p.id, direction: dir } },
        refresh: ["products"],
      });
      return READY;
    }

    // ================================================= events
    case "propose_create_event": {
      const title = s(args.title, 150);
      const location = s(args.location, 200);
      const start = pacific(s(args.start, 20));
      if (!title || !location) return { error: "Need a title and a location." };
      if (!start) return { error: "start must look like 2026-10-05 18:00 (local)." };
      const end = s(args.end, 20) ? pacific(s(args.end, 20)) : null;
      if (s(args.end, 20) && (!end || end <= start)) return { error: "end must be after the start, like 2026-10-05 20:00." };
      const image = s(args.image_url, 500);
      if (image && !/^https:\/\//i.test(image)) return { error: "The photo must be an https link." };
      const type = ["class", "workshop", "vendor", "other"].includes(s(args.type, 10)) ? s(args.type, 10) : "class";
      const published = args.published === true;
      const capacity = Math.max(0, Math.floor(Number(args.capacity) || 0));
      const waitlist = Math.max(0, Math.floor(Number(args.waitlist) || 0));
      push(ctx, {
        kind: "event_create",
        title: `New event: ${title}`,
        lines: [`${fmt(start)}${end ? ` – ${fmt(end)}` : ""}`, location, `${s(args.price, 30) || "No price shown"} · ${type} · ${capacity ? `${capacity} spots` : "unlimited spots"}${capacity && waitlist ? `, waitlist ${waitlist}` : ""}`, published ? "Published — shows on /events right away" : "Saved as a draft (not shown on /events yet)"],
        preview: s(args.description, 3000) || undefined,
        confirmLabel: published ? "Create & publish" : "Create draft",
        request: { method: "POST", url: "/api/admin/events", body: { title, description: s(args.description, 3000), date: start, endDate: end || undefined, location, price: s(args.price, 30) || undefined, capacity, waitlistCapacity: waitlist, type, image: image || undefined, published } },
        refresh: ["events"],
      });
      return READY;
    }
    case "propose_edit_event": {
      const e = (await getEvents()).find((x) => x.id === s(args.event_id, 80));
      if (!e) return { error: "No event with that id. Use list_events_admin." };
      const body: Record<string, unknown> = { id: e.id };
      const lines: string[] = [];
      if (has(args, "title") && s(args.title, 150) && s(args.title, 150) !== e.title) { body.title = s(args.title, 150); lines.push(`Title → ${body.title}`); }
      if (has(args, "description")) { body.description = s(args.description, 3000); lines.push("New description"); }
      if (has(args, "start")) {
        const t = pacific(s(args.start, 20));
        if (!t) return { error: "start must look like 2026-10-05 18:00." };
        body.date = t;
        lines.push(`Starts ${fmt(e.date)} → ${fmt(t)}`);
      }
      if (has(args, "end") && s(args.end, 20)) {
        const t = pacific(s(args.end, 20));
        if (!t) return { error: "end must look like 2026-10-05 20:00." };
        body.endDate = t;
        lines.push(`Ends ${fmt(t)}`);
      }
      if (has(args, "location") && s(args.location, 200)) { body.location = s(args.location, 200); lines.push(`Location → ${body.location}`); }
      if (has(args, "price")) { body.price = s(args.price, 30); lines.push(`Price → ${body.price || "none shown"}`); }
      if (has(args, "capacity")) { body.capacity = Math.max(0, Math.floor(Number(args.capacity) || 0)); lines.push(`Spots → ${body.capacity || "unlimited"}`); }
      if (has(args, "waitlist")) { body.waitlistCapacity = Math.max(0, Math.floor(Number(args.waitlist) || 0)); lines.push(`Waitlist → ${body.waitlistCapacity || "unlimited"}`); }
      if (has(args, "type") && ["class", "workshop", "vendor", "other"].includes(s(args.type, 10))) { body.type = s(args.type, 10); lines.push(`Type → ${body.type}`); }
      if (has(args, "image_url")) {
        const im = s(args.image_url, 500);
        if (im && !/^https:\/\//i.test(im)) return { error: "The photo must be an https link." };
        body.image = im;
        lines.push(im ? "New photo" : "Photo removed");
      }
      if (typeof args.published === "boolean" && args.published !== e.published) { body.published = args.published; lines.push(args.published ? "Publish — shows on /events" : "Unpublish — hidden from /events"); }
      if (lines.length === 0) return { note: "Nothing would change." };
      push(ctx, {
        kind: "event_edit",
        title: `Update ${e.title}`,
        lines,
        confirmLabel: "Save",
        request: { method: "PATCH", url: "/api/admin/events", body },
        refresh: ["events"],
      });
      return READY;
    }
    case "propose_delete_event": {
      const e = (await getEvents()).find((x) => x.id === s(args.event_id, 80));
      if (!e) return { error: "No event with that id." };
      const regs = (await getRegistrations()).filter((r) => r.eventId === e.id && r.status !== "cancelled");
      push(ctx, {
        kind: "event_delete",
        title: `Delete ${e.title}`,
        lines: [fmt(e.date), regs.length ? `⚠ ${regs.length} people are signed up — they are NOT emailed; tell them yourself` : "Nobody is signed up", "This can't be undone"],
        confirmLabel: "Delete event",
        busyLabel: "Deleting…",
        danger: true,
        request: { method: "DELETE", url: `/api/admin/events?id=${encodeURIComponent(e.id)}`, body: undefined },
        refresh: ["events"],
      });
      return READY;
    }
    case "propose_registration_action": {
      const act = s(args.action, 10);
      if (act !== "cancel" && act !== "promote") return { error: "action must be cancel or promote." };
      const [regs, events] = await Promise.all([getRegistrations(), getEvents()]);
      const r = regs.find((x) => x.id === s(args.registration_id, 80));
      if (!r) return { error: "No registration with that id. Use list_events_admin with event_id." };
      if (act === "promote" && r.status !== "waitlisted") return { note: `${r.name} isn't on the waitlist (${r.status}).` };
      if (act === "cancel" && r.status === "cancelled") return { note: "Already cancelled." };
      const e = events.find((x) => x.id === r.eventId);
      push(ctx, {
        kind: "registration",
        title: act === "cancel" ? `Cancel ${r.name}'s spot` : `Move ${r.name} off the waitlist`,
        lines: [`${e?.title || "Event"} · ${e ? fmt(e.date) : ""}`, r.email, act === "cancel" && r.status === "registered" ? "The first person on the waitlist moves in and is emailed" : ""].filter(Boolean),
        confirmLabel: act === "cancel" ? "Cancel registration" : "Promote",
        danger: act === "cancel",
        request: { method: "PATCH", url: "/api/admin/events", body: { registrationId: r.id, action: act } },
        refresh: ["events"],
      });
      return READY;
    }

    // ================================================= discounts & bundles
    case "propose_discount_toggle":
    case "propose_delete_discount": {
      const q = s(args.code, 60);
      const all = await getDiscounts();
      const d = all.find((x) => x.id === q) || all.find((x) => x.code === normalizeCode(q));
      if (!d) return { error: "No discount code like that. Use list_discount_codes." };
      const desc = `${d.type === "percentage" ? `${d.value}% off` : `${formatMoney(d.value)} off`} · used ${d.uses}×${d.expiresAt ? ` · expires ${fmtDay(d.expiresAt)}` : ""}`;
      if (name === "propose_discount_toggle") {
        const active = args.active === true;
        if (d.active === active) return { note: `${d.code} is already ${active ? "on" : "off"}.` };
        push(ctx, {
          kind: "discount_update",
          title: `${active ? "Switch on" : "Switch off"} code ${d.code}`,
          lines: [desc],
          confirmLabel: active ? "Switch on" : "Switch off",
          request: { method: "PATCH", url: "/api/admin/discounts", body: { id: d.id, active } },
          refresh: ["discounts"],
        });
      } else {
        push(ctx, {
          kind: "discount_delete",
          title: `Delete code ${d.code}`,
          lines: [desc, "Past orders keep their discount", "This can't be undone — switching it off is reversible"],
          confirmLabel: "Delete code",
          danger: true,
          request: { method: "DELETE", url: `/api/admin/discounts?id=${encodeURIComponent(d.id)}`, body: undefined },
          refresh: ["discounts"],
        });
      }
      return READY;
    }
    case "propose_mix_bundle":
    case "propose_mix_bundle_update": {
      const products = await getProducts();
      const isNew = name === "propose_mix_bundle";
      const current = isNew ? null : (await listBundles()).find((b) => b.id === s(args.bundle_id, 80));
      if (!isNew && !current) return { error: "No bundle with that id. Use list_mix_bundles." };
      // Pause/resume only
      const onlyActive = !isNew && ["name", "products", "type", "value", "starts", "ends"].every((k) => !has(args, k)) && typeof args.active === "boolean";
      if (onlyActive && current) {
        if (current.active === args.active) return { note: `${current.name} is already ${current.active ? "running" : "paused"}.` };
        push(ctx, {
          kind: "mix_bundle",
          title: `${args.active ? "Resume" : "Pause"} bundle ${current.name}`,
          lines: [bundleOfferLabel(current)],
          confirmLabel: args.active ? "Resume" : "Pause",
          request: { method: "PATCH", url: "/api/admin/bundles", body: { id: current.id, active: args.active } },
          refresh: ["bundles"],
        });
        return READY;
      }
      let items = current?.items || [];
      if (has(args, "products")) {
        items = [];
        for (const it of (Array.isArray(args.products) ? args.products : []).slice(0, 12) as Array<Record<string, unknown>>) {
          const p = findProduct(products, s(it?.product, 120));
          if (!p) return { error: `Couldn't find "${s(it?.product, 60)}". Use list_products.` };
          items.push({ productId: p.id, qty: Math.max(1, Math.min(20, Math.floor(Number(it?.qty) || 1))) });
        }
      }
      const type = has(args, "type") ? (s(args.type, 10) === "price" ? "price" : "percent") : current?.type || "percent";
      const value = has(args, "value") ? Number(args.value) : current?.value;
      const when = (k: string, cur?: number) => (has(args, k) ? (s(args[k], 20) ? pacific(s(args[k], 20)) : undefined) : cur);
      const startsAt = when("starts", current?.startsAt);
      const endsAt = when("ends", current?.endsAt);
      if (startsAt === null || endsAt === null) return { error: "Dates must look like 2026-10-01 09:00." };
      const body = { ...(current ? { id: current.id } : {}), name: s(args.name, 80) || current?.name || "", items, type, value, startsAt, endsAt, active: typeof args.active === "boolean" ? args.active : current ? current.active : true };
      if (!body.name) return { error: "Give the bundle a name." };
      if (items.reduce((n, i) => n + i.qty, 0) < 2) return { error: "A bundle needs at least 2 items." };
      const unit = new Map(products.map((p) => [p.id, parsePrice(effectivePrice(p))]));
      const prev = setSavings({ type, value: Number(value) || 0, items } as never, (id) => unit.get(id) ?? 0);
      const pname = new Map(products.map((p) => [p.id, p.name]));
      const flagOn = (await getFlags()).bundles_specific_products;
      push(ctx, {
        kind: "mix_bundle",
        title: `${isNew ? "New" : "Update"} bundle: ${body.name}`,
        lines: [
          ...items.map((i) => `${i.qty > 1 ? `${i.qty}× ` : ""}${pname.get(i.productId)}`),
          `${bundleOfferLabel({ type, value: Number(value) || 0 })} · one set ${formatMoney(prev.cost)} → ${formatMoney(prev.cost - prev.savings)}${prev.savings <= 0 ? " (no saving at today's prices!)" : ""}`,
          startsAt || endsAt ? `${startsAt ? `From ${fmt(startsAt)}` : ""}${startsAt && endsAt ? " · " : ""}${endsAt ? `until ${fmt(endsAt)}` : ""}` : "",
          body.active ? "" : "Paused",
          flagOn ? "" : "Bundles are switched OFF — it won't apply until the switch is on",
        ].filter(Boolean),
        confirmLabel: isNew ? "Create bundle" : "Save bundle",
        request: { method: isNew ? "POST" : "PATCH", url: "/api/admin/bundles", body },
        refresh: ["bundles"],
      });
      return READY;
    }
    case "propose_delete_mix_bundle": {
      const b = (await listBundles()).find((x) => x.id === s(args.bundle_id, 80));
      if (!b) return { error: "No bundle with that id." };
      push(ctx, {
        kind: "mix_bundle",
        title: `Delete bundle ${b.name}`,
        lines: [bundleOfferLabel(b), "Past orders keep their savings", "Pausing is reversible; deleting isn't"],
        confirmLabel: "Delete bundle",
        danger: true,
        request: { method: "DELETE", url: `/api/admin/bundles?id=${encodeURIComponent(b.id)}`, body: undefined },
        refresh: ["bundles"],
      });
      return READY;
    }

    // ================================================= marketing
    case "product_links": {
      const want = (Array.isArray(args.products) ? args.products : [args.products]).map((x) => s(x, 120).toLowerCase()).filter(Boolean).slice(0, 12);
      const all = await getProducts();
      const site = brand.siteUrl;
      const found = want.map((w) => all.find((p) => p.id.toLowerCase() === w) || all.find((p) => p.name.toLowerCase() === w) || all.find((p) => p.name.toLowerCase().includes(w)));
      const missing = want.filter((_, i) => !found[i]);
      const seen = new Set<string>();
      const links = found
        .filter((p): p is Product => !!p && !seen.has(p.id) && !!seen.add(p.id))
        .map((p) => ({
          name: p.name,
          sells_in: p.visibility === "external" ? "public shop" : p.visibility === "both" ? "public shop + members' gallery" : p.retail ? "public shop + members' gallery" : "members' gallery only (sign-in needed)",
          link: `${site}/p/${encodeURIComponent(p.id)}`,
          qr_png: `${site}/api/qr/product/${encodeURIComponent(p.id)}`,
          qr_png_print: `${site}/api/qr/product/${encodeURIComponent(p.id)}?size=l`,
        }));
      return {
        links,
        ...(missing.length ? { not_found: missing } : {}),
        how_to_use:
          "Links: markdown [Product name](link). In campaign drafts, a line with just [Shop Product name](link) becomes a button. QR: put ![QR code for Product name](qr_png) on its own line (shows in chat and in emails); qr_png_print is a large version for flyers. For social posts give the plain link. Members-only products need sign-in, so prefer public ones for social posts.",
      };
    }
    case "today_item":
      return todayItemInfo(s(args.key, 120), ctx.config.monthlyCapUsd);
    case "find_customer_group": {
      const g = await resolveSegment(s(args.segment, 40), { days: Number(args.segment_days), limit: Number(args.segment_limit), product: s(args.segment_product, 120) });
      if ("error" in g) return g;
      const reach = await recipientsFor("custom", g.emails);
      return {
        group: g.label,
        people_in_group: g.emails.length,
        will_receive: reach.length,
        examples: g.names,
        note: reach.length < g.emails.length ? "Campaigns reach mailing-list subscribers and members (members get them unless they've unsubscribed); non-member customers only if they're subscribed. Anyone who unsubscribed is always skipped. For the rest, personal notes (propose_member_message / propose_order_message) are the way." : undefined,
      };
    }
    case "propose_campaign": {
      const subject = s(args.subject, 200);
      const body = s(args.body, 50_000);
      if (!subject || !body) return { error: "Need a subject and a body." };
      let audience = (["subscribers", "all", "members", "nonmembers", "custom"].includes(s(args.audience, 12)) ? s(args.audience, 12) : "subscribers") as "subscribers" | "all" | "members" | "nonmembers" | "custom";
      let customList = s(args.custom_list, 20_000);
      let groupLabel = "";
      let groupSize = 0;
      if (s(args.segment, 40)) {
        const g = await resolveSegment(s(args.segment, 40), { days: Number(args.segment_days), limit: Number(args.segment_limit), product: s(args.segment_product, 120) });
        if ("error" in g) return g;
        if (g.emails.length === 0) return { error: `Nobody is in the group "${g.label}" right now.` };
        audience = "custom";
        customList = g.emails.join(",");
        groupLabel = g.label;
        groupSize = g.emails.length;
      }
      if (audience === "custom" && !customList) return { error: "Give the list of emails for a custom send." };
      const recipients = await recipientsFor(audience, audience === "custom" ? customList.split(/[\s,;]+/).filter((e) => /@/.test(e)) : undefined);
      if (recipients.length === 0)
        return { error: groupLabel ? `None of the ${groupSize} ${groupLabel} can get campaigns (they've unsubscribed, or they aren't members or subscribers). Personal notes are the way to reach them.` : "Nobody on the mailing list matches that audience." };
      let when = 0;
      if (s(args.send_at, 20)) {
        const t = pacific(s(args.send_at, 20));
        if (!t) return { error: "send_at must look like 2026-10-05 10:00 (local)." };
        if (t < Date.now() - 60_000) return { error: "That time has passed." };
        when = t;
      }
      const aud = groupLabel
        ? `${groupLabel} (${groupSize} in the group; anyone who unsubscribed is skipped)`
        : { subscribers: "mailing-list subscribers", all: "everyone on the mailing list and all members", members: "members", nonmembers: "non-member subscribers", custom: "the pasted list (subscribers and members only)" }[audience];
      push(ctx, {
        kind: "campaign_send",
        title: when ? `Schedule "${subject}"` : `Send "${subject}" now`,
        lines: [
          `To ${aud}: ${recipients.length} people`,
          when ? `Sends ${fmt(when)} (local)${inWindow(when) ? "" : " — outside 9am–6pm, so it waits for 9am"}` : inWindow() ? "Starts sending right away" : "Outside 9am–6pm local — it waits until 9am",
          "Unsubscribe link and your footer are added automatically",
          when ? "You can cancel it from Marketing → Campaigns before it sends" : "",
        ].filter(Boolean),
        preview: body.slice(0, 1500),
        confirmLabel: when ? "Schedule" : `Send to ${recipients.length}`,
        busyLabel: when ? "Scheduling…" : "Sending…",
        danger: true,
        request: { method: "POST", url: "/api/admin/campaigns", body: { subject, body, audience, customList: audience === "custom" ? customList : undefined, scheduledFor: when || undefined } },
        refresh: ["campaigns"],
      });
      return READY;
    }
    case "propose_campaign_test": {
      const subject = s(args.subject, 200);
      const body = s(args.body, 50_000);
      if (!subject || !body) return { error: "Need a subject and a body." };
      push(ctx, {
        kind: "campaign_test",
        title: `Test send: ${subject}`,
        lines: [`To the team inbox (${process.env.INQUIRY_TO_EMAIL || "not set"}) only`],
        preview: body.slice(0, 1500),
        confirmLabel: "Send test",
        busyLabel: "Sending…",
        request: { method: "POST", url: "/api/admin/campaigns", body: { subject, body, testOnly: true } },
        refresh: [],
      });
      return READY;
    }
    case "propose_cancel_campaign": {
      const c = (await listCampaigns()).find((x) => x.id === s(args.campaign_id, 80));
      if (!c) return { error: "No campaign with that id. Use list_campaigns." };
      if (c.status !== "scheduled") return { note: `That campaign is ${c.status} — only scheduled ones can be cancelled.` };
      push(ctx, {
        kind: "campaign_cancel",
        title: `Cancel "${c.subject}"`,
        lines: [`Was going out ${fmt(c.scheduledFor)}`],
        confirmLabel: "Cancel campaign",
        request: { method: "PATCH", url: "/api/admin/campaigns", body: { action: "cancel", id: c.id } },
        refresh: ["campaigns"],
      });
      return READY;
    }
    case "propose_template": {
      const id = s(args.template_id, 80);
      const tname = s(args.name, 80);
      const body = s(args.body, 20_000);
      if (!tname || !body) return { error: "Need a name and a body." };
      if (id && !(await listTemplates()).some((t) => t.id === id)) return { error: "No template with that id." };
      const cat = (TEMPLATE_CATEGORIES as readonly string[]).includes(s(args.category, 20)) ? s(args.category, 20) : "custom";
      push(ctx, {
        kind: "template",
        title: `${id ? "Update" : "Save"} template: ${tname}`,
        lines: [`Subject: ${s(args.subject, 200) || "(none)"}`, `Category: ${cat}`],
        preview: body.slice(0, 1500),
        confirmLabel: "Save template",
        request: { method: "POST", url: "/api/admin/templates", body: { action: "save", id: id || undefined, name: tname, category: cat, subject: s(args.subject, 200), body } },
        refresh: ["templates"],
      });
      return READY;
    }
    case "propose_template_archive": {
      const t = (await listTemplates()).find((x) => x.id === s(args.template_id, 80));
      if (!t) return { error: "No template with that id." };
      const archived = args.archived === true;
      push(ctx, {
        kind: "template",
        title: `${archived ? "Archive" : "Restore"} template ${t.name}`,
        lines: [archived ? "Hidden from the library (restore any time)" : "Back in the library"],
        confirmLabel: archived ? "Archive" : "Restore",
        request: { method: "POST", url: "/api/admin/templates", body: { action: archived ? "archive" : "unarchive", id: t.id } },
        refresh: ["templates"],
      });
      return READY;
    }
    case "propose_subscriber_add": {
      const email = s(args.email, 200).toLowerCase();
      if (!EMAIL.test(email)) return { error: "That email doesn't look right." };
      const existing = (await getSubscribers()).find((x) => x.email.toLowerCase() === email);
      if (existing && !existing.unsubscribedAt) return { note: `${email} is already subscribed.` };
      push(ctx, {
        kind: "subscriber",
        title: `Add ${email} to the mailing list`,
        lines: [s(args.name, 100) || "(no name)", existing?.unsubscribedAt ? `⚠ They unsubscribed on ${fmtDay(existing.unsubscribedAt)} — only re-add them if they asked` : "They get your campaigns from now on"],
        confirmLabel: "Add subscriber",
        request: { method: "POST", url: "/api/admin/subscribers", body: { email, name: s(args.name, 100) || undefined } },
        refresh: ["subscribers"],
      });
      return READY;
    }
    case "propose_subscriber_remove": {
      const q = s(args.email, 200).toLowerCase();
      const sub = (await getSubscribers()).find((x) => x.id === s(args.email, 80) || x.email.toLowerCase() === q);
      if (!sub) return { error: "Not on the mailing list. Use find_subscribers." };
      push(ctx, {
        kind: "subscriber",
        title: `Remove ${sub.email} from the mailing list`,
        lines: [sub.name || "(no name)", `Subscribed ${fmtDay(sub.subscribedAt)} · ${sub.unsubscribedAt ? "already unsubscribed" : "subscribed"}`, "Removed completely — they can sign up again later"],
        confirmLabel: "Remove",
        danger: true,
        request: { method: "DELETE", url: `/api/admin/subscribers?id=${encodeURIComponent(sub.id)}`, body: undefined },
        refresh: ["subscribers"],
      });
      return READY;
    }

    // ================================================= settings
    case "propose_loyalty_settings": {
      const st = await getSettings();
      const body: Record<string, unknown> = { partial: true };
      const lines: string[] = [];
      if (typeof args.enabled === "boolean" && args.enabled !== st.loyaltyEnabled) { body.loyaltyEnabled = args.enabled; lines.push(`Loyalty ${args.enabled ? "on" : "off"}`); }
      const numField = (k: string, key: string, label: string, cur: number) => {
        if (!has(args, k)) return;
        const v = Number(args[k]);
        if (!Number.isFinite(v) || v < 0) return;
        body[key] = v;
        if (v !== cur) lines.push(`${label}: ${cur} → ${v}`);
      };
      numField("points_per_dollar", "pointsPerDollar", "Points per $1 spent", st.pointsPerDollar);
      numField("points_per_dollar_redeemed", "pointsPerDollarRedeemed", "Points per $1 off", st.pointsPerDollarRedeemed);
      numField("min_points_to_redeem", "minPointsToRedeem", "Minimum to redeem", st.minPointsToRedeem);
      if (lines.length === 0) return { note: "Nothing would change." };
      push(ctx, {
        kind: "settings",
        title: "Change loyalty settings",
        lines,
        confirmLabel: "Save",
        request: { method: "POST", url: "/api/admin/settings", body },
        refresh: ["settings"],
      });
      return READY;
    }
    case "propose_feature_switch": {
      const key = s(args.key, 40) as FlagKey;
      if (!FLAG_KEYS.includes(key)) return { error: `Unknown switch. Keys: ${FLAG_KEYS.join(", ")}` };
      const on = args.on === true;
      const cur = (await getFlags({ fresh: true }))[key];
      if (cur === on) return { note: `${FLAGS[key].label} is already ${on ? "on" : "off"}.` };
      push(ctx, {
        kind: "feature_switch",
        title: `${on ? "Turn on" : "Turn off"}: ${FLAGS[key].label}`,
        lines: [FLAGS[key].description, "This environment only (live and stage are separate) · takes effect within ~15 seconds"],
        confirmLabel: on ? "Turn on" : "Turn off",
        danger: !on && (key === "ai_assistant" || key === "ai_admin_actions"),
        request: { method: "POST", url: "/api/admin/flags", body: { key, on } },
        refresh: ["flags"],
      });
      return READY;
    }
    case "propose_staff_change": {
      const list = await getAdmins();
      const add = s(args.add_email, 200).toLowerCase();
      const remove = s(args.remove_email, 200).toLowerCase();
      if (!add && !remove) return { error: "Say who to add or remove." };
      if (add && !EMAIL.test(add)) return { error: "That email doesn't look right." };
      let next = list.map((a) => ({ ...a }));
      const lines: string[] = [];
      if (add) {
        if (next.some((a) => a.email === add)) return { note: `${add} is already on the staff list.` };
        next.push({ id: add, email: add, name: s(args.add_name, 60) || add.split("@")[0], addedAt: Date.now() });
        lines.push(`Add ${add} — they can sign in to the dashboard with an emailed link`);
      }
      if (remove) {
        if (!next.some((a) => a.email === remove)) return { error: `${remove} isn't on the staff list.` };
        next = next.filter((a) => a.email !== remove);
        lines.push(`Remove ${remove} — their link sign-in ends within a minute`);
      }
      if (next.length === 0) return { error: "Keep at least one person on the list." };
      lines.push("The shared admin password keeps working");
      push(ctx, {
        kind: "staff",
        title: "Change who can sign in",
        lines,
        confirmLabel: "Save staff list",
        danger: true,
        request: { method: "PUT", url: "/api/admin/admins", body: { admins: next } },
        refresh: ["staff"],
      });
      return READY;
    }
    case "propose_reminder_settings": {
      const cur = await getReminderSettings();
      const stages = cur.stages.map((x) => ({ ...x }));
      const lines: string[] = [];
      if (has(args, "reminder")) {
        const i = Math.floor(Number(args.reminder)) - 1;
        if (!(i >= 0 && i <= stages.length && i < 6)) return { error: `Reminder must be 1–${Math.min(6, stages.length + 1)}.` };
        if (i === stages.length) stages.push({ afterHours: stages[stages.length - 1].afterHours + 168, subject: "A reminder about your order {ref}", message: "Your order {ref} ({total}) is still waiting for payment." });
        if (has(args, "after_hours")) { stages[i].afterHours = Math.round(Number(args.after_hours)); lines.push(`Reminder ${i + 1}: after ${stages[i].afterHours} hours`); }
        if (has(args, "subject")) { stages[i].subject = s(args.subject, 150); lines.push(`Reminder ${i + 1} subject: ${stages[i].subject}`); }
        if (has(args, "message")) { stages[i].message = s(args.message, 3000); lines.push(`Reminder ${i + 1}: new message`); }
      }
      const expire = has(args, "expire_after_hours") ? Math.round(Number(args.expire_after_hours)) : cur.expireAfterHours;
      if (expire !== cur.expireAfterHours) lines.push(`Move to Expired after ${expire} hours`);
      if (lines.length === 0) return { note: "Nothing would change." };
      push(ctx, {
        kind: "reminders",
        title: "Change payment reminders",
        lines,
        preview: has(args, "message") ? s(args.message, 3000) : undefined,
        confirmLabel: "Save",
        request: { method: "PUT", url: "/api/admin/reminders", body: { stages, expireAfterHours: expire } },
        refresh: ["reminders"],
      });
      return READY;
    }
    case "propose_send_report": {
      push(ctx, {
        kind: "report",
        title: "Email the nightly report now",
        lines: [`To ${process.env.EXPORT_RECIPIENT_EMAIL || process.env.INQUIRY_TO_EMAIL || "the report address"}`, "Revenue summary + six spreadsheets attached"],
        confirmLabel: "Send report",
        busyLabel: "Sending…",
        request: { method: "POST", url: "/api/admin/export-email", body: {} },
        refresh: [],
      });
      return READY;
    }
    case "propose_assistant_settings": {
      const c = ctx.config;
      const body: Record<string, unknown> = {};
      const lines: string[] = [];
      const b = (k: string, key: "enabledPublic" | "enabledMembers" | "enabledStaff", label: string) => {
        if (typeof args[k] === "boolean" && args[k] !== c[key]) { body[key] = args[k]; lines.push(`${label}: ${args[k] ? "on" : "off"}`); }
      };
      b("enabled_public", "enabledPublic", "Concierge for visitors");
      b("enabled_members", "enabledMembers", "Concierge for members");
      b("enabled_staff", "enabledStaff", "Staff assistant");
      if (has(args, "monthly_cap")) { body.monthlyCapUsd = Number(args.monthly_cap); lines.push(`Monthly limit: $${c.monthlyCapUsd} → $${body.monthlyCapUsd}`); }
      if (s(args.name, 40)) { body.assistantName = s(args.name, 40); lines.push(`Name: ${c.assistantName} → ${body.assistantName}`); }
      if (has(args, "tone")) { body.persona = s(args.tone, 4000); lines.push("New tone notes (replaces the old ones)"); }
      if (s(args.add_knowledge_note, 4000)) { body.knowledge = `${c.knowledge.trim()}\n\n${s(args.add_knowledge_note, 4000)}`.trim(); lines.push("Adds a note to its knowledge (everything already there stays)"); }
      if (s(args.model, 100)) { body.model = s(args.model, 100); lines.push(`Model: ${c.model} → ${body.model} (press Test this model after)`); }
      if (has(args, "fallback_model")) { body.fallbackModel = s(args.fallback_model, 100); lines.push(`Backup model → ${body.fallbackModel || "none"}`); }
      if (has(args, "handoff_email")) { body.escalationEmail = s(args.handoff_email, 200); lines.push(`Hand-offs go to ${body.escalationEmail || "the site default"}`); }
      if (lines.length === 0) return { note: "Nothing would change." };
      push(ctx, {
        kind: "assistant_settings",
        title: "Change the Concierge's settings",
        lines,
        preview: (s(args.add_knowledge_note, 4000) || (has(args, "tone") ? s(args.tone, 4000) : "")) || undefined,
        confirmLabel: "Save",
        danger: body.enabledStaff === false,
        request: { method: "PUT", url: "/api/admin/assistant", body },
        refresh: ["assistant"],
      });
      return READY;
    }
    case "propose_knowledge_page": {
      const act = s(args.action, 10);
      const url = s(args.url, 500);
      if (!["add", "refresh", "remove"].includes(act)) return { error: "action must be add, refresh or remove." };
      if (act !== "refresh" && !/^https?:\/\//i.test(url)) return { error: "Give the page's full address." };
      if (act === "remove" && !(await listSources(true)).some((x) => x.id === url || x.url === url)) return { error: "That page isn't in the list. Use get_admin_settings." };
      push(ctx, {
        kind: "knowledge_page",
        title: act === "add" ? `Learn from ${url}` : act === "refresh" ? "Re-read all web pages" : `Stop using ${url}`,
        lines: [act === "add" ? "Reads the page's text (a sitemap.xml adds up to 20 pages); your tone and notes stay as they are" : act === "refresh" ? "Picks up any changes on those pages" : "The Concierge stops using that page"],
        confirmLabel: act === "add" ? "Add page" : act === "refresh" ? "Refresh" : "Remove",
        busyLabel: act === "remove" ? "Saving…" : "Reading…",
        request: { method: "POST", url: "/api/admin/assistant/sources", body: act === "refresh" ? { action: "refresh" } : act === "add" ? { action: "add", url } : { action: "remove", id: url } },
        refresh: ["sources"],
      });
      return READY;
    }
    case "propose_handoff_reply": {
      const e = (await recentEscalations()).find((x) => x.id === s(args.request_id, 80));
      if (!e) return { error: "No request with that id. Use list_handed_to_team." };
      const reply = s(args.reply, 5000);
      const url = `/api/admin/assistant/escalations/${encodeURIComponent(e.id)}`;
      if (reply) {
        const resolve = args.resolve !== false;
        push(ctx, {
          kind: "handoff",
          title: `Reply to ${e.name}${resolve ? " & resolve" : ""}`,
          lines: [`${e.email} · ${e.topic}`, `Their request: ${e.summary.slice(0, 200)}`, "“Hi [name],” and a sign-off are added; replies come to your inbox"],
          preview: reply,
          confirmLabel: resolve ? "Send & resolve" : "Send",
          busyLabel: "Sending…",
          request: { method: "POST", url, body: { action: "reply", body: reply, resolve } },
          refresh: ["escalations"],
        });
        return READY;
      }
      const reopen = args.reopen === true;
      if (!reopen && escalationStatus(e) === "resolved") return { note: "Already resolved." };
      if (reopen && escalationStatus(e) === "open") return { note: "It's already open." };
      push(ctx, {
        kind: "handoff",
        title: `${reopen ? "Reopen" : "Resolve"} ${e.name}'s request`,
        lines: [`${e.email} · ${e.topic}`, e.summary.slice(0, 200), reopen ? "" : "No email is sent"].filter(Boolean),
        confirmLabel: reopen ? "Reopen" : "Resolve",
        request: { method: "POST", url, body: { action: reopen ? "reopen" : "resolve" } },
        refresh: ["escalations"],
      });
      return READY;
    }
  }
  return { error: `Tool ${name} isn't implemented.` };
}
