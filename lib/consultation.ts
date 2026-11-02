import { escapeHtml } from "./invoiceEmail";
import { getAssistantConfig } from "./assistant/config";
import { sendMail, staffInbox } from "./assistant/tools";
import { addEscalation, escalationStatus, recentEscalations } from "./assistant/usage";
import { customerReplyTo } from "./replyTo";
import { brand, TEAM } from "./brand";
import { CONSULT_ACK, CONSULT_INTERESTS, checkSlot, slotText } from "./consultSlots";
import type { Audience } from "./assistant/shared";

/**
 * Free phone consultation requests, from the /consultation page or the
 * Concierge (they replaced the outside JotForm; same questions). Each request
 * lands in the dashboard's Assistant tab → "Handed to the team" (topic
 * "consultation") and the team inbox; the customer gets a confirmation. The
 * time is a request: the team confirms it by phone or email.
 */

export type ConsultationInput = {
  name: string;
  email: string;
  phone: string;
  interest: string;
  /** Requested time (ms), a weekday half-hour slot in the brand's time zone. */
  at: number;
  comments?: string;
  /** Their full name typed as a signature under CONSULT_ACK. */
  signature: string;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const squash = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function cleanConsultation(raw: Record<string, unknown>): { ok: true; value: ConsultationInput } | { ok: false; error: string } {
  const name = squash(raw.name ?? `${squash(raw.firstName, 60)} ${squash(raw.lastName, 60)}`, 120);
  const email = squash(raw.email, 200).toLowerCase();
  const phone = squash(raw.phone, 40);
  const interest = squash(raw.interest, 80);
  const comments = String(raw.comments ?? "").trim().slice(0, 1500);
  const signature = squash(raw.signature, 120);
  const at = Number(raw.at);
  if (!name) return { ok: false, error: "Please add your name." };
  if (phone.replace(/\D/g, "").length < 10) return { ok: false, error: "Please add a phone number with its area code." };
  if (!EMAIL.test(email)) return { ok: false, error: "Please add a valid email." };
  if (!(CONSULT_INTERESTS as readonly string[]).includes(interest)) return { ok: false, error: "Please choose what you'd like to talk about." };
  const slotError = checkSlot(at);
  if (slotError) return { ok: false, error: slotError };
  if (raw.acknowledged !== true) return { ok: false, error: "Please read and agree to the statement at the bottom." };
  if (signature.length < 2) return { ok: false, error: "Please type your full name to sign." };
  return { ok: true, value: { name, email, phone, interest, at, comments: comments || undefined, signature } };
}

/** Requested times already asked for by open requests (so two people don't pick the same one). Times only, nothing personal. */
export async function takenSlots(): Promise<number[]> {
  const rows = await recentEscalations().catch(() => []);
  return rows.filter((e) => e.topic === "consultation" && e.consultation && escalationStatus(e) === "open").map((e) => e.consultation!.at);
}

export async function requestConsultation(
  c: ConsultationInput,
  meta: { source: "form" | "concierge"; audience: Audience; transcript?: Array<{ role: "user" | "assistant"; content: string }> }
): Promise<{ ok: true } | { ok: false; error: string }> {
  if ((await takenSlots()).includes(c.at)) return { ok: false, error: "Someone just asked for that time. Please pick another." };
  const config = await getAssistantConfig();
  const when = slotText(c.at);
  const via = meta.source === "concierge" ? "the Concierge" : "the consultation form";
  const staffHtml = `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:620px;color:#2b2f27">
      <div style="font-size:12px;letter-spacing:.15em;text-transform:uppercase;color:#6fa336;font-weight:700">Free phone consultation request</div>
      <h2 style="font-family:Georgia,serif;font-weight:400;font-style:italic;margin:8px 0 14px">${escapeHtml(c.name)} would like a call</h2>
      <p><strong>Asked for:</strong> ${escapeHtml(when)}<br/>
      <strong>Phone:</strong> <a href="tel:${escapeHtml(c.phone.replace(/[^\d+]/g, ""))}">${escapeHtml(c.phone)}</a><br/>
      <strong>Email:</strong> <a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a><br/>
      <strong>Interest:</strong> ${escapeHtml(c.interest)}<br/>
      <strong>From:</strong> ${meta.audience === "member" ? "Signed-in member" : "Website visitor"}, via ${via}</p>
      ${c.comments ? `<p style="background:#f3f6ec;padding:12px 14px;border-left:3px solid #85ba45;white-space:pre-wrap">${escapeHtml(c.comments)}</p>` : ""}
      <p style="font-size:13px;color:#61676d">Agreed to: &ldquo;${escapeHtml(CONSULT_ACK)}&rdquo; Signed: <strong>${escapeHtml(c.signature)}</strong></p>
      <p style="font-size:12px;color:#81858b;margin-top:20px">Call or reply to confirm the time (replying to this email goes to them), then mark it resolved in the dashboard's Assistant tab → Handed to the team.</p>
    </div>`;
  const emailed = await sendMail(staffInbox(config), `Consultation request: ${c.name}, ${when}`, staffHtml, c.email);
  const summary = [`Free phone consultation, asked for ${when}.`, `Phone: ${c.phone}.`, `Interest: ${c.interest}.`, c.comments ? `Comments: ${c.comments}` : ""].filter(Boolean).join(" ").slice(0, 1000);
  try {
    await addEscalation({
      audience: meta.audience,
      name: c.name,
      email: c.email,
      topic: "consultation",
      summary,
      emailed,
      transcript: meta.transcript?.length ? meta.transcript : [{ role: "user", content: summary }],
      consultation: { at: c.at, phone: c.phone, interest: c.interest, signature: c.signature, acknowledgedAt: Date.now() },
    });
  } catch (err) {
    console.error("[consultation] couldn't save the request", err);
    if (!emailed) return { ok: false, error: `We couldn't send your request just now. Please try again, or email ${customerReplyTo()}.` };
  }
  const first = escapeHtml(c.name.split(" ")[0] || c.name);
  await sendMail(
    c.email,
    "We got your consultation request",
    `<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;color:#2b2f27;line-height:1.6">
      <p>Hi ${first},</p>
      <p>Thanks for asking for a free phone consultation with ${escapeHtml(brand.name)}. We'll confirm your time by phone or email, usually within one business day.</p>
      <p style="background:#f3f6ec;padding:12px 14px;border-radius:8px"><strong>You asked for:</strong> ${escapeHtml(when)}<br/><strong>We'll call:</strong> ${escapeHtml(c.phone)}<br/><strong>About:</strong> ${escapeHtml(c.interest)}</p>
      <p>Consultations are friendly, general conversations about our products, not medical advice. Need a different time? Just reply to this email.</p>
      <p>Warmly,<br/>${escapeHtml(TEAM)}</p>
    </div>`,
    customerReplyTo()
  ).catch(() => false);
  return { ok: true };
}
