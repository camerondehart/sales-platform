import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { generateAuthenticationOptions, verifyAuthenticationResponse, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { VISITOR_COOKIE, signVisitorToken } from "@/lib/auth";
import { isEnabled } from "@/lib/flags";
import { getUsers } from "@/lib/users";
import { checkRateLimit, recordFailedAttempt } from "@/lib/rateLimit";
import { CHALLENGE_COOKIE, packChallenge, relyingParty, unpackChallenge } from "@/lib/passkeys";
import { getMemberPasskeys, touchMemberPasskey } from "@/lib/memberPasskeys";

export const dynamic = "force-dynamic";

/**
 * Members' sign-in with Face ID / Touch ID (a passkey added after signing in
 * another way, or under Account → Face ID). Same checks as the password
 * sign-in: pending and inactive accounts can't get in.
 *   { action: "options" }            → a one-time challenge for the browser
 *   { action: "verify", response }   → checks the device's answer, signs the member in
 */
export async function POST(req: Request) {
  if (!(await isEnabled("member_passkeys").catch(() => false))) return NextResponse.json({ error: "off" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { action?: string; response?: AuthenticationResponseJSON } | null;
  const { rpID, origins } = relyingParty(req);
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const cookieOpts = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: "/api/login/member-passkey", maxAge: 300 };

  if (body?.action === "options") {
    // No list of allowed keys: the device offers whichever passkey it has for this site.
    const options = await generateAuthenticationOptions({ rpID, userVerification: "required", timeout: 60_000 });
    cookies().set(CHALLENGE_COOKIE, packChallenge({ c: options.challenge, k: "mauth" }), cookieOpts);
    return NextResponse.json({ options });
  }

  if (body?.action === "verify" && body.response && typeof body.response === "object") {
    const rateKey = `member-passkey:${ip}`;
    const fail = async (why: string, status = 401) => {
      recordFailedAttempt(rateKey, ip);
      console.warn(`[member passkey] sign-in refused: ${why}`);
      await new Promise((r) => setTimeout(r, 500));
      return NextResponse.json({ error: "That didn't work. Try again, or sign in with your email and password." }, { status });
    };
    if (checkRateLimit(rateKey, ip).blocked) return fail("too many tries", 429);
    const ch = unpackChallenge(cookies().get(CHALLENGE_COOKIE)?.value, "mauth");
    cookies().delete({ name: CHALLENGE_COOKIE, path: "/api/login/member-passkey" });
    if (!ch) return fail("the request expired");
    const pk = (await getMemberPasskeys()).find((p) => p.id === body.response!.id);
    if (!pk) return fail("unknown passkey (removed, or added on another site)");
    if (pk.rpID !== rpID) return fail("passkey belongs to another site");
    const user = (await getUsers()).find((u) => u.id === pk.userId);
    if (!user) return fail("that member no longer exists");
    let ok = false;
    let newCounter = pk.counter;
    try {
      const v = await verifyAuthenticationResponse({
        response: body.response,
        expectedChallenge: ch.c,
        expectedOrigin: origins,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: { id: pk.id, publicKey: new Uint8Array(Buffer.from(pk.publicKey, "base64url")), counter: pk.counter, transports: pk.transports },
      });
      ok = v.verified;
      newCounter = v.authenticationInfo.newCounter;
    } catch (err) {
      console.error("[member passkey] sign-in check failed", err);
    }
    if (!ok) return fail("the device's answer didn't check out");
    // Same answers as the password sign-in for accounts that can't shop.
    if (user.status === "pending") return NextResponse.json({ error: "pending" }, { status: 403 });
    if (user.status !== "approved") return NextResponse.json({ error: "rejected" }, { status: 403 });
    await touchMemberPasskey(pk.id, newCounter);
    cookies().set(VISITOR_COOKIE, await signVisitorToken(user.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return NextResponse.json({ ok: true, name: user.name });
  }
  return NextResponse.json({ error: "Bad request." }, { status: 400 });
}
