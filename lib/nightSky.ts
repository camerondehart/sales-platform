/**
 * Night sky (switch `night_sky`): from dusk to dawn on the VISITOR'S OWN clock
 * (not the business time zone), the customer pages turn
 * to a moonlit valley — darker sky, a glowing moon, twinkling stars, fireflies —
 * and the members' entrance plays its night version. Staff pages never change.
 *
 * Dusk and dawn come from the rough area (about city level) the visitor's
 * internet address points to, which Vercel adds to each request (the same
 * headers the events note uses): the server rounds it to 0.1° and hands it to
 * the page; it's never stored and the browser never asks for a location
 * (so it matches what visitors see out of the window). Night = from
 * 15 minutes after sunset to 15 minutes before sunrise there (isNightAt).
 * With no area (local runs, odd networks) it falls back to the date and the
 * visitor's own clock at a mid-US latitude (isNightLocal).
 *
 * Pure and client-safe: the same code runs in the tiny <head> script (before
 * the first paint, so nobody sees a flash of daytime) and in NightSky.tsx.
 * Unit check: tests/unit/night-sky.cjs.
 */

export const NIGHT_LAT = 38;
/** Minutes after sunset that "night" starts, and before sunrise that it ends. */
export const DUSK_MIN = 15;

/**
 * Is it night on this clock? `now` is a Date in the visitor's own time zone.
 * Self-contained on purpose (no imports, no outside variables): its source is
 * inlined into the page head as-is.
 */
export function isNightLocal(now: Date): boolean {
  const y = now.getFullYear();
  const start = new Date(y, 0, 1);
  const day = Math.floor((now.getTime() - start.getTime()) / 86400000) + 1;
  // Clocks forward? (standard time = the larger UTC offset of January and July)
  const jan = new Date(y, 0, 1).getTimezoneOffset();
  const jul = new Date(y, 6, 1).getTimezoneOffset();
  const dst = now.getTimezoneOffset() < Math.max(jan, jul) ? 60 : 0;
  // Sun's declination for the day, then half the length of daylight at 38°N.
  const rad = Math.PI / 180;
  const decl = -23.44 * Math.cos(rad * (360 / 365) * (day + 10));
  const lat = 38 * rad;
  const cosW = (Math.sin(-0.833 * rad) - Math.sin(lat) * Math.sin(decl * rad)) / (Math.cos(lat) * Math.cos(decl * rad));
  const half = (Math.acos(Math.max(-1, Math.min(1, cosW))) / rad) * 4; // minutes of daylight either side of noon
  const noon = 12 * 60 + dst;
  const mins = now.getHours() * 60 + now.getMinutes();
  const dusk = noon + half + 15;
  const dawn = noon - half - 15;
  return mins >= dusk || mins < dawn;
}

/**
 * Is it night at this place (latitude, longitude east-positive) at this moment?
 * The standard sunrise equation; handles polar night and midnight sun.
 * Self-contained like isNightLocal (inlined into the page head as-is).
 */
export function isNightAt(nowMs: number, lat: number, lon: number): boolean {
  const rad = Math.PI / 180;
  const d = nowMs / 86400000 + 2440587.5 - 2451545.0; // days since J2000
  const n = Math.round(d - 0.0009 + lon / 360);
  const buf = 15 / 1440;
  for (let k = n - 1; k <= n + 1; k++) {
    const js = k + 0.0009 - lon / 360;
    const M = (357.5291 + 0.98560028 * js) % 360;
    const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
    const L = (M + C + 180 + 102.9372) % 360;
    const transit = js + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * L * rad);
    const decl = Math.asin(Math.sin(L * rad) * Math.sin(23.44 * rad));
    const cosW = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(decl)) / (Math.cos(lat * rad) * Math.cos(decl));
    if (cosW > 1) continue; // the sun stays down all day
    const half = cosW < -1 ? 0.5 : Math.acos(cosW) / rad / 360;
    if (d >= transit - half - buf && d <= transit + half + buf) return false;
  }
  return true;
}

/** Rounded rough area from Vercel's headers (about 10 km), or null. */
export function roughArea(geo: { lat: number; lon: number } | null): { lat: number; lon: number } | null {
  return geo ? { lat: Math.round(geo.lat * 10) / 10, lon: Math.round(geo.lon * 10) / 10 } : null;
}

/** Staff pages never get the night look. */
export const isStaffPath = (p: string) => /^\/(admin|help)(\/|$)/.test(p);

/** Staff preview cookie (Settings → Entrance animation): "on" = night now, "off" = day now. */
export const NIGHT_PREVIEW_COOKIE = "fp_night_preview";

/**
 * The script inlined at the top of <head>: sets <html data-night="1"> before
 * the first paint. `force` is the staff preview ("on" / "off"), else the clock decides.
 */
export function nightHeadScript(force?: "on" | "off" | null, area?: { lat: number; lon: number } | null): string {
  const clock = area && Number.isFinite(area.lat) && Number.isFinite(area.lon)
    ? `(${isNightAt.toString()})(Date.now(),${Number(area.lat)},${Number(area.lon)})`
    : `(${isNightLocal.toString()})(new Date())`;
  const decide = force === "on" ? "true" : force === "off" ? "false" : clock;
  // Never on staff pages (the admin has its own dark theme).
  return `try{if(!/^\\/(admin|help)(\\/|$)/.test(location.pathname)&&${decide})document.documentElement.setAttribute("data-night","1")}catch(e){}`;
}
