// Staff Face ID sign-in, end to end in a real browser with Chrome's virtual
// authenticator (stands in for Face ID). Prints PASS/FAIL lines (run9.sh).
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.log("SKIP passkeys: Playwright isn't installed here");
  process.exit(0);
}
const T = require("/tmp/harness/tokens.json");
const BASE = "http://localhost:3470"; // passkeys need a real host name (localhost), not an IP
let fails = 0;
const check = (name, ok, d = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} passkeys: ${name}${ok ? "" : "  -> " + String(d).slice(0, 300)}`); };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  try {
    // Signed out: the sign-in page offers Face ID, but this device has none yet.
    await page.goto(BASE + "/admin");
    const btn = page.locator("button.gate-faceid");
    check("sign-in page shows the Face ID button", (await btn.count()) === 1);
    await btn.click();
    await page.waitForTimeout(1500);
    check("no passkey yet → a friendly message, still signed out", /Cancelled|no Face ID|didn't work/i.test(await page.locator(".gate-error").innerText().catch(() => "")) && (await page.locator(".gate-card").count()) === 1);

    // Sign in with the shared password, add Face ID for Support on this device.
    await ctx.addCookies([{ name: "gallery_admin", value: T.admin, url: BASE }]);
    await page.goto(BASE + "/admin");
    await page.locator(".admin-tab", { hasText: "Settings" }).first().click();
    await page.locator("button", { hasText: "Staff sign-in" }).first().click();
    const pick = page.locator(".pk-add select");
    await pick.waitFor({ timeout: 10000 });
    check("shared-password session must say whose Face ID it is", await page.locator(".pk-add button").isDisabled());
    await pick.selectOption({ index: 1 });
    await page.locator(".pk-add button").click();
    await page.locator(".pk-panel .ap-ok").waitFor({ timeout: 10000 }).catch(() => {});
    check("adding it works", / added for /.test(await page.locator(".pk-panel").innerText()), await page.locator(".pk-panel").innerText());
    check("it's listed under the person", (await page.locator(".pk-list li").count()) === 1);
    const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
    check("the device holds one discoverable passkey", credentials.length === 1 && credentials[0].isResidentCredential, JSON.stringify(credentials.map((c) => c.isResidentCredential)));
    await page.locator(".pk-add button").click();
    await page.waitForTimeout(1500);
    check("adding it twice on the same device is refused", /already set up|Cancelled|Couldn/.test(await page.locator(".pk-panel").innerText()));

    // Sign out, then sign back in with one tap.
    await ctx.clearCookies();
    await page.goto(BASE + "/admin");
    await page.locator("button.gate-faceid").click();
    await page.locator(".admin-tabs").waitFor({ timeout: 10000 }).catch(() => {});
    check("Face ID signs in to the dashboard", (await page.locator(".admin-tabs").count()) === 1);
    const me = await page.evaluate(() => fetch("/api/admin/admins").then((r) => r.json()));
    check("…as that staff member (named in the Activity log, not the shared login)", me.you === "support@example.com", JSON.stringify(me.you));
    const keys = await page.evaluate(() => fetch("/api/admin/passkeys").then((r) => r.json()));
    check("the passkey shows when it was last used, and no key material is sent", keys.passkeys.length === 1 && keys.passkeys[0].lastUsedAt > 0 && !("publicKey" in keys.passkeys[0]), JSON.stringify(keys.passkeys));

    // Removing it: Face ID no longer works.
    page.on("dialog", (d) => d.accept());
    await page.locator(".admin-tab", { hasText: "Settings" }).first().click();
    await page.locator("button", { hasText: "Staff sign-in" }).first().click().catch(() => {});
    await page.locator(".pk-list button", { hasText: "Remove" }).click();
    await page.waitForTimeout(1200);
    await ctx.clearCookies();
    await page.goto(BASE + "/admin");
    await page.locator("button.gate-faceid").click();
    await page.waitForTimeout(2000);
    check("after removing it, that passkey can't sign in", (await page.locator(".admin-tabs").count()) === 0 && (await page.locator(".gate-error").count()) === 1);
  } catch (err) {
    check("flow ran", false, err && err.message);
  }
  await b.close();
  process.exit(0);
})();
