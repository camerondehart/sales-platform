import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isEnabled } from "@/lib/flags";
import { canSignIn, findLoginById } from "@/lib/retail";
import { getStoreSession, startStoreSession } from "@/lib/retailAuth";
import { checkRateLimit, recordFailedAttempt } from "@/lib/rateLimit";
import { CHALLENGE_COOKIE, deviceName, packChallenge, relyingParty, unpackChallenge } from "@/lib/passkeys";
import { addStorePasskey, getStorePasskeys, removeStorePasskey, storePasskeyView, storeUserIdFor, touchStorePasskey } from "@/lib/storePasskeys";
import { portalOn } from "@/lib/retailPortal";
import { brand } from "@/lib/brand";

export const dynamic = "force-dynamic";

/**
 * Store portal Face ID / Touch ID (same switch as members': member_passkeys).
 *   GET                                  → { on, passkeys } for the signed-in login
 *   POST { action: "options" }           → sign-in challenge
 *   POST { action: "verify", response }  → signs in
 *   POST { action: "add-options" }       → (signed in) start adding one for this device
 *   POST { action: "add-verify", response }
 *   DELETE ?id=                          → (signed in) remove one of theirs
 */

const PATH = "/api/store-portal/passkey";
const cookieOpts = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: PATH, maxAge: 300 };
const on = async () => (await portalOn()) && (await isEnabled("member_passkeys").catch(() => false));

export async function GET(req: Request) {
  const s = await getStoreSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { rpID } = relyingParty(req);
  const mine = (await getStorePasskeys()).filter((p) => p.loginId === s.login.id && p.rpID === rpID);
  return NextResponse.json({ on: await on(), passkeys: mine.map(storePasskeyView).sort((a, b) => b.createdAt - a.createdAt) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  if (!(await on())) return NextResponse.json({ error: "Face ID sign-in is switched off right now." }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { action?: string; response?: AuthenticationResponseJSON & RegistrationResponseJSON } | null;
  const { rpID, origins } = relyingParty(req);
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";

  if (body?.action === "options") {
    const options = await generateAuthenticationOptions({ rpID, userVerification: "required", timeout: 60_000 });
    cookies().set(CHALLENGE_COOKIE, packChallenge({ c: options.challenge, k: "sauth" }), cookieOpts);
    return NextResponse.json({ options });
  }

  if (body?.action === "verify" && body.response && typeof body.response === "object") {
    const rateKey = `store-passkey:${ip}`;
    const fail = async (why: string, status = 401) => {
      recordFailedAttempt(rateKey, ip);
      console.warn(`[store passkey] sign-in refused: ${why}`);
      await new Promise((r) => setTimeout(r, 500));
      return NextResponse.json({ error: "That didn't work. Try again, or sign in with your email." }, { status });
    };
    if (checkRateLimit(rateKey, ip).blocked) return fail("too many tries", 429);
    const ch = unpackChallenge(cookies().get(CHALLENGE_COOKIE)?.value, "sauth");
    cookies().delete({ name: CHALLENGE_COOKIE, path: PATH });
    if (!ch) return fail("the request expired");
    const pk = (await getStorePasskeys()).find((p) => p.id === body.response!.id);
    if (!pk) return fail("unknown passkey");
    if (pk.rpID !== rpID) return fail("passkey belongs to another site");
    const hit = await findLoginById(pk.loginId);
    if (!canSignIn(hit)) return fail("login removed or switched off");
    let ok = false;
    let newCounter = pk.counter;
    try {
      const v = await verifyAuthenticationResponse({
        response: body.response,
        expectedChallenge: ch.c,
        expectedOrigin: origins,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: { id: pk.id, publicKey: new Uint8Array(Buffer.from(pk.publicKey, "base64url")), counter: pk.counter, transports: pk.transports as RegistrationResponseJSON["response"]["transports"] },
      });
      ok = v.verified;
      newCounter = v.authenticationInfo.newCounter;
    } catch (err) {
      console.error("[store passkey] sign-in check failed", err);
    }
    if (!ok) return fail("the device's answer didn't check out");
    await touchStorePasskey(pk.id, newCounter);
    await startStoreSession(hit!.login, hit!.account);
    return NextResponse.json({ ok: true, name: hit!.login.name });
  }

  // Adding a device: signed in only.
  const s = await getStoreSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (body?.action === "add-options") {
    const existing = (await getStorePasskeys()).filter((p) => p.loginId === s.login.id && p.rpID === rpID);
    const options = await generateRegistrationOptions({
      rpName: `${brand.shortName} store portal`,
      rpID,
      userName: s.login.email,
      userDisplayName: `${s.login.name} (${s.account.name})`,
      userID: storeUserIdFor(s.login.id),
      attestationType: "none",
      excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports as RegistrationResponseJSON["response"]["transports"] })),
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      timeout: 60_000,
    });
    cookies().set(CHALLENGE_COOKIE, packChallenge({ c: options.challenge, k: "sreg", u: s.login.id }), cookieOpts);
    return NextResponse.json({ options });
  }

  if (body?.action === "add-verify" && body.response && typeof body.response === "object") {
    const ch = unpackChallenge(cookies().get(CHALLENGE_COOKIE)?.value, "sreg");
    cookies().delete({ name: CHALLENGE_COOKIE, path: PATH });
    if (!ch || ch.u !== s.login.id) return NextResponse.json({ error: "That took too long. Please try again." }, { status: 400 });
    try {
      const v = await verifyRegistrationResponse({ response: body.response, expectedChallenge: ch.c, expectedOrigin: origins, expectedRPID: rpID, requireUserVerification: true });
      if (!v.verified) throw new Error("not verified");
      const c = v.registrationInfo.credential;
      const device = deviceName(req.headers.get("user-agent") || "");
      await addStorePasskey({ id: c.id, loginId: s.login.id, publicKey: Buffer.from(c.publicKey).toString("base64url"), counter: c.counter, transports: c.transports, device, rpID, createdAt: Date.now() });
      return NextResponse.json({ ok: true, device });
    } catch (err) {
      console.error("[store passkey] add failed", err);
      return NextResponse.json({ error: "Face ID couldn't be added. Please try again." }, { status: 400 });
    }
  }
  return NextResponse.json({ error: "Bad request." }, { status: 400 });
}

export async function DELETE(req: Request) {
  const s = await getStoreSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") || "";
  const gone = id ? await removeStorePasskey(id, s.login.id) : null;
  if (!gone) return NextResponse.json({ error: "Already removed." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
