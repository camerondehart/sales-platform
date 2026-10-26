import { escapeHtml } from "./invoiceEmail";
import { getProducts } from "./storage";
import { getAssistantConfig } from "./assistant/config";
import { sendMail, staffInbox } from "./assistant/tools";
import { addEscalation } from "./assistant/usage";
import type { User } from "./users";
import { brand } from "@/lib/brand";

/**
 * "Ask a question about these items" — replaces the old inquiry-only order.
 * Nothing is ordered or invoiced: the question (with the items) lands in the
 * Assistant tab's "Handed to the team" list and in the team inbox, and staff
 * reply from there. Old inquiry orders are left exactly as they were.
 */
export async function askAboutItems(
  user: Pick<User, "name" | "email">,
  items: Array<{ productId: string; quantity: number }>,
  question: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const q = String(question || "").trim().slice(0, 2000);
  if (!q) return { ok: false, error: "Type your question so we know how to help." };
  const products = await getProducts();
  const lines = (Array.isArray(items) ? items : [])
    .slice(0, 30)
    .map((i) => {
      const p = products.find((x) => x.id === i.productId);
      return p ? `${p.name} ×${Math.max(1, Math.min(999, Math.floor(Number(i.quantity) || 1)))}` : null;
    })
    .filter((x): x is string => !!x);
  const config = await getAssistantConfig();
  const html = `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:620px;color:#2b2f27">
      <div style="font-size:12px;letter-spacing:.15em;text-transform:uppercase;color:#6fa336;font-weight:700">Question from a member</div>
      <h2 style="font-family:Georgia,serif;font-weight:400;font-style:italic;margin:8px 0 14px">${escapeHtml(user.name)} has a question</h2>
      <p><strong>Reply to:</strong> <a href="mailto:${escapeHtml(user.email)}">${escapeHtml(user.email)}</a></p>
      <p style="background:#f3f6ec;padding:12px 14px;border-left:3px solid #85ba45;white-space:pre-wrap">${escapeHtml(q)}</p>
      ${lines.length ? `<p><strong>About:</strong> ${lines.map(escapeHtml).join(", ")}</p>` : ""}
      <p style="font-size:12px;color:#81858b;margin-top:20px">Reply to this email, or from the dashboard's Assistant tab → Handed to the team.</p>
    </div>`;
  const emailed = await sendMail(staffInbox(config), `Question from ${user.name}`, html, user.email);
  try {
    await addEscalation({
      audience: "member",
      name: user.name,
      email: user.email,
      topic: "product",
      summary: (lines.length ? `${q}\n\nAbout: ${lines.join(", ")}` : q).slice(0, 1000),
      emailed,
      transcript: [{ role: "user", content: lines.length ? `${q}\n\nAbout: ${lines.join(", ")}` : q }],
    });
  } catch (err) {
    console.error("[ask] couldn't save the question", err);
    if (!emailed) return { ok: false, error: `We couldn't send your question just now. Please try again, or email ${brand.supportEmail}.` };
  }
  return { ok: true };
}
