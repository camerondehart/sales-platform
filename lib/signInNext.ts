/**
 * Where a member lands after signing in. Normally the members' gallery; an
 * ambassador's page sends "Sign in to see" visitors back to itself with
 * ?next=/<their page>. Only a bare page name of this site is accepted (the
 * same shape as an ambassador page name), never another site or a deeper path.
 */
const NEXT_RE = /^\/[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function safeNext(raw: string | null | undefined): string | null {
  const v = String(raw || "").trim().toLowerCase();
  return NEXT_RE.test(v) ? v : null;
}

/**
 * In the browser: the page to go to after signing in. `to` = where the server
 * says this member lands (an ambassador's panel, "/ambassador"); a ?next= page
 * still wins, so "Sign in to see" on a page returns there.
 */
export function afterSignIn(to?: string): string {
  const home = to === "/ambassador" ? to : "/gallery";
  try {
    return safeNext(new URLSearchParams(window.location.search).get("next")) || home;
  } catch {
    return home;
  }
}
