# Storefront + Members Club

A complete small-business commerce platform: a public shop, a members-only
catalogue with approval-based sign-up, invoicing by email, events with
registration and waitlists, a mailing list with campaigns and templates, loyalty
points, mix-and-match bundles, discount codes (including cash-pickup-only
sales), a store-locator map, stock counts, Venmo payment matching, ambassador
pages with commission tracking, a staff dashboard with analytics, and an AI
"Concierge" for customers and staff (with photos and voice). Staff can sign in
with Face ID / Touch ID, an emailed link, or a daily two-word password. Built with Next.js 14, plain CSS,
Vercel Blob for storage, Resend for email and the Vercel AI Gateway for the
Concierge. No database to run.

Everything brand-specific lives in **one file: `brand.config.ts`**. Change it,
build, and the whole product — pages, emails, the Concierge's briefing, the
staff guide — speaks for the new client.

---

## 1. Quick start (local)

```bash
npm ci
npm run dev           # http://localhost:3000
```

With no `BLOB_READ_WRITE_TOKEN` set, data is read from and written to local
JSON files in `data/` (a sample `products.json` is included). The admin is at
`/admin`; sign in with `ADMIN_PASSWORD` (default when unset: `changemetoo` — set it before deploying).

## 2. Branding a new client

Edit `brand.config.ts`. The fields:

| Field | Used for |
| --- | --- |
| `name`, `shortName`, `legalName` | Site titles, mastheads, email headers, "the Northwind team" sign-offs, the footer © line |
| `members` | The name of the members-only area ("The Inner Circle") everywhere it appears |
| `siteUrl`, `domains` | Links in emails and campaigns; which hosts count as "our site" |
| `supportEmail` | Reply-To on every customer email, shown on every page |
| `tagline`, `description`, `productsPhrase` | Shop hero, About page, metadata and the Concierge's briefing |
| `city` | Footer "Site made with ♥ in …" (empty hides it) |
| `minimumAge` | Age gate copy in Terms and the Concierge (0 = none) |
| `emoji` | The brand mark in empty states, section breaks and email subjects |
| `decor` | `"meadow"` keeps the illustrated valley + entrance animation; `"plain"` turns them off |
| `consultationFormUrl` | Optional booking/consultation link in the members' footer |
| `pickup` | Address, directions and notes for local pickup |
| `payments.venmoHandle`, `payments.zelle` | Invoice payment instructions; leave empty to hide that method |
| `timezone`, `timezoneLabel`, `businessHours` | Every report, "today", cron windows and the Concierge's copy |
| `shippingNote` | Shipping copy (keep in sync with the amount in `lib/pricing.ts`) |

Any of the customer-facing values can also be overridden at **build time** with
environment variables, so one repo can serve several deployments:

```
NEXT_PUBLIC_BRAND_NAME, NEXT_PUBLIC_BRAND_SHORT_NAME, NEXT_PUBLIC_BRAND_MEMBERS,
NEXT_PUBLIC_BRAND_LEGAL_NAME, NEXT_PUBLIC_SITE_URL, NEXT_PUBLIC_SUPPORT_EMAIL,
NEXT_PUBLIC_BRAND_TAGLINE, NEXT_PUBLIC_BRAND_CITY, NEXT_PUBLIC_BRAND_EMOJI,
NEXT_PUBLIC_BRAND_TIMEZONE, NEXT_PUBLIC_VENMO_HANDLE, NEXT_PUBLIC_ZELLE_CONTACT
```

### Colours, fonts and the look

`app/globals.css` → the `:root` block at the top holds the palette (`--green`,
`--ink`, `--cream`, …) and font stacks. Email templates carry their own inline
colours (search for `#85ba45`, the primary green, in `lib/*Email*.ts` and
`app/api/**/route.ts`) — change those too if you re-colour the site.

### The logo

There is no image logo. The mark next to the site name is four CSS triangles
(`.logo-mark` in `app/globals.css`, used in the mastheads, the pay page, the
admin header and the Concierge button). To use a client's logo, replace the
`<div className="logo-mark">` blocks with an `<img>` and drop the CSS rule.

### Internal names you can ignore

Browser-storage and event keys are prefixed `fp_` / `collective_` (e.g.
`fp_admin_tab`, `collective_cart_v1`). They are never shown to anyone and
renaming them would only reset visitors' saved tabs and baskets, so they were
left alone.

### Pages to re-write per client

- `app/about/page.tsx` — three short sections, written generically; most
  clients will want their own story here.
- `app/terms/page.tsx` — boilerplate, marked **requires legal review**.
- `Staff-Guide.html` — the staff training guide. It uses tokens
  (`{{BRAND}}`, `{{MEMBERS}}`, `{{SUPPORT}}`, `{{SITE}}`, `{{HOST}}`,
  `{{EMOJI}}`, `{{TZ}}`) that are filled from `brand.config.ts` at runtime.
  After editing it, run `npm run sync:course`.

## 3. Environment variables

Copy `.env.example` to `.env.local` for development, or set them in the
hosting dashboard. Only `AUTH_SECRET` and `ADMIN_PASSWORD` are needed to run;
the rest switch features on.

