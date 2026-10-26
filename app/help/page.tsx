import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { COURSE_HTML } from "./courseHtml";
import { brand } from "@/lib/brand";

export const metadata = {
  title: `Staff Guide · ${brand.name}`,
  description: `How-to guide for running the ${brand.name} site.`,
};

export const dynamic = "force-dynamic";

// Staff guide. Admin-only: it documents the whole back office.
//
// The guide is a complete, self-contained HTML document, so it renders in a
// sandboxed iframe that fills the viewport. Its own sidebar carries the
// "Back to dashboard" link — wrapping it in extra page chrome caused the
// header to smear during scroll in Safari.
export default async function HelpPage() {
  if (!(await isAdmin())) redirect("/admin");

  return (
    <iframe
      className="help-frame"
      title={`${brand.name} staff guide`}
      srcDoc={COURSE_HTML}
      sandbox="allow-scripts allow-popups allow-modals allow-top-navigation-by-user-activation"
    />
  );
}
