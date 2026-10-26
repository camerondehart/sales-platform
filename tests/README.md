# Tests

`bash tests/e2e/run-all.sh` builds the site and runs every end-to-end suite
against a **mock AI Gateway** and a **mock Resend** on local JSON data — no
Blob, no real emails, no AI spend. Requires `node_modules` installed and
`python3`. Takes about 2–8 minutes.

| Suite | What it proves |
|---|---|
| core | Assistant for visitors/members/staff, tool permissions, order lookup, resets, escalations, spend cap, rate limits, billing messages |
| reliability | Event sign-ups under a burst (no overbooking, nothing lost), loyalty never double-awarded, export can't be redirected, escaped admin emails |
| admin-actions | Sale / bundle / bundle-rule / banner cards, partial updates that never undo other edits |
| insights | Sales analytics numbers checked independently against 1,500 synthetic orders |
| messages | Payment reminders & personal emails: preview, pay button, honest failures |
| models | Reasoning models (Opus) keep their "thinking" across tool calls; Test button |
| foundations | Feature switches, one audit row per admin write on every write route, new assistant tools, templates, videos, QR links, Terms |
| analytics | Cookie-free visit counting (bots/junk ignored, no IPs stored, per-IP cap), funnel, sources, campaigns, QR scans, dashboard ranges |
| features | Ask a question, transcripts + flags + alerts, web-page knowledge (and refusing internal addresses), payment reminders (stages, ledger, expire/revive, cron auth), scheduled campaigns, Resend webhook signatures |
| sign-in | Member email codes (single use, expiry, tries, throttling, no account leaks), staff links, staff list, who-did-what in the Activity log, password backup |
| concierge-actions | Every dashboard action through the staff Concierge end to end: card first, nothing changed, confirm → same endpoint → data changed, emails sent, audit marked Concierge; passwords never in chat text; coverage check that every admin write has a card |
| product-cards | Concierge product cards: right catalog per visitor/member, sale prices, "Inquire" = View only, max 4, fallback from names in the reply, none on redirected answers or staff chat |
| uploads | Upload tokens (staff only, right folder, type and size limits, 30-min expiry), automatic clean-up of replaced/removed uploads, never deleting files still in use or other sites' links |
| bundles | The 4-capsule 20% example, partial sets, two sets, BOGO/"buy N" interplay, bundle-or-code, points, best combination, dates/pause, public shop, reporting |
| member-import | Shopify import (preview, counts, field mapping, existing members untouched, opt-outs, re-run safe, no CSV in logs), set-password links (welcome page, once-only, sign-in), "email me a link", invite runs, campaign groups |
| launch-hardening | Today bulletin (to-do + suggestions + campaign ideas: calendar, refills, bundles, invites; order, Concierge on/off, staff only), Resend rejections at checkout (emailed:false + team warning), no second Shippo label without asking, public form limits (429), no payment token in the orders spreadsheet, safe storage switch (shared; parallel product/code saves and code uses never lost; switch off keeps everything), model privacy fields |

Plus `node tests/unit/bundle-pricing.cjs`: 3,000 random carts checked against a brute-force best price, and against the old maths when no bundle applies.
And `node tests/unit/versioned-blob.cjs`: the safe storage switch on a fake Blob store (switch on/off/on, 30 saves from 3 servers at once, empty-catalog guard).

Five checks about the assistant's topic word list are **skipped** while
`OFF_LIMITS` in `lib/assistant/shared.ts` doesn't include those words — they
turn back on automatically if the list is restored.

Visual checks are manual — see `QA_CHECKLIST.md`.
