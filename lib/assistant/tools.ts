import { Resend } from "resend";
import type { User } from "../users";
import { getOrdersByUser, normalizeStatus, type Order, type OrderStatus } from "../orders";
import { getInsights, money } from "../analytics";
import { getDiscounts, normalizeCode } from "../discounts";
import { requestPasswordReset } from "../passwordReset";
import { escapeHtml } from "../invoiceEmail";
import { asCash, cashDeal, effectivePrice, formatMoney, lineDiscount, onSale, parsePrice, promoLabel } from "../pricing";
import { isExternal, isInternal, type Product } from "../storage";
import { getSettings } from "../settings";
import { getBanner } from "../banner";
import { computeInsights } from "./insights";
import { addDays, lastNDaysStart, pacificDay, pacificMidnight } from "../periods";
import { auditSystem } from "../audit";
import { canResendInvoice, resendInvoice } from "../invoiceResend";
import { chatInsights } from "./chatInsights";
import { recentTranscripts } from "./transcripts";
import type { GatewayTool } from "./gateway";
import type { AssistantConfig } from "./config";
import { addEscalation, escalationStatus, recentEscalations } from "./usage";
import { overLimit } from "./limits";
import {
  cachedProducts,
  cachedEvents,
  cachedUsers,
  cachedOrders,
  productsFor,
  priceLine,
  fmtDate,
  orderRef,
  plainText,
  searchStaffGuide,
  customerItemName,
  TZ,
} from "./knowledge";
import type { ActionProposal, Audience, CampaignDraft, ChatMessage } from "./shared";
import { PHOTO_SLOT, SUPPORT_EMAIL } from "./shared";
import { getFaq } from "../faq";
import { ADMIN_EXTRA_DEFS, runAdminExtra } from "./adminActions";
import { AMBASSADOR_DEFS, runAmbassadorTool } from "./ambassadorTools";
import { resolveSegment, SEGMENT_KEYS } from "../segments";
import { recipientsFor } from "../campaignSchedule";
import { THEME_KEYS, cleanThemeChoice, themeForCategory } from "../campaignThemes";
import { listTemplates } from "../emailTemplates";
import { splitChased, CHASE_QUIET_DAYS } from "../chased";
import { isEnabled } from "../flags";
import { liveBundles } from "../bundleStore";
import { applyStockFlag, getStock } from "@/lib/stock";
import { backorders } from "@/lib/stockMath";
import { inbox as venmoInbox } from "@/lib/venmoInbox";
import { cachedPublicStores } from "../storesCache";
import { cleanStore, getStores } from "@/lib/stores";
import { geocodeCached, milesBetween } from "../geocode";
import { bundleOfferLabel } from "../bundles";
import { brand } from "@/lib/brand";

/**
 * Tools the model may call. Which tools exist depends on the audience, and
 * the audience is decided on the server from the session cookie — a visitor
 * cannot talk their way into staff tools because those tools are simply not
 * offered to them.
 *
 * Admin "propose_*" tools never change anything. They validate the request
 * against real records and return a card the staff member must confirm; the
 * confirm button then calls the same admin endpoint the dashboard uses.
 */

export type ToolContext = {
  audience: Audience;
  user: User | null;
  ip: string;
  config: AssistantConfig;
  transcript: ChatMessage[];
  /** Collected side-outputs for the widget. */
  actions: ActionProposal[];
  draft: CampaignDraft | null;
  /** Staff: may the assistant prepare confirm cards? (feature switch ai_admin_actions) */
  allowActions?: boolean;
  /** Customers: products to show as cards under the reply (show_products). */
  productIds?: string[];
};

type ToolDef = GatewayTool & { audiences: Audience[] };

const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: "string", description, ...extra });

