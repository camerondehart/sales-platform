import { brand } from "@/lib/brand";
/**
 * Types shared by the assistant's server code and the chat widget.
 * No server-only imports here — this file ships to the browser.
 */

export type Audience = "public" | "member" | "admin";

/** Where the widget is mounted. The server decides the real audience. */
export type WidgetMode = "site" | "admin";

export type ChatRole = "user" | "assistant";

/** What the client sends back as conversation history. Text only. */
export type ChatMessage = { role: ChatRole; content: string };

/**
 * A change the assistant wants to make in the admin panel. Nothing happens
 * until a staff member presses Confirm, and the confirm button calls the
 * exact same admin endpoint the dashboard's own buttons use.
 */
export type ActionProposal = {
  id: string;
  kind:
    | "member_status"
    | "order_status"
    | "venmo_payment"
    | "stock_count"
    | "store_create"
    | "ambassador"
    | "ambassador_payout"
    | "ambassador_report"
    | "product_visibility"
    | "discount_code"
    | "product_sale"
    | "bundle"
    | "bundle_rule"
    | "banner"
    | "order_message"
    | "member_message"
    | "resend_invoice"
    | "member_email"
    | "points_credit"
    // The rest of the dashboard (lib/assistant/adminActions.ts)
    | "member_create"
    | "member_delete"
    | "member_profile"
    | "member_password"
    | "manual_invoice"
    | "shipping_label"
    | "reminders"
    | "product_create"
    | "product_edit"
    | "product_delete"
    | "product_move"
    | "event_create"
    | "event_edit"
    | "event_delete"
    | "registration"
    | "discount_update"
    | "discount_delete"
    | "mix_bundle"
    | "campaign_send"
    | "campaign_test"
    | "campaign_cancel"
    | "template"
    | "subscriber"
    | "settings"
    | "feature_switch"
    | "staff"
    | "report"
    | "assistant_settings"
    | "knowledge_page"
    | "handoff";
  title: string;
  /** Human-readable facts, built from real records on the server. */
  lines: string[];
  /** Exact text that will be sent (emails), shown in full before confirming. */
  preview?: string;
  confirmLabel: string;
  /** Button text while it runs, e.g. "Sending…". Default "Saving…". */
  busyLabel?: string;
  danger?: boolean;
  request: { method: "PATCH" | "POST" | "PUT" | "DELETE"; url: string; body: unknown };
  /** Which dashboard data to reload after it succeeds. */
  refresh: Array<AdminRefreshKey>;
};

/** Parts of the dashboard that reload after a confirmed change. */
export type AdminRefreshKey =
  | "users" | "orders" | "products" | "discounts" | "settings" | "banner"
  | "events" | "subscribers" | "bundles" | "campaigns" | "templates" | "flags"
  | "staff" | "reminders" | "assistant" | "sources" | "escalations" | "today" | "ambassadors";

export type CampaignDraft = {
  subject: string;
  body: string;
  audience: "subscribers" | "all" | "members" | "nonmembers" | "custom";
  /** For a customer group: the emails (comma-separated) and what the group is. */
  customList?: string;
  groupLabel?: string;
  /** The Today-list item this draft came from (ticked off once the campaign is sent). */
  todayKey?: string;
  /** Seasonal look for the email (lib/campaignThemes.ts): a theme key, "auto" or "none". */
  theme?: string;
  /** Use the photo staff sent in the chat: it goes where PHOTO_SLOT is in the body (uploaded when the draft opens in the composer). */
  photo?: { alt: string };
  /** Set by the chat widget on the way to the composer: the photo itself (JPEG data URL, kept in this browser only). */
  photoData?: string;
};

/** Where the chat photo goes in a draft's body, on its own line. */
export const PHOTO_SLOT = "[[PHOTO]]";

/** A product the Concierge is recommending, shown as a card with Add to cart / View. */
export type ProductCard = {
  id: string;
  name: string;
  image: string;
  /** What they'd pay (sale price if on sale). */
  price: string;
  /** Regular price when on sale. */
  was?: string;
  /** e.g. "20% off", "BOGO 50% off". */
  badge?: string;
  blurb?: string;
  hasVideo?: boolean;
  /** Which cart it goes in: the members' gallery or the public shop. */
  shop: "members" | "public";
  /** False for "Inquire"-priced items — View only. */
  canAdd: boolean;
};

export type ChatReply = {
  reply: string;
  products?: ProductCard[];
  actions?: ActionProposal[];
  draft?: CampaignDraft;
  /** Set when this reply answers a Today-list button: its item ticks itself off once the cards are dealt with. */
  todayKey?: string;
  /** Voice on: lets this answer be read aloud (lib/voice.ts signSpeech). */
  voiceSig?: string;
  /** Conversation mode: the Concierge judged the chat finished — stop listening after this answer. */
  endConversation?: boolean;
  /** True when the assistant is unavailable and `reply` explains why. */
  offline?: boolean;
  /** True when something failed mid-conversation; `reply` is a fallback. */
  degraded?: boolean;
};

export type AssistantStatus = {
  available: { public: boolean; member: boolean; admin: boolean };
  name: string;
  /** Voice on (mic + read aloud): the switch is on and a Gateway key is set. */
  voice?: boolean;
  /** Photos on: the camera button can send a picture with a message. */
  photos?: boolean;
  /** Why staff can't use it, when they can't. Only shown in the admin. */
  staffNote?: string;
};

/** Window events the admin widget uses to talk to the dashboard. */
export const EVT_USE_DRAFT = "fp:assistant-use-draft";
export const EVT_ADMIN_REFRESH = "fp:assistant-admin-refresh";
/** Any page can open the chat, optionally with a question pre-sent. */
export const EVT_OPEN = "fp:assistant-open";
export const EVT_ASK = "fp:assistant-ask";
/** Chat product cards → the shop page on screen (it sets detail.handled = true). */
export const EVT_ADD_TO_CART = "fp:shop-add";
export const EVT_VIEW_PRODUCT = "fp:shop-view";
export const EVT_OPEN_CART = "fp:shop-open-cart";
export type ShopEventDetail = { productId?: string; shop: "members" | "public"; handled?: boolean };
/** Same keys the shop pages use, for adding from pages without a shop on them. */
export const CART_KEYS = { members: "collective_cart_v1", public: "fp_retail_cart_v1" } as const;
export const SHOP_PATH = { members: "/gallery", public: "/retail" } as const;
/** The Assistant tab tells the dashboard its open-request count changed. */
export const EVT_ESCALATIONS = "fp:assistant-escalations";

/** Terms the customer-facing assistant never uses. */
export const OFF_LIMITS = /\b(?:illegal|illegality|legality)\b/i;

/** Products the customer-facing assistant leaves out; the site still shows them. */
export function hiddenFromAssistant(p: { name: string; category?: string; description?: string }): boolean {
  return OFF_LIMITS.test(`${p.name} ${p.category || ""} ${p.description || ""}`);
}

export const SUPPORT_EMAIL = brand.supportEmail;
