import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { generateAuthenticationOptions, verifyAuthenticationResponse, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { ADMIN_COOKIE, signAdminToken } from "@/lib/auth";
import { isEnabled } from "@/lib/flags";
import { findAdmin } from "@/lib/admins";
import { auditSystem } from "@/lib/audit";
import { checkRateLimit, recordFailedAttempt } from "@/lib/rateLimit";
import { CHALLENGE_COOKIE, getPasskeys, packChallenge, relyingParty, touchPasskey, unpackChallenge } from "@/lib/passkeys";

export const dynamic = "force-dynamic";

/**
 * Staff sign-in with Face ID / Touch ID (a passkey added in Settings → Staff sign-in).
 *   { action: "options" }            → a one-time challenge for the browser
 *   { action: "verify", response }   → checks the device's answer, signs that staff member in
 * The shared password and emailed link keep working alongside it.
 */
export async function POST(req: Request) {
  if (!(await isEnabled("admin_passkeys").catch(() => false))) return NextResponse.json({ error: "off" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { action?: string; response?: AuthenticationResponseJSON } | null;
  const { rpID, origins } = relyingParty(req);
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const meta = { ip, userAgent: (req.headers.get("user-agent") || "").slice(0, 200) || undefined };
  const cookieOpts = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: "/api/login/passkey", maxAge: 300 };

  if (body?.action === "options") {
    // No list of allowed keys: the device offers whichever passkey for this site it has.
    const options = await generateAuthenticationOptions({ rpID, userVerification: "required", timeout: 60_000 });
    cookies().set(CHALLENGE_COOKIE, packChallenge({ c: options.challenge, k: "auth" }), cookieOpts);
    return NextResponse.json({ options });
  }

  if (body?.action === "verify" && body.response && typeof body.response === "object") {
    const fail = async (why: string) => {
      recordFailedAttempt("admin-passkey", ip);
      await auditSystem({ action: "admin.signin", actor: "unknown", actorType: "admin", source: "human", targetType: "admin", targetId: "passkey", ok: false, note: `Face ID sign-in refused: ${why}`, ...meta }).catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
      return NextResponse.json({ error: "That didn't work. Try again, or use your email link or the password." }, { status: 401 });
    };
    if (checkRateLimit("admin-passkey", ip).blocked) return fail("too many tries");
    const ch = unpackChallenge(cookies().get(CHALLENGE_COOKIE)?.value, "auth");
    cookies().delete({ name: CHALLENGE_COOKIE, path: "/api/login/passkey" });
    if (!ch) return fail("the request expired");
    const pk = (await getPasskeys()).find((p) => p.id === body.response!.id);
    if (!pk) return fail("unknown passkey (removed, or added on another site)");
    if (pk.rpID !== rpID) return fail("passkey belongs to another site");
    const admin = await findAdmin(pk.email);
    if (!admin) return fail(`${pk.email} is no longer on the staff list`);
    let ok = false;
    let why = "";
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
      console.error("[passkey] sign-in check failed", err);
      // The library's reason (origin, challenge, counter…) so the Activity log shows what to fix. No secrets in it.
      why = err instanceof Error ? err.message.slice(0, 240) : "";
    }
    if (!ok) return fail(`the device's answer didn't check out${why ? ` (${why})` : ""}`);
    await touchPasskey(pk.id, newCounter);
    cookies().set(ADMIN_COOKIE, await signAdminToken(admin.email), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
    await auditSystem({ action: "admin.signin", actor: admin.email, actorType: "admin", source: "human", targetType: "admin", targetId: admin.email, ok: true, note: `Signed in with Face ID / passkey (${pk.device})`, ...meta });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Bad request." }, { status: 400 });
}
