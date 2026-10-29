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
- Staff sign-in: Face ID / Touch ID passkeys (`lib/passkeys.ts`, rpID = the domain of `brand.siteUrl` on the live site), the emailed link, or the daily two-word password (`lib/staffPhrase.ts`: in the nightly report and Settings; the old fixed password stops 7 days after first run). Keep the `@peculiar/asn1-schema` override in package.json, or passkey sign-in fails ("Cannot get schema").
- Cash-pickup-only sales: `lib/pricing.ts` treats `cashOnly` as no sale unless priced `asCash()`; only Local pickup + cash orders do that.
- If something unclear touches money, sign-in or customer data, stop and ask.
