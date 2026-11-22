/**
 * Security headers on every response (2026-11-22 hardening pass):
 *  - no other site may frame ours (clickjacking); our own pages still can;
 *  - browsers must not guess file types, and links to other sites carry only
 *    our domain (never a /pay?token= or /gift/<token> address);
 *  - camera, microphone and location only for our own pages (the Concierge's
 *    photo and voice buttons, the store finder's "near me").
 * No script/style rules: the site relies on inline scripts and styles.
 */
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(self), browsing-topics=()" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // No remote images: the site doesn't use next/image, and an open
  // remotePatterns ("**") let anyone run any image on the web through our
  // image optimizer (the route several 2026 Next.js advisories target).
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};
module.exports = nextConfig;
