// The full staff training course, kept as one self-contained HTML document.
// It renders inside a sandboxed iframe on /help so its stylesheet stays
// completely isolated from the rest of the site (and vice versa).
//
// GENERATED FILE — do not edit directly.
// Edit Staff-Guide.html at the repo root, then run:
//   npm run sync:course

import { applyBrandTokens } from "@/lib/brand";

export const COURSE_HTML_RAW = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Staff Guide · {{MEMBERS}}</title>
<style>
  :root{
    --green:#85ba45; --green-deep:#6fa336; --mint:#0fc7a3; --mint-deep:#0a9880;
    --yellow:#a2a434; --yellow-deep:#7d7f28; --red:#c86164; --red-deep:#b34d50;
    --ink:#2b2f27; --ink-soft:#61676d; --ink-faint:#8f949a;
    --white:#f9f9f8; --rule:#dcdcd6; --rule-soft:#e9e9e3; --surface:#ffffff;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html{scroll-behavior:smooth}
  body{
    font-family:"Optima","Segoe UI",system-ui,-apple-system,sans-serif;
    background:#f2f4ef;color:var(--ink);line-height:1.65;font-size:16px;
  }
  a{color:var(--green-deep)}

  /* ---------- Layout ---------- */
  .wrap{display:flex;align-items:flex-start}
  .sidebar{
    width:272px;flex:0 0 272px;background:#1a2716;color:#eaf7c9;
    position:sticky;top:0;height:100vh;overflow-y:auto;padding-bottom:2rem;
  }
  .sidebar-top{padding:1.3rem 1.3rem 1rem;border-bottom:1px solid rgba(190,227,145,.15)}
  .back-link{
    display:inline-block;font-size:.72rem;font-weight:700;letter-spacing:.05em;
    color:rgba(234,247,201,.75);text-decoration:none;padding:.35rem .7rem;
    border:1px solid rgba(190,227,145,.25);border-radius:7px;margin-bottom:.9rem;
  }
  .back-link:hover{background:rgba(133,186,69,.2);color:#fff;border-color:var(--green)}
  .sidebar-top h1{font-family:Georgia,serif;font-style:italic;font-size:1.35rem;font-weight:400;color:#f4f8ea}
  .sidebar-top p{font-size:.58rem;letter-spacing:.2em;text-transform:uppercase;color:rgba(190,227,145,.55);margin-top:.3rem}
  .search-wrap{padding:.9rem 1rem .4rem}
  #search{
    width:100%;padding:.55rem .75rem;border-radius:8px;border:1px solid rgba(190,227,145,.25);
    background:rgba(255,255,255,.07);color:#f4f8ea;font-family:inherit;font-size:.83rem;
  }
  #search::placeholder{color:rgba(234,247,201,.4)}
  #search:focus{outline:none;border-color:var(--green);background:rgba(255,255,255,.11)}
  .nav-group-title{
    font-size:.56rem;letter-spacing:.22em;text-transform:uppercase;font-weight:700;
    color:rgba(190,227,145,.5);padding:1rem 1.3rem .35rem;
  }
  .sidebar a.nav-link{
    display:flex;align-items:center;gap:.5rem;padding:.45rem 1.3rem;
    color:rgba(234,247,201,.78);text-decoration:none;font-size:.85rem;
    border-left:3px solid transparent;
  }
  .sidebar a.nav-link:hover{background:rgba(133,186,69,.13);color:#fff}
  .sidebar a.nav-link.active{background:rgba(133,186,69,.19);color:#fff;border-left-color:var(--green)}
  .nav-ico{width:1.1rem;text-align:center;flex-shrink:0;opacity:.85}

  main{flex:1;min-width:0;padding:2.4rem clamp(1.1rem,4vw,3.2rem) 6rem;max-width:920px}

  /* ---------- Typography ---------- */
  h2.sec{
    font-family:Georgia,serif;font-style:italic;font-weight:400;font-size:1.95rem;
    margin:0 0 .3rem;padding-bottom:.5rem;border-bottom:2px solid var(--rule);
  }
  .where{
    display:inline-block;font-size:.63rem;letter-spacing:.14em;text-transform:uppercase;
    font-weight:700;color:var(--green-deep);background:rgba(133,186,69,.12);
    padding:.25rem .7rem;border-radius:99px;margin-bottom:1rem;
  }
  h3{font-size:1.1rem;font-weight:600;margin:1.9rem 0 .5rem}
  h4{font-size:.94rem;font-weight:600;margin:1.2rem 0 .35rem}
  p{margin:.65rem 0}
  ul,ol{margin:.65rem 0 .65rem 1.25rem}
  li{margin:.3rem 0}
  .lede{font-size:1.03rem;color:var(--ink-soft);margin-bottom:1.3rem}

  /* ---------- Components ---------- */
  .card{background:var(--surface);border:1px solid var(--rule-soft);border-radius:12px;padding:1.2rem 1.4rem;margin:1.1rem 0}
  .steps{counter-reset:s;list-style:none;margin-left:0}
  .steps li{counter-increment:s;position:relative;padding-left:2.5rem;margin:.8rem 0}
  .steps li::before{
    content:counter(s);position:absolute;left:0;top:.05rem;width:1.75rem;height:1.75rem;
    background:var(--green);color:#fff;border-radius:50%;display:grid;place-items:center;
    font-size:.78rem;font-weight:700;
  }
  .callout{border-radius:10px;padding:.9rem 1.15rem;margin:1.1rem 0;border-left:4px solid}
  .tip{background:rgba(133,186,69,.09);border-color:var(--green)}
  .warn{background:rgba(162,164,52,.12);border-color:var(--yellow)}
  .danger{background:rgba(200,97,100,.09);border-color:var(--red)}
  .callout strong{display:block;margin-bottom:.2rem}
  kbd{
    background:var(--white);border:1px solid var(--rule);border-bottom-width:2px;border-radius:5px;
    padding:.08rem .42rem;font-family:inherit;font-size:.85em;font-weight:600;white-space:nowrap;
  }
  table{width:100%;border-collapse:collapse;margin:1rem 0;font-size:.9rem}
  th,td{text-align:left;padding:.55rem .65rem;border-bottom:1px solid var(--rule-soft);vertical-align:top}
  th{font-size:.65rem;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-soft);font-weight:700}
  .pill{display:inline-block;padding:.12rem .5rem;border-radius:99px;font-size:.69rem;font-weight:700;white-space:nowrap}
  .p-pending{background:rgba(162,164,52,.18);color:var(--yellow-deep)}
  .p-paid{background:rgba(133,186,69,.18);color:var(--green-deep)}
  .p-ship{background:rgba(15,199,163,.16);color:var(--mint-deep)}
  .p-cancel{background:rgba(200,97,100,.14);color:var(--red-deep)}
  .p-inq{background:rgba(97,103,109,.13);color:var(--ink-soft)}
  .toc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:.7rem;margin:1.3rem 0}
  .toc-card{background:var(--surface);border:1px solid var(--rule-soft);border-radius:10px;padding:.9rem 1rem;text-decoration:none;color:inherit;display:block}
  .toc-card:hover{border-color:var(--green)}
  .toc-card .t{font-weight:600}
  .toc-card .d{font-size:.8rem;color:var(--ink-soft);margin-top:.15rem}
  .faq-q{font-weight:600;margin-top:1.1rem}
  .faq-a{color:var(--ink-soft);margin-top:.15rem}
  .no-results{padding:3rem 0;text-align:center;color:var(--ink-soft);display:none}
  section{margin-bottom:3.4rem}
  section.hidden{display:none}
  mark{background:rgba(162,164,52,.35);padding:0 .1em;border-radius:2px}
  .search-results{display:none;margin:0 0 2.2rem;padding:1rem 1.1rem;border:1px solid var(--rule-soft);border-radius:12px;background:var(--surface)}
  .search-results .sr-head{font-size:.78rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-soft);margin-bottom:.5rem}
  .search-results a.sr-item{display:block;padding:.55rem .6rem;border-radius:8px;text-decoration:none;color:inherit}
  .search-results a.sr-item:hover,.search-results a.sr-item.first{background:rgba(133,186,69,.1)}
  .search-results .sr-title{font-weight:600}
  .search-results .sr-where{font-size:.75rem;color:var(--ink-soft);margin-left:.35rem}
  .search-results .sr-snip{font-size:.85rem;color:var(--ink-soft);margin-top:.1rem;line-height:1.45}
  .search-results .sr-tip{font-size:.75rem;color:var(--ink-soft);margin-top:.5rem}
  .sidebar a.nav-link.dim{opacity:.35}
  .nav-count{margin-left:auto;font-size:.68rem;font-weight:700;background:rgba(133,186,69,.35);color:#eaf7c9;border-radius:99px;padding:0 .45rem;line-height:1.4}
  .print-btn{
    position:fixed;bottom:1.3rem;right:1.3rem;background:var(--green);color:#fff;border:none;
    border-radius:99px;padding:.65rem 1.2rem;font-family:inherit;font-size:.78rem;font-weight:700;
    cursor:pointer;box-shadow:0 5px 16px rgba(97,103,109,.25);z-index:40;
  }
  .print-btn:hover{background:var(--green-deep)}

  @media (max-width:880px){
    .wrap{flex-direction:column}
    .sidebar{width:100%;flex:none;height:auto;position:static}
    .nav-group-title{padding:.7rem 1rem .2rem}
    .sidebar a.nav-link{display:inline-flex;border-left:none;border-bottom:2px solid transparent;padding:.35rem .7rem}
    .sidebar a.nav-link.active{border-left:none;border-bottom-color:var(--green)}
    main{padding:1.4rem 1.1rem 4rem}
  }
  @media print{
    .sidebar,.print-btn{display:none}
    body{background:#fff;font-size:11pt}
    main{max-width:none;padding:0}
    section.hidden{display:block!important}
    h2.sec{page-break-before:always}
    section:first-of-type h2.sec{page-break-before:avoid}
    .card,.callout{break-inside:avoid}
  }
</style>
</head>
<body>
<div class="wrap">

<nav class="sidebar">
  <div class="sidebar-top">
    <a class="back-link" href="/admin" target="_top">← Back to dashboard</a>
    <h1>Staff Guide</h1>
    <p>{{MEMBERS}}</p>
  </div>
  <div class="search-wrap">
    <input type="search" id="search" placeholder="Search the guide…" aria-label="Search the guide" />
  </div>

  <div class="nav-group-title">Start here</div>
  <a class="nav-link" href="#start"><span class="nav-ico">✦</span>How it all works</a>
  <a class="nav-link" href="#signin"><span class="nav-ico">🔑</span>Signing in</a>
  <a class="nav-link" href="#saving"><span class="nav-ico">💾</span>How you know it saved</a>
  <a class="nav-link" href="#daily"><span class="nav-ico">☀</span>The daily routine</a>

  <div class="nav-group-title">The dashboard tabs</div>
  <a class="nav-link" href="#tab-overview"><span class="nav-ico">◧</span>Overview</a>
  <a class="nav-link" href="#tab-orders"><span class="nav-ico">🧾</span>Orders</a>
  <a class="nav-link" href="#tab-members"><span class="nav-ico">👥</span>Members</a>
  <a class="nav-link" href="#tab-products"><span class="nav-ico">{{EMOJI}}</span>Products</a>
  <a class="nav-link" href="#tab-events"><span class="nav-ico">🎟</span>Events</a>
  <a class="nav-link" href="#tab-marketing"><span class="nav-ico">✦</span>Marketing</a>
  <a class="nav-link" href="#tab-ambassadors"><span class="nav-ico">★</span>Ambassadors</a>
  <a class="nav-link" href="#tab-analytics"><span class="nav-ico">📈</span>Analytics</a>
  <a class="nav-link" href="#tab-assistant"><span class="nav-ico">✧</span>Assistant</a>
  <a class="nav-link" href="#tab-settings"><span class="nav-ico">⚙</span>Settings</a>

  <div class="nav-group-title">Common jobs</div>
  <a class="nav-link" href="#job-paid"><span class="nav-ico">💵</span>Take a payment</a>
  <a class="nav-link" href="#job-ship"><span class="nav-ico">📦</span>Ship an order</a>
  <a class="nav-link" href="#job-pickup"><span class="nav-ico">🚗</span>Handle a pickup</a>
  <a class="nav-link" href="#job-message"><span class="nav-ico">✉</span>Message a customer</a>
  <a class="nav-link" href="#job-sale"><span class="nav-ico">🏷</span>Run a sale</a>
  <a class="nav-link" href="#job-invoice"><span class="nav-ico">📄</span>Invoice by hand</a>
  <a class="nav-link" href="#job-loyalty"><span class="nav-ico">⭐</span>Loyalty points</a>

  <div class="nav-group-title">Reference</div>
  <a class="nav-link" href="#customer"><span class="nav-ico">👤</span>What customers see</a>
  <a class="nav-link" href="#troubleshoot"><span class="nav-ico">🔧</span>Troubleshooting</a>
  <a class="nav-link" href="#glossary"><span class="nav-ico">📖</span>Glossary</a>
  <a class="nav-link" href="#cheatsheet"><span class="nav-ico">⚡</span>Cheat sheet</a>
</nav>

<main>
<div class="no-results" id="noResults">Nothing in the guide matches that search. Try fewer or shorter words.</div>
<div class="search-results" id="searchResults" aria-live="polite"></div>

<!-- ===== START ===== -->
<section id="start">
<h2 class="sec">How it all works</h2>
<p class="lede">The shape of the business, as the website sees it. Five minutes here makes everything else obvious.</p>

<h3>There are two shops</h3>
<table>
<tr><th>Shop</th><th>Address</th><th>Who sees it</th></tr>
<tr><td><strong>{{MEMBERS}}</strong></td><td>{{HOST}}</td><td>Approved members only, with a password</td></tr>
<tr><td><strong>Public shop</strong></td><td>{{HOST}}/retail<br/>(and the bottom of the home page)</td><td>Anyone. No account needed.</td></tr>
</table>
<p>Every product is set to appear in one or both. That single setting is called <strong>Where it sells</strong>.</p>

<h3>Nobody pays by card here</h3>
<p>This is the most important thing to understand.</p>
<ol class="steps">
<li>A customer orders. The site emails an invoice automatically.</li>
<li>The invoice has a Venmo button and Zelle details.</li>
<li>They pay directly, outside the website.</li>
<li>They click <strong>"I've sent my payment"</strong> in that same email.</li>
<li>The order flips to <span class="pill p-paid">Paid</span> and an alert email arrives.</li>
</ol>
<div class="callout danger">
<strong>Always confirm the money before shipping</strong>
Step 4 is the customer <em>saying</em> they paid. It is not proof. Open Venmo or Zelle and check it landed first, every time.
</div>

<h3>Order statuses</h3>
<table>
<tr><th>Status</th><th>Meaning</th><th>What happens next</th></tr>
<tr><td><span class="pill p-pending">Pending payment</span></td><td>Invoice sent, money unconfirmed</td><td>Wait, or nudge them</td></tr>
<tr><td><span class="pill p-paid">Paid</span></td><td>Money confirmed</td><td>Pack it — this is your to-do list</td></tr>
<tr><td><span class="pill p-ship">Completed</span></td><td>Shipped or collected. Finished.</td><td>Done</td></tr>
<tr><td><span class="pill p-cancel">Cancelled</span></td><td>Called off, record kept</td><td>Refund by hand if needed</td></tr>
<tr><td><span class="pill p-inq">Expired</span></td><td>Unpaid after every reminder. Still pending, nothing cancelled</td><td>Revive it, or cancel it yourself</td></tr>
</table>

<div class="callout tip">
<strong>Nothing here can break the site</strong>
Statuses can be changed back. Products can be edited. Emails only send when a send button is pressed. The only permanent action is deleting. Click around freely.
</div>
</section>

<!-- ===== SIGN IN ===== -->
<section id="signin">
<h2 class="sec">Signing in</h2>
<ol class="steps">
<li>Go to <strong>{{HOST}}/admin</strong>. (The sign-in page has a link back to the homepage.)</li>
<li>Enter <strong>today&rsquo;s staff password</strong> and press <kbd>Sign in</kbd> (see <em>The daily staff password</em> below). <em>Or</em>, if you're on the staff list and sign-in links are switched on, choose <strong>Email me a sign-in link</strong>, enter your email, and tap the button in the email, then <kbd>Sign in to the dashboard</kbd>. The link works once, for 15 minutes.</li>
<li><em>Shortcut:</em> on the normal member sign-in page, type your staff email. The password box disappears; press <strong>Email me a dashboard sign-in link</strong> and tap the button in the email, the same link as above. It signs you in to the dashboard only, so <strong>Preview store</strong> still shows the admin preview. This needs <strong>Admin sign-in link by email</strong> switched on.</li>
<li><em>Fastest:</em> once you've set it up on your phone or computer (below), just tap the button at the top of the sign-in page: <strong>Sign in with Face ID</strong> on an iPhone, <strong>Touch ID</strong> on a Mac, <strong>fingerprint</strong> on Android, <strong>Windows Hello</strong> on Windows. Look at the phone or touch the sensor and you're in.</li>
<li>You stay signed in for about 12 hours, then it asks again.</li>
</ol>

<h3>The daily staff password</h3>
<p>The staff password changes every day at midnight Pacific. It's two words and two numbers, like <code>maple-otter-42</code>. You'll find it in two places:</p>
<ul>
<li>At the top of each morning's <strong>nightly report email</strong>, under <em>Today's staff password</em>.</li>
<li>In <strong>Settings → Steward password</strong> whenever you're signed in (with Face ID or the email link, say). It's always there, so a missing email never locks anyone out.</li>
</ul>
<p>Capitals and spaces don't matter. Yesterday's password still works until noon, in case you haven't opened the new email yet. The old fixed password kept working for one week after the change, then stopped. Settings → Steward password says until when. Face ID and the email link work as always, and they're the quickest way in.</p>

<h3>Setting up Face ID, Touch ID or fingerprint</h3>
<ol class="steps">
<li>Sign in the usual way on the device you want to use (your iPhone, Mac…).</li>
<li>Open <strong>Settings → Staff sign-in</strong>. Under <strong>Face ID, Touch ID &amp; fingerprint</strong>, press <kbd>Add Face ID for this device</kbd> (it says Touch ID, fingerprint or Windows Hello on those devices). If you signed in with the shared password, first choose who it's for.</li>
<li>Your device asks for your face or fingerprint once. That's it: from now on, tap the <strong>Sign in with …</strong> button.</li>
</ol>
<p>Do this once per device. It works with Face ID and Touch ID on iPhone, iPad and Mac (with iCloud Keychain, setting it up on your iPhone also covers your Mac and iPad), fingerprint or face unlock on Android phones (Chrome), and Windows Hello. Your face or fingerprint never leaves your device: the site only keeps a lock that your phone's key fits. The live site and stage are set up separately. The list shows each person's devices and when they last signed in. <kbd>Remove</kbd> one if a phone is lost or replaced, and anyone taken off the staff list loses their Face ID too. The password and the email link always keep working.</p>
<div class="callout tip">
<strong>Make it one tap</strong>
Bookmark {{HOST}}/admin. On a phone, use "Add to Home Screen" and it opens like an app.
</div>
<div class="callout danger">
<strong>Never share the staff password</strong>
It reveals every customer, order, and address. Don&rsquo;t forward the nightly report email either, since it carries the day&rsquo;s password. Members have their own separate passwords — unrelated to this one.
</div>
<div class="callout tip">
<strong>Why use the email link</strong>
With the link, the Activity log shows <em>your</em> email next to each change instead of just "admin". The shared password keeps working as a backup.
</div>
</section>

<!-- ===== SAVING ===== -->
<section id="saving">
<h2 class="sec">How you know it saved</h2>
<p class="lede">Every change you make shows a little message in the top right corner. It tells you exactly what is happening, so you never have to wonder.</p>

<h3>The four messages</h3>
<table>
<tr><th>What you see</th><th>What it means</th><th>Do you need to do anything?</th></tr>
<tr><td><strong>Saving…</strong> (grey, spinning)</td><td>Your change is being written down.</td><td>No. Keep working.</td></tr>
<tr><td><strong>Still syncing…</strong> (gold, spinning)</td><td>It is taking a bit longer than usual. It is still working.</td><td>No. Just wait.</td></tr>
<tr><td><strong>✓ Saved</strong> (green)</td><td>Done. The change is really stored.</td><td>No. It's finished.</td></tr>
<tr><td><strong>⚠ Couldn't confirm</strong> (red)</td><td>It waited a whole minute and still couldn't check.</td><td>Refresh the page and look.</td></tr>
</table>

<div class="callout tip">
<strong>Green means really saved</strong>
The green "Saved" does not appear until the site has gone back and checked that your change is actually there. It is the same check that happens when you refresh the page. So if you see green, you can close the tab and trust it.
</div>

<h3>You don't have to wait for it</h3>
<p>The message is only there to keep you informed. You can carry on clicking, open something else, or move to another tab while it finishes. Nothing is frozen or waiting on you.</p>

<div class="callout warn">
<strong>If you see "Still syncing…", don't redo it</strong>
Your change was already accepted. The site is just waiting to read it back so it can prove it worked. Doing the same thing again won't make it faster.
</div>

<h3>It remembers where you were</h3>
<p>If you refresh the page, you stay on the same tab you were using. Refresh while looking at Products and you come back to Products, not the Overview.</p>
<p>The one exception is clicking an order link from an email. That always takes you straight to that order, wherever you were before.</p>
<div class="callout tip">
<strong>All times are {{TZ}}</strong>
Every date and time in the dashboard is {{TZ}} time: order times, event times, campaign scheduling, bundle start and end, the banner countdown, and discount codes' last day. That stays true even if your computer is set to another time zone, for example while travelling. A discount's "last day" works until 11:59 PM {{TZ}} on that day.
</div>
</section>

<!-- ===== DAILY ===== -->
<section id="daily">
<h2 class="sec">The daily routine</h2>
<p class="lede">If you do nothing else, do this. Five minutes on a quiet day.</p>
<div class="card">
<ol class="steps">
<li><strong>Open Overview and work down the <em>Today</em> list.</strong> It's your to-do list for the day, kept up to date for you. Tick things off as you go.</li>
<li><strong>Click "Ready to fulfil."</strong> These are paid and waiting to be packed — today's work.</li>
<li><strong>Pack and ship each one.</strong> See <a href="#job-ship">Ship an order</a>.</li>
<li><strong>Check "Awaiting payment."</strong> Anything past three days gets flagged. Send a gentle nudge.</li>
<li><strong>Approve anyone waiting to join.</strong> See <a href="#tab-members">Members</a>.</li>
</ol>
</div>
<div class="callout tip">
<strong>Or just read the nightly email</strong>
Every night the site emails a full summary with spreadsheet backups attached. If you'd rather work from your inbox, everything is in there.
</div>
</section>

<!-- ===== OVERVIEW TAB ===== -->
<section id="tab-overview">
<h2 class="sec">Overview</h2>
<span class="where">Dashboard → Overview</span>
<p class="lede">The home screen. Start here every day.</p>

<h3>Today — your stand-in manager</h3>
<p>The <strong>Today</strong> card at the top checks orders, members, codes, events and sales for you and lists what's worth doing, most urgent first:</p>
<ul>
<li><strong>Do now / Today</strong>: requests waiting for a reply, members to approve, unpaid orders to chase, paid orders to pack.</li>
<li><strong>This week</strong>: housekeeping, like finished discount codes still switched on, very old unpaid orders to close out, events that need a promo email.</li>
<li><strong>Campaign ideas</strong> (always at least one): the next date worth a campaign (Halloween, Black Friday, holiday gifting, Valentine's, Mother's Day…) with an angle, a template and when to send; regulars who are due to reorder their usual product; products people often buy together (make it a bundle); repeat shop customers to invite in as members; subscribers who've never ordered; members with points to spend; a thank-you for your top customers. It also tells you which weekday your orders peak, so you know when to send.</li>
<li><strong>Ideas to grow</strong>: members who've gone quiet, new members who haven't ordered yet, products that have stopped selling, a best seller worth featuring in the banner.</li>
</ul>
<p>Press the green or coloured button on an item (marked ✦) and the Concierge opens and <strong>prepares cards</strong> for it — reminders, approvals, a sale, a draft email. <strong>Nothing happens until you press Confirm on each card</strong>, so read them first. Plain buttons just open the right tab.</p>
<p>Press <strong>Mark done</strong> when you've handled an item (press again to undo). Ticks are shared — everyone sees them on every device — and reset each day. You rarely need to tick by hand: an item ticks itself off once you've dealt with the cards its button prepared (confirmed at least one, dismissed the rest), or once the campaign it drafted is sent. Items whose problem is fixed (orders paid, codes switched off, weights entered) simply disappear. <em>Do now</em> and <em>Today</em> open automatically; the other groups stay folded until you open them. The list refreshes itself every few minutes and straight after you confirm a card. <kbd>Hide</kbd> folds it away.</p>
<p>On a phone or iPad only the most urgent group starts open; tap any group's heading to open or close it (the site remembers). Right after you sign in (and the first time each day), the card arrives folded: it writes you a gentle hello, a few little leaves float up, and a row of coloured chips drifts down into place — one per group with how many are left. Tap a chip to open the card at that group, or <kbd>Show</kbd> to open it all.</p>

<h3>The four boxes</h3>
<table>
<tr><th>Box</th><th>What it tells you</th><th>Click it to…</th></tr>
<tr><td>Awaiting payment</td><td>How many are unpaid, and how much money that is</td><td>Jump to those orders</td></tr>
<tr><td>Ready to fulfil</td><td>Paid but not yet shipped</td><td>Jump to what needs packing</td></tr>
<tr><td>Member requests</td><td>People waiting for approval</td><td>Jump to Members</td></tr>
<tr><td>Revenue, 7 days</td><td>The last week's takings</td><td>—</td></tr>
</table>
<p>Below the boxes are the five most recent orders and a row of quick action buttons.</p>
<div class="callout tip">
<strong>What the red numbers mean</strong>
The number on <strong>Orders</strong> counts orders that aren't finished yet: ones waiting for payment, plus ones that are paid and still need packing. Hover over it and it splits the two out for you. The number on <strong>Members</strong> is people waiting to be approved. Both drop to nothing when you're caught up.
</div>
</section>

<!-- ===== ORDERS TAB ===== -->
<section id="tab-orders">
<h2 class="sec">Orders</h2>
<span class="where">Dashboard → Orders</span>
<p class="lede">Every order ever placed, filterable and searchable.</p>

<h3>The filter buttons</h3>
<p>Across the top, each with a live count:</p>
<ul>
<li><strong>All</strong> — everything except cancelled</li>
<li><strong>Pending payment</strong> — waiting on money</li>
<li><strong>Paid</strong> — your to-do list</li>
<li><strong>Completed</strong> — shipped or collected, nothing left to do</li>
<li><strong>Cancelled</strong> — called off</li>
<li><strong>Expired</strong> (its own tab, next to Pending payment) — unpaid invoices that got every reminder and still weren't paid. They aren't cancelled: the customer can still pay, they just stop crowding Pending payment. The tab explains your three options: mark Paid, Revive, or Cancel. The Overview's "Awaiting payment" card counts them separately ("· 3 expired").</li>
</ul>
<p>Questions no longer arrive as orders. When a member presses <strong>Ask a question</strong> at checkout, it goes to <strong>Assistant → Handed to the team</strong> with the items they were looking at. Old inquiries are still in each member's History.</p>

<h3>Payment reminders</h3>
<p>When <strong>Automatic payment reminders</strong> is switched on, unpaid invoices get a friendly email at 24 hours, 48 hours, one week and two weeks, each with the order and a "View &amp; pay" button. A week after the last one, the order moves to <strong>Expired</strong>. Cash-at-pickup orders are never chased, and nobody gets the same reminder twice.</p>
<ul>
<li>Inside an order you'll see which reminders went out. <strong>Stop reminders for this order</strong> switches them off for that order (useful if they've told you they're paying Friday).</li>
<li>In <strong>Expired</strong>, <strong>Revive order</strong> puts the order back into Pending payment. Reminders stay off for it after that.</li>
<li>To move an unpaid order to Expired yourself (they've gone quiet), open it and press <strong>Move to Expired</strong>, or ask the Concierge, e.g. "move the 3 oldest unpaid orders to Expired". It stays unpaid and isn't cancelled.</li>
<li>Timing and wording: Settings → Payment reminders.</li>
</ul>
<p>Ten orders per page, newest first. Use the arrows at the bottom to go further back, and <kbd>Export CSV</kbd> to download the lot as a spreadsheet.</p>

<h3>Opening an order</h3>
<p>Click any row. A panel opens with the customer, the items, the total, their address, any note they left, and every action button.</p>
<div class="callout tip">
<strong>Alert emails link straight to the order</strong>
New order emails have a button called <strong>"Open this order in admin."</strong> One click and you're on that exact order.
</div>

<h3>Changing status</h3>
<p>Inside the order, use the <strong>Status</strong> dropdown. It saves immediately and can always be changed back.</p>
<div class="callout tip">
<strong>One finished status</strong>
Shipped and picked-up orders share a single <strong>Completed</strong> status. Whether an order was posted or collected is already on the order itself, under its delivery method, so there's no need for two separate buttons to remember.
</div>
<div class="callout warn">
<strong>Cancelled is not deleted</strong>
Cancelling hides an order from the "All" list but keeps the record for your books. That's what you want when someone changes their mind.
</div>
<p>The three jobs you'll do most from here have their own pages: <a href="#job-paid">take a payment</a>, <a href="#job-ship">ship an order</a>, and <a href="#job-message">message a customer</a>.</p>
</section>

<!-- ===== MEMBERS TAB ===== -->
<section id="tab-members">
<h2 class="sec">Members</h2>
<span class="where">Dashboard → Members</span>
<p class="lede">Approve new sign-ups and look after existing customers.</p>

<h3>Approving requests</h3>
<p>People request access from the front page and see nothing until approved. Requests sit at the top of this tab with a count badge, showing their name, email, age confirmation, whether they've bought before, and any note.</p>
<ol class="steps">
<li>Read the request.</li>
<li>Click <kbd>Approve</kbd> — they instantly get a welcome email with a link into the site.</li>
<li>Or <kbd>Reject</kbd> if something's off. They aren't notified.</li>
</ol>
<div class="callout tip">
<strong>The site promises under 24 hours</strong>
Checking once each morning keeps that promise easily.
</div>

<h3>Adding someone yourself</h3>
<p>For a person you already know — a regular, a friend, or someone whose request went astray — you can skip the request step entirely. Above the member list click <strong>+ Add member</strong>, type their name and email, and either keep the generated password or type your own. They are approved the moment you click <strong>Create member</strong>.</p>
<ul>
<li>Leave <strong>Email them their login details</strong> ticked and they get a short note with the password and a sign-in button.</li>
<li>Untick it if you would rather tell them in person; the password is shown to you after saving.</li>
<li><strong>Add them to the mailing list</strong> is ticked by default.</li>
</ul>
<div class="callout tip">
<strong>If their email is already in the system</strong>
The site tells you and does nothing, so you cannot end up with two accounts for one person. If they have a request waiting, approve that instead. If they were rejected, find them under <strong>Rejected</strong> and use <strong>Approve after all</strong>.
</div>

<h3>Rejecting a request</h3>
<p>Each waiting request has three buttons. <strong>Approve</strong> lets them in. <strong>Reject</strong> turns them down but keeps their record. <strong>Delete</strong> removes them completely and cannot be undone. When in doubt, reject rather than delete.</p>
<p>Below the pending requests is a collapsed <strong>Rejected</strong> list. Nobody vanishes: if a request was rejected by mistake, open it and click <strong>Approve after all</strong>. They get the normal welcome email and can sign in straight away.</p>

<h3>Finding someone</h3>
<p>Type any part of a name or email into the search box and the list narrows as you type. The arrow beside the "Members" heading collapses the whole list when you want it out of the way.</p>

<h3>Adding lots of members at once</h3>
<p>The <strong>Import CSV</strong> button next to the member list lets you add many people from a spreadsheet in one go. This is useful if you already have a customer list somewhere else.</p>
<p>The file needs a column called <strong>email</strong>, and a <strong>name</strong> column if you have one. Everything else is ignored.</p>
<ol class="steps">
<li>Click <kbd>Import CSV</kbd> and pick your file.</li>
<li>Wait a moment. You will get a summary telling you how many were added.</li>
<li>Let those people know they can now sign in.</li>
</ol>
<div class="callout warn">
<strong>Imported members need to set a password</strong>
The site does not invent a password for them, and nobody is emailed automatically. Tell them to go to the sign-in page and click <strong>"Forgot password?"</strong>. The site emails them one they can use straight away.
</div>
<div class="callout tip">
<strong>Importing twice is safe</strong>
Anyone whose email is already in the system is skipped, so nothing gets overwritten and no duplicates are made.
</div>

<h3>Bringing customers over from the old Shopify store</h3>
<ol class="steps">
<li>In Shopify: <strong>Customers → Export → All customers → CSV</strong>.</li>
<li>Here: <strong>Members → Import from Shopify</strong> and pick that file. You'll see a preview first — how many new members, how many are already here (left exactly as they are), who joins the mailing list, and who's skipped (no email, or said they're under 21). Nothing is saved yet.</li>
<li>Press <kbd>Import</kbd>. Addresses, phone, notes, “used {{SHORT}} before”, experience level and their old-store order history come across. People who said no to marketing in Shopify won't get campaigns. <strong>No emails are sent.</strong> Running the same file again adds nobody twice.</li>
<li>In the <strong>Invite members to set a password</strong> box: <kbd>Send a test to me</kbd>, check it, then <kbd>Invite</kbd>. Emails go out in batches every 15 minutes (9am–6pm {{TZ}}); you can <kbd>Pause</kbd> or <kbd>Cancel</kbd>. The bar shows how many have set a password.</li>
<li>A few days later, <kbd>Remind</kbd> sends a fresh link to anyone who still hasn't.</li>
</ol>
<p>Each link works once, for 30 days, and signs them straight in. If theirs expired, they can choose <em>“First time here since our old shop? Email me a link”</em> on the sign-in screen, or you can press <kbd>Send set-password link</kbd> on their row. “Forgot password?” works for them too. Members still waiting show a <em>No password yet</em> tag.</p>

<h3>What you can do for a member</h3>
<table>
<tr><th>Button</th><th>What it does</th></tr>
<tr><td>Edit</td><td>Fix a name or email typed wrong at sign-up, or change their shipping address and phone. Their password, points and orders stay as they are (orders already placed keep the address they were placed with), and if they're on the mailing list that moves to the new email too.</td></tr>
<tr><td>Log in as</td><td>Opens the members' site signed in as them, so you see exactly what they see and can place an order for them. A rust-coloured bar says <em>Signed in as …</em> with <kbd>← Back to admin</kbd>. It ends after an hour or when you press that button. Their password isn't touched, orders you place show <em>Placed by staff</em>, and each use is in the Activity log. Only approved members.</td></tr>
<tr><td>History</td><td>Every order and invoice they've had. Click one to manage it.</td></tr>
<tr><td>Message customer</td><td>Email them from the dashboard</td></tr>
<tr><td>Generate invoice</td><td>Bill them by hand — see <a href="#job-invoice">Invoice by hand</a></td></tr>
<tr><td>Reset password</td><td>For someone locked out. Tell them the new one yourself.</td></tr>
<tr><td>Export CSV</td><td>Download the whole member list as a spreadsheet</td></tr>
<tr><td>Import CSV</td><td>Add lots of members at once from a spreadsheet</td></tr>
<tr><td>Delete</td><td>Permanent. Cannot be undone.</td></tr>
</table>
</section>

<!-- ===== PRODUCTS TAB ===== -->
<section id="tab-products">
<h2 class="sec">Products</h2>
<span class="where">Dashboard → Products</span>
<p class="lede">The catalog workspace — search, filter, bulk edit, reorder.</p>

<h3>Adding a product</h3>
<ol class="steps">
<li>Click <kbd>+ New product</kbd>.</li>
<li>Enter the <strong>Name</strong>.</li>
<li>Press <kbd>⬆ Upload photo</kbd> and pick a picture from the computer or phone, or paste a link to one. The preview updates instantly so you can check it. Big phone photos are shrunk automatically so pages stay fast.</li>
<li>Enter the <strong>Price</strong> — "$120", or even "Inquire" if you'd rather people ask.</li>
<li>Optionally add a <strong>Sale price</strong>. The original shows crossed out. Tick <strong>💵 Cash pickup only</strong> to make it a cash pickup deal (see <em>Run a sale</em>).</li>
<li>Add a <strong>Category</strong> — this creates the filter buttons customers use, so keep spelling consistent.</li>
<li>Choose <strong>Where it sells</strong>.</li>
<li>Write a <strong>Description</strong>. Short paragraphs and lines starting with "-" format themselves.</li>
<li>Click <kbd>Add product</kbd>.</li>
</ol>

<h3>Where it sells</h3>
<table>
<tr><th>Setting</th><th>Members</th><th>Public</th><th>Use for</th></tr>
<tr><td><strong>Members only</strong></td><td>Yes</td><td>No</td><td>Anything not for public listing. The default.</td></tr>
<tr><td><strong>Both</strong></td><td>Yes</td><td>Yes</td><td>General products</td></tr>
<tr><td><strong>Public shop only</strong></td><td>No</td><td>Yes</td><td>Retail items that would clutter the gallery</td></tr>
</table>
<div class="callout tip">
<strong>Change it in one click</strong>
The coloured tag on any product card is a button. Click it to cycle Members → Both → Public without opening anything.
</div>

<h4>Changing lots of products at once</h4>
<p>If you click several tags one after another, the site waits about a second after your last click and then saves them all together in one go. While it's waiting you'll see a gold <strong>"3 unsaved"</strong> label near the top with a <strong>Save now</strong> button if you don't want to wait.</p>
<p>This is on purpose. Saving them one at a time used to make some changes overwrite others, so a few would quietly not stick. Saving them together fixes that.</p>
<div class="callout tip">
<strong>You can't lose them by leaving</strong>
If you switch tabs, close the page, or click away while changes are still gathering, they save straight away instead of being thrown out.
</div>

<h3>Finding things</h3>
<ul>
<li><strong>Search</strong> — matches name, category, and description as you type</li>
<li><strong>Filters</strong> — All, Members only, Both, Public only, On sale, Bundles</li>
<li><strong>Sort</strong> — display order, name, price high or low, newest</li>
<li><strong>View</strong> — grid for browsing by photo, list for compact work</li>
</ul>

<h3>Changing many at once</h3>
<ol class="steps">
<li>Tick the checkbox on each product, or use <strong>Select all</strong>.</li>
<li>A green bar appears at the top.</li>
<li>Set visibility for all of them together, or delete them together.</li>
</ol>

<h3>Per-product actions</h3>
<table>
<tr><th>Action</th><th>What it does</th></tr>
<tr><td>Edit</td><td>Full form with live image preview</td></tr>
<tr><td>Duplicate</td><td>Instant copy — fastest way to make a variant</td></tr>
<tr><td>↑ ↓</td><td>Moves it in the gallery. Customers see this order.</td></tr>
<tr><td>Remove</td><td>Permanent</td></tr>
</table>
<div class="callout warn">
<strong>The arrows only appear sometimes</strong>
They show when sorting is "Display order" with no filters or search active. Moving item three above item seven is meaningless in a filtered list, so they hide themselves.
</div>

<h3>Stock counts and backorders</h3>
<p>Under the product list, open <strong>Stock counts</strong>. Type how many of each product you have ready to send and press <kbd>Save</kbd>. You can also see and change a product's count in its edit window. Leave a box <strong>blank</strong> if you don't want that product counted. Bundles use the counts of the products inside them.</p>
<ul>
<li><strong>Every order takes its items off</strong> the count. Cancelling an order puts them back.</li>
<li><strong>At 0</strong> the shop shows <strong>Currently restocking</strong>, and people can <strong>still order</strong>. Those order lines are marked “restocking” so you know they're waiting for new stock.</li>
<li><strong>On backorder</strong> means units customers have ordered that the shelf didn't cover. The rust-coloured <strong>“… on backorder”</strong> label next to <em>Stock counts</em> shows the total. Tap it to see each product, with the orders waiting for it and how many each one needs. Send those first when stock arrives.</li>
</ul>
<ol class="steps">
<li><strong>When a delivery comes in:</strong> open Stock counts, type the new totals and press <kbd>Save</kbd>. Or tell the Concierge (“we now have 24 Harmony Blend”) and confirm its card.</li>
<li>Pack the backordered orders first. The list under the rust-coloured label tells you which ones.</li>
</ol>
<div class="callout tip">
<strong>The Today list warns you before you run out</strong>
When a product is running low or owed to customers, <strong>Overview → Today</strong> shows <em>Restock …</em> with what's on hand, what's on backorder and 30 days of sales. <kbd>Plan the restock</kbd> asks the Concierge how much to order.
</div>
<div class="callout warn">
<strong>The shop only uses the counts once the switch is on</strong>
Enter the counts first, then turn on <strong>Stock counts</strong> in Settings → Feature switches. Until then the numbers are saved but customers never see “Currently restocking”.
</div>

<h3>Shipping weights</h3>
<p>Under the product list, open <strong>Shipping weights</strong>. Weigh one of each product the way it goes in the box (bottle, jar or pouch plus any wrap) and type the ounces next to its name. Weigh an empty box with its padding once and enter it as <strong>Box &amp; packing</strong> (it starts at 3.5 oz as a guess, and the Today list reminds you to check it — press <kbd>Confirm box weight</kbd> if 3.5 is right). Press <kbd>Save</kbd>.</p>
<p>From then on, shipping labels work out the weight for you: each item × quantity + the box. You'll see the sum on the order before you buy, and you can still change it. The Concierge uses the same weights when it prepares a label card, and it warns you if a product has no weight yet. The Today list reminds you about products that ship without one. You can also set a weight when adding or editing a product, or ask the Concierge ("Harmony Blend weighs 4.5 oz").</p>
<h3>Product videos</h3>
<p>Edit a product and press <kbd>⬆ Upload video</kbd> to add an MP4 (up to 250 MB, with a progress bar), or paste a YouTube or Vimeo link into <strong>Video</strong>. Shoppers see a “▶ Video” tag on the product card, and the video plays at the top of the product's pop-up. Clear the box to remove it.</p>
<div class="callout tip">
<strong>Videos from an iPhone</strong>
iPhones often save videos as .mov and photos as HEIC, which some browsers can't show. The uploader will tell you. Fix it once: iPhone Settings → Camera → Formats → <strong>Most Compatible</strong>. Keep uploaded clips short; for long videos an unlisted YouTube link streams better and costs nothing.
</div>
<p>When you replace or remove an uploaded photo or video, or delete the product, the old file is deleted automatically, unless another product (for example a bundle) still uses it. Links you pasted from other sites are never touched.</p>

<h3>Printable QR code for a product</h3>
<p>In a product's edit window, open <strong>QR code for this product</strong>, then choose <kbd>Download</kbd> or <kbd>Print</kbd>. Scanning it opens the shop with that product (and its video) showing.</p>
<div class="callout tip">
<strong>Printed codes never go stale</strong>
The code points to a permanent link for that product. Renaming it, changing the price or moving it between shops won't break a code that's already printed. Print codes from the <em>live</em> dashboard, not stage.
</div>
</section>

<!-- ===== EVENTS TAB ===== -->
<section id="tab-events">
<h2 class="sec">Events</h2>
<span class="where">Dashboard → Events</span>
<p class="lede">Classes and gatherings, with automatic sign-ups and waitlists.</p>

<h3>Creating one</h3>
<ol class="steps">
<li>Fill in title, description, date and time, and location.</li>
<li>Set <strong>Capacity</strong> — how many fit. Use 0 for unlimited.</li>
<li>Set <strong>Waitlist capacity</strong> — extra names to collect once full.</li>
<li>Tick <strong>Published</strong> to make it appear at <strong>/events</strong>. Leave it off to keep drafting.</li>
<li>Click <kbd>Create event</kbd>.</li>
</ol>

<h3>Changing an event after it's live</h3>
<p>Click <kbd>Edit</kbd> on any event to change anything about it: the time, the location, the price, the description, the photo, capacity, or the waitlist size. This works whether the event is a draft, already published, or in the past. Changes appear on the public page right away.</p>
<div class="callout warn">
<strong>Edit it, don't delete and rebuild it</strong>
Deleting an event throws away everyone who signed up. If a date moves or a price changes, always edit the existing event so your registrations come with it.
</div>
<p>A few things worth knowing while editing:</p>
<ul>
<li><strong>Lowering capacity is safe.</strong> If four people are registered and you drop capacity to two, nobody gets removed. It just stops new spots opening. The form warns you when this happens.</li>
<li><strong>Unpublishing keeps registrations.</strong> Ticking off Published hides the event from the public page but everyone signed up stays signed up. Publish it again and they're still there.</li>
<li><strong>Clearing a field really clears it.</strong> Empty out the price or the image and it disappears from the public listing.</li>
</ul>
<p>If a time or location changes, the site does not notify people automatically. Open <strong>Registrations</strong>, see who is signed up, and message them so they know.</p>

<h3>How sign-ups handle themselves</h3>
<ul>
<li>While there's room, people are <strong>registered</strong>.</li>
<li>Once full, they join the <strong>waitlist</strong> automatically.</li>
<li>If someone cancels, the first person on the waitlist is promoted automatically.</li>
</ul>
<p>You can see everyone signed up, and cancel or promote people by hand if you need to.</p>
<p>The sign-up list shows <strong>15 people at a time</strong>. If more than that have signed up, use the <strong>Previous</strong> and <strong>Next</strong> buttons at the bottom of the list. It tells you where you are, like "1–15 of 42". You can also download the whole list as a spreadsheet with <kbd>Export CSV</kbd>.</p>

<h3>What visitors see</h3>
<p>Published events appear at <strong>/events</strong> as cards. Clicking the photo, the title, or the <strong>Details</strong> button opens a pop-up with the full description, the date and location, the price, and live availability such as "12 of 20 registered." They register from there, or straight from the card.</p>
</section>

<!-- ===== MARKETING TAB ===== -->
<section id="tab-marketing">
<h2 class="sec">Marketing</h2>
<span class="where">Dashboard → Marketing</span>
<p class="lede">Discount codes, mix &amp; match bundles, the site banner, and email campaigns.</p>

<h3>Mix &amp; match bundles</h3>
<p>A set discount: buy every product in the set, save automatically. For example Sacred Immunity + Revive + Thrive + Harmony capsules, 20% off.</p>
<ol class="steps">
<li>Press <kbd>New bundle</kbd>, give it a name, and add the products (with a quantity if it's "2 of these").</li>
<li>Choose <strong>% off the set</strong> or a <strong>Set price</strong>. The preview shows what one set costs before and after, at today's prices.</li>
<li>Optionally add start and end dates, then <kbd>Create bundle</kbd>.</li>
<li>The first time, switch on <strong>Mix-and-match bundle discounts</strong> in Settings → Feature switches.</li>
</ol>
<ul>
<li>It applies once per <em>full</em> set. Two full sets get it twice; a set missing one item gets nothing, and the cart tells them what to add.</li>
<li>Sale prices count: 20% comes off the price they'd pay anyway.</li>
<li>Items in a bundle don't also get BOGO or the cart-wide bundle rule. Everything else in the cart still does.</li>
<li>A bundle <strong>or</strong> a discount code, never both. Points still work.</li>
<li>If bundles overlap, the customer gets whichever combination saves them the most.</li>
</ul>
<p>Each bundle shows how many orders used it, how much customers saved, and the sales it brought in. <kbd>Pause</kbd> stops it without deleting it.</p>

<h3>Discount codes</h3>
<p>Create a code and set any of these:</p>
<table>
<tr><th>Option</th><th>Controls</th></tr>
<tr><td>Percentage or fixed</td><td>20% off, or $15 off</td></tr>
<tr><td>Expiry date</td><td>When it stops working</td></tr>
<tr><td>Max uses</td><td>Total times anyone can use it</td></tr>
<tr><td>Per-customer limit</td><td>Times one person can use it</td></tr>
<tr><td>Minimum order</td><td>Cart must reach this first</td></tr>
<tr><td>Rep / source</td><td>A label to track where it came from</td></tr>
<tr><td>Also works in the public shop</td><td>Off = members only (the default). On = anyone can use it in the public shop too, on public products, without an account</td></tr>
</table>
<p>The dashboard tracks every use, so you can see what's working. Codes that work in the public shop show a <strong>Public shop too</strong> chip. Switch one either way with the <kbd>Public shop too</kbd> / <kbd>Members only</kbd> button in the list. A code linked to an ambassador always works in the public shop.</p>
<p>The list files codes by state: <strong>Live</strong> (on and still working), <strong>Inactive</strong> (you pressed Deactivate) and <strong>Ended</strong> (past its last day, or every allowed use taken). Ended is the archive: codes move there by themselves and keep their history. Use the search box to find a code or a rep's label, and <strong>Show more</strong> for older ones. A live code within a week of its last day shows an <em>Ends in…</em> tag.</p>

<h3>The announcement banner</h3>
<p>A coloured strip across the top of every customer page. Good for sales, holiday cut-offs, or closures.</p>
<ol class="steps">
<li>Switch it on and write the message.</li>
<li>Optionally add a link, pick colours, and set a <strong>countdown</strong> to a date — visitors see a live ticking clock.</li>
<li>Save. It appears immediately.</li>
</ol>
<div class="callout tip">
<strong>Turn it off when it's stale</strong>
A banner about a finished sale looks worse than no banner at all.
</div>

<h3>Templates</h3>
<p>Above the composer, open <strong>Templates</strong> for ready-made starting points: Fall, Holiday, Winter, Spring, Summer, Promo, Event, News and a blank one. Press <kbd>Use</kbd> to load one into the composer, then replace anything in <code>[brackets]</code>. To keep something you wrote, type a name under the templates and click <kbd>Save template</kbd>. Saved templates can be duplicated, archived, or deleted for good with <kbd>Delete</kbd> (it asks first). Every card also has <kbd>✦ Redo with AI</kbd>: the Concierge rewrites that template and shows the new version with a preview, and it only replaces the card when you press <strong>Save template</strong>. The built-in starters work the same way: a rewritten one is marked <em>edited</em> and has <kbd>Reset</kbd> to go back to the original wording, and <kbd>Remove</kbd> takes one off the list (a <strong>Bring back</strong> link appears to restore removed built-ins).</p>
<p><strong>Preview email</strong> under any template shows exactly what subscribers will see: header, your text, buttons and footer, with a sample name. The same preview is on the Concierge's template cards and campaign drafts. For new ideas, type one in the box at the top of Templates (e.g. <em>cozy fall restock, 10% off this weekend</em>) and press <kbd>✦ Generate</kbd>, or leave it empty and press <kbd>✦ Suggest ideas</kbd>. The Concierge writes it and shows a <strong>Save template</strong> card with a preview; nothing is saved until you confirm. <kbd>↻ Refresh</kbd> reloads the list.</p>

<h3>Email campaigns</h3>
<ol class="steps">
<li>Write a subject line and message.</li>
<li>Under <strong>Send to</strong>, pick who gets it: <strong>Everyone</strong>, <strong>Members only</strong>, or <strong>Non-members only</strong>. The number next to each shows how many people that is.</li>
<li><strong>Click "Send test to myself" first.</strong> Check it in your own inbox.</li>
<li>When it looks right, send it to the list.</li>
</ol>
<div class="callout tip">
<strong>Who counts as a member</strong>
Anyone on the mailing list whose email also has an approved {{MEMBERS}} account. A member-only email is a good way to announce something in the private catalog. A non-member email is a good way to invite everyone else to join.
</div>

<h3>Making the email look good</h3>
<p class="lede">You never have to write HTML. Just type normally and the site turns it into a properly designed email.</p>

<p>Every campaign is automatically wrapped in the {{SHORT}} template: the green header with our name, a white card, the reader's first name at the top, and the unsubscribe footer. You only write what goes in the middle.</p>

<p>Type plainly and it comes out formatted. Leave a blank line between paragraphs and each becomes its own paragraph. If you want more than that, these few shortcuts are all there is:</p>

<table>
<tr><th>Type this</th><th>You get</th></tr>
<tr><td><kbd># New arrivals</kbd></td><td>A heading in our serif font</td></tr>
<tr><td><kbd>- Reishi tincture</kbd><br/><kbd>- Lion's mane caps</kbd></td><td>A bulleted list</td></tr>
<tr><td><kbd>**this**</kbd></td><td><strong>Bold text</strong></td></tr>
<tr><td><kbd>*this*</kbd></td><td><em>Italic text</em></td></tr>
<tr><td><kbd>[Shop now](https://{{HOST}})</kbd></td><td>A green button, if it's alone on its own line</td></tr>
<tr><td><kbd>[our shop](https://{{HOST}})</kbd></td><td>A link, when it's inside a sentence</td></tr>
<tr><td><kbd>---</kbd></td><td>A dividing line</td></tr>
<tr><td>Any web address</td><td>Becomes a clickable link on its own</td></tr>
<tr><td><kbd>![Our new label](https://…)</kbd></td><td>A photo, if it's alone on its own line</td></tr>
</table>

<h3>Adding a photo</h3>
<p>Click in the message where the photo should go, then press <kbd>⬆ Upload photo</kbd> under the message box and pick a JPEG, PNG, WebP or GIF. It uploads and the message gets a <kbd>![Photo](https://…)</kbd> line, which shows as the picture in the email. If you haven't clicked in the message, the photo goes at the end. Change the word <em>Photo</em> in the brackets to a short description for people who can't see images. Use <strong>Preview email</strong> or send yourself a test to check how it looks. Big phone photos are shrunk first. iPhone HEIC photos need sharing as JPEG (or set iPhone Settings → Camera → Formats → <strong>Most Compatible</strong>).</p>

<div class="card">
<h4 style="margin-top:0">A complete example</h4>
<p style="font-family:monospace;font-size:0.85rem;white-space:pre-wrap;background:#f2f4ef;padding:0.9rem 1rem;border-radius:8px;line-height:1.6;"># Fresh batch just landed

We just finished a new run and wanted you to hear it first.

- Reishi tincture, back after two months
- Lion's mane capsules in the larger size
- A new chocolate bar we're quietly proud of

Local pickup is always free, and orders over three items save 10%.

[Browse the shop](https://{{HOST}})

---

Questions? Reply to {{SUPPORT}}</p>
<p>That produces a heading, a paragraph, a neat bullet list, another paragraph, a green button, a divider, and a closing line. No HTML anywhere.</p>
</div>

<div class="callout tip">
<strong>Already have HTML?</strong>
If you paste real HTML in, the site notices and uses it exactly as written, still inside the {{SHORT}} template. So a design from elsewhere works too, but you never need one.
</div>

<div class="callout warn">
<strong>Always send yourself the test</strong>
The test email is the real thing, formatting and all. Read it on your phone as well as your computer, since most people will open it on a phone.
</div>
<div class="callout danger">
<strong>A campaign cannot be unsent</strong>
There is no recall. Send the test, read it properly, check every link, then send for real. Every campaign carries an unsubscribe link automatically, as the law requires.
</div>
<p>The list is built from people who ticked the opt-in box at public checkout, from members who left the box ticked when they signed up, and from anyone who scanned the sign-up code at an event. Open <strong>Manage subscribers</strong> to see everyone; the <strong>Unsubscribed</strong> filter shows just the people who opted out, newest first, with the date. When sending, pick any mix of three groups: <strong>Members subscribed</strong>, <strong>Non-subscribed members</strong> (members not on the list who have never opted out — see Terms §9) and <strong>Mailing list subscribed – not member</strong>. The first and last are ticked by default (that's everyone on the mailing list). Or choose <strong>Paste custom email list</strong>. Anyone who has unsubscribed is always skipped.</p>
<p>Above the list are three buttons: <strong>All</strong>, <strong>Members</strong>, and <strong>Non-members</strong>. Click one to show only that group. People who are members get a small green <strong>Member</strong> tag next to their name, and anyone who joined at an event shows the event name.</p>

<h3>Collecting sign-ups at an event</h3>
<p class="lede">A QR code people scan at your table. They type a name and email, and they are on the mailing list. That is all it does: no account, no password, nothing for you to approve.</p>
<ol class="steps">
<li>In the Marketing tab, find <strong>Event sign-up QR code</strong>.</li>
<li>Type the event name if you want one, for example <em>Farmers Market, Sept 2026</em>. This is optional, but it means you can see later who signed up at which event.</li>
<li>Optional: pick an <strong>Offer for this event</strong>, one of your discount codes, or tap <strong>+ Make a new code for this event</strong> to create one right there (it suggests a code like <em>FARMERS15</em>, 15% off, once per person, working for 30 days; change anything, then <strong>Create &amp; use it</strong>). Everyone new who signs up at that event gets the code in their welcome email, the sign-up page says "Join today and we'll email you 15% off your order", and the printed page mentions it too. The code's own limits still apply at checkout. If the code is switched off or expires, nobody gets it and the page stops mentioning it. <strong>Event offers</strong> underneath lists every event with an offer; <strong>Use</strong> loads it, <strong>Remove</strong> takes the offer off.</li>
<li>Click <strong>Print</strong> for a ready-to-print page with the code, or <strong>Download SVG</strong> for a file you can put on a flyer. It prints sharp at any size.</li>
<li>Put it on the table. When someone scans it their phone opens a short form.</li>
</ol>
<div class="callout tip">
<strong>Works on an iPad too</strong>
Click <strong>Open the page</strong> and leave that on a tablet at the booth. After each person signs up it says thank you, then clears itself a few seconds later, ready for the next person.
</div>
<div class="callout tip">
<strong>They get a welcome email straight away</strong>
Anyone new who signs up this way gets a friendly welcome with three doors to walk through: the public shop, a note about joining {{MEMBERS}}, and the events page. Someone already on the list does not get a second one.
</div>
<div class="callout tip">
<strong>Scanning twice does no harm</strong>
Someone already on the list just gets a thank-you on screen. If they had unsubscribed before, scanning puts them back on, because they asked to be.
</div>
<p>The link behind the code is always <strong>{{HOST}}/join</strong>, so a code you printed last year still works this year. The event name just rides along with it.</p>

<h4>Getting a list in and out</h4>
<p>Two buttons sit above the subscriber list:</p>
<ul>
<li><strong>Export CSV</strong> downloads the whole list as a spreadsheet, the same as the other exports. It includes a <strong>Member</strong> column (yes or no) and an <strong>Event</strong> column, so you can sort the same way in Excel. The nightly backup email carries the same file.</li>
<li><strong>Import CSV</strong> uploads a list. Use this to bring people over from another mailing tool or a spreadsheet you already keep.</li>
</ul>
<p>The file only needs a column called <strong>email</strong>. If there is a <strong>name</strong> column it will be used too. Any other columns are ignored, and the order does not matter.</p>
<div class="callout tip">
<strong>Importing twice is safe</strong>
Anyone already on the list is left alone, so you cannot create duplicates. After it finishes you get a summary of how many were added and how many were skipped.
</div>

<h4>Adding your members to the mailing list</h4>
<p>You can export your members from the Members tab and upload that same file here. It works because both files have an email column.</p>
<div class="callout tip">
<strong>It only takes the right people</strong>
A members file also says whether each person is approved, pending, or rejected. Only approved members are added. Anyone you turned down, or who is still waiting, is skipped and the summary tells you how many.
</div>
<div class="callout warn">
<strong>People who unsubscribed stay unsubscribed</strong>
If you upload an old copy of your subscriber list, anyone who had opted out is left off. Someone who asks to stop hearing from you will not be added back by an import.
</div>

<h3>Scheduling a campaign</h3>
<p>Set <strong>When</strong> in the composer to a date and time and press send. Scheduling it counts as approving it. It goes out at that time, but only between 9 am and 6 pm {{TZ}}. Anything due overnight waits for 9 am. Until it starts sending, <kbd>Cancel</kbd> in the Campaigns list stops it.</p>
<p>You can also send to a <strong>pasted list</strong> of addresses. Only people on your mailing list who haven't unsubscribed will get it.</p>

<h3>How a campaign did</h3>
<p>The <strong>Campaigns</strong> list under the composer shows each one: when it went, how many it reached, the percentage who opened and clicked, and the visits, orders and sales that came from its links. <kbd>Duplicate</kbd> copies it back into the composer. Anyone who marks a campaign as spam is unsubscribed automatically.</p>
</section>

<!-- ===== AMBASSADORS TAB ===== -->
<section id="tab-ambassadors">
<h2 class="sec">Ambassadors</h2>
<span class="where">Dashboard → Ambassadors</span>
<p class="lede">Influencers and friends of the brand who share {{SHORT}}. Each one gets their own page, their own terms, and a running tally of what they’ve sold and earned.</p>

<h3>What an ambassador gets</h3>
<ul>
<li><strong>Their own page</strong> at <strong>{{HOST}}/their-name</strong>: their photo, a few words, links to their socials and the products they pick, each with Add to cart. It isn’t in the site’s menus or on Google. People only reach it through their link or QR code.</li>
<li><strong>Credit for sales</strong>: orders from people who came through their page (within their attribution window) or members who used their code.</li>
<li><strong>Commission</strong> on those sales, worked out for you, and a <strong>progress report</strong> you can email them any time.</li>
</ul>

<h3>Adding an ambassador</h3>
<ol class="steps">
<li>Open the <strong>Ambassadors</strong> tab and press <kbd>+ Add an ambassador</kbd>.</li>
<li><strong>Their page</strong>: name, page address (fills itself in), optional headline, a few words in their voice, a photo (<kbd>Upload photo</kbd>), the <strong>featured products</strong> in order (↑ ↓; public-shop products only; none = whole shop) and their <strong>social links</strong> (each gets its icon).</li>
<li><strong>Their terms</strong>, copied from their agreement:
  <ul>
  <li><strong>Their email</strong>: where progress reports go.</li>
  <li><strong>Their discount code</strong>: make the code first under Marketing → Discount codes (e.g. 10% off), then pick it here. It works for their community in the public shop and the members’ shop, and anyone who opens their page finds it already filled in at checkout.</li>
  <li><strong>Commission %</strong> (e.g. 15) and <strong>community discount %</strong> (e.g. 10).</li>
  <li><strong>Room to grow</strong>: the higher rate (e.g. 20) and the goals that earn it. Tick <em>Goals met</em> when they get there. New orders then earn the higher rate, and earlier orders keep the rate they were placed at.</li>
  <li><strong>Started on</strong> and <strong>trial</strong> length (e.g. 90 days; 0 = none).</li>
  <li><strong>Attribution window</strong>: how many days after visiting their page an order still counts (e.g. 30). Untick <em>Repeat purchases count</em> if only each customer’s first order should.</li>
  <li><strong>Payouts</strong>: monthly, quarterly or on request.</li>
  <li><strong>Other terms &amp; notes</strong>: complimentary products sent, content permissions, exclusivity… (staff only).</li>
  </ul>
</li>
<li>Press <kbd>Create</kbd>. Open their card, then <kbd>Copy link</kbd> or <kbd>QR code ⬇</kbd> / <kbd>Print QR</kbd> and send it to them.</li>
</ol>
<div class="callout warn">
<strong>Share links and QR codes from the live dashboard</strong>
On stage the link and QR code point at stage. The panel warns you when that’s the case.
</div>

<h3>Reading the numbers</h3>
<p>The top of the tab shows everyone together: live pages, page visits, orders, sales, commission earned and <strong>owed now</strong>. Sort the cards by <em>Most owed</em>, <em>Most sales</em>, <em>Newest</em> or <em>Name</em>. Tap a card for one ambassador:</p>
<table>
<tr><th>Number</th><th>What it means</th></tr>
<tr><td>Page visits</td><td>Times their page was opened (and how many came from the QR code). Counted without cookies or personal data.</td></tr>
<tr><td>Orders</td><td>Orders credited to them, and what share of visits became an order. Cancelled orders aren’t counted.</td></tr>
<tr><td>Sales (paid)</td><td>Product sales after discounts, without shipping, on paid orders. Unpaid ones are shown separately.</td></tr>
<tr><td>Earned</td><td>Their commission on paid orders. Unpaid orders show what they’ll earn once paid.</td></tr>
<tr><td>Paid to them</td><td>Every payout you’ve recorded.</td></tr>
<tr><td>Owed now</td><td>Earned minus paid. This is what to pay them next.</td></tr>
</table>
<p>Below that: their <strong>trial</strong> (day 29 of 90, or <em>review due</em> once it’s over; press <kbd>Mark review done</kbd> after you talk), <strong>month by month</strong>, their <strong>top products</strong>, their <strong>terms</strong>, and every <strong>order</strong> credited to them with what it earned.</p>

<h3>Paying an ambassador</h3>
<ol class="steps">
<li>Check <strong>Owed now</strong> on their page in the dashboard.</li>
<li>Pay them the usual way (Zelle, Venmo…). The site never moves money.</li>
<li>Under <strong>Payouts</strong>, type the amount, date and a note (“Zelle, October commission”) and press <kbd>Record payout</kbd>. <strong>Owed now</strong> goes down. Entered one by mistake? Press <kbd>Remove</kbd>.</li>
</ol>

<h3>Emailing a progress report</h3>
<ol class="steps">
<li>Open the ambassador and press <kbd>✉ Email a progress report</kbd>.</li>
<li>Pick what it covers: <em>This month so far</em>, <em>Last month</em>, <em>The last 30 days</em> or <em>Since they started</em>.</li>
<li>Add your own note and sign-off, or leave them blank for a warm thank-you from the team. The preview on the right updates as you type.</li>
<li>Type your own email and press <kbd>Send test</kbd> to see it in your inbox first.</li>
<li>Press <kbd>Send to …</kbd>. It goes to the email in their terms, and their replies go to the support inbox.</li>
</ol>
<p>The report shows their page visits, orders, sales and commission for that period, what they’ve earned, been paid and are still owed since they started, their community’s favorite products, where their trial stands and their link and code. It <strong>never</strong> shows customers’ names or details.</p>

<h3>Asking the Concierge</h3>
<p>The staff Concierge knows all of this. Ask it things like <em>“How is Alex doing this month?”</em>, <em>“Who do we owe commission to?”</em> or <em>“Which ambassador sold the most?”</em> and it pulls back the same numbers as this tab. It can also prepare cards for you to confirm: adding an ambassador or changing their terms (<em>“Toni hit her goals, move her to 20%”</em>), recording a payout you’ve made (<em>“I paid Toni $42.50 by Zelle”</em>), and emailing a progress report. Nothing changes until you press the card’s button.</p>
<p>The Overview’s <strong>Today</strong> list also reminds you when ambassador payouts are due (the first week of the month, or of the quarter for quarterly payouts) and when someone’s trial is over and ready for review.</p>

<h3>Turning a page off</h3>
<p><kbd>Turn off</kbd> takes their page down without losing anything: the link stops working for customers and new orders stop being credited. Their numbers and payouts stay. You can still open the page while signed in to the dashboard to preview it. <kbd>Delete</kbd> removes them for good, including their payout history (credited orders keep their name).</p>
<div class="callout tip">
<strong>Before the switch is on</strong>
Everything here works with the <strong>Ambassador pages</strong> switch off, so you can set people up and preview their pages first. Customers can only open the pages, and orders are only credited, once it’s on in Settings → Feature switches.
</div>
</section>

<!-- ===== ANALYTICS TAB ===== -->
<section id="tab-analytics">
<h2 class="sec">Analytics</h2>
<span class="where">Dashboard → Analytics</span>
<p class="lede">How people find the shop, what they look at, and what they buy.</p>
<p>Pick a period at the top (7 days, 30 days, 90 days, a year). You'll see:</p>
<ul>
<li><strong>The headline numbers</strong>: visits, orders, sales and conversion, each compared with the period before.</li>
<li><strong>The funnel</strong>: visited → looked at a product → added to cart → checked out → paid. The biggest drop is where to focus.</li>
<li><strong>Busiest days and hours</strong>, so you know when to send campaigns and post.</li>
<li><strong>Where visits came from</strong>: search, social, email campaigns and QR codes.</li>
<li><strong>Products</strong>: best sellers, most viewed, and ones people look at but don't buy.</li>
<li><strong>Customers</strong>: new members and subscribers, and repeat buyers.</li>
<li><strong>What people ask the Concierge</strong>, and any chats it flagged.</li>
</ul>
<div class="callout tip">
<strong>No cookies, no banner</strong>
Visits are counted without cookies or storing anyone's address, and visitors who ask not to be tracked aren't counted. That's why there's no cookie pop-up.
</div>
</section>

<!-- ===== SETTINGS TAB ===== -->
<section id="tab-assistant">
<h2 class="sec">The AI assistant</h2>
<span class="where">Dashboard → Assistant, and the round button in the corner</span>
<p class="lede">A chat helper that lives in the bottom corner of the site. Customers use it for product questions, orders and passwords. You use it inside the dashboard to look things up, draft emails and prepare changes.</p>

<h3>What customers can do with it</h3>
<ul>
<li>Ask about products, prices, sales and upcoming events. It only knows the products that visitor is allowed to see — members-only items never come up for the public.</li>
<li>Check an order. They need the 6-character reference from their order email <em>and</em> the email on the order.</li>
<li>Get a new password emailed, exactly like the Forgot password link.</li>
<li>Get their unpaid invoice sent again. Members can do this for their own orders; visitors need the order reference and the email on the order. It only ever goes to the email on the order, and the amount never changes.</li>
<li>Hand a problem to you. It collects their name, email and a short description and emails it to your inbox. Just reply to that email and it goes straight to the customer.</li>
</ul>
<div class="callout tip">
<strong>It never gives medical advice</strong>
It won't say a product treats anything, and it points people to a healthcare professional for health questions.
</div>

<h3>What it can do for you</h3>
<p>Click the dark round button in the bottom corner of the dashboard. Ask it things like:</p>
<ul>
<li>"What needs my attention today?" You get a live to-do list of requests waiting, members to approve, unpaid orders by age, orders to pack and events coming up. It then offers to prepare the reminders or approvals.</li>
<li>"What are customers struggling with?" gives the most common reasons customers get handed to you.</li>
<li>"Resend Pat's invoice", "Fix Mia's email, it should be mia@…", "Give Ann 250 points for the late parcel"</li>
<li>"Who's waiting for approval?"</li>
<li>"How do I make a discount code?" — it answers from this guide</li>
<li>"Draft an email to members about the new Reishi batch"</li>
<li>"Who are our best customers this year?" or "Who's ordered the most in the last 90 days?"</li>
<li>"What's selling best this month, and what isn't moving?"</li>
<li>"Who buys Lion's Mane?" or "Show me Ann's order history"</li>
<li>"Which regulars haven't ordered in a while?"</li>
<li>"Send Mia a reminder about her unpaid order" or "Remind everyone whose order has been unpaid for 3+ days"</li>
<li>"Put all the tinctures on 20% off" or "Buy one get one half off Lion's Mane"</li>
<li>"End the sale on Harmony Blend"</li>
<li>"Make a Morning Ritual bundle with the coffee blend and Lion's Mane, 15% off"</li>
<li>"Turn on 10% off for 3 or more items"</li>
<li>"Put up a banner for the fall sale, ending Sunday at 6pm, linking to the shop"</li>
</ul>
<div class="callout warn">
<strong>It never changes anything on its own</strong>
When you ask it to approve someone, change an order, move products between shops, create a code, start or end a sale, make a bundle, change the bundle &amp; save rule or change the banner, it shows a card with the details and a button. Sale cards show each product's old and new price. Nothing happens until you press that button. If the card looks wrong, press Dismiss.
</div>
<ul>
<li><strong>Sales figures</strong> count paid and completed orders only, the same as the Overview tab. Unpaid orders are listed separately. Each answer says which dates it covers and compares them with the period before. A customer's guest and member orders count together because they're matched by email.</li>
<li><strong>Sales stay on until you end them.</strong> It can't schedule an end date, but it can add a banner countdown so customers see when the sale ends. Ask it to end the sale when the day comes.</li>
<li><strong>Bundles</strong> are priced at the items' combined price minus the discount you ask for, and use the first item's photo. Change the photo in Products afterwards if you like. A bundle can only go in the public shop if every item in it is public.</li>
<li><strong>Banners</strong> it writes are plain text and keep your current colours. For bold text or other styling, edit the banner in Settings.</li>
</ul>
<p><strong>Emails to specific people</strong>, like payment reminders, order updates or a personal note, appear as a card showing who it goes to, the subject and the full email. Nothing is sent until you press <strong>Send email</strong>, and the card confirms who it went to. Reminders for unpaid orders include a <strong>View &amp; pay</strong> button for that order. It prepares up to 10 at a time. Replies come back to your inbox.</p>
<p>Newsletter drafts for the whole mailing list come with an <strong>Open in composer</strong> button. That fills in the Marketing tab for you. It is never sent until you press Send there yourself.</p>

<h3>Anything in the dashboard, by asking</h3>
<p>Everything you can do in the dashboard, you can also ask for. It looks things up, then shows a card with exactly what will happen and a button. Nothing changes until you press it, and every confirmed card appears in the Activity log marked <strong>Concierge</strong>. For example:</p>
<ul>
<li><strong>Members</strong>: "Add Jo Smith, jo@…, as a member" (a random password is emailed to them), "Rename…", "Email Mia a new password", "Delete the test account".</li>
<li><strong>Orders</strong>: "Invoice Mia for 2 Harmony Blend, pickup", "Buy a label for Pat's order, 12 oz", "Stop reminders for order 4K9Q2X", "Bring 7HX2PL back from Expired".</li>
<li><strong>Products</strong>: "Add Chaga Tea at $18 to both shops with this photo link", "Change Lion's Mane to $34", "Move Chaga up", "Delete the old sampler".</li>
<li><strong>Events</strong>: "Create a tea workshop on March 5 at 6pm, 12 spots, $25", "Publish it", "Cancel Guest's spot" (the first person on the waitlist moves in), "Delete the draft".</li>
<li><strong>Links &amp; QR codes</strong>: "Write an Instagram caption for Harmony Blend with the link", "Make a flyer blurb with a QR code for the tincture", "Give me the QR code for Bliss Bites". The Concierge uses each product's permanent link and shows the QR code right in the chat (with a Download button). In campaign emails a QR code line shows as a picture.</li>
<li><strong>Marketing</strong>: "Send this to members Friday at 10am", "Send me a test", "Cancel the scheduled campaign", "Turn off code SPRING10", "Make a Tea &amp; Calm bundle, 15% off", "Pause it", "Save this as a template", "Add jo@… to the mailing list".</li>
<li><strong>Emails to a group of customers</strong>: "Email members who haven't ordered in 60 days", "…everyone who bought Harmony Blend this year", "…our top 20 customers", "…subscribers who've never ordered", "…regulars due for a refill". The Concierge works out who's in the group itself and tells you how many will get it. Campaigns go to mailing-list subscribers and to members (membership includes emails unless they opt out); anyone who has unsubscribed is always skipped. The draft opens in Marketing with the list filled in, or it prepares a send card for you to confirm.</li>
<li><strong>Settings</strong>: loyalty points, feature switches, the staff sign-in list, reminder wording, "Send me the nightly report now", and the Concierge's own settings ("Add a note that pickup is Tuesdays" adds to its knowledge and never replaces it).</li>
<li><strong>Handed to the team</strong>: "Reply to Pat's question: yes, it's fine with coffee, and resolve it".</li>
</ul>
<div class="callout warn">
<strong>Red cards</strong>
Deleting something, sending a campaign, buying postage and changing who can sign in show as red cards. Read them before pressing. Where there's a gentler option it will suggest it, for example switching a code off instead of deleting it, or pausing a bundle.
</div>
<p>A few things stay in the dashboard on purpose: typing passwords (never put a password in the chat — it can email a fresh one instead), uploading photos and videos (give it a link to a photo you've uploaded), importing spreadsheets (it can give you download links), and the staff password.</p>

<h3>Teaching it about the business</h3>
<p>In the Assistant tab, the box called <strong>What the assistant should know</strong> is where you teach it. It already knows every product, price, sale and event. Add the things only you know:</p>
<ul>
<li>Favourites and pairing ideas ("Lion's Mane is our go-to for focus")</li>
<li>Policies — returns, pickup times, where you ship</li>
<li>Answers to questions customers ask you a lot</li>
</ul>
<p>Write it like you're briefing a new hire. Press <strong>Save changes</strong>; the live chat picks it up within about a minute.</p>

<h3>Choosing the model and the budget</h3>
<ul>
<li><strong>Model</strong> is the AI brain it uses. The three recommended cards update themselves to the newest fast, low-cost model from Anthropic, OpenAI and Google. Press <strong>Test this model</strong> before saving a new one.</li>
<li><strong>Backup model</strong> answers only if the main one fails. Pick one from a different company.</li>
<li>Models marked <strong>⚠ may train on your data</strong> don't promise to keep customer chats out of AI training. Prefer one without the mark, especially as the main model.</li>
<li><strong>Monthly spending limit</strong> stops it for the rest of the month when reached, and you get an email. Raise the number to switch it back on straight away.</li>
<li>The three switches turn it on or off separately for visitors, members and staff.</li>
</ul>
<div class="callout tip">
<strong>Reading the numbers</strong>
The top of the tab shows what it has cost this month, how many messages it answered, and anything it handed to the team. The figures can trail by a few minutes. Your exact bill is the AI Gateway balance in Vercel.
</div>

<h3>Talking to the Concierge (voice)</h3>
<p>With the <strong>Concierge voice</strong> switch on, the chat has a microphone, for customers and for staff:</p>
<table>
<tr><th>Button</th><th>What it does</th></tr>
<tr><td>Mic</td><td>Tap, talk, tap ■. Your words appear in the box so you can check them before sending.</td></tr>
<tr><td>▶ Listen</td><td>Under any answer. Reads that answer out loud. Tap ■ Stop to stop.</td></tr>
<tr><td>Read answers aloud</td><td>Tick it and every new answer is read out automatically.</td></tr>
<tr><td>Conversation mode</td><td>Like a phone call. See below.</td></tr>
</table>

<h3>Conversation mode</h3>
<p>Tick <strong>Conversation mode</strong> and just talk. When you pause, what you said is sent. The Concierge answers out loud, then listens again. Answers are shorter than in typed chat, with the same personality.</p>
<ul>
<li><strong>Interrupt it</strong> any time by talking over it. It stops and listens.</li>
<li><strong>To finish</strong>, say goodbye (“that's all, thanks!”). The Concierge says bye and conversation mode switches itself off. Unticking it also works.</li>
<li>Money and dates are read out properly (“four thousand one hundred sixty-four dollars”). The text on screen stays as written.</li>
</ul>
<div class="callout tip">
<strong>Best in a quiet spot</strong>
Background chatter or music can count as talking and interrupt the answer. Headphones help a lot.
</div>

<h3>Choosing the voice</h3>
<p><strong>Assistant → Concierge voice</strong>: pick a <strong>Speech model</strong> (ElevenLabs, Google or Microsoft) and a <strong>Voice</strong>. Press <kbd>▶ Play</kbd> to hear a sample, then <kbd>Save voice</kbd>. Faster models start talking sooner; the more natural ones cost more. The panel also shows each day's voice use. The voice's estimated cost is part of the Assistant's monthly spend and limit.</p>

<h3>Photos in the chat</h3>
<p>With the <strong>Concierge photos</strong> switch on, the chat has a 📷 button. Take a photo or pick one, add a question if you like, and send. The Concierge looks at it: a product, a label, a shelf, a packing slip or an invoice. Staff can photograph a delivery note and ask it to prepare the stock counts. Photos are shrunk on the phone first and are never kept in the saved chats.</p>
<p><strong>A photo for a campaign:</strong> send the photo and ask, for example, "make a campaign about our new label with this photo". The draft card shows your photo and where it goes. Press <kbd>Open in composer</kbd> and the photo is uploaded into the message for you. Then review it, send yourself a test and send as usual. The photo is only kept in your browser until then, so if you reload the page first, the composer leaves a <kbd>[[PHOTO]]</kbd> line. Use <kbd>⬆ Upload photo</kbd> to add it there (and delete the line). A campaign with a <kbd>[[PHOTO]]</kbd> line left in won't send.</p>

<h3>Replying to customers it handed to the team</h3>
<p>When the Concierge can't solve something, the customer's request lands in <strong>Handed to the team</strong> at the bottom of the Assistant tab, and the tab shows a number until it's dealt with. Each one shows the customer's summary; press <strong>Show the conversation</strong> to read the whole chat.</p>
<ul>
<li>Type your reply and press <strong>Send &amp; resolve</strong>. It's emailed to the customer with “Hi [name],” and a sign-off added for you. If they write back, it arrives in your inbox.</li>
<li><strong>Send, keep open</strong> emails the reply but leaves it waiting, for when you expect more back-and-forth.</li>
<li><strong>Resolve without replying</strong> is for ones you've already handled by phone or email.</li>
<li>Resolved requests move to the <strong>Resolved</strong> filter. You can reply again or reopen them from there.</li>
</ul>

<h3>Product cards in the chat</h3>
<p>When the Concierge recommends products to a visitor or member, they appear under its answer as cards with the photo, price (sale price if there is one), a short description, and two buttons: <strong>Add to cart</strong> and <strong>View</strong>. Add to cart puts it straight in their cart; View opens the product's pop-up. Members only ever see members' products and visitors only public-shop products. "Inquire" items get View only. Analytics → Concierge shows how many were added to carts from the chat.</p>
<p>The cards come from your live catalog, so if a product's photo or price is wrong in a card, fix it in Products.</p>

<h3>Conversations</h3>
<p>Every chat with the Concierge is kept for 30 days, then deleted. Each reply shows which AI model wrote it, in small grey text (only you see this). Filter by <strong>Visitors</strong>, <strong>Members</strong> or <strong>Staff</strong>, or search. Each one is tagged with its topics (orders, shipping, products, deals…), and the top of the list sums up what people ask most.</p>
<div class="callout warn">
<strong>Flagged chats</strong>
Flags are deliberately sensitive, so expect the odd false alarm. <strong>Red</strong> (emailed to the team straight away, once per chat): a possible medical emergency, self-harm, or a threat. <strong>Amber</strong>: reactions, legal or chargeback threats, abuse, slurs, hostility to the business, mentions of police or regulators, someone who may be under 21, risky use or reselling, personal distress, trying to trick the assistant, or probing for private information. <strong>Grey</strong>: frustration, swearing, and odd behaviour (repeating themselves, shouting, spam). Customers never see flags, and flags don't change how the Concierge answers. For a red flag, open the chat, read it, and reach out if you know who it is. The Concierge has already given emergency numbers.
</div>

<h3>Web pages it learns from</h3>
<p>Paste the address of a page (your FAQ, About, shipping policy) or a <code>sitemap.xml</code>, and the Concierge reads that page's text. It's used as well as your tone and notes, not instead of them. When you change the page, press <kbd>Refresh</kbd>.</p>

<h3>Concierge notes (it learns from chats)</h3>
<p>Switch on <strong>Concierge learns from chats</strong> in Settings → Feature switches. Every night the Concierge reads the last week of chats, which of its cards you confirmed or dismissed, what got ticked off on the Today list, and a sales snapshot. It then rewrites a short list of notes in three groups: <strong>Staff Concierge</strong> (better daily cards, campaign ideas and insights), <strong>Customer Concierge</strong> (general lessons for shoppers) and <strong>Today list</strong> (a small <em>✦ Learned</em> line on that item). Notes take effect straight away. They're habits, never rules: the safety rules always win, and every note is checked first, so it can't contain email addresses, phone numbers, outside links, passwords or rule-changing wording. Open <strong>Concierge notes</strong> at the bottom of the Assistant tab to read them, <kbd>Edit</kbd>, <kbd>Pin</kbd> (the review then keeps it exactly as it is), <kbd>Delete</kbd> or <kbd>+ Add</kbd> your own. <kbd>✦ Review chats now</kbd> runs a review straight away. Each review costs a few cents, counts toward the monthly AI limit, and is listed in the Activity log.</p>
</section>

<section id="tab-settings">
<h2 class="sec">Settings</h2>
<span class="where">Dashboard → Settings</span>

<h3>Bundle rule</h3>
<p>A cart-wide discount. Turn it on, set a minimum number of items and a percentage, and any cart reaching that many items gets the discount. Customers even see a hint at checkout: "Add 1 more item to save 10%." Click <kbd>Save rules</kbd> after changing.</p>

<h3>Loyalty points</h3>
<p>Switch on loyalty and three numbers control it:</p>
<table>
<tr><th>Setting</th><th>Meaning</th><th>Starting value</th></tr>
<tr><td>Points per dollar</td><td>Points earned per $1 spent</td><td>1</td></tr>
<tr><td>Points per dollar redeemed</td><td>Points that equal $1 off</td><td>100</td></tr>
<tr><td>Minimum to redeem</td><td>Points needed before spending any</td><td>100</td></tr>
</table>
<p>With those values, $100 spent earns 100 points, worth $1 off — a deliberately conservative 1%. Raise "points per dollar" to be more generous.</p>
<p>Members see their balance and history under <strong>Points &amp; rewards</strong> in their account menu, and can slide points onto an order at checkout. Points are awarded automatically when an order becomes Paid or Completed, and never twice for the same order. You can also add or subtract points by hand with a reason, which is recorded in their history.</p>

<h3>Store locations (the “Find us in stores” map)</h3>
<p>Open <strong>Settings → Store locations</strong>. These are the shops that carry {{SHORT}}. They appear on the public <strong>/stores</strong> map once the <strong>Store locator</strong> switch is on.</p>
<ol class="steps">
<li>Press <kbd>+ Add a store</kbd>.</li>
<li>Start typing the <strong>Store name</strong>. Pick the business from the list and its address fills in. If it isn't listed, start typing the <strong>Street</strong> and pick the address instead. Use ↑ ↓ and Enter, or tap.</li>
<li>Check the pin on the map. If it's off, <strong>drag it</strong> or tap the right spot. You can also paste coordinates from Google Maps (right-click the spot → copy “38.91876, -119.99515”) into either the Latitude or Longitude box.</li>
<li>Add phone, website, hours and a note customers see (“On the wellness shelf by the register”).</li>
<li>Optionally tick the <strong>products it carries</strong>. Those products then show <strong>📍 Find it in a store near you</strong> in their pop-up.</li>
<li>Press <kbd>Add store</kbd>.</li>
</ol>
<p>In the list: <kbd>↑</kbd> <kbd>↓</kbd> set the order on the page, <kbd>Hide</kbd> takes a store off the map without deleting it, and <kbd>Edit</kbd> / <kbd>Delete</kbd> do what they say. A hidden store only needs a name and a city. The Concierge can add stores too (“add Main Street Market”) and answers customers asking where to buy in person.</p>
<div class="callout tip">
<strong>“Pin approximate”</strong>
If an address can't be found exactly, the pin goes to the middle of the town and the store is marked <em>Pin approximate</em>. Drag the pin to the right spot and save. A pin you placed by hand is always kept.
</div>

<h3>Change the staff password</h3>
<p>The top of <strong>Settings → Steward password</strong> shows <strong>today's staff password</strong> with a <kbd>Copy</kbd> button. It changes by itself every night, so there's nothing to change. The old fixed password only signs in during the first week after the daily password started, and it can't be changed while the daily password is on. If <strong>Daily staff password</strong> is ever switched off under Feature switches, this section shows a box to set the fixed password again: enter it and click <kbd>Update password</kbd>.</p>

<h3>Feature switches</h3>
<p>Turn parts of the site on or off without calling anyone. It takes effect within about 15 seconds. The live site and stage have separate switches, except any marked <strong>Stage + live</strong>.</p>
<ul>
<li><strong>AI assistant</strong>: the master off switch for the Concierge, for visitors, members and staff at once. Use it if the assistant ever says something it shouldn't.</li>
<li><strong>Assistant can prepare changes</strong>: switch off to make the staff Concierge look-up-only.</li>
<li><strong>Email template library</strong> and <strong>Product videos</strong>: hide those features without losing anything you saved.</li>
<li><strong>Automatic payment reminders</strong>, <strong>Sign in with an email code</strong> (members), <strong>Admin sign-in link by email</strong> and <strong>Mix-and-match bundle discounts</strong> start off. Switch each on when you're ready.</li>
<li><strong>Store locator</strong>, <strong>Stock counts</strong>, <strong>Venmo payment matching</strong>, <strong>Concierge voice</strong>, <strong>Concierge photos</strong> and <strong>Ambassador pages</strong>: each has its own section in this guide. Stores and stock counts can be set up while their switch is off. Customers only see them once it's on.</li>
<li><strong>Cash pickup deals &amp; public-shop pickup</strong>: the <em>Cash pickup only</em> tick on sales, and Local pickup (invoice or cash) in the public shop. Off = the public shop is ship-only.</li>
<li><strong>Daily staff password</strong> (on): the staff password changes every day (see <em>Signing in</em>). Switching it off goes back to the old fixed password. Only do that if your developer asks.</li>
<li><strong>Member sign-in with Face ID / Touch ID / fingerprint</strong>: on by default. Members get the one-tap sign-in and the popup offering it after they sign in. Off hides both; saved devices stay saved.</li>
<li><strong>Staff sign-in with Face ID / Touch ID / fingerprint</strong>: on by default. Switch off to hide the Face ID button. Saved Face IDs stay saved for when it's back on.</li>
<li><strong>Safe storage for products &amp; discount codes</strong> (Stage + live): a behind-the-scenes setting your developer turns on once. Leave it as it is.</li>
</ul>

<h3>Payment reminders</h3>
<p>Set when each reminder goes (in hours) and what it says. <code>{name}</code>, <code>{ref}</code> and <code>{total}</code> fill themselves in. <strong>Move to Expired after</strong> sets when unpaid orders leave the Pending list. <kbd>Run now</kbd> checks straight away instead of waiting up to 15 minutes. Only orders placed after you switch reminders on are ever chased.</p>

<h3>Staff sign-in</h3>
<p>The people who can sign in with an emailed link (and with Face ID). Add a name and email and press <kbd>Add</kbd>. <kbd>Remove</kbd> signs them out within a minute and removes their Face ID too. You can't remove yourself, and at least one person has to stay on the list.</p>
<p>Below the list, <strong>Face ID / Touch ID</strong> shows every device set up for Face ID sign-in, with <kbd>Add Face ID for this device</kbd> and <kbd>Remove</kbd> (see <em>Signing in → Setting up Face ID</em>).</p>

<h3>Activity log</h3>
<p>Every change made in the dashboard, newest first: order statuses, approvals, product edits, sales, emails sent, codes, switches and more. Click a row to see what it was before and what it changed to. <strong>Concierge</strong> means the assistant prepared it and someone pressed the button. <strong>Scheduled</strong> is the nightly report. Tick <strong>Failed only</strong> to see anything that didn't save, and any “access denied” alerts: someone asked the Concierge about an order that wasn't theirs. Nothing was shown to them.</p>

<h3>Email Data Export</h3>
<p>Sends the full nightly report right now with six spreadsheets attached: revenue, orders, members, subscribers, products, and inquiries. Use it before an accountant meeting or any time you want a fresh backup.</p>
<div class="callout tip">
<strong>The nightly email is your backup</strong>
It arrives automatically every night with revenue for today, 7 days, 30 days and all time, orders unpaid over three days, top sellers, and those same six spreadsheets. Keep the emails, or save the files monthly.
</div>
</section>

<!-- ===== JOB: PAYMENT ===== -->
<section id="job-paid">
<h2 class="sec">Take a payment</h2>
<span class="where">Dashboard → Orders → open an order</span>

<h3>How money reaches you</h3>
<p>The invoice offers Venmo or Zelle, and the memo always reads <strong>Order for</strong> followed by the customer's name and the order number (e.g. <strong>#4K9Q2X</strong>). Pickup customers can also choose cash.</p>

<h3>Venmo payments, matched for you</h3>
<p><span class="where" style="display:inline">Orders tab → Venmo payments</span> (when the <strong>Venmo payment matching</strong> switch is on). Venmo's “paid you” emails show up here, already checked and matched to the unpaid order they pay for. The invoice's Venmo button fills the note with the order number (e.g. <strong>#4K9Q2X</strong>), so most payments match by themselves.</p>
<table>
<tr><th>You see</th><th>Means</th><th>Do</th></tr>
<tr><td><strong>Sure</strong></td><td>The Venmo note had the order number, and the amount fits</td><td>Tap <kbd>Mark paid</kbd></td></tr>
<tr><td><strong>Likely</strong></td><td>Same amount and a similar name, but no order number</td><td>Check the name and order, then <kbd>Mark paid</kbd> or <kbd>Not a match</kbd></td></tr>
<tr><td><strong>No sure match</strong></td><td>Couldn't tell which order</td><td>Pick the order it pays for, or dismiss it if it isn't for an order</td></tr>
<tr><td><strong>Quarantined</strong></td><td>Failed the security check (may not really be from Venmo)</td><td>Check the Venmo app itself before marking anything paid</td></tr>
</table>
<p>Nothing is ever marked paid until someone taps. The Today list shows Venmo payments waiting, and the Concierge can prepare the same confirm cards. One-time setup (forwarding the Venmo emails from the inbox that receives them) is under <strong>Setup</strong> at the bottom of that panel.</p>

<h3>When a customer reports paying</h3>
<p>Every order email carries a confirmation button, and what it does depends on how they're paying:</p>
<table>
<tr><th>Paying by</th><th>Button says</th><th>Order becomes</th></tr>
<tr><td>Venmo or Zelle</td><td>I've sent my payment</td><td><span class="pill p-paid">Paid</span>, ready to pack</td></tr>
<tr><td>Cash at pickup</td><td>I picked up and paid cash</td><td><span class="pill p-ship">Completed</span>, finished</td></tr>
</table>
<p>Either way you get an email the moment they tap it.</p>
<div class="callout danger">
<strong>Verify before you ship</strong>
Open Venmo or Zelle and confirm the money landed. If it hasn't, set the order back to Pending payment and message them.
</div>

<h3>Marking paid yourself</h3>
<ol class="steps">
<li>Open the order.</li>
<li>Click <kbd>✓ Mark paid</kbd>.</li>
<li>Loyalty points are awarded automatically if points are switched on.</li>
</ol>

<h3>Re-sending the payment link</h3>
<p>Open the order and copy <strong>Customer payment link</strong>. Paste it into a text or email — it works exactly like the one in the invoice.</p>
</section>

<!-- ===== JOB: SHIP ===== -->
<section id="job-ship">
<h2 class="sec">Ship an order</h2>
<span class="where">Dashboard → Orders → open a paid order</span>
<p class="lede">The site buys and prints USPS postage through Shippo without leaving the dashboard.</p>

<ol class="steps">
<li>Open a <span class="pill p-paid">Paid</span> order and scroll to <strong>Shipping label</strong>. The address is already filled in.</li>
<li>Check the <strong>Weight (oz)</strong>. If every item has a shipping weight (see <a href="#tab-products">Products → Shipping weights</a>), it's filled in for you, with the sum shown underneath. Otherwise weigh the packed box and type it in. Be accurate — USPS bills the difference.</li>
<li>Pick a <strong>Service</strong>: Ground Advantage (cheapest), Priority Mail (faster), or Priority Express (fastest).</li>
<li>Create the label. It opens in a new tab — print it and tape it on.</li>
<li>If the order already has a label, the site asks before buying another (each one costs money). Press <kbd>Cancel</kbd> to open the one you already have.</li>
<li>The tracking number saves to the order automatically, and the customer can see it in their account.</li>
<li>Mark the order <strong>Completed</strong> when it's on its way.</li>
</ol>

<div class="callout warn">
<strong>If nothing happens when you click</strong>
Almost always an unpaid Shippo balance — they block new labels until it's settled. Sign in at goshippo.com → Billing, pay it, and try again. The dashboard shows Shippo's exact message when this happens.
</div>
</section>

<!-- ===== JOB: PICKUP ===== -->
<section id="job-pickup">
<h2 class="sec">Handle a pickup</h2>
<span class="where">Dashboard → Orders</span>

<h3>What the customer is told</h3>
<p>The site sends these instructions automatically — you don't need to:</p>
<div class="card">
<p style="margin-top:0"><strong>{{PICKUP_ADDRESS}}</strong></p>
<p>{{PICKUP_WHERE}}</p>
<ul>
<li>(the pickup notes from brand.config.ts)</li>
<li>If you have any trouble locating your order, just reach out and we'll help right away</li>
</ul>
</div>

<h3>Your steps</h3>
<ol class="steps">
<li>Filter orders to <strong>Paid</strong> and look for pickup orders.</li>
<li>Bag it with the customer's name clearly on it.</li>
<li>Put it in the pickup spot.</li>
<li>After they collect it, set the status to <strong>Completed</strong>.</li>
</ol>

<h3>Cash at pickup</h3>
<p>Pickup customers can choose cash instead of an invoice. With <strong>Cash pickup deals &amp; public-shop pickup</strong> switched on, public-shop customers can choose Local pickup too (pay by invoice or cash at pickup). Those orders show in Orders like any other, marked Local pickup. No invoice goes out, and their email states the exact amount to bring.</p>
<p>Their confirmation email also carries a green button reading <strong>"I picked up and paid cash."</strong> When they tap it after collecting their order, the site marks it <span class="pill p-ship">Completed</span> on its own and emails you to say so. Most cash pickups will close themselves out this way with no work from you.</p>
<div class="callout warn">
<strong>Still count the cash</strong>
That button is the customer telling you they left the money, the same as the payment button on a normal invoice. Check the cash left at the pickup spot matches before you consider it settled. If something is off, open the order and set it back to Pending payment.
</div>
<p>If someone forgets to tap it, just open the order and set the status to <strong>Completed</strong> yourself. Both routes end in the same place.</p>
</section>

<!-- ===== JOB: MESSAGE ===== -->
<section id="job-message">
<h2 class="sec">Message a customer</h2>
<span class="where">Orders → open an order · or · Members → Message customer</span>
<p class="lede">Emails come from the {{SHORT}} address and replies land in the support inbox.</p>
<p>Use the button on an <strong>order</strong> for anything about that order. Use the button on a <strong>member</strong> for general conversation.</p>

<div class="card">
<h4 style="margin-top:0">Wording that works</h4>
<p><strong>Nudging about payment:</strong> "Hi Sarah, just checking in on your order from Tuesday. Whenever you get a chance to send payment we'll get it right out to you. The link is in your original email, and I'm happy to resend it."</p>
<p><strong>A delay:</strong> "Hi Marcus, your order is packed and ready. We're running a day behind on post office trips so it'll go out tomorrow. Tracking will come through as soon as it's on its way."</p>
<p><strong>Pickup ready:</strong> "Hi Dana, your order is ready at the pickup spot whenever you'd like to swing by."</p>
</div>
<div class="callout warn">
<strong>Emails send immediately</strong>
No draft, no undo. Read it once before clicking send.
</div>
</section>

<!-- ===== JOB: SALE ===== -->
<section id="job-sale">
<h2 class="sec">Run a sale</h2>
<span class="where">Products · and · Settings · and · Marketing</span>
<p class="lede">Four separate tools lower a price. They stack, so be deliberate.</p>

<table>
<tr><th>Tool</th><th>Where</th><th>Scope</th></tr>
<tr><td><strong>Sale price</strong></td><td>On the product</td><td>One product. Original shows crossed out.</td></tr>
<tr><td><strong>Promotion</strong></td><td>On the product</td><td>One product. % off, or buy-one-get-one % off.</td></tr>
<tr><td><strong>Bundle rule</strong></td><td>Settings</td><td>Whole cart, once it hits a set number of items</td></tr>
<tr><td><strong>Discount code</strong></td><td>Marketing</td><td>Whole cart, when the customer types the code</td></tr>
</table>

<h4>Buy one, get one</h4>
<p>Set 100% for a true "second one free," or 50% for half off the second. It discounts every second item in the cart.</p>

<h4>Cash pickup deals</h4>
<p>Under a product's sale price or promotion, tick <strong>💵 Cash pickup only</strong>. The sale then applies only when the customer chooses <strong>Local pickup</strong> and <strong>Cash at pickup</strong>. Shipped orders and orders paid by invoice pay the regular price. Customers see the regular price with "💵 $32 cash at pickup" under it and a <em>Cash pickup deal</em> chip on the photo. At checkout the cart tells them how much choosing cash at pickup would save, and the price drops as soon as they pick it. It works in the members' gallery and the public shop. The tick shows once <strong>Cash pickup deals &amp; public-shop pickup</strong> is on under Feature switches. Ending the sale clears it. You can also ask the Concierge, for example "put Harmony at $30, cash pickup only".</p>

<div class="callout warn">
<strong>Discounts stack</strong>
A sale-priced product, in a qualifying bundle, with a code applied, plus points redeemed will apply all four. Before launching anything, add the items to a cart yourself and read the total line by line.
</div>
</section>

<!-- ===== JOB: INVOICE ===== -->
<section id="job-invoice">
<h2 class="sec">Invoice by hand</h2>
<span class="where">Dashboard → Members → Generate invoice</span>
<p class="lede">For orders that arrive by phone, text, or in person.</p>
<ol class="steps">
<li>Find the member and click <kbd>Generate invoice</kbd>.</li>
<li>Add the items and the amount.</li>
<li>Send.</li>
</ol>
<p>They receive exactly the same invoice email as a website order — same Venmo button, same "I've sent my payment" link — and it shows up in your Orders list as a real order you can ship and track like any other.</p>
</section>

<section id="job-loyalty">
<h2 class="sec">Loyalty points</h2>
<span class="where">Dashboard → Settings → Loyalty points · Members → Points</span>
<p class="lede">Members earn points on what they buy and spend them as money off later. Everything in one place.</p>

<h3>How it works</h3>
<ul>
<li><strong>Earning:</strong> members earn points for every $1 they spend on products (shipping doesn't count). The points are added automatically when an order becomes <strong>Paid</strong> or <strong>Completed</strong>, and never twice for the same order.</li>
<li><strong>Spending:</strong> at checkout in the members' area they slide points onto the order once they have the minimum. The points come off the total as dollars.</li>
<li><strong>Members only:</strong> the public shop doesn't earn or use points. It's one of the reasons to join {{MEMBERS}}.</li>
</ul>

<h3>Setting it up</h3>
<p>In <strong>Settings → Loyalty points</strong>, switch it on and set three numbers (more detail under <a href="#tab-settings">Settings</a>):</p>
<table>
<tr><th>Setting</th><th>Meaning</th><th>Starting value</th></tr>
<tr><td>Points per dollar</td><td>Points earned per $1 spent</td><td>1</td></tr>
<tr><td>Points per dollar redeemed</td><td>Points that equal $1 off</td><td>100</td></tr>
<tr><td>Minimum to redeem</td><td>Points needed before spending any</td><td>100</td></tr>
</table>
<p>With the starting values, $100 spent earns 100 points, worth $1 off, so about 1% back. To be more generous, raise "points per dollar" (2 = about 2% back).</p>

<h3>What members see</h3>
<p>Their balance and history are under <strong>Points &amp; rewards</strong> in their account menu, and the points slider shows at checkout. The Concierge can answer "how do points work?", "how many points do I have?" and "what are they worth?" from the live settings and their own balance.</p>

<h3>Adding or taking away points by hand</h3>
<ol class="steps">
<li>In <strong>Members</strong>, click <kbd>Points</kbd> on their row (it shows their balance).</li>
<li>Enter a positive number to add (e.g. a goodwill gesture for a late parcel) or a negative one to take away, and give a reason.</li>
<li>Save. The reason shows in their points history.</li>
</ol>
<p>Or ask the staff Concierge, e.g. "Give Ann 250 points for the late parcel". It prepares a card for you to confirm.</p>

<h3>If points look wrong</h3>
<ul>
<li><strong>No points after an order?</strong> They're added when the order is marked Paid or Completed, not when it's placed. Check loyalty is switched on in Settings.</li>
<li><strong>Can't use points at checkout?</strong> They need at least the minimum, and they must be shopping in the members' area.</li>
<li>Points stack with sales, bundles and codes. Build a test basket to see the total line by line.</li>
</ul>
</section>

<!-- ===== CUSTOMER ===== -->
<section id="customer">
<h2 class="sec">What customers see</h2>
<p class="lede">Knowing their side makes support conversations much easier.</p>

<h3>The home page</h3>
<p>The first thing anyone sees at <strong>{{HOST}}</strong> is the sign-in box on the illustrated valley background. Underneath it, if they scroll down, is the public shop. So a visitor who is not a member yet can still buy something instead of hitting a dead end.</p>
<p>There is a small bouncing arrow under the sign-in box saying <strong>"Shop our range"</strong> that takes them there.</p>
<div class="callout tip">
<strong>Only public products appear there</strong>
It shows the same products as /retail, which means anything set to <strong>Both</strong> or <strong>Public shop only</strong>. Members-only products are never shown on the home page.
</div>

<h3>Joining</h3>
<p>They click <strong>Join {{MEMBERS}}</strong>, give a name, email, password, confirm their age, say whether they've bought before, and can leave a note. They're told approval usually takes under 24 hours. On approval they get a welcome email with a direct link.</p>
<div class="callout warn">
<strong>The age question is a real gate</strong>
If someone answers <strong>No</strong> to being 21 or over, they cannot send a request at all. The site tells them so and stops there, and it checks again on our side so the answer cannot be faked. Nobody under 21 can get into the member area.
</div>
<p>When you look at a waiting request you will see <strong>"✓ Confirmed 21 or over"</strong> on their card, so you can check it at the moment you approve them rather than digging through the email.</p>

<h3>Signing in</h3>
<p>The sign-in box has <strong>Sign in</strong> and <strong>Join {{MEMBERS}}</strong> tabs. Members type their email and password; <strong>Show</strong> reveals what they typed, and <strong>Forgot password?</strong> and <strong>Email me a code instead</strong> (when switched on) sit just under the password. People from the old shop tap the <strong>Shopped with us before?</strong> line to get a set-password link.</p>
<h3>Face ID, Touch ID and fingerprint for members</h3>
<p>With <strong>Member sign-in with Face ID / Touch ID / fingerprint</strong> on (it is by default), a member who signs in with their password, a code or a set-password link sees a small popup: <strong>Sign in faster next time?</strong> One tap on <kbd>Use Face ID</kbd> (Touch ID on a Mac, fingerprint on Android) sets it up for that phone or computer. After that, the sign-in box shows <kbd>Sign in with Face ID</kbd> at the top and they're in with one tap. If they choose <kbd>Not now</kbd>, that device never asks again. They can still set it up, or remove a device, under <strong>Account → Face ID &amp; Touch ID</strong>. Their face or fingerprint never leaves their device, and passwords and codes keep working. It's set up on each device separately, and never offered when staff use <strong>Log in as</strong>.</p>

<h3>On a phone</h3>
<p>Products show <strong>two across</strong> so more of the shop fits on screen. There's a small button beside the category picker that switches to <strong>one big product per row</strong> if they'd rather see larger photos, and the site remembers which they picked.</p>
<p>Categories become a drop-down list on a phone instead of a row of buttons, which is much easier to tap.</p>

<h3>Shopping</h3>
<p>On the first visit each session there's a short animated entrance — a forest that's brushed aside to reveal a sunlit clearing, the peaks and “{{MEMBERS}}” (about 3 seconds; tapping skips it, and it never plays for people who've turned on reduced motion) — then the gallery. They browse, filter by category, and add to a basket that survives closing the tab.</p>

<h3>Checking out</h3>
<p>They choose shipping ($10) or free local pickup, confirm their address, can apply a discount code (unless a bundle already applies; in the public shop only codes switched on for it, or an ambassador’s code, which fills itself in for people who came through that ambassador’s page), can slide points onto the order, or can press <strong>Ask a question</strong> to ask about the items without buying.</p>
<p>Members who forget their password can choose <strong>Email me a code instead</strong> on the sign-in form (when it's switched on) and type the 6-digit code from their inbox.</p>

<h3>Paying</h3>
<p>The invoice has two clearly numbered steps: pay with Venmo or Zelle, then click "I've sent my payment." It explicitly warns that Venmo does not notify us on its own, which is why the second step matters.</p>

<h3>Their account</h3>
<p>Order history with tracking and payment links, points and rewards, saved shipping address, and a password change. Any order still awaiting payment shows its confirmation button here too, so they never need to dig up the original email.</p>

<h3>About us page</h3>
<p>There is a public page at <strong>/about</strong> telling the {{SHORT}} story: the mission, the vision, and who you are as a women-owned small business. It is linked from the top of the shop and events pages.</p>
<div class="callout warn">
<strong>This one is a copy, not a live feed</strong>
The words come from the About page. If that page is edited there, this one will not change by itself. Let your developer know and it can be brought back in line.
</div>

<h3>Events</h3>
<p>Anyone can browse <strong>/events</strong> without an account. Clicking an event opens a pop-up with the full details and live availability, and they register from there. If it's full they join the waitlist and get moved up automatically when a spot opens.</p>

<h3>Find us in stores</h3>
<p>With the Store locator switch on, a highlighted <strong>📍 Find us in stores</strong> button sits in the top menu of every page (members’ gallery included) and in the footer. It opens <strong>/stores</strong>: a map and a list of the shops that carry {{SHORT}}, with hours, phone, directions and your note for each. Product pop-ups say <strong>📍 Find it in a store near you</strong> when a store carries that product, and the Concierge answers “where can I buy this in person?”.</p>
<p>When a product is out (stock count 0) its card says <strong>Currently restocking</strong>. They can still order it. It's sent when new stock arrives.</p>

<div class="callout warn">
<strong>Why a link might "not work"</strong>
Payment links opened inside some email preview windows hang, because those windows block the sign-in cookie. Ask them to copy the link into a normal browser tab.
</div>
</section>

<!-- ===== TROUBLESHOOT ===== -->
<section id="troubleshoot">
<h2 class="sec">Troubleshooting</h2>

<p class="faq-q">A customer never got their invoice email.</p>
<p class="faq-a">Check spam first — usually that's it. Then open their order, copy the <strong>Customer payment link</strong>, and send it directly. Confirm their email is spelled right while you're there.</p>

<p class="faq-q">Nothing happens when I click to make a shipping label.</p>
<p class="faq-a">Almost always an unpaid Shippo balance. goshippo.com → Billing, settle it, try again.</p>

<p class="faq-q">They clicked "I've sent my payment" but no money arrived.</p>
<p class="faq-a">Message them politely — usually an honest mix-up or it went to the wrong handle. Set the order back to Pending payment until you see it. Don't ship first.</p>

<p class="faq-q">Someone can't sign in.</p>
<p class="faq-a">Check they're approved on the Members tab. If they are, use <strong>Reset password</strong> and tell them the new one. Remind them logins from the old website don't work here.</p>
<p class="faq-q">A member typed their email wrong when they signed up.</p>
<p class="faq-a">Members tab, find them, click <strong>Edit</strong>, correct the email, save. They sign in with the new address from then on and nothing else about their account changes.</p>

<p class="faq-q">A product isn't showing up.</p>
<p class="faq-a">Check <strong>Where it sells</strong> on that product. "Public shop only" is invisible to members; "Members only" is invisible to the public. The tag on the card tells you at a glance.</p>

<p class="faq-q">The checkout total looks wrong.</p>
<p class="faq-a">Discounts stack. Check the product's sale price and promotion, the bundle rule in Settings, any code, and points being redeemed. Build the cart yourself and watch each line.</p>

<p class="faq-q">An event's date or location changed.</p>
<p class="faq-a">Click <strong>Edit</strong> on the event and change it there. Never delete it and build a new one, because that loses everyone who already signed up. After saving, open <strong>Registrations</strong> and message the people on the list, since the site does not tell them automatically.</p>

<p class="faq-q">I need to cancel an order.</p>
<p class="faq-a">Open it and set status to Cancelled. If they already paid, refund through Venmo or Zelle directly — the site can't move money.</p>

<p class="faq-q">A product says “Currently restocking” but we have it.</p>
<p class="faq-a">Its stock count is 0. Products → Stock counts, type the real number, press Save. To stop counting a product, clear its box.</p>

<p class="faq-q">A Venmo payment didn't show up in Venmo payments.</p>
<p class="faq-a">Give it a couple of minutes. If it's still missing, check that the Gmail filter is still forwarding Venmo emails (Setup at the bottom of the panel), then mark the order paid by hand after checking the Venmo app.</p>

<p class="faq-q">The Concierge voice keeps stopping mid-answer in conversation mode.</p>
<p class="faq-a">It thinks you're talking over it. Usually it's background noise or the speaker being loud. Use headphones or move somewhere quieter, or untick Conversation mode and use ▶ Listen.</p>

<p class="faq-q">Something looks broken or a number seems off.</p>
<p class="faq-a">Refresh the page first. The site sometimes shows you a slightly old copy for a few seconds. If it still looks wrong after refreshing, take a screenshot and send it over.</p>
</section>

<!-- ===== GLOSSARY ===== -->
<section id="glossary">
<h2 class="sec">Glossary</h2>
<table>
<tr><th>Term</th><th>Meaning</th></tr>
<tr><td>{{MEMBERS}}</td><td>The members-only shop — the main site</td></tr>
<tr><td>Staff password</td><td>The admin password, a new two-word phrase each day (in the nightly email and Settings). Different from member passwords.</td></tr>
<tr><td>Member</td><td>Someone approved to shop the private gallery</td></tr>
<tr><td>Expired</td><td>An unpaid invoice that got every reminder. Still pending and can be revived</td></tr>
<tr><td>Mix &amp; match bundle</td><td>A set of products that's cheaper bought together</td></tr>
<tr><td>Pending payment</td><td>Ordered, money not confirmed</td></tr>
<tr><td>Where it sells</td><td>Members only, Both, or Public shop only</td></tr>
<tr><td>Bundle rule</td><td>Cart-wide discount once enough items are added</td></tr>
<tr><td>BOGO</td><td>Buy one, get one — discounts every second item</td></tr>
<tr><td>Points per dollar redeemed</td><td>How many points equal $1 off</td></tr>
<tr><td>Shippo</td><td>The service that prints USPS labels</td></tr>
<tr><td>Campaign</td><td>A marketing email to the mailing list</td></tr>
<tr><td>Subscriber</td><td>Someone who opted into the mailing list</td></tr>
<tr><td>Stock count</td><td>How many of a product are on the shelf. Orders take from it</td></tr>
<tr><td>Backorder</td><td>Units customers ordered that the shelf didn't cover. Send these first when stock arrives</td></tr>
<tr><td>Currently restocking</td><td>What the shop shows when a product's count is 0. Still orderable</td></tr>
<tr><td>Conversation mode</td><td>Talking back and forth with the Concierge out loud, like a call</td></tr>
<tr><td>Ambassador page</td><td>An influencer’s own page at {{HOST}}/their-name, shared by link or QR only. Orders through it are credited to them</td></tr>
<tr><td>Owed now</td><td>An ambassador’s commission earned on paid orders, minus the payouts recorded</td></tr>
<tr><td>Attribution window</td><td>How many days after visiting an ambassador’s page an order still counts for them</td></tr>
<tr><td>Quarantined (Venmo)</td><td>A “payment” email that failed the security check. Check the Venmo app</td></tr>
<tr><td>CSV</td><td>A spreadsheet file that opens in Excel or Numbers</td></tr>
</table>
</section>

<!-- ===== CHEAT SHEET ===== -->
<section id="cheatsheet">
<h2 class="sec">Cheat sheet</h2>

<div class="card">
<h3 style="margin-top:0">Every morning</h3>
<ol>
<li>Overview → read the four boxes</li>
<li>Click "Ready to fulfil" → pack and ship those</li>
<li>Weigh the box, pick a service, print the label</li>
<li>Check "Awaiting payment" → nudge anything over 3 days</li>
<li>Pickups to the pickup spot; mark "Completed" after collection</li>
<li>Approve anyone waiting to join</li>
<li>Orders → Venmo payments → confirm the matches</li>
<li>Check the rust-coloured “on backorder” label in Products → Stock counts</li>
</ol>
</div>

<div class="card">
<h3 style="margin-top:0">Every week</h3>
<ol>
<li>Read the nightly email for revenue and top sellers</li>
<li>Review any sale prices and promotions still running</li>
<li>Turn off a stale banner</li>
<li>Update stock counts after deliveries (or tell the Concierge the new numbers)</li>
<li>Ambassadors: pay anyone owed (record it), and email their progress report</li>
<li>Save the spreadsheet attachments somewhere safe</li>
</ol>
</div>

<div class="card">
<h3 style="margin-top:0">Never do this</h3>
<ul>
<li>Ship before confirming the money actually arrived</li>
<li>Send a campaign without testing it on yourself first</li>
<li>Delete a member or product to "tidy up" — it can't be undone</li>
<li>Share the staff password outside the team</li>
</ul>
</div>

<div class="card">
<h3 style="margin-top:0">Key addresses</h3>
<table>
<tr><td>Member shop</td><td>{{HOST}}</td></tr>
<tr><td>Dashboard</td><td>{{HOST}}/admin</td></tr>
<tr><td>Public shop</td><td>{{HOST}}/retail</td></tr>
<tr><td>Events</td><td>{{HOST}}/events</td></tr>
<tr><td>About us</td><td>{{HOST}}/about</td></tr>
<tr><td>Pickup</td><td>{{PICKUP_ADDRESS}}</td></tr>
<tr><td>Support email</td><td>{{SUPPORT}}</td></tr>
<tr><td>Shipping account</td><td>goshippo.com</td></tr>
</table>
</div>
</section>

</main>
</div>

<button class="print-btn" onclick="window.print()">Print / Save as PDF</button>

<script>
(function(){
  var links = document.querySelectorAll('.nav-link');
  var sections = document.querySelectorAll('main section');
  var search = document.getElementById('search');
  var noResults = document.getElementById('noResults');

  function setActive(id){
    for (var i=0;i<links.length;i++){
      links[i].classList.toggle('active', links[i].getAttribute('href') === '#' + id);
    }
  }

  if ('IntersectionObserver' in window) {
    var obs = new IntersectionObserver(function(entries){
      for (var i=0;i<entries.length;i++){
        if (entries[i].isIntersecting) setActive(entries[i].target.id);
      }
    }, { rootMargin: '0px 0px -75% 0px' });
    for (var j=0;j<sections.length;j++) obs.observe(sections[j]);
  }

  // Scroll to the section ourselves rather than letting the browser follow
  // the #hash. This document is rendered inside an iframe via srcdoc, where
  // relative URLs resolve against the PARENT page — so a plain #link tries to
  // navigate the frame instead of jumping, which just made the page flash.
  function goTo(id){
    var el = document.getElementById(id);
    if (!el) return false;
    // A search filter may be hiding the target. Clear it synchronously —
    // going through the debounced input handler would scroll to an element
    // that's still display:none.
    if (search.value.trim()) {
      search.value = '';
      render('');
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(id);
    return true;
  }

  document.addEventListener('click', function(e){
    var a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
    if (!a) return;
    var id = a.getAttribute('href').slice(1);
    if (!id) return;
    e.preventDefault();
    goTo(id);
  });

  function clearMarks(root){
    var marks = root.querySelectorAll('mark');
    for (var i=0;i<marks.length;i++){
      var m = marks[i];
      m.parentNode.replaceChild(document.createTextNode(m.textContent), m);
    }
    root.normalize();
  }

  function highlight(node, term){
    if (node.nodeType === 3) {
      var i = node.textContent.toLowerCase().indexOf(term);
      if (i === -1) return;
      var after = node.splitText(i);
      after.splitText(term.length);
      var mark = document.createElement('mark');
      mark.appendChild(document.createTextNode(after.textContent));
      after.parentNode.replaceChild(mark, after);
      return;
    }
    if (node.nodeType === 1 && node.tagName !== 'MARK' && node.tagName !== 'SCRIPT') {
      var kids = [];
      for (var c=0;c<node.childNodes.length;c++) kids.push(node.childNodes[c]);
      for (var d=0;d<kids.length;d++) highlight(kids[d], term);
    }
  }

  // ---- Search: every word must appear (any order); results ranked by
  // where they appear (headings first); the best spots listed at the top.
  var results = document.getElementById('searchResults');
  var navById = {};
  for (var n=0;n<links.length;n++){ navById[links[n].getAttribute('href').slice(1)] = links[n]; }

  // Blocks: each section's intro (h2 → first h3) and each h3 with what follows it.
  var blocks = [];
  for (var b=0;b<sections.length;b++){
    var sec = sections[b];
    var h2 = sec.querySelector('h2');
    var secTitle = h2 ? h2.textContent.trim() : sec.id;
    var cur = { section: sec, el: h2 || sec, title: secTitle, where: '', text: '' };
    var kids = sec.children;
    for (var c=0;c<kids.length;c++){
      var el = kids[c];
      if (el.tagName === 'H3') { blocks.push(cur); cur = { section: sec, el: el, title: el.textContent.trim(), where: secTitle, text: '' }; }
      else if (el.tagName !== 'H2') cur.text += ' ' + el.textContent;
    }
    blocks.push(cur);
  }

  function norm(t){ return t.toLowerCase().replace(/[^a-z0-9$%@.\s-]/g, ' '); }
  // "points" also finds "point", "emails" finds "email"…
  function stem(w){ return w.length > 4 && /s$/.test(w) ? w.slice(0, -1) : w; }
  function wordsOf(q){ var out = []; norm(q).split(/\s+/).forEach(function(w){ w = w.replace(/^[.-]+|[.-]+$/g, ''); if (w.length > 1) out.push(stem(w)); }); return out; }
  function count(hay, w){ var k = 0, i = hay.indexOf(w); while (i !== -1){ k++; i = hay.indexOf(w, i + w.length); } return k; }
  function esc(t){ return t.replace(/[&<>"]/g, function(ch){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[ch]; }); }
  function snippet(text, w){
    var t = text.replace(/\s+/g, ' ').trim(), i = t.toLowerCase().indexOf(w);
    if (i < 0) return esc(t.slice(0, 140));
    var a = Math.max(0, i - 60), piece = t.slice(a, a + 170);
    var re = new RegExp('(' + w.replace(/[.*+?^{}$()|[\]\\]/g, '\\$&') + ')', 'ig');
    return (a > 0 ? '…' : '') + esc(piece).replace(re, '<mark>$1</mark>') + (a + 170 < t.length ? '…' : '');
  }

  var ranked = [];
  function render(term){
    var words = wordsOf(term);
    for (var i=0;i<sections.length;i++) clearMarks(sections[i]);
    for (var id in navById){ navById[id].classList.remove('dim'); var old = navById[id].querySelector('.nav-count'); if (old) old.remove(); }
    results.style.display = 'none'; results.innerHTML = ''; ranked = [];
    if (!words.length) {
      for (var j=0;j<sections.length;j++) sections[j].classList.remove('hidden');
      noResults.style.display = 'none';
      return;
    }
    var perSection = {};
    blocks.forEach(function(bl){
      var head = norm(bl.title), body = norm(bl.text), all = head + ' ' + body;
      if (!words.every(function(w){ return all.indexOf(w) !== -1; })) return;
      var score = 0;
      words.forEach(function(w){ score += count(head, w) * 8 + Math.min(count(body, w), 6); });
      if (head.indexOf(norm(term).trim()) !== -1) score += 10; // the whole phrase in a heading
      if (!bl.where && words.every(function(w){ return head.indexOf(w) !== -1; })) score += 6; // a whole section about it
      ranked.push({ bl: bl, score: score });
      perSection[bl.section.id] = (perSection[bl.section.id] || 0) + 1;
    });
    ranked.sort(function(x, y){ return y.score - x.score; });
    var any = false;
    for (var k=0;k<sections.length;k++){
      var s = sections[k], hit = !!perSection[s.id] || words.every(function(w){ return norm(s.textContent).indexOf(w) !== -1; });
      s.classList.toggle('hidden', !hit);
      if (hit) { any = true; words.forEach(function(w){ highlight(s, w); }); }
      var nav = navById[s.id];
      if (nav) {
        nav.classList.toggle('dim', !hit);
        if (perSection[s.id]) { var badge = document.createElement('span'); badge.className = 'nav-count'; badge.textContent = perSection[s.id]; nav.appendChild(badge); }
      }
    }
    noResults.style.display = any ? 'none' : 'block';
    if (ranked.length) {
      var html = '<div class="sr-head">' + ranked.length + ' place' + (ranked.length === 1 ? '' : 's') + ' mention “' + esc(term.trim()) + '”</div>';
      ranked.slice(0, 8).forEach(function(r, idx){
        html += '<a href="#" class="sr-item' + (idx === 0 ? ' first' : '') + '" data-i="' + idx + '"><span class="sr-title">' + esc(r.bl.title) + '</span>' + (r.bl.where ? '<span class="sr-where">in ' + esc(r.bl.where) + '</span>' : '') + '<div class="sr-snip">' + snippet(r.bl.text || r.bl.title, words[0]) + '</div></a>';
      });
      html += '<div class="sr-tip">Press Enter to jump to the top result. Matching parts of the guide are shown below.</div>';
      results.innerHTML = html;
      results.style.display = 'block';
    }
  }

  function jump(idx){
    var r = ranked[idx];
    if (!r) return;
    r.bl.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(r.bl.section.id);
  }
  results.addEventListener('click', function(e){
    var a = e.target && e.target.closest ? e.target.closest('a.sr-item') : null;
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    jump(Number(a.getAttribute('data-i')));
  }, true);

  var timer;
  search.addEventListener('input', function(){
    clearTimeout(timer);
    timer = setTimeout(function(){ render(search.value); window.scrollTo({ top: 0 }); }, 160);
  });
  search.addEventListener('keydown', function(e){
    if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); render(search.value); jump(0); }
    if (e.key === 'Escape') { search.value = ''; render(''); }
  });
})();
</script>
</body>
</html>
`;

// Brand tokens ({{BRAND}}, {{MEMBERS}}, {{SUPPORT}}, …) are filled from brand.config.ts at runtime.
export const COURSE_HTML = applyBrandTokens(COURSE_HTML_RAW);
