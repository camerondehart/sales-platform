"use client";

import { useEffect, useState } from "react";
import { useAdminRefresh } from "./useAdminRefresh";
import type { AdminRefreshKey } from "@/lib/assistant/shared";

// Settings → Staff sign-in: who can get an emailed sign-in link.
// The shared admin password keeps working as a backup.

type Admin = { id: string; email: string; name: string; addedAt: number };

export default function StaffPanel() {
  const [rows, setRows] = useState<Admin[] | null>(null);
  const [you, setYou] = useState("admin");
  const [on, setOn] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    const [a, f] = await Promise.all([
      fetch("/api/admin/admins", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/admin/flags", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
    ]);
    if (a) {
      setRows(a.admins);
      setYou(a.you);
    }
    setOn(!!f?.flags?.find((x: { key: string; on: boolean }) => x.key === "admin_magic_link")?.on);
  };
  useAdminRefresh(["staff","flags"] as AdminRefreshKey[], () => load());
  useEffect(() => {
    load().catch(() => {});
  }, []);

  async function save(next: Admin[], okText: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/admins", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ admins: next }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Couldn't save.");
      setRows(d.admins);
      setMsg({ ok: true, text: okText });
      return true;
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Couldn't save." });
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!rows) return null;
  return (
    <section className="admin-section">
      <h2>Staff sign-in</h2>
      <p className="field-hint" style={{ marginTop: "-0.4rem" }}>
        {on
          ? "People on this list can sign in with a one-time link sent to their email (it expires in 15 minutes). The shared admin password still works as a backup. The Activity log shows who made each change."
          : "Off. Switch on under Feature switches → Admin sign-in link by email. Until then, everyone uses the shared admin password."}
      </p>
      <div className="staff-list">
        {rows.map((a) => (
          <div key={a.id} className="staff-row">
            <div>
              <strong>{a.name}</strong> <span className="staff-email">{a.email}</span>
              {a.email === you && <span className="staff-you">you</span>}
            </div>
            <button
              type="button"
              className="ap-linkbtn esc-quiet"
              disabled={busy || rows.length <= 1}
              title={rows.length <= 1 ? "Keep at least one person" : ""}
              onClick={() => {
                if (confirm(`Remove ${a.email}? They won't be able to sign in with a link (within a minute).`)) save(rows.filter((x) => x.id !== a.id), `Removed ${a.email}.`);
              }}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <form
        className="staff-add"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await save([...rows, { id: email, email, name, addedAt: Date.now() }], `Added ${email.trim().toLowerCase()}.`)) {
            setEmail("");
            setName("");
          }
        }}
      >
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} style={{ maxWidth: 160 }} />
        <input type="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <button type="submit" className="esc-btn primary" disabled={busy}>Add</button>
      </form>
      {msg && <div className={msg.ok ? "ap-ok" : "ap-bad"} style={{ marginTop: "0.5rem" }}>{msg.text}</div>}
    </section>
  );
}
