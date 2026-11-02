import { notFound } from "next/navigation";
import { isEnabled } from "@/lib/flags";
import { getApprovedVisitor } from "@/lib/auth";
import SiteNav from "@/app/components/SiteNav";
import ConsultationForm from "./ConsultationForm";
import { brand } from "@/lib/brand";

export const metadata = {
  title: `Free phone consultation · ${brand.name}`,
  description: `Ask for a free phone consultation with the ${brand.shortName} team.`,
};

export const dynamic = "force-dynamic";

// Free phone consultation requests (switch `consultation_form`). Replaced the
// usual outside consultation form; signed-in members' details are filled in.
export default async function ConsultationPage() {
  const [on, stores, member] = await Promise.all([
    isEnabled("consultation_form").catch(() => false),
    isEnabled("store_locator").catch(() => false),
    getApprovedVisitor().catch(() => null),
  ]);
  if (!on) notFound();
  const [firstName, ...rest] = (member?.name || "").trim().split(/\s+/);
  return (
    <div className="shell">
      <header className="masthead">
        <a className="masthead-brand" href="/" aria-label={`${brand.name} home`}>
          <div className="logo-mark floaty" aria-hidden="true">
            <span></span><span></span><span></span><span></span>
          </div>
          <h1 className="masthead-title">{brand.name}</h1>
        </a>
        <SiteNav stores={stores} concierge />
      </header>

      <article className="about consult">
        <div className="about-hero">
          <div className="about-kicker">Let&rsquo;s talk</div>
          <h2 className="about-title">Free phone consultation</h2>
          <p className="about-lede">Tell us a little about what you&rsquo;re looking for and pick a time that suits you. We&rsquo;ll call you, and confirm the time by phone or email first.</p>
        </div>
        <ConsultationForm
          prefill={member ? { firstName: firstName || "", lastName: rest.join(" "), email: member.email || "", phone: member.phone || "" } : undefined}
        />
      </article>
    </div>
  );
}