const DEFS: ToolDef[] = [
  // ---------------------------------------------------------- everyone
  {
    audiences: ["public", "member", "admin"],
    type: "function",
    function: {
      name: "get_product_details",
      description: "Full details (description, price, promotions) for a product by name. Use before describing a product.",
      parameters: { type: "object", properties: { name: str("Product name or part of it") }, required: ["name"] },
    },
  },
  {
    audiences: ["public", "member", "admin"],
    type: "function",
    function: {
      name: "list_upcoming_events",
      description: "Upcoming published classes and events with dates, location, price and description.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    audiences: ["public", "member", "admin"],
    type: "function",
    function: {
      name: "find_stores",
      description: `Shops that carry ${brand.shortName} in person (read-only). Use for 'where can I buy this in person / near me'. near = a city, zip or place the customer gave; product = a product name (or id) to only list stores that carry it. Point them to /stores for the map.`,
      parameters: { type: "object", properties: { near: str("City, zip or place (optional)"), product: str("Product name or id (optional)") } },
    },
  },
  // ---------------------------------------------------------- customers
  {
    audiences: ["public", "member"],
    type: "function",
    function: {
      name: "show_products",
      description:
        "Show product cards (photo, price, Add to cart and View buttons) under your reply. Call this whenever you recommend or talk about specific products — up to 4, most relevant first, using exact names from the catalog. The cards show the photo and price, so keep your text short.",
      parameters: {
        type: "object",
        properties: { names: { type: "array", items: { type: "string" }, description: "Exact product names from the catalog, up to 4" } },
        required: ["names"],
      },
    },
  },
  {
    audiences: ["public", "member"],
    type: "function",
    function: {
      name: "send_password_reset",
      description:
        "Email a new password to a member account. Always reply neutrally: if that email belongs to an approved member, a new password is on its way.",
      parameters: { type: "object", properties: { email: str("The email address they signed up with") }, required: ["email"] },
    },
  },
  {
    audiences: ["public", "member"],
    type: "function",
    function: {
      name: "check_order_status",
      description: "Look up an order's status. Requires BOTH the 6-character order reference and the email on the order.",
      parameters: {
        type: "object",
        properties: { reference: str("6-character order reference, e.g. 4K9Q2X"), email: str("Email used on the order") },
        required: ["reference", "email"],
      },
    },
  },
  {
    audiences: ["public", "member"],
    type: "function",
    function: {
      name: "escalate_to_team",
      description:
        `Send the conversation to the ${brand.shortName} team by email so a person follows up. Only after the customer agreed and gave name, email and a summary.`,
      parameters: {
        type: "object",
        properties: {
          name: str("Customer's name"),
          email: str("Customer's email for the reply"),
          topic: str("Category", { enum: ["order", "payment", "membership", "account", "product", "complaint", "other"] }),
          summary: str("One or two sentences describing the problem"),
        },
        required: ["name", "email", "topic", "summary"],
      },
    },
  },
  {
    audiences: ["public", "member"],
    type: "function",
    function: {
      name: "resend_my_invoice",
      description:
        "Email the customer their unpaid invoice again (same pay link, same amount — amounts never change). Members: the reference is optional if they have one unpaid order. Visitors: need the 6-character reference AND the email on the order. It only ever goes to the email on the order.",
      parameters: {
        type: "object",
        properties: {
          reference: str("6-character order reference (optional for signed-in members)"),
          email: str("Email used on the order (visitors only)"),
        },
      },
    },
  },
  {
    audiences: ["public", "member"],
    type: "function",
    function: {
      name: "deals_and_rewards",
      description:
        "Everything about saving money right now: how loyalty points work (earn rate, what they're worth, minimum to redeem, how to use them) plus — for a signed-in member — their own balance; products currently on sale or BOGO; mix & match bundle deals; the cart-wide 'buy N, save X%' deal; and the site announcement. Use for any question about points, rewards, sales, deals, promotions, bundles or discounts.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    audiences: ["member"],
    type: "function",
    function: {
      name: "get_my_orders",
      description: "The signed-in member's recent orders with status and totals.",
      parameters: { type: "object", properties: {} },
    },
  },
  // ---------------------------------------------------------- staff: read
  {
    audiences: ["admin"],
    type: "function",
    function: {
      name: "search_staff_guide",
      description: "Search the staff guide for how to do something in the admin dashboard. Use for any how-to question.",
      parameters: { type: "object", properties: { query: str("What they want to do, in plain words") }, required: ["query"] },
    },
  },
  {
    audiences: ["admin"],
    type: "function",
    function: {
      name: "business_snapshot",
      description: "Sales, orders waiting on payment or fulfilment, pending approvals, top products and customers.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    audiences: ["admin"],
    type: "function",
    function: {
      name: "sales_insights",
      description:
        "Sales analysis for any period: top customers by spend and by number of orders, lifetime top spenders, lapsed regulars, best-selling and fastest-rising products, products not selling, categories, items bought together, member vs public shop, shipping vs pickup, discount code results, and change vs the previous period. Optionally focus on one product (who buys it) or one customer (their history).",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "Look back this many days (default 30; 0 = all time). Ignored if from is given." },
          from: str("Start date YYYY-MM-DD (local), for a specific range"),
          to: str("End date YYYY-MM-DD (local), inclusive; default today"),
          product: str("Only orders containing this product (name or part of it)"),
          customer: str("One customer's history (email or name)"),
          top: { type: "number", description: "How many rows per list (default 10, max 25)" },
        },
      },
    },
  },
  {
    audiences: ["admin"],
    type: "function",
    function: {
      name: "chat_insights",
      description:
        "What customers talk to the Concierge about (last 30 days): conversations by audience, topics, anything flagged as concerning, and recent customer questions to spot themes. Use for 'what are people asking', 'any concerning chats', 'what should we add to the FAQ'.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    audiences: ["admin"],
    type: "function",
    function: {
      name: "find_members",
      description: "Search members and membership requests by name or email, or list by status.",
      parameters: {
        type: "object",
        properties: {
          query: str("Name or email fragment; empty to list"),
          status: str("Filter", { enum: ["any", "pending", "approved", "rejected"] }),
        },
      },
    },
  },
  {
    audiences: ["admin"],
    type: "function",
    function: {
      name: "find_orders",
      description: "Search orders by customer name/email or reference, or list by status (newest first).",
      parameters: {
        type: "object",
        properties: {
          query: str("Customer name, email or 6-character reference; empty to list"),
          status: str("Filter", { enum: ["any", "pending", "paid", "completed", "cancelled", "inquiry"] }),
        },
      },
    },
  },
  {
    audiences: ["admin"],
    type: "function",
    function: {
      name: "list_products",
      description: "Products with id, visibility (internal = members only, external = public only, both), price and promotions.",
      parameters: { type: "object", properties: { query: str("Name or category fragment; empty for all") } },
    },
  },
  {
    audiences: ["admin"],
    type: "function",
    function: {
      name: "list_discount_codes",
      description: "Existing discount codes with value, usage and status.",
      parameters: { type: "object", properties: {} },
    },
  },
  // ---------------------------------------------------------- staff: propose
  {
    audiences: ["admin"],
    type: "function",
    function: {
      name: "propose_member_status",
      description: "Prepare approving or rejecting a membership request (staff must confirm). Get the id from find_members first.",
      parameters: {
        type: "object",
        properties: { member_id: str("Member id"), status: str("New status", { enum: ["approved", "rejected"] }) },
        required: ["member_id", "status"],
      },
    },
  },
  {
    audiences: ["admin"],
    type: "function",
    function: {
      name: "propose_store",
      description: `Prepare adding a shop that carries ${brand.shortName} to the store map (Settings → Store locations). Staff must confirm. One card per store — for a pasted list, call this once per store. Put the suite/unit in street (e.g. \"1920 Market Pl, Ste 120\"). Stores marked pending/coming soon: hidden=true (saved but not shown until staff switch them on); a hidden one may have just a city if the street isn't known yet. The pin comes from the address when it's saved.`,
      parameters: {
        type: "object",
        properties: {
          name: str("Store name"),
          street: str("Street address, including suite"),
          city: str("City"),
          state: str("State, e.g. CA"),
          zip: str("Zip code"),
          phone: str("Phone (optional)"),
          website: str("Website (optional)"),
          hours: str("Opening hours (optional)"),
          notes: str("Note shown to customers (optional)"),
          products: { type: "array", items: { type: "string" }, description: "Product names it carries (optional)" },
          hidden: { type: "boolean", description: "true = save but don't show yet (pending)" },
        },
        required: ["name", "city"],
      },
    },
  },
  {
    audiences: ["admin"],
    type: "function",
    function: {
      name: "list_faq",
      description: "Read-only: the FAQ page's questions and answers (Settings → FAQ page), with ids, topic and whether each is published.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    audiences: ["admin"],
    type: "function",
    function: {
      name: "propose_faq",
      description: "Prepare a change to the FAQ page (staff must confirm; the business approves every answer). action add (question + answer, optional topic, published defaults to false = draft unless staff asked to publish), edit (faq_id + any of question/answer/topic), publish, unpublish, or delete (red card). Get ids from list_faq. Never invent dosing guidance: only use dosing wording the staff gave you.",
      parameters: {
        type: "object",
        properties: {
          action: str("What to do", { enum: ["add", "edit", "publish", "unpublish", "delete"] }),
          faq_id: str("For edit/publish/unpublish/delete: the id from list_faq"),
          question: str("The question"),
          answer: str("The answer (plain text; blank line = new paragraph, \"- \" = bullet)"),
          topic: str("Topic that groups it on the page, e.g. Ordering, Products, Pickup"),
          published: { type: "boolean", description: "For add: true only if staff asked to publish it now" },
        },
        required: ["action"],
      },
    },
  },
  {
    audiences: ["admin"],
    type: "function",
    function: {
      name: "propose_stock_count",
      description: "Prepare setting a product's stock count (Products → Stock counts), e.g. when new stock arrives. Staff must confirm. One card per product. count = how many are on the shelf now (0 or more).",
      parameters: {
        type: "object",
        properties: { product_id: str("Product id"), count: { type: "number", description: "New on-hand count" } },
        required: ["product_id", "count"],
      },
    },
  },
  {
    audiences: ["admin"],
    type: "function",
    function: {
      name: "venmo_payments",
      description: "Read-only: Venmo payments from the Venmo inbox (forwarded “paid you” emails), with the unpaid order each one matches (strong = #ref in the note, medium = same amount + name, weak = amount only). Quarantined ones failed the security check and can't be matched.",
      parameters: { type: "object", properties: { show: str("Which", { enum: ["to_sort", "all"] }) } },
    },
  },
  {
    audiences: ["admin"],
    type: "function",
    function: {
      name: "propose_venmo_payment",
      description: "Prepare marking an unpaid order PAID from a Venmo payment in the Venmo inbox. Staff must confirm. One card per payment. Get ids from venmo_payments (or the Today item).",
      parameters: {
        type: "object",
        properties: { payment_id: str("Venmo payment id (vt_… or vm_…)"), order_id: str("Order id") },
        required: ["payment_id", "order_id"],
      },
    },
  },
  {
    audiences: ["admin"],
    type: "function",
    function: {
      name: "propose_order_status",
      description: "Prepare changing an order's status, including CANCELLING an order (status cancelled → red card). Staff must confirm. Get the id from find_orders first. One card per order.",
      parameters: {
        type: "object",
        properties: {
          order_id: str("Order id"),
          status: str("New status", { enum: ["pending", "paid", "completed", "cancelled"] }),
        },
        required: ["order_id", "status"],
      },
    },
  },
  {
    audiences: ["admin"],
    type: "function",
    function: {
      name: "propose_product_visibility",
      description: "Prepare changing where products are sold (staff must confirm). internal = members only, external = public shop only, both.",
      parameters: {
        type: "object",
        properties: {
          product_ids: { type: "array", items: { type: "string" }, description: "Product ids from list_products" },
          visibility: str("Where to sell", { enum: ["internal", "external", "both"] }),
        },
        required: ["product_ids", "visibility"],
      },
    },
  },
  {
    audiences: ["admin"],
    type: "function",
    function: {
      name: "propose_discount_code",
      description: "Prepare a new discount code (staff must confirm).",
      parameters: {
        type: "object",
        properties: {
          code: str("Code text, letters/numbers; leave empty to auto-generate"),
          type: str("percentage or fixed dollars", { enum: ["percentage", "fixed"] }),
          value: { type: "number", description: "Percent (1-100) or dollars" },
          label: str("Internal note, e.g. who it's for"),
          max_uses: { type: "number", description: "Total uses allowed; omit for unlimited" },
          expires_in_days: { type: "number", description: "Days until it expires; omit for never" },
          min_order: { type: "number", description: "Minimum order in dollars; omit for none" },
          public_shop: { type: "boolean", description: "true = also works in the public shop (no account needed); default members only. Ambassadors' linked codes always work there." },
        },
        required: ["type", "value"],
      },
    },
  },
  {
    audiences: ["admin"],
    type: "function",
    function: {
      name: "get_site_settings",
      description: "The current announcement banner, the 'buy N, save X%' bundle rule, and loyalty settings.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    audiences: ["admin"],
    type: "function",
    function: {
      name: "propose_sale",
      description:
        "Prepare putting products on sale or ending a sale (staff must confirm). Modes: percent_off (X% off), bogo (buy one, get one X% off), sale_price (a fixed sale price), end_sale (back to regular price). Sales don't end on their own. cash_pickup_only true = the sale applies only to Local pickup orders paid in cash (everyone else pays the regular price).",
      parameters: {
        type: "object",
        properties: {
          product_ids: { type: "array", items: { type: "string" }, description: "Product ids from list_products" },
          mode: str("What to do", { enum: ["percent_off", "bogo", "sale_price", "end_sale"] }),
          percent: { type: "number", description: "For percent_off and bogo: 1-99" },
          sale_price: { type: "number", description: "For sale_price: the sale price in dollars" },
          cash_pickup_only: { type: "boolean", description: "true: only for Local pickup paid in cash. false: for everyone. Leave out to keep each product's current setting." },
        },
        required: ["product_ids", "mode"],
      },
    },
  },
  {
    audiences: ["admin"],
    type: "function",
    function: {
      name: "propose_bundle",
      description:
        "Prepare a new bundle product made of existing products (staff must confirm). Price defaults to the combined price minus discount_percent. A bundle can only be sold publicly if every item in it is.",
      parameters: {
        type: "object",
        properties: {
          name: str("Bundle name, e.g. 'Morning Ritual Bundle'"),
          product_ids: { type: "array", items: { type: "string" }, description: "2-10 product ids from list_products" },
          discount_percent: { type: "number", description: "% off the combined price (default 10); ignored if price is given" },
          price: { type: "number", description: "Exact bundle price in dollars (optional)" },
          description: str("Short customer-facing description (optional; a list of what's included is added automatically)"),
          visibility: str("Where to sell (default: both shops if every item is public, else members only)", { enum: ["internal", "external", "both"] }),
        },
        required: ["name", "product_ids"],
      },
    },
  },
  {
    audiences: ["admin"],
    type: "function",
    function: {
      name: "propose_bundle_rule",
      description: "Prepare changing the cart-wide 'buy N or more items, save X%' rule (staff must confirm).",
      parameters: {
        type: "object",
        properties: {
          enabled: { type: "boolean", description: "Turn the rule on or off" },
          min_items: { type: "number", description: "Minimum items in the cart (2 or more)" },
          percent: { type: "number", description: "Percent off the cart (1-90)" },
        },
        required: ["enabled"],
      },
    },
  },
  {
    audiences: ["admin"],
    type: "function",
    function: {
      name: "propose_banner",
      description:
        "Prepare the site-wide announcement banner (staff must confirm): set new text, or turn it off with enabled=false. Setting new text replaces the old link and countdown unless you pass them again. Colours stay as they are.",
      parameters: {
        type: "object",
        properties: {
          enabled: { type: "boolean", description: "false turns the banner off (other fields ignored)" },
          message: str("Banner text, plain words, under 160 characters"),
          link_url: str("Optional link: a site path like /retail or /events, or a full https:// address"),
          link_label: str("Optional link text, e.g. 'Shop the sale'"),
          countdown_to: str("Optional countdown end, local time, as YYYY-MM-DD HH:mm"),
          countdown_label: str("Optional words before the countdown, e.g. 'Sale ends in'"),
        },
        required: ["enabled"],
      },
    },
  },
  {
    audiences: ["admin"],
    type: "function",
    function: {
      name: "propose_order_message",
      description:
        "Prepare an email to the customer on one order (staff must confirm; nothing sends until then). Use for payment reminders, shipping/pickup updates and questions about that order. Works for guests and members. For an unpaid order a 'View & pay' button is added automatically. One call per order; get the id from find_orders.",
      parameters: {
        type: "object",
        properties: {
          order_id: str("Order id from find_orders"),
          subject: str("Short subject line"),
          message: str(`Plain-text body. No greeting (the email already starts 'Hello, <name>'). End with a short sign-off from the ${brand.shortName} team.`),
          include_pay_link: { type: "boolean", description: "Add the 'View & pay' button (default true for unpaid orders; ignored otherwise)" },
        },
        required: ["order_id", "subject", "message"],
      },
    },
  },
  {
    audiences: ["admin"],
    type: "function",
    function: {
      name: "propose_member_message",
      description:
        "Prepare a personal email to one member account (staff must confirm). For anything about a specific order, use propose_order_message instead. Get the id from find_members.",
      parameters: {
        type: "object",
        properties: {
          member_id: str("Member id from find_members"),
          subject: str("Short subject line"),
          message: str(`Plain-text body. No greeting (the email already starts 'Hello, <name>'). End with a short sign-off from the ${brand.shortName} team.`),
        },
        required: ["member_id", "subject", "message"],
      },
    },
  },
  {
    audiences: ["admin"],
    type: "function",
    function: {
      name: "daily_tasks",
      description:
        "Today's to-do list from live data: membership requests waiting, unpaid orders by age, paid orders to pack or ship, customer requests waiting for a reply, upcoming events, expiring discount codes. Use for 'what needs my attention', 'what should I do today', 'who do I need to follow up with'.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    audiences: ["admin"],
    type: "function",
    function: {
      name: "support_report",
      description: "Recurring customer problems: what customers were handed to the team about, by topic, how fast they were answered, what's still open, and recent examples.",
      parameters: { type: "object", properties: { days: { type: "number", description: "Look back this many days (default 90)" } } },
    },
  },
  {
    audiences: ["admin"],
    type: "function",
    function: {
      name: "propose_resend_invoice",
      description: "Prepare re-sending the original invoice email (same pay link and amount) for an unpaid order (staff must confirm). Amounts can't be changed here.",
      parameters: { type: "object", properties: { order_id: str("Order id from find_orders") }, required: ["order_id"] },
    },
  },
  {
    audiences: ["admin"],
    type: "function",
    function: {
      name: "propose_member_email",
      description: "Prepare correcting a member's email address, e.g. a typo at sign-up (staff must confirm). Their mailing-list entry moves with it. Get the id from find_members.",
      parameters: {
        type: "object",
        properties: { member_id: str("Member id"), new_email: str("The corrected email address") },
        required: ["member_id", "new_email"],
      },
    },
  },
  {
    audiences: ["admin"],
    type: "function",
    function: {
      name: "propose_points_credit",
      description: "Prepare adding loyalty points to a member as a goodwill credit (staff must confirm). Points only — never money, refunds or price changes.",
      parameters: {
        type: "object",
        properties: {
          member_id: str("Member id"),
          points: { type: "number", description: "Points to add (1–5000)" },
          reason: str("Short reason the member will see in their points history"),
        },
        required: ["member_id", "points", "reason"],
      },
    },
  },
  {
    audiences: ["admin"],
    type: "function",
    function: {
      name: "prepare_campaign_draft",
      description:
        "Newsletter draft opened in the campaign composer (never sends): for the whole mailing list, all members, all non-members, or a customer GROUP via segment (e.g. lapsed_members, subscribers_never_ordered, top_customers, bought_product) — the server works out who's in the group. To use a template, call list_templates and pass its id as template_id. Never for one person, an order or a payment reminder — use propose_order_message or propose_member_message for those.",
      parameters: {
        type: "object",
        properties: {
          template_id: str("Optional: template id or exact name from list_templates. Loads its subject, body and matching look; subject, body and theme override those"),
          subject: str("Email subject line (optional with template_id)"),
          body: str("Email body in the composer's plain-text format (optional with template_id)"),
          audience: str("Who it's for (ignored when segment is given). subscribers = the mailing list (the default); all = subscribers + every member", { enum: ["subscribers", "all", "members", "nonmembers"] }),
          segment: str(`Optional customer group: ${SEGMENT_KEYS.join(" | ")}`),
          segment_days: { type: "number", description: "Group window in days (e.g. 60 for lapsed_members)" },
          segment_limit: { type: "number", description: "For top_customers: how many people" },
          segment_product: str("For bought_product: product id or name"),
          use_photo: { type: "boolean", description: `true to put the photo the staff sent in this chat into the email. Put ${PHOTO_SLOT} on its own line in body where it should go (otherwise it goes at the top)` },
          photo_alt: str("With use_photo: a short description of the photo (for people who can't see images)"),
          theme: str(`Optional look (seasonal banner, colours, dividers): auto (default, or the template's category) | none (plain) | ${THEME_KEYS.join(" | ")}`),
        },
        required: ["audience"],
      },
    },
  },
];

/** Tools that prepare a confirm card (they change something once approved). */
const isActionTool = (name: string) => name.startsWith("propose_");

export function toolsFor(audience: Audience, opts: { actions?: boolean } = {}): GatewayTool[] {
  return [...DEFS, ...ADMIN_EXTRA_DEFS, ...AMBASSADOR_DEFS].filter((d) => d.audiences.includes(audience))
    .filter((d) => opts.actions !== false || !isActionTool(d.function.name))
    .map(({ type, function: fn }) => ({ type, function: fn }));
}

// ------------------------------------------------------------------ helpers

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const s = (v: unknown, max = 500) => String(v ?? "").trim().slice(0, max);
const newId = () => `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

function findByName<T extends { name: string }>(items: T[], q: string): T[] {
  const needle = q.toLowerCase().trim();
  if (!needle) return [];
  const exact = items.filter((i) => i.name.toLowerCase() === needle);
  if (exact.length) return exact;
  const words = needle.split(/\s+/).filter((w) => w.length > 1);
  return items
    .map((i) => {
      const n = i.name.toLowerCase();
      const score = (n.includes(needle) ? 10 : 0) + words.filter((w) => n.includes(w)).length;
      return { i, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.i);
}

function orderSummary(o: Order, detailed = false) {
  // Customer-facing summaries (detailed=false) name hidden products generically.
  const itemName = (n: string) => (detailed ? n : customerItemName(n));
  const base = {
    reference: orderRef(o),
    status: normalizeStatus(o.status),
    placed: fmtDate(o.createdAt),
    total: money(o.total),
    items: o.items.map((i) => `${itemName(i.productName)} ×${i.quantity}`).join(", "),
    delivery: o.shippingMethod === "pickup" ? "local pickup" : "shipping",
    tracking: o.trackingNumber || undefined,
  };
  if (!detailed) return base;
  return { id: o.id, customer: `${o.userName} <${o.userEmail}>`, source: o.source || "member", payment: o.paymentMethod || "invoice", ...base };
}

const STATUS_HELP: Record<string, string> = {
  inquiry: "an enquiry — the team will be in touch",
  pending: "waiting for payment (the invoice email has payment instructions)",
  paid: "paid and being prepared",
  completed: "completed — shipped or collected",
  cancelled: "cancelled",
};

export async function sendMail(to: string, subject: string, html: string, replyTo?: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !to) return false;
  try {
    const resend = new Resend(apiKey);
    const r = await resend.emails.send({
      from: process.env.INQUIRY_FROM_EMAIL || "onboarding@resend.dev",
      to,
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    });
    if (r.error) {
      console.error("[assistant] email rejected", r.error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[assistant] email failed", err);
    return false;
  }
}

export function staffInbox(config: AssistantConfig): string {
  return config.escalationEmail || process.env.INQUIRY_TO_EMAIL || SUPPORT_EMAIL;
}


/** A wall-clock time in local time → epoch ms (handles daylight saving). */
function pacificToEpoch(text: string): number | null {
  const m = text.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (!m) return null;
  const [y, mo, d, h, mi] = [+m[1], +m[2], +m[3], m[4] ? +m[4] : 23, m[5] ? +m[5] : 59];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    })
      .formatToParts(new Date(guess))
      .map((p) => [p.type, p.value])
  );
  const seen = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  const t = guess - (seen - guess);
  return Number.isFinite(t) ? t : null;
}

const fmtWhen = (t: number) =>
  new Date(t).toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Banner text is rendered as HTML on the site; the assistant only ever writes plain text. */
const bannerText = (v: unknown) => escapeHtml(s(v, 160).replace(/\s+/g, " "));

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function safeLink(v: unknown): string | undefined {
  const u = s(v, 300);
  if (!u) return undefined;
  if (u.startsWith("/") && !u.startsWith("//")) return u;
  if (/^https:\/\//i.test(u)) return u;
  return undefined;
}

const visibilityOf = (p: Product) => p.visibility || (p.retail ? "both" : "internal");

/** What a product would cost after a pricing change — same maths as checkout. */
function previewPrice(p: Product, change: Partial<Product>): string {
  const next = { ...p, ...change };
  // A cash-pickup-only sale shows its cash price (the card says it's cash pickup only).
  if (next.cashOnly) return `${previewPrice(asCash(next), {})} cash pickup only (others ${next.price})`;
  const now = effectivePrice(next);
  const bogo = next.promo?.type === "bogo" ? ` · 2nd ${next.promo.percent}% off (2 for ${formatMoney(parsePrice(now) * 2 - lineDiscount(next, 2))})` : "";
  return `${now}${bogo}`;
}


/**
 * A lookup for an order that exists but belongs to a different email is a
 * possible attempt to see someone else's order. The customer gets the same
 * neutral answer as for a typo; staff get an entry in the Activity log.
 */
async function logAccessDenied(ctx: ToolContext, tool: string, ref: string) {
  try {
    const exists = (await cachedOrders()).some((o) => orderRef(o) === ref);
    if (!exists) return;
    await auditSystem({
      action: "assistant.access_denied",
      targetType: "order",
      targetId: ref,
      ok: false,
      source: "ai",
      actor: ctx.user ? `member:${ctx.user.email}` : "visitor",
      actorType: ctx.user ? "member" : "visitor",
      ip: ctx.ip,
      note: `${tool}: order ${ref} exists but the email given doesn't match it. Nothing was shown.`,
    });
  } catch {
    /* logging must never break the chat */
  }
}

