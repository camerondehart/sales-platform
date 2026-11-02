/**
 * BRAND CONFIGURATION — the one file to edit for a new client.
 *
 * Everything customer-facing (site names, emails, copy, payment handles,
 * time zone, decorative theme) reads from here. Any value can also be
 * overridden with an environment variable at build time (see lib/brand.ts),
 * so one codebase can serve several deployments.
 *
 * After changing this file: `npm run build` (and `npm run sync:course` if you
 * also edited the staff guide HTML).
 */
const brandConfig = {
  /** Public business name, e.g. "Northwind Goods". */
  name: "Northwind Goods",
  /** Short form used in "the Northwind team", "Northwind Concierge". */
  shortName: "Northwind",
  /** Name of the members-only area, e.g. "The Inner Circle". */
  members: "The Inner Circle",
  /** Legal / trading name shown in the footer and Terms. */
  legalName: "Northwind Goods LLC",

  /** Canonical public URL, no trailing slash. NEXT_PUBLIC_SITE_URL overrides it. */
  siteUrl: "https://www.example.com",
  /** Hostnames that count as "our site" for links in campaigns and notes. */
  domains: ["example.com", "www.example.com"],
  /** Where customer questions go (Reply-To on every customer email, shown on the site). */
  supportEmail: "support@example.com",

  /** Hero line under the shop title. */
  tagline: "Small-batch goods, made with care. Thoughtfully sourced, honestly priced.",
  /** One sentence used in page metadata and the Concierge's briefing. */
  description: "a small, independent maker of thoughtfully sourced goods",
  /** What the shop sells, in a few words, for emails and the Concierge. */
  productsPhrase: "small-batch goods",
  /** Where the business is based (footer: "Site made with ♥ in …"). Empty = line hidden. */
  city: "",
  /** Minimum age to join the members area. 0 = no age gate copy. */
  minimumAge: 21,

  /** Emoji used as the brand mark in empty states, emails and section breaks. */
  emoji: "🌿",
  /** "meadow" keeps the illustrated valley and entrance animation; "plain" hides them. */
  decor: "meadow" as "meadow" | "plain",

  /** Optional link to an external consultation/booking form (members' gallery footer). Empty = hidden. */
  consultationFormUrl: "",
  /**
   * Free phone consultations (/consultation, switch consultation_form): the
   * statement people agree to (and sign by typing their name) before asking
   * for a call. Empty = a general default (lib/consultSlots.ts).
   */
  consultationAcknowledgement: "",

  /** Legal pages (/terms, /privacy): whose law applies and where disputes go. county "" = just the state's courts. */
  legal: { state: "California", county: "" },

  /** Local pickup. Shown at checkout, on the order confirmation and in the order email. */
  pickup: {
    address: "123 Example Street, Springfield",
    where: "Come to the front counter and give your name. Your order will be waiting for you.",
    notes: [
      "Pickup hours are Tuesday to Saturday, 10am–5pm.",
      "If you have any trouble locating your order, just reach out and we'll help right away.",
    ],
  },

  /** Invoice payment instructions. Leave a handle empty to hide that option. */
  payments: {
    venmoHandle: "",
    zelle: "",
  },

  /** IANA time zone the business runs on (reports, "today", cron windows). */
  timezone: "America/Los_Angeles",
  /** Human label for the time zone, used in copy like "8am–5pm Pacific time". */
  timezoneLabel: "Pacific",
  /** Business hours copy for the Concierge. */
  businessHours: "Mon–Fri, 8am–5pm",

  /** Flat shipping copy ("Flat $10 shipping per order"). Keep in sync with lib/pricing.ts. */
  shippingNote: "Flat $10 shipping per order.",
} as const;

export default brandConfig;
