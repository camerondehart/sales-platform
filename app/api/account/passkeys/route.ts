import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { generateRegistrationOptions, verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { getApprovedVisitor, getVisitor } from "@/lib/auth";
import { isEnabled } from "@/lib/flags";
import { brand } from "@/lib/brand";
import { CHALLENGE_COOKIE, deviceName, packChallenge, relyingParty, unpackChallenge } from "@/lib/passkeys";
import { addMemberPasskey, getMemberPasskeys, memberPublicView, memberUserIdFor, removeMemberPasskey } from "@/lib/memberPasskeys";

export const dynamic = "force-dynamic";

// A signed-in member's own Face ID / Touch ID devices (Account → Face ID, and
// the one-click prompt after signing in).
//   GET                                 → { on, passkeys } (this site's, no key material)
//   POST { action: "options" }          → start adding one for this device
//   POST { action: "verify", response } → finish adding it
//   DELETE ?id=                         → remove one of theirs
// Staff using "Log in as" can't add or remove a member's devices.

const cookieOpts = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: "/api/account/passkeys", maxAge: 300 };

export async function GET(req: Request) {
  const user = await getApprovedVisitor();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const on = await isEnabled("member_passkeys").catch(() => false);
  const { rpID } = relyingParty(req);
  const mine = (await getMemberPasskeys()).filter((p) => p.userId === user.id && p.rpID === rpID);
  return NextResponse.json({ on, passkeys: mine.map(memberPublicView).sort((a, b) => b.createdAt - a.createdAt) }, { headers: { "Cache-Control": "no-store" } });
}

async function guard() {
  const user = await getApprovedVisitor();
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  if (!(await isEnabled("member_passkeys").catch(() => false))) return { error: NextResponse.json({ error: "Face ID sign-in is switched off right now." }, { status: 404 }) };
  if ((await getVisitor())?.as) return { error: NextResponse.json({ error: "Staff signed in as a member can't change their Face ID." }, { status: 403 }) };
  return { user };
}

export async function POST(req: Request) {
  const g = await guard();
  if (g.error) return g.error;
  const user = g.user!;
  const body = (await req.json().catch(() => null)) as { action?: string; response?: RegistrationResponseJSON } | null;
  const { rpID, origins } = relyingParty(req);

  if (body?.action === "options") {
    const existing = (await getMemberPasskeys()).filter((p) => p.userId === user.id && p.rpID === rpID);
    const options = await generateRegistrationOptions({
      rpName: brand.name,
      rpID,
      userName: user.email,
      userDisplayName: user.name,
      userID: memberUserIdFor(user.id),
      attestationType: "none",
      excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports as RegistrationResponseJSON["response"]["transports"] })),
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      timeout: 60_000,
    });
    cookies().set(CHALLENGE_COOKIE, packChallenge({ c: options.challenge, k: "mreg", u: user.id }), cookieOpts);
    return NextResponse.json({ options });
  }

  if (body?.action === "verify" && body.response && typeof body.response === "object") {
    const ch = unpackChallenge(cookies().get(CHALLENGE_COOKIE)?.value, "mreg");
    cookies().delete({ name: CHALLENGE_COOKIE, path: "/api/account/passkeys" });
    if (!ch || ch.u !== user.id) return NextResponse.json({ error: "That took too long. Please try again." }, { status: 400 });
    try {
      const v = await verifyRegistrationResponse({ response: body.response, expectedChallenge: ch.c, expectedOrigin: origins, expectedRPID: rpID, requireUserVerification: true });
      if (!v.verified) throw new Error("not verified");
      const c = v.registrationInfo.credential;
      const device = deviceName(req.headers.get("user-agent") || "");
      await addMemberPasskey({
        id: c.id, userId: user.id, publicKey: Buffer.from(c.publicKey).toString("base64url"), counter: c.counter,
        transports: c.transports, device, rpID, createdAt: Date.now(),
      });
      return NextResponse.json({ ok: true, device });
    } catch (err) {
      console.error("[member passkey] add failed", err);
      return NextResponse.json({ error: "Face ID couldn't be added. Please try again." }, { status: 400 });
    }
  }
  return NextResponse.json({ error: "Bad request." }, { status: 400 });
}

export async function DELETE(req: Request) {
  const g = await guard();
  if (g.error) return g.error;
  const id = new URL(req.url).searchParams.get("id") || "";
  const gone = id ? await removeMemberPasskey(id, g.user!.id) : null;
  if (!gone) return NextResponse.json({ error: "Already removed." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