// ------------------------------------------------------------------ execution

type Result = Record<string, unknown> | string;

export async function runTool(name: string, rawArgs: string, ctx: ToolContext): Promise<Result> {
  // Refuse anything not offered to this audience, whatever the model asks for.
  const def = [...DEFS, ...ADMIN_EXTRA_DEFS, ...AMBASSADOR_DEFS].find((d) => d.function.name === name);
  if (!def || !def.audiences.includes(ctx.audience)) return { error: `Tool ${name} is not available.` };
  if (ctx.allowActions === false && isActionTool(name)) {
    return { error: "Preparing changes is switched off right now (Settings → Feature switches). Explain how to do it in the dashboard instead." };
  }

  let args: Record<string, unknown> = {};
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
    if (typeof args !== "object" || args === null) args = {};
  } catch {
    return { error: "Arguments were not valid JSON." };
  }

  // The rest of the dashboard's actions live in adminActions.ts.
  const extra = await runAdminExtra(name, args, ctx);
  if (extra) return extra;
  // Ambassadors: numbers, terms, payouts, progress reports (ambassadorTools.ts).
  const amb = await runAmbassadorTool(name, args, ctx);
  if (amb) return amb;

  switch (name) {
    // ------------------------------------------------ everyone
    case "find_stores": {
      if (!(await isEnabled("store_locator").catch(() => false))) return { available: false, note: "There's no in-store list on the site right now. Offer to pass the question to the team." };
      let stores = await cachedPublicStores();
      if (stores.length === 0) return { found: false, note: "No stores are listed yet." };
      const want = s(args.product, 120);
      let productName: string | undefined;
      if (want) {
        const visible = productsFor(ctx.audience, await cachedProducts());
        const p = visible.find((x) => x.id === want) || findByName(visible, want)[0];
        if (!p) return { found: false, note: "No product by that name in this catalog." };
        productName = p.name;
        stores = stores.filter((st) => (st.productIds || []).includes(p.id));
        if (stores.length === 0) return { found: false, product: p.name, note: `No store lists ${p.name} yet. It can be ordered online.` };
      }
      const near = s(args.near, 120);
      let ranked: Array<{ st: (typeof stores)[number]; miles?: number }> = stores.map((st) => ({ st }));
      if (near) {
        const n = near.toLowerCase();
        const text = stores.filter((st) => [st.city, st.zip, st.state, st.name].some((f) => (f || "").toLowerCase().includes(n)));
        if (text.length) ranked = text.map((st) => ({ st }));
        else {
          // Not a listed city/zip: look the place up (cached) and sort by distance.
          const g = await geocodeCached(near);
          if (g.point) {
            ranked = stores
              .filter((st) => typeof st.lat === "number" && typeof st.lng === "number")
              .map((st) => ({ st, miles: Math.round(milesBetween(g.point!, { lat: st.lat!, lng: st.lng! }) * 10) / 10 }))
              .sort((a, b) => a.miles! - b.miles!);
          }
        }
      }
      return {
        found: true,
        product: productName,
        map: "/stores",
        stores: ranked.slice(0, 5).map(({ st, miles }) => ({
          name: st.name,
          address: [st.street, [st.city, [st.state, st.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(", "),
          miles,
          hours: st.hours,
          phone: st.phone,
          notes: st.notes,
        })),
        say: "Shops can sell out, so suggest calling ahead. Link /stores for the map and directions.",
      };
    }
    case "get_product_details": {
      const products = productsFor(ctx.audience, await cachedProducts());
      const hits = await applyStockFlag(findByName(products, s(args.name, 120)).slice(0, 3));
      if (hits.length === 0) return { found: false, note: "No product by that name in this catalog." };
      const where = ctx.audience === "member" ? "/gallery" : ctx.audience === "public" ? "/retail" : undefined;
      return {
        found: true,
        products: hits.map((p) => ({
          ...(ctx.audience === "admin" ? { id: p.id, visibility: p.visibility } : {}),
          name: p.name,
          category: p.category,
          price: effectivePrice(p),
          regular_price: onSale(p) ? p.price : undefined,
          promotion: promoLabel(p) || undefined,
          cash_pickup_deal: cashDeal(p) || undefined,
          bundle: p.isBundle || undefined,
          availability: p.restocking ? "Currently restocking: it can still be ordered as usual and ships as soon as new stock arrives." : undefined,
          description: plainText(p.description, 1500),
          where_to_buy: where,
        })),
      };
    }
    case "show_products": {
      if (ctx.audience === "admin") return { error: "Cards are for customers." };
      const products = productsFor(ctx.audience, await cachedProducts());
      const names = (Array.isArray(args.names) ? args.names : [args.names]).map((n) => s(n, 120)).filter(Boolean).slice(0, 6);
      ctx.productIds = ctx.productIds || [];
      const shown: string[] = [];
      const missing: string[] = [];
      for (const n of names) {
        const hit = findByName(products, n)[0];
        if (!hit) {
          missing.push(n);
          continue;
        }
        if (!ctx.productIds.includes(hit.id) && ctx.productIds.length < 4) {
          ctx.productIds.push(hit.id);
          shown.push(hit.name);
        }
      }
      return {
        shown,
        ...(missing.length ? { not_found: missing, note: "Those aren't in this catalog — don't recommend them." } : {}),
        tip: "Cards with photo, price, Add to cart and View appear under your reply. Don't repeat long price lists.",
      };
    }
    case "list_upcoming_events": {
      const events = (await cachedEvents())
        .filter((e) => e.published && (e.endDate || e.date) >= Date.now())
        .sort((a, b) => a.date - b.date)
        .slice(0, 10);
      return {
        register_at: "/events",
        events: events.map((e) => ({
          title: e.title,
          when: fmtDate(e.date, true),
          where: e.location,
          price: e.price || "see event page",
          type: e.type,
          about: plainText(e.description, 400),
        })),
      };
    }

    // ------------------------------------------------ customers
    case "send_password_reset": {
      const email = s(args.email, 200).toLowerCase();
      if (!EMAIL.test(email)) return { ok: false, note: "That doesn't look like an email address — ask them to check it." };
      if (overLimit(`reset:ip:${ctx.ip}`, 3, 3600_000) || overLimit(`reset:em:${email}`, 2, 3600_000)) {
        return { ok: false, note: "Too many reset requests recently. Ask them to wait an hour or use the Forgot password link later." };
      }
      await requestPasswordReset(email);
      return {
        ok: true,
        say:
          "If that email belongs to an approved member, a new password is on its way — check inbox and spam. Sign in with it, then change it from the account menu. If nothing arrives in 10 minutes, the email may be different or the membership may still be pending.",
      };
    }
    case "check_order_status": {
      const ref = s(args.reference, 20).replace(/^ref\s*/i, "").replace(/[^a-z0-9]/gi, "").toUpperCase();
      const email = s(args.email, 200).toLowerCase();
      if (ref.length !== 6 || !EMAIL.test(email)) {
        return { found: false, note: "Need the 6-character reference from the order email and the email used on the order." };
      }
      if (overLimit(`order:ip:${ctx.ip}`, 8, 3600_000)) {
        return { found: false, note: "Too many lookups; ask them to try again later or escalate to the team." };
      }
      const order = (await cachedOrders()).find(
        (o) => orderRef(o) === ref && o.userEmail.toLowerCase() === email
      );
      // Same answer for "no such order" and "wrong email" — don't confirm references exist.
      if (!order) {
        await logAccessDenied(ctx, "check_order_status", ref);
        return { found: false, note: "No order matches that reference and email. Suggest double-checking both, or escalating." };
      }
      return { found: true, order: { ...orderSummary(order), meaning: STATUS_HELP[normalizeStatus(order.status)] } };
    }
    case "escalate_to_team": {
      const name = s(args.name, 100);
      const email = s(args.email, 200).toLowerCase();
      const topic = s(args.topic, 30) || "other";
      const summary = s(args.summary, 1000);
      if (!name || !EMAIL.test(email) || !summary) {
        return { ok: false, note: "Need their name, a valid email and a short summary before escalating." };
      }
      if (overLimit(`esc:ip:${ctx.ip}`, 3, 3600_000)) {
        return { ok: false, note: `Already sent several requests. Ask them to email ${SUPPORT_EMAIL} directly.` };
      }
      const convo = ctx.transcript
        .slice(-12)
        .map(
          (m) =>
            `<p style="margin:0 0 8px"><strong>${m.role === "user" ? "Customer" : "Assistant"}:</strong> ${escapeHtml(
              m.content.slice(0, 1500)
            ).replace(/\n/g, "<br/>")}</p>`
        )
        .join("");
      const who = ctx.user ? `Signed-in member (${escapeHtml(ctx.user.email)})` : "Website visitor";
      const html = `
        <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:620px;color:#2b2f27">
          <div style="font-size:12px;letter-spacing:.15em;text-transform:uppercase;color:#6fa336;font-weight:700">Assistant escalation · ${escapeHtml(topic)}</div>
          <h2 style="font-family:Georgia,serif;font-weight:400;font-style:italic;margin:8px 0 14px">${escapeHtml(name)} needs a hand</h2>
          <p><strong>Reply to:</strong> <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a><br/><strong>From:</strong> ${who}</p>
          <p style="background:#f3f6ec;padding:12px 14px;border-left:3px solid #85ba45">${escapeHtml(summary)}</p>
          <h3 style="font-size:14px;margin:20px 0 8px">Conversation</h3>
          <div style="font-size:14px;line-height:1.5">${convo}</div>
          <p style="font-size:12px;color:#81858b;margin-top:20px">Reply to this email (it goes to the customer), or reply from the dashboard’s Assistant tab and mark it resolved there.</p>
        </div>`;
      const emailed = await sendMail(staffInbox(ctx.config), `Assistant: ${name} — ${topic}`, html, email);
      try {
        await addEscalation({
          audience: ctx.audience,
          name,
          email,
          topic,
          summary,
          emailed,
          transcript: ctx.transcript.slice(-12).map((m) => ({ role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant", content: m.content.slice(0, 1500) })),
        });
      } catch (err) {
        console.error("[assistant] escalation record failed", err);
      }
      if (!emailed) {
        return { ok: false, note: `The message couldn't be sent. Ask them to email ${SUPPORT_EMAIL} directly.` };
      }
      return { ok: true, say: `Sent. Someone from the team will reply to ${email}, usually within one business day.` };
    }
    case "deals_and_rewards": {
      const [settings, products, banner, bundlesOn] = await Promise.all([
        getSettings(),
        cachedProducts(),
        getBanner().catch(() => null),
        isEnabled("bundles_specific_products").catch(() => false),
      ]);
      const mine = productsFor(ctx.audience, products);
      const visible = new Map(mine.map((p) => [p.id, p.name]));
      const sale = mine.filter((p) => onSale(p) || p.promo?.type === "bogo").slice(0, 20).map((p) => ({ name: p.name, price: priceLine(p) }));
      const bundles = bundlesOn
        ? (await liveBundles().catch(() => []))
            .filter((b) => b.items.every((i) => visible.has(i.productId)))
            .slice(0, 10)
            .map((b) => ({ name: b.name, deal: bundleOfferLabel(b), items: b.items.map((i) => `${i.qty > 1 ? `${i.qty}× ` : ""}${visible.get(i.productId)}`), ends: b.endsAt ? fmtDate(b.endsAt) : undefined }))
        : [];
      const perDollar = Math.max(1, settings.pointsPerDollarRedeemed || 100);
      const loyalty = settings.loyaltyEnabled
        ? {
            how_it_works: `Members earn ${settings.pointsPerDollar} point${settings.pointsPerDollar === 1 ? "" : "s"} for every $1 spent on products (not shipping), added once an order is paid or picked up. ${perDollar} points = $1 off. They can be used at checkout in the members' area once you have at least ${settings.minPointsToRedeem} points.`,
            members_only: true,
            ...(ctx.audience === "member" && ctx.user
              ? (() => {
                  const pts = Math.max(0, Math.floor(ctx.user!.loyaltyPoints || 0));
                  return { your_points: pts, worth_usd: Math.floor((pts / perDollar) * 100) / 100, can_redeem_now: pts >= settings.minPointsToRedeem, points_to_go: Math.max(0, settings.minPointsToRedeem - pts) };
                })()
              : { note: `Points are for members of ${brand.members} — they can join from the homepage.` }),
          }
        : { status: "The loyalty programme isn't running right now." };
      const announcement = banner?.enabled && banner.message ? plainText(banner.message, 300) : undefined;
      return {
        loyalty,
        on_sale_now: sale.length ? sale : "Nothing is on sale right now.",
        bundle_deals: bundles.length ? bundles : undefined,
        cart_deal: settings.bundleRuleEnabled ? `Buy ${settings.bundleRuleMinItems} or more items and get ${settings.bundleRulePercent}% off the basket (applied automatically).` : undefined,
        announcement,
        tip: "Sale prices, BOGO, bundle and cart deals apply automatically in the basket. Never invent a discount code — only mention one if it appears in the announcement.",
      };
    }
    case "get_my_orders": {
      if (!ctx.user) return { error: "Not signed in." };
      const orders = (await getOrdersByUser(ctx.user.id)).slice(0, 10);
      if (orders.length === 0) return { orders: [], note: "No orders yet." };
      return { orders: orders.map((o) => ({ ...orderSummary(o), meaning: STATUS_HELP[normalizeStatus(o.status)] })) };
    }

    // ------------------------------------------------ staff: read
    case "search_staff_guide": {
      const hits = searchStaffGuide(s(args.query, 300));
      if (hits.length === 0) return { results: [], note: "Nothing in the staff guide matched. Say so; don't guess." };
      return { results: hits };
    }
    case "business_snapshot": {
      const [i, esc] = await Promise.all([getInsights(), recentEscalations()]);
      const openEsc = esc.filter((e) => escalationStatus(e) === "open");
      const p = (x: typeof i.today) => ({ orders: x.orders, revenue: money(x.revenue), avg_order: money(x.avgOrderValue) });
      return {
        today: p(i.today),
        last_7_days: p(i.last7),
        previous_7_days: p(i.prev7),
        last_30_days: p(i.last30),
        change_vs_previous_week_pct: i.revenueChangePct,
        waiting_for_payment: { count: i.pendingCount, value: money(i.pendingValue) },
        waiting_over_3_days: i.pendingOver3Days.slice(0, 5).map((o) => `${o.userName} ${money(o.total)} (${o.daysWaiting}d)`),
        paid_not_yet_fulfilled: i.awaitingFulfillment,
        pending_member_approvals: i.pendingApprovals,
        top_products: i.topProducts.slice(0, 5).map((t) => `${t.name}: ${t.unitsSold} sold, ${money(t.revenue)}`),
        slow_movers: i.slowMovers.slice(0, 5).map((x) => x.name),
        new_customers_7d: i.newCustomers7,
        repeat_rate_pct: i.repeatRatePct,
        customer_requests_waiting_for_a_reply: openEsc.length,
        oldest_waiting: openEsc.slice(-3).map((e) => `${e.name} (${e.topic}) since ${fmtDate(e.at)}`),
        where_to_reply: "Assistant tab → Handed to the team",
      };
    }
    case "sales_insights": {
      const now = Date.now();
      let from: number;
      let to = now + 1;
      let label: string;
      let prevFrom: number | undefined;
      const fromText = s(args.from, 20);
      if (fromText) {
        const f = pacificToEpoch(`${fromText} 00:00`);
        if (!f) return { error: "from must look like 2026-09-01." };
        const toText = s(args.to, 20);
        const t = toText ? pacificToEpoch(`${toText} 23:59`) : null;
        if (toText && !t) return { error: "to must look like 2026-09-30." };
        from = f;
        if (t) to = t + 60_000;
        if (to <= from) return { error: "to must be after from." };
        label = toText ? `${fromText} to ${toText}` : `since ${fromText}`;
      } else {
        const days = args.days === undefined || args.days === null || args.days === "" ? 30 : Math.floor(Number(args.days));
        if (!Number.isFinite(days) || days < 0) return { error: "days must be 0 (all time) or more." };
        if (days === 0) {
          const all = await cachedOrders();
          from = all.length ? Math.min(...all.map((o) => o.paidAt || o.createdAt)) : now - 30 * 86_400_000;
          label = "All time";
        } else {
          from = lastNDaysStart(days, now); // today + the days before, local (same as the Analytics tab)
          prevFrom = pacificMidnight(addDays(pacificDay(from), -days)); // the N full days before
          label = `Last ${days} days`;
        }
      }
      const [orders, users, products] = await Promise.all([cachedOrders(), cachedUsers(), cachedProducts()]);
      return computeInsights(orders, users, products, {
        from,
        to,
        label,
        top: Number(args.top) || 10,
        product: s(args.product, 80) || undefined,
        customer: s(args.customer, 120) || undefined,
        prevFrom,
      }, TZ);
    }
    case "chat_insights": {
      const [ins, recent] = await Promise.all([chatInsights(), recentTranscripts({ limit: 40 })]);
      const questions = recent
        .filter((t) => t.audience !== "admin")
        .flatMap((t) => t.messages.filter((m) => m.role === "user").slice(0, 2).map((m) => `[${t.audience}] ${m.content.slice(0, 160)}`))
        .slice(0, 40);
      return { ...ins, sample_customer_questions: questions, tip: "Group the questions into themes, point out gaps in the FAQ/knowledge, and mention flagged chats first if any are high severity." };
    }
    case "find_members": {
      const q = s(args.query, 100).toLowerCase();
      const status = s(args.status, 20) || "any";
      const users = await cachedUsers(true);
      const hits = users
        .filter((u) => status === "any" || u.status === status)
        .filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
        .sort((a, b) => b.createdAt - a.createdAt);
      return {
        total_matches: hits.length,
        members: hits.slice(0, 15).map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          status: u.status,
          requested: fmtDate(u.createdAt),
          approved: u.approvedAt ? fmtDate(u.approvedAt) : undefined,
          confirmed_21_plus: u.ageVerified,
          note: u.message ? plainText(u.message, 200) : undefined,
          loyalty_points: u.loyaltyPoints || 0,
          // Staff-only tool: the address on file (for "change Jess's address").
          address: [u.addressLine1, u.addressLine2, u.city, u.state, u.postalCode].filter(Boolean).join(", ") || undefined,
          phone: u.phone || undefined,
        })),
      };
    }
    case "find_orders": {
      const q = s(args.query, 100).toLowerCase().replace(/^ref\s*/, "");
      const status = s(args.status, 20) || "any";
      const orders = await cachedOrders(true);
      const hits = orders
        .filter((o) => status === "any" || normalizeStatus(o.status) === status)
        .filter(
          (o) =>
            !q ||
            o.userName.toLowerCase().includes(q) ||
            o.userEmail.toLowerCase().includes(q) ||
            orderRef(o).toLowerCase() === q.replace(/[^a-z0-9]/g, "")
        )
        .sort((a, b) => b.createdAt - a.createdAt);
      return { total_matches: hits.length, orders: hits.slice(0, 12).map((o) => orderSummary(o, true)) };
    }
    case "list_products": {
      const q = s(args.query, 100).toLowerCase();
      const products = (await cachedProducts(true)).filter(
        (p) => !q || p.name.toLowerCase().includes(q) || (p.category || "").toLowerCase().includes(q)
      );
      return {
        total: products.length,
        products: products.slice(0, 60).map((p) => ({
          id: p.id,
          name: p.name,
          category: p.category,
          visibility: p.visibility || (p.retail ? "external" : "internal"),
          price: effectivePrice(p),
          regular_price: onSale(p) ? p.price : undefined,
          promotion: promoLabel(p) || undefined,
          cash_pickup_deal: cashDeal(p) || undefined,
        })),
      };
    }
    case "list_discount_codes": {
      const d = await getDiscounts();
      return {
        codes: d.slice(0, 40).map((x) => ({
          code: x.code,
          value: x.type === "percentage" ? `${x.value}%` : money(x.value),
          active: x.active,
          uses: x.uses,
          max_uses: x.maxUses,
          expires: x.expiresAt ? fmtDate(x.expiresAt) : undefined,
          label: x.label,
        })),
      };
    }

    // ------------------------------------------------ staff: propose
    case "propose_member_status": {
      const id = s(args.member_id, 80);
      const status = args.status === "rejected" ? "rejected" : args.status === "approved" ? "approved" : null;
      if (!status) return { error: "status must be approved or rejected" };
      const u = (await cachedUsers(true)).find((x) => x.id === id);
      if (!u) return { error: "No member with that id. Use find_members first." };
      if (u.status === status) return { note: `${u.name} is already ${status}. Nothing to do.` };
      ctx.actions.push({
        id: newId(),
        kind: "member_status",
        title: status === "approved" ? `Approve ${u.name}` : `Reject ${u.name}`,
        lines: [
          `${u.name} · ${u.email}`,
          `Requested ${fmtDate(u.createdAt)} · currently ${u.status}`,
          u.ageVerified ? "Confirmed 21 or over" : "⚠ Did not confirm 21 or over",
          status === "approved" && !u.welcomeEmailSentAt ? "They'll get the welcome email." : "",
        ].filter(Boolean),
        confirmLabel: status === "approved" ? "Approve" : "Reject",
        danger: status === "rejected",
        request: { method: "PATCH", url: "/api/admin/users", body: { id: u.id, status } },
        refresh: ["users"],
      });
      return { proposed: true, say: "The card is ready for them to confirm. Nothing has changed yet." };
    }
    case "propose_store": {
      const input: Record<string, unknown> = {
        name: s(args.name, 120), street: s(args.street, 160), city: s(args.city, 80), state: s(args.state, 40), zip: s(args.zip, 12),
        phone: s(args.phone, 30), website: s(args.website, 300), hours: s(args.hours, 400), notes: s(args.notes, 400),
        active: args.hidden !== true,
      };
      // A hidden (pending) store may wait for its street address; a live one needs it.
      if (!input.street && input.active) return { error: `No street address for ${input.name || "that store"} — ask staff for it, or add it as hidden (pending) for now.` };
      const c = cleanStore(input);
      if (!c.ok) return { error: c.error };
      const existing = (await getStores()).find((x) => x.name.toLowerCase() === c.value.name.toLowerCase() && x.city.toLowerCase() === c.value.city.toLowerCase());
      if (existing) return { note: `${existing.name} (${existing.city}) is already on the map. Edit it in Settings → Store locations if anything changed.` };
      const wanted = Array.isArray(args.products) ? args.products.map((x) => s(x, 120)).filter(Boolean).slice(0, 30) : [];
      const all = await cachedProducts(true);
      const productIds: string[] = [];
      const missing: string[] = [];
      for (const w of wanted) {
        const hit = all.find((x) => x.id === w) || findByName(all, w)[0];
        if (hit) productIds.push(hit.id);
        else missing.push(w);
      }
      const addr = [c.value.street, c.value.city, [c.value.state, c.value.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
      ctx.actions.push({
        id: newId(),
        kind: "store_create",
        title: `Add store: ${c.value.name}${input.active ? "" : " (hidden for now)"}`,
        lines: [
          addr,
          [c.value.phone, c.value.website, c.value.hours].filter(Boolean).join(" · "),
          productIds.length ? `Carries: ${productIds.map((id) => all.find((x) => x.id === id)?.name).join(", ")}` : "",
          missing.length ? `Not found in the catalog (left off): ${missing.join(", ")}` : "",
          input.active ? "Shows on the Find us in stores map once saved (the pin comes from the address)." : "Saved as Hidden: switch it on in Settings → Store locations when it's ready.",
          input.street ? "" : "No street address yet: the pin goes in the middle of the city. Add the address before showing it.",
        ].filter(Boolean),
        confirmLabel: "Add store",
        request: { method: "POST", url: "/api/admin/stores", body: { ...input, productIds } },
        refresh: [],
      });
      return { proposed: true, say: "Ready to confirm. Nothing has changed yet." };
    }
    case "list_faq": {
      const items = await getFaq();
      return { count: items.length, published: items.filter((f) => f.published).length, items: items.map((f) => ({ id: f.id, question: f.question, answer: f.answer.slice(0, 1500), topic: f.category || "General", published: f.published })) };
    }
    case "propose_faq": {
      const action = String(args.action);
      const items = await getFaq();
      const hit = items.find((f) => f.id === s(args.faq_id, 80));
      if (action !== "add" && !hit) return { error: "No FAQ entry with that id. Use list_faq." };
      if (action === "add") {
        const question = s(args.question, 300), answer = s(args.answer, 6000);
        if (!question || !answer) return { error: "Need the question and its answer." };
        const published = args.published === true;
        ctx.actions.push({
          id: newId(),
          kind: "faq_add",
          title: `Add to the FAQ${published ? "" : " (as a draft)"}: ${question}`,
          lines: [s(args.topic, 60) ? `Topic: ${s(args.topic, 60)}` : "Topic: General", published ? "Goes on /faq and the Concierge uses it once confirmed." : "Saved as a draft: publish it in Settings → FAQ page when it's approved."],
          preview: answer.slice(0, 1200),
          confirmLabel: published ? "Add and publish" : "Save draft",
          request: { method: "POST", url: "/api/admin/faq", body: { question, answer, category: s(args.topic, 60), published } },
          refresh: ["faq" as const],
        });
        return { proposed: true, say: "Ready to confirm. Nothing has changed yet." };
      }
      const f = hit!;
      if (action === "edit") {
        const body: Record<string, unknown> = { id: f.id };
        const lines: string[] = [];
        const has = (a: Record<string, unknown>, k: string) => a[k] !== undefined && a[k] !== null;
        if (has(args, "question") && s(args.question, 300) && s(args.question, 300) !== f.question) { body.question = s(args.question, 300); lines.push(`Question: ${f.question} → ${body.question}`); }
        if (has(args, "answer") && s(args.answer, 6000) && s(args.answer, 6000) !== f.answer) { body.answer = s(args.answer, 6000); lines.push("New answer (below)"); }
        if (has(args, "topic") && s(args.topic, 60) !== f.category) { body.category = s(args.topic, 60); lines.push(`Topic: ${f.category || "General"} → ${s(args.topic, 60) || "General"}`); }
        if (!lines.length) return { note: "Nothing would change." };
        if (f.published) lines.push("It's published: the page and the Concierge change once confirmed.");
        ctx.actions.push({ id: newId(), kind: "faq_edit", title: `Edit FAQ: ${f.question}`, lines, preview: typeof body.answer === "string" ? body.answer.slice(0, 1200) : undefined, confirmLabel: "Save changes", request: { method: "PUT", url: "/api/admin/faq", body }, refresh: ["faq" as const] });
        return { proposed: true, say: "Ready to confirm. Nothing has changed yet." };
      }
      if (action === "publish" || action === "unpublish") {
        const on = action === "publish";
        if (f.published === on) return { note: `It's already ${on ? "published" : "a draft"}.` };
        ctx.actions.push({ id: newId(), kind: "faq_publish", title: `${on ? "Publish" : "Unpublish"} FAQ: ${f.question}`, lines: [on ? "Shows on /faq and the Concierge starts using it." : "Comes off /faq and the Concierge stops using it (kept as a draft)."], confirmLabel: on ? "Publish" : "Unpublish", request: { method: "PUT", url: "/api/admin/faq", body: { id: f.id, published: on } }, refresh: ["faq" as const] });
        return { proposed: true, say: "Ready to confirm. Nothing has changed yet." };
      }
      if (action === "delete") {
        ctx.actions.push({ id: newId(), kind: "faq_delete", title: `Delete FAQ: ${f.question}`, lines: ["Removed from /faq and the Concierge. This can't be undone (unpublish keeps it instead)."], confirmLabel: "Delete", danger: true, request: { method: "DELETE", url: `/api/admin/faq?id=${encodeURIComponent(f.id)}`, body: undefined }, refresh: ["faq" as const] });
        return { proposed: true, say: "Ready to confirm. Nothing has changed yet." };
      }
      return { error: "action must be add, edit, publish, unpublish or delete." };
    }
    case "propose_stock_count": {
      const id = s(args.product_id, 80);
      const n = Number(args.count);
      if (!Number.isInteger(n) || n < 0 || n > 99999) return { error: "count must be a whole number from 0 up." };
      const p = (await cachedProducts(true)).find((x) => x.id === id);
      if (!p) return { error: "No product with that id. Use list_products first." };
      if (p.isBundle) return { error: `${p.name} is a bundle: set the counts of the products in it.` };
      const stock = await getStock();
      const was = stock.has(id) ? stock.get(id)! : null;
      const owed = backorders((await cachedOrders(true)).map((o) => ({ ...o, status: normalizeStatus(o.status) })), await cachedProducts()).get(id);
      ctx.actions.push({
        id: newId(),
        kind: "stock_count",
        title: `Stock count: ${p.name} → ${n}`,
        lines: [
          `Now: ${was === null ? "not counted" : `${was} in stock`} → ${n}`,
          owed ? `${owed.units} on backorder across ${owed.orders} open order${owed.orders === 1 ? "" : "s"}: send those first, and count only what's left after.` : "",
          n > 0 && (was === null || was <= 0) ? "The shop stops saying “Currently restocking”." : "",
        ].filter(Boolean),
        confirmLabel: "Set count",
        request: { method: "PUT", url: "/api/admin/stock", body: { counts: { [id]: n } } },
        refresh: ["products"],
      });
      return { proposed: true, say: "The card is ready for them to confirm. Nothing has changed yet." };
    }
    case "venmo_payments": {
      if (!(await isEnabled("venmo_matching").catch(() => false))) return { available: false, note: "Venmo payment matching is switched off (Settings → Feature switches)." };
      const { rows } = await venmoInbox();
      const pick = String(args.show) === "all" ? rows : rows.filter((r) => r.state === "new");
      return {
        payments: pick.slice(0, 25).map((r) => ({
          id: r.id,
          received: fmtDate(r.receivedAt),
          payer: r.payer,
          amount: r.amount,
          note: r.note,
          status: !r.verified ? `quarantined: ${r.reason}` : r.state,
          match: r.match ? { strength: r.match.strength, order_id: r.match.orderId, why: r.match.why, candidates: r.match.candidates.slice(0, 5) } : undefined,
          confirmed_order: r.orderId,
        })),
        say: "Only strong and medium matches are suggestions. Weak ones need a person to pick the order in Orders → Venmo payments.",
      };
    }
    case "propose_venmo_payment": {
      const pid = s(args.payment_id, 80);
      const oid = s(args.order_id, 80);
      const { rows } = await venmoInbox();
      const p = rows.find((r) => r.id === pid);
      if (!p) return { error: "No Venmo payment with that id. Use venmo_payments first." };
      if (!p.verified) return { error: `That email is quarantined (${p.reason}). It can't be matched.` };
      if (p.state !== "new") return { note: `That payment is already ${p.state}.` };
      const o = (await cachedOrders(true)).find((x) => x.id === oid);
      if (!o) return { error: "No order with that id. Use find_orders first." };
      if (normalizeStatus(o.status) !== "pending" || o.paidAt) return { note: `Order ${orderRef(o)} is already ${normalizeStatus(o.status)}.` };
      const strength = p.match?.orderId === o.id ? p.match.strength : "picked by hand";
      const differs = typeof p.amount === "number" && Math.abs(p.amount - o.total) >= 0.005;
      ctx.actions.push({
        id: newId(),
        kind: "venmo_payment",
        title: `Mark order ${orderRef(o)} paid (Venmo)`,
        lines: [
          `Venmo ${money(p.amount || 0)} from ${p.payer}${p.note ? ` · note “${p.note.slice(0, 80)}”` : ""}`,
          `Order ${orderRef(o)} · ${o.userName} · ${money(o.total)} · placed ${fmtDate(o.createdAt)}`,
          `Match: ${strength}${p.match?.orderId === o.id ? ` (${p.match.why})` : ""}`,
          differs ? `⚠ The amounts differ (paid ${money(p.amount || 0)}, order ${money(o.total)}). Check before confirming.` : "",
          "Loyalty points are awarded as usual. Payment reminders stop.",
        ].filter(Boolean),
        confirmLabel: "Mark paid",
        danger: differs,
        request: { method: "POST", url: "/api/admin/venmo", body: { action: "confirm", paymentId: p.id, orderId: o.id } },
        refresh: ["orders"],
      });
      return { proposed: true, say: "The card is ready for them to confirm. Nothing has changed yet." };
    }
    case "propose_order_status": {
      const id = s(args.order_id, 80);
      const allowed = ["pending", "paid", "completed", "cancelled"];
      const status = allowed.includes(String(args.status)) ? (String(args.status) as OrderStatus) : null;
      if (!status) return { error: `status must be one of ${allowed.join(", ")}` };
      const o = (await cachedOrders(true)).find((x) => x.id === id);
      if (!o) return { error: "No order with that id. Use find_orders first." };
      if (normalizeStatus(o.status) === status) return { note: `Order ${orderRef(o)} is already ${status}.` };
      const cancelling = status === "cancelled";
      const was = normalizeStatus(o.status);
      const wasPaid = !!o.paidAt || was === "paid" || was === "completed";
      ctx.actions.push({
        id: newId(),
        kind: "order_status",
        title: cancelling ? `Cancel order ${orderRef(o)}` : `Mark order ${orderRef(o)} as ${status}`,
        lines: [
          `${o.userName} · ${o.userEmail}`,
          `${money(o.total)} · ${o.items.map((i) => `${i.productName} ×${i.quantity}`).join(", ")}`,
          `Currently ${was}${o.expiredAt && was === "pending" ? " (expired)" : ""} · placed ${fmtDate(o.createdAt)}`,
          status === "paid" || status === "completed" ? "Loyalty points are awarded as usual." : "",
          // Cancelling only changes the status: say plainly what it does and doesn't do.
          cancelling && !wasPaid ? "Unpaid: it leaves Pending payment and its payment reminders stop." : "",
          cancelling && wasPaid ? "Already paid: refund them yourself (Venmo, Zelle or cash). The site doesn't move money." : "",
          cancelling && o.loyaltyPointsEarned ? `The ${o.loyaltyPointsEarned} loyalty points they earned on it stay on their account.` : "",
          cancelling && o.stockTaken?.length && !o.stockReturnedAt ? "Its items go back into Stock counts." : "",
          cancelling ? "The customer isn't emailed. Ask me for a note to them if they should know." : "",
          cancelling ? "You can undo it later by setting the order's status back in Orders." : "",
        ].filter(Boolean),
        confirmLabel: cancelling ? "Cancel order" : `Mark ${status}`,
        danger: cancelling,
        request: { method: "PATCH", url: "/api/admin/orders", body: { id: o.id, status } },
        refresh: ["orders"],
      });
      return {
        proposed: true,
        say: cancelling
          ? "The cancel card is ready for them to confirm. Nothing has changed yet. The customer isn't told automatically: offer to prepare a short note to them (propose_order_message)."
          : "Ready to confirm. Nothing has changed yet.",
      };
    }
    case "propose_product_visibility": {
      const ids = Array.isArray(args.product_ids) ? args.product_ids.map((x) => s(x, 80)).filter(Boolean).slice(0, 50) : [];
      const vis = ["internal", "external", "both"].includes(String(args.visibility)) ? String(args.visibility) : null;
      if (!vis || ids.length === 0) return { error: "Need product_ids and a visibility of internal, external or both." };
      const products = (await cachedProducts(true)).filter((p) => ids.includes(p.id));
      if (products.length === 0) return { error: "None of those ids exist. Use list_products first." };
      const label = vis === "internal" ? "Members only" : vis === "external" ? "Public shop only" : "Both shops";
      ctx.actions.push({
        id: newId(),
        kind: "product_visibility",
        title: `${label}: ${products.length} product${products.length === 1 ? "" : "s"}`,
        lines: products.slice(0, 8).map((p) => `${p.name} (now ${p.visibility || (p.retail ? "external" : "internal")})`).concat(
          products.length > 8 ? [`…and ${products.length - 8} more`] : []
        ),
        confirmLabel: "Apply",
        request: { method: "PATCH", url: "/api/admin/products", body: { ids: products.map((p) => p.id), visibility: vis } },
        refresh: ["products"],
      });
      return { proposed: true, missing_ids: ids.filter((i) => !products.some((p) => p.id === i)), say: "Ready to confirm." };
    }
    case "propose_discount_code": {
      const type = args.type === "fixed" ? "fixed" : "percentage";
      const value = Number(args.value);
      if (!Number.isFinite(value) || value <= 0 || (type === "percentage" && value > 100)) {
        return { error: "value must be above 0 (and at most 100 for a percentage)." };
      }
      const code = args.code ? normalizeCode(s(args.code, 30)) : "";
      if (code && (await getDiscounts()).some((d) => d.code === code)) return { error: `Code ${code} already exists.` };
      if (code && ctx.actions.some((a) => a.kind === "discount_code" && (a.request?.body as { code?: string } | undefined)?.code === code))
        return { note: `A card for ${code} is already prepared above — don't prepare it again.` };
      const days = Number(args.expires_in_days);
      const expiresAt = Number.isFinite(days) && days > 0 ? Date.now() + Math.round(days) * 86_400_000 : undefined;
      const maxUses = Number(args.max_uses) > 0 ? Math.floor(Number(args.max_uses)) : undefined;
      const minOrder = Number(args.min_order) > 0 ? Number(args.min_order) : undefined;
      const body = { code, type, value, label: s(args.label, 80) || undefined, maxUses, expiresAt, minOrderAmount: minOrder, publicShop: args.public_shop === true || undefined, active: true };
      ctx.actions.push({
        id: newId(),
        kind: "discount_code",
        title: `New code ${code || "(auto-generated)"}: ${type === "percentage" ? `${value}% off` : `${money(value)} off`}`,
        lines: [
          maxUses ? `Up to ${maxUses} uses` : "Unlimited uses",
          expiresAt ? `Expires ${new Date(expiresAt).toLocaleDateString("en-US", { timeZone: TZ })}` : "No expiry",
          minOrder ? `Minimum order ${money(minOrder)}` : "",
          body.label ? `Note: ${body.label}` : "",
          body.publicShop ? "Works in the public shop too" : "Members only",
        ].filter(Boolean),
        confirmLabel: "Create code",
        request: { method: "POST", url: "/api/admin/discounts", body },
        refresh: ["discounts"],
      });
      return { proposed: true, say: "Ready to confirm." };
    }
    case "get_site_settings": {
      const [st, b] = await Promise.all([getSettings(), getBanner()]);
      return {
        banner: {
          showing: b.enabled && !!b.message.trim() && !(b.countdownTo && b.countdownTo < Date.now()),
          text: stripTags(b.message),
          link: b.linkUrl ? `${b.linkLabel || "link"} → ${b.linkUrl}` : undefined,
          countdown_to: b.countdownTo ? fmtWhen(b.countdownTo) : undefined,
          countdown_label: b.countdownLabel,
        },
        bundle_rule: st.bundleRuleEnabled
          ? `On: ${st.bundleRulePercent}% off carts with ${st.bundleRuleMinItems}+ items`
          : `Off (last setting: ${st.bundleRulePercent}% off ${st.bundleRuleMinItems}+ items)`,
        loyalty: st.loyaltyEnabled
          ? `On: ${st.pointsPerDollar} point(s) per $1; ${st.pointsPerDollarRedeemed} points = $1; min ${st.minPointsToRedeem} to redeem`
          : "Off",
      };
    }
    case "propose_sale": {
      const ids = Array.isArray(args.product_ids) ? args.product_ids.map((x) => s(x, 80)).filter(Boolean).slice(0, 60) : [];
      const mode = String(args.mode);
      if (!["percent_off", "bogo", "sale_price", "end_sale"].includes(mode)) return { error: "mode must be percent_off, bogo, sale_price or end_sale." };
      const products = (await cachedProducts(true)).filter((p) => ids.includes(p.id));
      if (products.length === 0) return { error: "None of those ids exist. Use list_products first." };
      const percent = Math.round(Number(args.percent));
      let pricing: Record<string, unknown>;
      let change: (p: Product) => Partial<Product>;
      let title: string;
      if (mode === "percent_off" || mode === "bogo") {
        if (!Number.isFinite(percent) || percent < 1 || percent > 99) return { error: "percent must be between 1 and 99." };
        pricing = { mode: mode === "percent_off" ? "percent" : "bogo", percent };
        change =
          mode === "percent_off"
            ? () => ({ promo: { type: "percent", percent }, salePrice: undefined })
            : () => ({ promo: { type: "bogo", percent } });
        title = mode === "percent_off" ? `${percent}% off` : `Buy one, get one ${percent}% off`;
      } else if (mode === "sale_price") {
        const amount = Math.round(Number(args.sale_price) * 100) / 100;
        if (!(amount > 0)) return { error: "sale_price must be above 0." };
        const tooHigh = products.filter((p) => amount >= parsePrice(p.price));
        if (tooHigh.length) return { error: `${formatMoney(amount)} isn't below the regular price of ${tooHigh.map((p) => `${p.name} (${p.price})`).join(", ")}.` };
        pricing = { mode: "sale_price", salePrice: amount };
        change = (p) => ({ salePrice: formatMoney(amount), promo: p.promo?.type === "bogo" ? p.promo : undefined });
        title = `Sale price ${formatMoney(amount)}`;
      } else {
        const onPromo = products.filter((p) => onSale(p) || p.promo);
        if (onPromo.length === 0) return { note: "None of those products are on sale right now. Nothing to do." };
        pricing = { mode: "clear" };
        change = () => ({ salePrice: undefined, promo: undefined });
        title = "End sale";
      }
      // Cash pickup only (or not): sent with the sale; left out = each product keeps its setting.
      if (mode !== "end_sale" && typeof args.cash_pickup_only === "boolean") {
        const cashOnly = args.cash_pickup_only;
        pricing = { ...pricing, cashOnly };
        const base = change;
        change = (p) => ({ ...base(p), cashOnly: cashOnly || undefined });
        title += cashOnly ? " (cash pickup only)" : "";
      }
      const lines = products.slice(0, 10).map((p) => `${p.name}: ${previewPrice(p, {})} → ${previewPrice(p, change(p))}`);
      if (products.length > 10) lines.push(`…and ${products.length - 10} more`);
      if (mode !== "end_sale" && products.some((p) => ({ ...p, ...change(p) }).cashOnly)) lines.push("Cash pickup only: shipped and invoiced orders pay the regular price.");
      if (mode !== "end_sale") lines.push("Shows on the site right away. It stays on until you end it.");
      ctx.actions.push({
        id: newId(),
        kind: "product_sale",
        title: `${title}: ${products.length} product${products.length === 1 ? "" : "s"}`,
        lines,
        confirmLabel: mode === "end_sale" ? "End sale" : "Start sale",
        request: { method: "PATCH", url: "/api/admin/products", body: { ids: products.map((p) => p.id), pricing } },
        refresh: ["products"],
      });
      return { proposed: true, missing_ids: ids.filter((i) => !products.some((p) => p.id === i)), say: "Ready to confirm. Nothing has changed yet." };
    }
    case "propose_bundle": {
      const name = s(args.name, 80);
      if (!name) return { error: "Give the bundle a name." };
      const all = await cachedProducts(true);
      if (all.some((p) => p.name.toLowerCase() === name.toLowerCase())) return { error: `A product called "${name}" already exists.` };
      const ids = Array.isArray(args.product_ids) ? Array.from(new Set(args.product_ids.map((x) => s(x, 80)).filter(Boolean))) : [];
      const items = ids.map((id) => all.find((p) => p.id === id)).filter((p): p is Product => !!p);
      if (items.length < 2) return { error: "A bundle needs at least 2 existing products. Use list_products for ids." };
      if (items.length > 10) return { error: "Keep bundles to 10 products or fewer." };
      if (items.some((p) => p.isBundle)) return { error: "A bundle can't contain another bundle." };
      const value = Math.round(items.reduce((n, p) => n + parsePrice(effectivePrice(p)), 0) * 100) / 100;
      const explicit = Number(args.price);
      const pct = Number.isFinite(Number(args.discount_percent)) ? Math.round(Number(args.discount_percent)) : 10;
      if (!(explicit > 0) && (pct < 0 || pct > 90)) return { error: "discount_percent must be between 0 and 90." };
      const price = explicit > 0 ? Math.round(explicit * 100) / 100 : Math.round(value * (1 - pct / 100) * 100) / 100;
      if (!(price > 0)) return { error: "The bundle price must be above $0." };
      const allPublic = items.every((p) => isExternal(p));
      const allMembers = items.every((p) => isInternal(p));
      const wanted = ["internal", "external", "both"].includes(String(args.visibility)) ? String(args.visibility) : allPublic ? (allMembers ? "both" : "external") : "internal";
      if ((wanted === "external" || wanted === "both") && !allPublic) {
        const hidden = items.filter((p) => !isExternal(p)).map((p) => p.name);
        return { error: `Can't sell this publicly: ${hidden.join(", ")} ${hidden.length === 1 ? "is" : "are"} members-only. Offer it to members only, or swap those out.` };
      }
      if ((wanted === "internal" || wanted === "both") && !allMembers) {
        const pub = items.filter((p) => !isInternal(p)).map((p) => p.name);
        return { error: `${pub.join(", ")} ${pub.length === 1 ? "isn't" : "aren't"} in the members' shop. Sell the bundle in the public shop only, or swap those out.` };
      }
      const intro = s(args.description, 600) || `A curated set of ${items.length} favourites, together for less.`;
      const description = `${intro}\n\nIncludes:\n${items.map((p) => `- ${p.name}`).join("\n")}`;
      const image = items.find((p) => p.image)?.image || "";
      if (!image) return { error: "None of those products has a photo to use. Add the bundle in the dashboard so you can pick one." };
      const saving = Math.round((value - price) * 100) / 100;
      const where = wanted === "internal" ? "Members only" : wanted === "external" ? "Public shop only" : "Both shops";
      ctx.actions.push({
        id: newId(),
        kind: "bundle",
        title: `New bundle: ${name}`,
        lines: [
          `Includes: ${items.map((p) => p.name).join(", ")}`,
          `Price ${formatMoney(price)} · bought separately ${formatMoney(value)}${saving > 0 ? ` · saves ${formatMoney(saving)}` : ""}`,
          saving <= 0 ? "⚠ This costs the same as, or more than, buying them separately." : "",
          `${where} · photo from ${items.find((p) => p.image)!.name} (change it in Products)`,
        ].filter(Boolean),
        confirmLabel: "Create bundle",
        request: {
          method: "POST",
          url: "/api/admin/products",
          body: {
            name,
            description,
            price: formatMoney(price),
            image,
            category: "Bundles",
            visibility: wanted,
            isBundle: true,
            bundleProducts: items.map((p) => p.id),
            bundleDiscount: explicit > 0 ? undefined : pct || undefined,
          },
        },
        refresh: ["products"],
      });
      return { proposed: true, price: formatMoney(price), combined_value: formatMoney(value), say: "Ready to confirm. Nothing has changed yet." };
    }
    case "propose_bundle_rule": {
      const cur = await getSettings();
      const enabled = args.enabled === true;
      const minItems = args.min_items !== undefined ? Math.floor(Number(args.min_items)) : cur.bundleRuleMinItems;
      const percent = args.percent !== undefined ? Number(args.percent) : cur.bundleRulePercent;
      if (enabled && (!Number.isFinite(minItems) || minItems < 2)) return { error: "min_items must be 2 or more." };
      if (enabled && (!Number.isFinite(percent) || percent < 1 || percent > 90)) return { error: "percent must be between 1 and 90." };
      const before = cur.bundleRuleEnabled ? `now ${cur.bundleRulePercent}% off ${cur.bundleRuleMinItems}+ items` : "now off";
      ctx.actions.push({
        id: newId(),
        kind: "bundle_rule",
        title: enabled ? `Bundle & save: ${percent}% off ${minItems}+ items` : "Turn off bundle & save",
        lines: [
          `Currently ${before}.`,
          enabled ? `Any cart with ${minItems} or more items gets ${percent}% off, on top of product sales.` : "Carts go back to normal pricing.",
        ],
        confirmLabel: enabled ? "Apply" : "Turn off",
        request: {
          method: "POST",
          url: "/api/admin/settings",
          body: enabled
            ? { partial: true, bundleRuleEnabled: true, bundleRuleMinItems: minItems, bundleRulePercent: percent }
            : { partial: true, bundleRuleEnabled: false },
        },
        refresh: ["settings"],
      });
      return { proposed: true, say: "Ready to confirm." };
    }
    case "propose_banner": {
      if (args.enabled === false) {
        ctx.actions.push({
          id: newId(),
          kind: "banner",
          title: "Turn off the announcement banner",
          lines: ["The text is kept, so you can switch it back on from Settings."],
          confirmLabel: "Turn off",
          request: { method: "POST", url: "/api/admin/banner", body: { partial: true, enabled: false } },
          refresh: ["banner"],
        });
        return { proposed: true, say: "Ready to confirm." };
      }
      const message = bannerText(args.message);
      if (!message) return { error: "Give the banner some text." };
      const linkUrl = safeLink(args.link_url);
      if (s(args.link_url) && !linkUrl) return { error: "link_url must be a site path like /retail or a full https:// address." };
      const linkLabel = linkUrl ? s(args.link_label, 60) || "Learn more" : undefined;
      let countdownTo: number | undefined;
      if (s(args.countdown_to)) {
        const t = pacificToEpoch(s(args.countdown_to, 40));
        if (!t) return { error: "countdown_to must look like 2026-10-31 18:00 (local time)." };
        if (t < Date.now() + 5 * 60_000) return { error: "The countdown has to end in the future." };
        countdownTo = t;
      }
      const countdownLabel = countdownTo ? s(args.countdown_label, 60) || "Ends in" : undefined;
      ctx.actions.push({
        id: newId(),
        kind: "banner",
        title: "Show a new announcement banner",
        lines: [
          `“${stripTags(message)}”`,
          linkUrl ? `Button: ${linkLabel} → ${linkUrl}` : "",
          countdownTo ? `Countdown: “${countdownLabel}” until ${fmtWhen(countdownTo)} local, then it hides itself` : "",
          "Shows at the top of every page. Colours stay as they are.",
        ].filter(Boolean),
        confirmLabel: "Show banner",
        request: {
          method: "POST",
          url: "/api/admin/banner",
          body: { partial: true, enabled: true, message, linkUrl: linkUrl ?? null, linkLabel: linkLabel ?? null, countdownTo: countdownTo ?? null, countdownLabel: countdownLabel ?? null },
        },
        refresh: ["banner"],
      });
      return { proposed: true, say: "Ready to confirm." };
    }
    case "propose_order_message":
    case "propose_member_message": {
      // A handful per reply keeps every card readable and every send deliberate.
      const MAX_MESSAGES = 10;
      if (ctx.actions.filter((a) => a.kind === "order_message" || a.kind === "member_message").length >= MAX_MESSAGES) {
        return { error: `That's ${MAX_MESSAGES} emails prepared already. Ask them to send or dismiss those first, then do the rest.` };
      }
      const subject = s(args.subject, 150).replace(/\s+/g, " ");
      const message = String(args.message ?? "").replace(/\r\n/g, "\n").trim().slice(0, 4000);
      if (!subject || !message) return { error: "Need a subject and a message." };

      if (name === "propose_order_message") {
        const o = (await cachedOrders(true)).find((x) => x.id === s(args.order_id, 80));
        if (!o) return { error: "No order with that id. Use find_orders first." };
        if (!EMAIL.test(o.userEmail)) return { error: "That order has no valid email address." };
        if (ctx.actions.some((a) => a.kind === "order_message" && (a.request.body as { orderId?: string }).orderId === o.id)) {
          return { note: `An email for order ${orderRef(o)} is already prepared above.` };
        }
        const unpaid = normalizeStatus(o.status) === "pending";
        const payLink = unpaid && o.paymentMethod !== "cash" && args.include_pay_link !== false;
        ctx.actions.push({
          id: newId(),
          kind: "order_message",
          title: `Email ${o.userName} about order ${orderRef(o)}`,
          lines: [
            `To: ${o.userEmail}${o.source === "retail" ? " (guest)" : ""}`,
            `Subject: ${subject}`,
            `Order ${orderRef(o)} · ${money(o.total)} · ${normalizeStatus(o.status)} since ${fmtDate(o.createdAt)}`,
            payLink ? "Includes a “View & pay” button for this order." : "",
          ].filter(Boolean),
          preview: `Hello, ${o.userName}\n\n${message}`,
          confirmLabel: "Send email",
          busyLabel: "Sending…",
          request: { method: "POST", url: "/api/admin/orders/message", body: { orderId: o.id, subject, message, includePayLink: payLink } },
          refresh: [],
        });
        return { proposed: true, pay_button: payLink, say: "The email is shown for them to check and send. It has NOT been sent." };
      }

      const u = (await cachedUsers(true)).find((x) => x.id === s(args.member_id, 80));
      if (!u) return { error: "No member with that id. Use find_members first." };
      if (ctx.actions.some((a) => a.kind === "member_message" && (a.request.body as { userId?: string }).userId === u.id)) {
        return { note: `An email to ${u.name} is already prepared above.` };
      }
      ctx.actions.push({
        id: newId(),
        kind: "member_message",
        title: `Email ${u.name}`,
        lines: [`To: ${u.email} · ${u.status} member`, `Subject: ${subject}`],
        preview: `Hello, ${u.name}\n\n${message}`,
        confirmLabel: "Send email",
        busyLabel: "Sending…",
        request: { method: "POST", url: "/api/admin/users/message", body: { userId: u.id, subject, message } },
        refresh: [],
      });
      return { proposed: true, say: "The email is shown for them to check and send. It has NOT been sent." };
    }
    case "resend_my_invoice": {
      if (overLimit(`resend:ip:${ctx.ip}`, 3, 3600_000)) {
        return { ok: false, note: "Already re-sent recently. Ask them to check spam, or offer to pass it to the team." };
      }
      const ref = s(args.reference, 20).replace(/^ref\s*/i, "").replace(/[^a-z0-9]/gi, "").toUpperCase();
      let order: Order | undefined;
      if (ctx.audience === "member" && ctx.user) {
        const mine = (await getOrdersByUser(ctx.user.id)).filter((o) => canResendInvoice(o).ok);
        if (ref) order = mine.find((o) => orderRef(o) === ref);
        else if (mine.length === 1) order = mine[0];
        else if (mine.length > 1) return { ok: false, note: `They have ${mine.length} unpaid orders: ${mine.map((o) => `${orderRef(o)} (${money(o.total)})`).join(", ")}. Ask which one.` };
        if (!order) {
          if (ref) await logAccessDenied(ctx, "resend_my_invoice", ref);
          return { ok: false, note: "No unpaid invoice on their account matches that. get_my_orders shows what they have." };
        }
      } else {
        const email = s(args.email, 200).toLowerCase();
        if (ref.length !== 6 || !EMAIL.test(email)) return { ok: false, note: "Need the 6-character reference and the email used on the order." };
        order = (await cachedOrders(true)).find((o) => orderRef(o) === ref && o.userEmail.toLowerCase() === email);
        if (!order) {
          await logAccessDenied(ctx, "resend_my_invoice", ref);
          return { ok: false, note: "No order matches that reference and email." };
        }
      }
      if (overLimit(`resend:order:${order.id}`, 2, 3600_000)) return { ok: false, note: "That invoice was just re-sent. Ask them to check spam." };
      const check = canResendInvoice(order);
      if (!check.ok) return { ok: false, note: check.reason };
      const siteUrl = brand.siteUrl;
      const r = await resendInvoice(order, siteUrl);
      if (!r.ok) return { ok: false, note: `Couldn't send it just now. Offer to pass it to the team, or email ${SUPPORT_EMAIL}.` };
      await auditSystem({
        action: "invoice.resend",
        targetType: "order",
        targetId: order.id,
        ok: true,
        source: "ai",
        actor: ctx.user ? `member:${ctx.user.email}` : "visitor",
        actorType: ctx.user ? "member" : "visitor",
        ip: ctx.ip,
        note: "Customer asked the Concierge to resend their own invoice.",
      });
      return { ok: true, say: `Sent — the invoice for order ${orderRef(order)} (${money(order.total)}) is on its way to the email on the order. Check spam if it isn't there in a few minutes.` };
    }
    case "daily_tasks": {
      const now = Date.now();
      const DAY = 86_400_000;
      const [orders, users, esc, events, codes] = await Promise.all([
        cachedOrders(true),
        cachedUsers(true),
        recentEscalations(),
        cachedEvents(true),
        getDiscounts(),
      ]);
      const days = (t: number) => Math.floor((now - t) / DAY);
      const pendingMembers = users.filter((u) => u.status === "pending").sort((a, b) => a.createdAt - b.createdAt);
      const unpaid = orders
        .filter((o) => normalizeStatus(o.status) === "pending" && !o.isInquiry)
        .sort((a, b) => a.createdAt - b.createdAt);
      const toFulfil = orders.filter((o) => normalizeStatus(o.status) === "paid").sort((a, b) => (a.paidAt || a.createdAt) - (b.paidAt || b.createdAt));
      const waiting = esc.filter((e) => escalationStatus(e) === "open").sort((a, b) => a.at - b.at);
      const soon = events
        .filter((e) => e.published && e.date >= now && e.date - now < 7 * DAY)
        .sort((a, b) => a.date - b.date);
      const expiring = codes.filter((d) => d.active && d.expiresAt && d.expiresAt > now && d.expiresAt - now < 7 * DAY);
      const tasks: Array<{ priority: "now" | "today" | "this week"; task: string; items: string[]; one_click?: string }> = [];
      if (waiting.length)
        tasks.push({
          priority: "now",
          task: `Reply to ${waiting.length} customer request${waiting.length === 1 ? "" : "s"} the Concierge handed over`,
          items: waiting.slice(0, 6).map((e) => `${e.name} (${e.topic}) — ${days(e.at)}d waiting: ${e.summary.slice(0, 90)}`),
          one_click: "Reply in Assistant tab → Handed to the team",
        });
      if (pendingMembers.length)
        tasks.push({
          priority: pendingMembers.some((u) => now - u.createdAt > DAY) ? "now" : "today",
          task: `Review ${pendingMembers.length} membership request${pendingMembers.length === 1 ? "" : "s"}`,
          items: pendingMembers.slice(0, 8).map((u) => `${u.name} <${u.email}> — ${days(u.createdAt)}d${u.ageVerified ? "" : " · did NOT confirm 21+"} {id:${u.id}}`),
          one_click: "propose_member_status per person",
        });
      // Orders chased in the last few days (staff message, invoice resend or an
      // automatic reminder) are left alone so they don't come back every morning.
      // Expired orders are left out: the automatic reminders already gave up on
      // them, so they belong in "close out" (cancel or revive), not another nudge.
      const { toChase: overdue, quiet } = await splitChased(unpaid.filter((o) => !o.expiredAt && now - o.createdAt > 2 * DAY), now);
      if (overdue.length)
        tasks.push({
          priority: overdue.some((o) => now - o.createdAt > 7 * DAY) ? "now" : "today",
          task: `Chase ${overdue.length} unpaid order${overdue.length === 1 ? "" : "s"} older than 2 days (${money(overdue.reduce((n, o) => n + o.total, 0))})`,
          items: [
            ...overdue.slice(0, 10).map((o) => `${orderRef(o)} ${o.userName} ${money(o.total)} — ${days(o.createdAt)}d${o.paymentMethod === "cash" ? " (cash at pickup)" : ""} {id:${o.id}}`),
            ...(quiet.length ? [`${quiet.length} more already chased in the last ${CHASE_QUIET_DAYS} days — left alone for now`] : []),
          ],
          one_click: "propose_order_message (reminder with pay button) or propose_resend_invoice per order — only the orders listed with an {id}; the 'already chased' ones are skipped on purpose",
        });
      if (toFulfil.length)
        tasks.push({
          priority: toFulfil.some((o) => now - (o.paidAt || o.createdAt) > 2 * DAY) ? "now" : "today",
          task: `Pack and ${toFulfil.some((o) => o.shippingMethod === "ship") ? "ship" : "hand over"} ${toFulfil.length} paid order${toFulfil.length === 1 ? "" : "s"}`,
          items: toFulfil.slice(0, 10).map((o) => `${orderRef(o)} ${o.userName} — ${o.shippingMethod === "ship" ? (o.labelUrl ? "label bought" : "needs a label") : "pickup"} · paid ${days(o.paidAt || o.createdAt)}d ago {id:${o.id}}`),
          one_click: "propose_order_status → completed once it's out the door",
        });
      if (soon.length)
        tasks.push({
          priority: "this week",
          task: `Prepare for ${soon.length} event${soon.length === 1 ? "" : "s"} in the next 7 days`,
          items: soon.map((e) => `${e.title} — ${fmtDate(e.date, true)}${e.capacity ? ` (capacity ${e.capacity})` : ""}`),
        });
      if (expiring.length)
        tasks.push({
          priority: "this week",
          task: `${expiring.length} discount code${expiring.length === 1 ? "" : "s"} expiring within 7 days`,
          items: expiring.map((d) => `${d.code} — ${fmtDate(d.expiresAt!)}, used ${d.uses}×`),
        });
      return {
        as_of: fmtDate(now, true),
        all_clear: tasks.length === 0,
        tasks,
        say_next: "Lead with the 'now' items. Offer to prepare the one-click cards (e.g. reminders for the unpaid orders) — one card per item, up to 10 at a time.",
      };
    }
    case "support_report": {
      const daysBack = Math.max(7, Math.min(365, Math.floor(Number(args.days) || 90)));
      const since = Date.now() - daysBack * 86_400_000;
      const esc = (await recentEscalations()).filter((e) => e.at >= since);
      if (esc.length === 0) return { period_days: daysBack, total: 0, note: "No customer requests were handed to the team in this period." };
      const byTopic = new Map<string, number>();
      for (const e of esc) byTopic.set(e.topic, (byTopic.get(e.topic) || 0) + 1);
      const answered = esc.filter((e) => (e.replies || []).length > 0);
      const replyHours = answered.map((e) => ((e.replies || [])[0].at - e.at) / 3_600_000).sort((a, b) => a - b);
      const median = replyHours.length ? replyHours[Math.floor(replyHours.length / 2)] : null;
      const open = esc.filter((e) => escalationStatus(e) === "open");
      return {
        period_days: daysBack,
        total: esc.length,
        by_topic: Array.from(byTopic.entries()).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}: ${n} (${Math.round((n / esc.length) * 100)}%)`),
        still_open: open.length,
        oldest_open: open.sort((a, b) => a.at - b.at).slice(0, 3).map((e) => `${e.name} (${e.topic}) since ${fmtDate(e.at)}`),
        replied_from_dashboard: answered.length,
        median_hours_to_first_reply: median === null ? "no replies sent from the dashboard yet" : Math.round(median * 10) / 10,
        recent_examples: esc.slice(0, 8).map((e) => `[${e.topic}] ${e.summary.slice(0, 140)}`),
        tip: "Suggest fixes for the biggest topic (e.g. a clearer FAQ line in the assistant's knowledge, or a site change).",
      };
    }
    case "propose_resend_invoice": {
      const o = (await cachedOrders(true)).find((x) => x.id === s(args.order_id, 80));
      if (!o) return { error: "No order with that id. Use find_orders first." };
      const check = canResendInvoice(o);
      if (!check.ok) return { error: check.reason };
      ctx.actions.push({
        id: newId(),
        kind: "resend_invoice",
        title: `Resend invoice ${orderRef(o)} to ${o.userName}`,
        lines: [
          `To: ${o.userEmail}`,
          `${money(o.total)} · unpaid since ${fmtDate(o.createdAt)} · ${o.items.map((i) => `${i.productName} ×${i.quantity}`).join(", ")}`,
          "Same invoice and pay link as before — the amount doesn't change.",
        ],
        confirmLabel: "Resend invoice",
        busyLabel: "Sending…",
        request: { method: "POST", url: "/api/admin/orders/resend-invoice", body: { orderId: o.id } },
        refresh: [],
      });
      return { proposed: true, say: "Ready to confirm. Nothing has been sent yet." };
    }
    case "propose_member_email": {
      const u = (await cachedUsers(true)).find((x) => x.id === s(args.member_id, 80));
      if (!u) return { error: "No member with that id. Use find_members first." };
      const email = s(args.new_email, 200).toLowerCase();
      if (!EMAIL.test(email)) return { error: "That doesn't look like an email address." };
      if (email === u.email.toLowerCase()) return { note: "That's already their email." };
      if ((await cachedUsers(true)).some((x) => x.id !== u.id && x.email.toLowerCase() === email)) {
        return { error: "Another member already uses that email." };
      }
      ctx.actions.push({
        id: newId(),
        kind: "member_email",
        title: `Change ${u.name}'s email`,
        lines: [`${u.email} → ${email}`, "They'll sign in with the new address from now on. Their mailing-list entry moves too.", "Their password, orders and points stay the same."],
        confirmLabel: "Change email",
        danger: true,
        request: { method: "PATCH", url: "/api/admin/users/profile", body: { id: u.id, email } },
        refresh: ["users"],
      });
      return { proposed: true, say: "Ready to confirm." };
    }
    case "propose_points_credit": {
      const u = (await cachedUsers(true)).find((x) => x.id === s(args.member_id, 80));
      if (!u) return { error: "No member with that id. Use find_members first." };
      const points = Math.floor(Number(args.points));
      if (!Number.isFinite(points) || points < 1 || points > 5000) return { error: "points must be between 1 and 5000." };
      const reason = s(args.reason, 120);
      if (!reason) return { error: "Give a short reason — the member sees it in their points history." };
      const st = await getSettings();
      const dollars = st.pointsPerDollarRedeemed > 0 ? points / st.pointsPerDollarRedeemed : 0;
      ctx.actions.push({
        id: newId(),
        kind: "points_credit",
        title: `Give ${u.name} ${points.toLocaleString()} points`,
        lines: [
          `Worth about ${money(dollars)} in store credit (${st.pointsPerDollarRedeemed} points = $1)${st.loyaltyEnabled ? "" : " — loyalty is currently switched off"}.`,
          `Balance now ${Math.max(0, Math.floor(u.loyaltyPoints || 0)).toLocaleString()} → ${(Math.max(0, Math.floor(u.loyaltyPoints || 0)) + points).toLocaleString()}`,
          `Reason they'll see: “${reason}”`,
        ],
        confirmLabel: "Add points",
        danger: true,
        request: { method: "POST", url: "/api/admin/loyalty", body: { userId: u.id, action: "points", amount: points, reason } },
        refresh: ["users"],
      });
      return { proposed: true, say: "Ready to confirm." };
    }
    case "prepare_campaign_draft": {
      const templateRef = s(args.template_id, 120).toLowerCase();
      const template = templateRef ? (await listTemplates()).find((t) => t.id.toLowerCase() === templateRef || t.name.toLowerCase() === templateRef) : undefined;
      if (templateRef && !template) return { error: `No template called ${templateRef}. Call list_templates without template_id to see them.` };
      const subject = s(args.subject, 150) || template?.subject || "";
      let body = s(args.body, 8000) || template?.body || "";
      // The photo staff sent in this chat (the widget still has it and uploads it when the draft opens).
      let photo: CampaignDraft["photo"];
      if (args.use_photo === true) {
        if (!ctx.transcript.some((m) => m.role === "user" && m.content.startsWith("[Photo]"))) {
          return { error: "There's no photo in this chat. Ask them to attach it with the camera button, or to use Upload photo in the composer." };
        }
        if (!body.includes(PHOTO_SLOT)) body = `${PHOTO_SLOT}\n\n${body}`;
        photo = { alt: s(args.photo_alt, 120) || "Photo" };
      } else {
        body = body.split(PHOTO_SLOT).join("");
      }
      const audience = args.audience === "members" || args.audience === "nonmembers" || args.audience === "all" ? args.audience : "subscribers";
      const theme = !s(args.theme, 20) && template ? themeForCategory(template.category) : cleanThemeChoice(args.theme);
      if (!subject || !body) return { error: "Need a subject and a body, or a template_id." };
      if (s(args.segment, 40)) {
        const g = await resolveSegment(s(args.segment, 40), { days: Number(args.segment_days), limit: Number(args.segment_limit), product: s(args.segment_product, 120) });
        if ("error" in g) return g;
        if (g.emails.length === 0) return { error: `Nobody is in the group "${g.label}" right now.` };
        const reach = (await recipientsFor("custom", g.emails)).length;
        ctx.draft = { subject, body, audience: "custom", customList: g.emails.join(", "), groupLabel: g.label, theme, ...(photo ? { photo } : {}) };
        return {
          ok: true,
          group: g.label,
          people_in_group: g.emails.length,
          will_receive: reach,
          say: `The draft is shown with a button to open it in the campaign composer, addressed to ${g.label} (${reach} of the ${g.emails.length} in the group will get it). It has NOT been sent.${reach < g.emails.length ? " Mention briefly that the rest have unsubscribed or aren't members/subscribers, so personal notes are the way to reach them." : ""}`,
        };
      }
      ctx.draft = { subject, body, audience, theme, ...(photo ? { photo } : {}) };
      return { ok: true, template: template?.name, say: `${template ? `Using the “${template.name}” template, the` : "The"} draft is shown with a button to open it in the campaign composer${photo ? ", which adds their photo" : ""}. It has NOT been sent.` };
    }
  }
  return { error: `Unknown tool ${name}` };
}