| Variable | Purpose |
| --- | --- |
| `AUTH_SECRET` | Signs sign-in cookies and one-time links. 32+ random characters. **Required.** |
| `ADMIN_PASSWORD` | Shared staff password for `/admin`. |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob store. Without it, `data/*.json` on disk is used. |
| `RESEND_API_KEY`, `INQUIRY_FROM_EMAIL`, `INQUIRY_TO_EMAIL` | Email sending: the API key, the verified From address, and where staff alerts go. |
| `CUSTOMER_REPLY_TO` | Overrides `brand.supportEmail` as the Reply-To on customer emails. |
| `EXPORT_RECIPIENT_EMAIL` | Where the nightly report/backup email goes (defaults to `INQUIRY_TO_EMAIL`). |
| `RESEND_WEBHOOK_SECRET` | Verifies Resend's open/click webhooks (`/api/webhooks/resend`). |
| `AI_GATEWAY_API_KEY`, `AI_GATEWAY_BASE_URL` | The Concierge (OpenAI-compatible endpoint; Vercel AI Gateway by default). Leave unset to run without AI. |
| `CRON_SECRET` | Protects the cron endpoints (`vercel.json`). |
| `SHIPPO_API_KEY`, `SHIPPO_FROM_*` | Optional shipping labels from the Orders tab. |
| `NEXT_PUBLIC_SITE_URL` | Canonical URL (overrides `brand.siteUrl`). Its domain is also the passkey (Face ID) domain for the live site. |
| `AI_GATEWAY_SPEECH_URL` | Optional: the Concierge voice's speech endpoint (defaults to the Vercel AI Gateway, same key). |
| `NOMINATIM_URL`, `PHOTON_URL` | Optional: address lookup and suggestions for the store map (OpenStreetMap services by default, no key). |
| `VENMO_ACCOUNT_EMAIL` | Venmo payment matching: the address the business's Venmo emails go to (others are quarantined). |

## 4. Deploying (Vercel)

1. Push the repo to GitHub and import it in Vercel.
2. Add a Blob store (Storage → Blob) — it sets `BLOB_READ_WRITE_TOKEN`.
3. Set the variables above. Verify the sending domain in Resend and point
   `INQUIRY_FROM_EMAIL` at it.
4. `vercel.json` schedules two crons: the nightly report (`/api/admin/export-email`)
   and `/api/cron/tick` every 15 minutes (campaigns, reminders, invites). Crons
   run on the production deployment only.
5. Once live, Settings → Feature switches in the dashboard turns features on
   and off without a redeploy. Consider switching on **Safe storage for
   products & discount codes** after the first successful deploy (see the
   staff guide).

> **Stage and production share the Blob store, Resend key and AI key** unless
> you give the preview deployment its own. Anything done on a preview
> deployment happens to live data.

### Features added since the first release

All behind switches in Settings → Feature switches (live-site defaults in brackets):

| Switch | What it does |
| --- | --- |
| Store locator [off] | Public `/stores` map and list, Settings → Store locations, Concierge `find_stores` |
| Stock counts [off] | Products → Stock counts; at 0 a product shows "Currently restocking" and can still be ordered (backorders) |
| Venmo payment matching [off] | Forward Venmo's "paid you" emails to Resend inbound; they're verified (DKIM) and matched to orders by the `#REF` in the note |
| Concierge voice / Concierge photos [off] | Read-aloud answers, hands-free conversation mode, and photos in the chat |
| Ambassador pages [off] | `/<name>` pages for influencers, per-ambassador terms, commission tracking, payouts, emailed progress reports |
| Staff sign-in with Face ID [on] | Passkeys (WebAuthn) for staff; added per device in Settings → Staff sign-in |
| Member sign-in with Face ID [on] | Members add Face ID / Touch ID / fingerprint from a one-click popup after signing in ("Not now" remembered per device) or Account → Face ID, then sign in with one tap |
| Daily staff password [on] | The shared admin password becomes a new two-word phrase daily (nightly email + Settings); the old fixed password stops after 7 days |
| Cash pickup deals & public-shop pickup [off] | "Cash pickup only" sales, and Local pickup (invoice or cash) in the public shop |

Campaigns can include uploaded photos (composer "Upload photo", or a photo sent to the Concierge). Campaigns get a seasonal look (banner art, colours, dividers; `auto` picks one from the words or the season) with a live preview, drag-to-arrange blocks and photo sizes, and scheduled campaigns can be edited until they start sending. The art lives in `public/email-art/` and is copied once to the Blob store for inboxes. `package.json` pins `@peculiar/asn1-schema` with `overrides` so passkey signatures can be read; run `npm ci` after pulling.

## 5. Tests

```bash
bash tests/e2e/run-all.sh     # builds the app, runs 16 suites + the unit checks against mocks
npx tsc --noEmit && npx next build
```

The suite runs the real app against a mock AI gateway and a mock Resend, on
local JSON files. Nothing real is called. It should end with `ALL GREEN`.

## 6. Layout of the code

```
brand.config.ts        ← the one file to edit per client
lib/brand.ts           ← reads it (+ env overrides), helper exports
app/                   ← Next.js App Router pages, API routes, admin dashboard
  page.tsx             ← sign-in gate + public shop
  retail/  gallery/    ← public shop / members' catalogue
  events/  join/  about/  terms/  pay/  welcome/  unsubscribe/
  admin/               ← the staff dashboard (tabs are components in this folder)
  api/                 ← route handlers; admin routes are under api/admin
  help/                ← the staff guide (generated from Staff-Guide.html)
lib/                   ← storage, orders, users, pricing, emails, campaigns, loyalty…
lib/assistant/         ← the Concierge: tools, prompts, learned notes, insights
tests/                 ← e2e suites (python) + unit checks (node)
data/                  ← local JSON storage when no Blob token is set
```

Storage notes: members, subscribers and event registrations use
`lib/versionedStore.ts` (every save is a new numbered file, so a public CDN
can never serve a stale overwrite). Products and discount codes use
read-modify-write by default and can be moved onto the versioned store with
the "Safe storage" switch once production is running this code.

## 7. Licence / resale

This package is delivered as source. Replace this section with your own licence
terms before handing it to a client.
