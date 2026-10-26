/**
 * Product video references — the same pattern as product images: a link to
 * a video (YouTube, Vimeo, or a direct .mp4/.webm file — including MP4s
 * uploaded from the dashboard, see lib/media.ts).
 *
 * Client-safe (no Node imports).
 */

export type VideoRef =
  | { kind: "youtube"; id: string; embed: string; original: string }
  | { kind: "vimeo"; id: string; embed: string; original: string }
  | { kind: "file"; src: string; original: string };

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/** Understand a pasted link or id. Returns null for anything we can't play safely. */
export function parseVideo(input: string | undefined | null): VideoRef | null {
  const raw = String(input || "").trim();
  if (!raw) return null;
  if (YT_ID.test(raw)) return yt(raw, raw);
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.replace(/^www\.|^m\./, "");
  if (host === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0];
    return YT_ID.test(id) ? yt(id, raw) : null;
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const v = u.searchParams.get("v");
    if (v && YT_ID.test(v)) return yt(v, raw);
    const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/);
    return m ? yt(m[1], raw) : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const m = u.pathname.match(/(?:^|\/)(\d{6,12})(?:\/|$)/);
    return m ? { kind: "vimeo", id: m[1], embed: `https://player.vimeo.com/video/${m[1]}?dnt=1`, original: raw } : null;
  }
  if (/\.(mp4|webm|mov|m4v)$/i.test(u.pathname)) return { kind: "file", src: u.toString(), original: raw };
  return null;
}

function yt(id: string, original: string): VideoRef {
  // youtube-nocookie: no tracking cookies until the visitor presses play.
  return { kind: "youtube", id, embed: `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1`, original };
}

/** Normalise what an admin typed; "" clears the video. Throws with a friendly message if unusable. */
export function cleanVideoInput(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (!parseVideo(s)) {
    throw new Error("That video link isn't one we can play. Use a YouTube or Vimeo link, or an https link ending in .mp4 or .webm.");
  }
  return s.slice(0, 500);
}
