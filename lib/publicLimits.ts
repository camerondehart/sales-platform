import { NextResponse } from "next/server";
import { clientIp, overLimit } from "./assistant/limits";

/**
 * Rate limits for the public forms (checkout, event sign-up, join, mailing
 * list, password reset, mark-paid). In memory, per server instance — enough to
 * stop a script flooding a form from one address, with no storage cost.
 * Limits are generous so a real person (or a family on one wifi) never hits them.
 *
 * Returns a ready 429 response when over the limit, or null to carry on.
 */
export function tooMany(
  req: Request,
  form: string,
  perIp: { max: number; minutes: number },
  extra?: { key: string; max: number; minutes: number }
): NextResponse | null {
  const ip = clientIp(req);
  const hitIp = overLimit(`form:${form}:ip:${ip}`, perIp.max, perIp.minutes * 60_000);
  const hitExtra = extra && extra.key ? overLimit(`form:${form}:k:${extra.key.toLowerCase()}`, extra.max, extra.minutes * 60_000) : false;
  if (!hitIp && !hitExtra) return null;
  console.warn(`[limits] ${form}: too many requests from ${ip}`);
  return NextResponse.json(
    { error: "That's a lot of tries in a short time — please wait a few minutes and try again." },
    { status: 429, headers: { "Retry-After": "300" } }
  );
}
