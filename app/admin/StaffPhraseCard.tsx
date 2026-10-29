"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useAdminRefresh } from "./useAdminRefresh";
import type { AdminRefreshKey } from "@/lib/assistant/shared";

// Settings → Steward password: today's daily staff password (lib/staffPhrase.ts).
// Always here for signed-in staff, so nobody is locked out if the email goes astray.

type Data = { on: boolean; date?: string; phrase?: string; yesterday?: string | null; oldPassword?: { works: boolean; until: number | null } };

const when = (t: number) => new Date(t).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });

// `fixedPassword` (the old "change the password" form) only shows while the daily password is switched off.
export default function StaffPhraseCard({ fixedPassword }: { fixedPassword?: ReactNode }) {
  const [d, setD] = useState<Data | null>(null);
  const [copied, setCopied] = useState(false);
  const load = () =>
    fetch("/api/admin/staff-phrase", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((x: Data | null) => x && setD(x))
      .catch(() => {});
  useAdminRefresh(["flags"] as AdminRefreshKey[], () => load());
  useEffect(() => {
    load();
  }, []);

  if (!d) return null;
  if (!d.on || !d.phrase) return <>{fixedPassword}</>;
  const copy = () =>
    navigator.clipboard?.writeText(d.phrase!).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});

  return (
    <div className="sp-card">
      <h3>Today&rsquo;s staff password</h3>
      <div className="sp-row">
        <code className="sp-phrase">{d.phrase}</code>
        <button type="button" className="esc-btn" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <p className="field-hint">
        A new one every day at midnight Pacific. It&rsquo;s also in each morning&rsquo;s nightly report email. Capitals and spaces don&rsquo;t matter.
        {d.yesterday ? <> Yesterday&rsquo;s (<code>{d.yesterday}</code>) still works until noon.</> : null}
      </p>
      {d.oldPassword && (
        <p className="field-hint">
          {d.oldPassword.works && d.oldPassword.until
            ? <>The old fixed password still works until <strong>{when(d.oldPassword.until)}</strong>, then stops.</>
            : <>The old fixed password no longer signs in. Face ID and the emailed sign-in link keep working.</>}
        </p>
      )}
    </div>
  );
}
