"use client";

import { useCallback, useEffect, useState } from "react";

// Dashboard dark mode. Three settings: follow the device (default), always
// dark, always light. The choice is remembered per device. The theme lives on
// <html data-admin-theme="dark|light"> only while the dashboard is mounted, so
// customer pages are never affected.

export type ThemePref = "auto" | "dark" | "light";
const KEY = "fp_admin_theme";

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "dark" || v === "light" ? v : "auto";
  } catch {
    return "auto";
  }
}

function resolve(pref: ThemePref): "dark" | "light" {
  if (pref !== "auto") return pref;
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useAdminTheme() {
  const [pref, setPref] = useState<ThemePref>("auto");
  const [resolved, setResolved] = useState<"dark" | "light">("light");

  useEffect(() => {
    const p = readPref();
    setPref(p);
    const apply = () => {
      const r = resolve(p);
      setResolved(r);
      document.documentElement.setAttribute("data-admin-theme", r);
    };
    apply();
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onChange = () => { if (p === "auto") apply(); };
    mq?.addEventListener?.("change", onChange);
    return () => {
      mq?.removeEventListener?.("change", onChange);
      document.documentElement.removeAttribute("data-admin-theme");
    };
  }, [pref]);

  const cycle = useCallback(() => {
    const next: ThemePref = pref === "auto" ? "dark" : pref === "dark" ? "light" : "auto";
    try {
      if (next === "auto") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {}
    setPref(next);
  }, [pref]);

  const label = pref === "auto" ? `◐ Auto` : pref === "dark" ? "☾ Dark" : "☀ Light";
  const title =
    pref === "auto"
      ? `Theme follows this device (currently ${resolved}). Click for dark.`
      : pref === "dark"
        ? "Dark theme. Click for light."
        : "Light theme. Click to follow the device.";
  return { pref, resolved, cycle, label, title };
}
