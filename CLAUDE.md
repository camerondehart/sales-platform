# Storefront + Members Club — working notes for AI assistants

A members-only storefront plus a public shop for a small business. Everything
brand-specific is in `brand.config.ts`; read `README.md` first.

## Stack
- Next.js 14.2 App Router, TypeScript, plain CSS (`app/globals.css`, no frameworks). Hosted on Vercel.
- Data: Vercel Blob (a **public** store) holding JSON files. With no `BLOB_READ_WRITE_TOKEN` the site uses local `data/*.json`.
  - Members, subscribers and event registrations use `lib/versionedStore.ts`: every save is a new numbered, create-only file; a conflicting save retries. Don't go back to unconditional overwrites.
  - Products and discount codes: read-modify-write by default, with strict reads that refuse to save if the read failed. The shared switch `versioned_catalog` moves them onto `versionedStore` too.
- Email: Resend. AI: the Concierge runs through an OpenAI-compatible gateway (`lib/assistant/*`).
- Every admin write is recorded in the Activity log (`lib/audit*`); new features sit behind feature switches in Settings.
- Crons (`vercel.json`): the nightly export email and `/api/cron/tick` every 15 minutes. Production only.
- All dates and times run in `brand.timezone` (`lib/periods.ts`).

## Verify before handing anything over
```
bash tests/e2e/run-all.sh      # should end with ALL GREEN
npx tsc --noEmit && npx next build
```

## Standing decisions
- Customer-facing text never says "AI"; it says "Concierge". The staff side can say AI.
- The Concierge **proposes** admin actions as cards; nothing happens until staff confirm. Password entry stays out of chat.
- Campaign recipients: active mailing-list subscribers plus approved members not on the list, unless they've ever unsubscribed. Members' unsubscribe links use a signed token.
- Customer emails set Reply-To = `customerReplyTo()` (`lib/replyTo.ts`), so the From address needn't be a real mailbox.
- Imported customers (`importedFrom`) stay `needsPassword` until they set one; set-password links are signed one-time 30-day tokens (`lib/passwordSetup.ts`).
- Staff sign-in: Face ID / Touch ID passkeys (`lib/passkeys.ts`, rpID = the domain of `brand.siteUrl` on the live site), the emailed link, or the daily two-word password (`lib/staffPhrase.ts`: in the nightly report and Settings; the old fixed password stops 7 days after first run). Keep the `@peculiar/asn1-schema` override in package.json, or passkey sign-in fails ("Cannot get schema"). Failed staff sign-ins (password, Face ID, link) are limited per device with a site-wide backstop (`checkSharedLimit` in `lib/rateLimit.ts`); never go back to one site-wide counter, which let anyone lock all staff out.
- Cash-pickup-only sales: `lib/pricing.ts` treats `cashOnly` as no sale unless priced `asCash()`; only Local pickup + cash orders do that.
- Campaign looks: campaigns get a seasonal design (`lib/campaignThemes.ts`, art in `public/email-art/` + Blob `email-art/v1/`); default `auto` (words, then the season in `brand.timezone`); a campaign with no `theme` stays plain. Scheduled campaigns can be edited until they start sending. To change the art, edit `scripts/email-art.cjs`, re-run it and bump `VERSION` in `lib/emailArt.ts`.
- Smart FAQ page (`lib/faq.ts`, `/faq`, Settings → FAQ page, switch `faq_page`): published answers go into the Concierge prompt before SAFETY; SAFETY allows dosing guidance only word-for-word from a published FAQ answer. New Concierge FAQ entries are drafts unless staff ask to publish.
- Every new member is added to the mailing list at sign-up (Terms say so); unsubscribe stays in every marketing email.
- Terms + Privacy: `/terms` and `/privacy` are built from `brand.config.ts` and must stay true to how the platform works: when sign-in, payments, the Concierge, consultations, emails or data handling change, update both pages and their dates.
- Phone consultations (`lib/consultation.ts`, `/consultation`, switch `consultation_form`, on): requests go to Handed to the team (topic `consultation`). When the switch is off, `brand.consultationFormUrl` (an outside form) is linked instead, if set.
- If something unclear touches money, sign-in or customer data, stop and ask.
