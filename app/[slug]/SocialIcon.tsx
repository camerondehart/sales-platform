// Small line icons for an ambassador's social links.
type Kind = "instagram" | "tiktok" | "youtube" | "facebook" | "x" | "pinterest" | "threads" | "spotify" | "link";

const PATHS: Record<Kind, JSX.Element> = {
  instagram: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4.5" />
      <circle cx="12" cy="12" r="3.6" />
      <circle cx="16.9" cy="7.1" r="0.6" fill="currentColor" />
    </>
  ),
  tiktok: <path d="M14 4v10.5a3.5 3.5 0 1 1-3.5-3.5M14 4c.4 2.3 2 3.9 4.5 4.2" />,
  youtube: (
    <>
      <rect x="3.5" y="6" width="17" height="12" rx="3.5" />
      <path d="M10.5 9.5v5l4-2.5z" fill="currentColor" />
    </>
  ),
  facebook: <path d="M14.5 20v-7h2.4l.4-2.8h-2.8V8.5c0-.8.3-1.4 1.4-1.4h1.5V4.6a19 19 0 0 0-2.2-.1c-2.2 0-3.6 1.3-3.6 3.7v2h-2.4V13h2.4v7" />,
  x: <path d="M5 4.5l14 15M19 4.5l-14 15" />,
  pinterest: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M11 9.5c.3-1.6 3.9-1.6 3.9 1.1 0 2.2-1.4 3.4-2.6 3.4-1 0-1.4-.7-1.4-.7L9.8 19" />
    </>
  ),
  threads: <path d="M16.5 10.5c-.6-2.6-2.4-3.8-4.6-3.8-3 0-4.9 2.3-4.9 5.3s1.8 5.3 4.9 5.3c2.4 0 4.3-1.3 4.3-3.4 0-2.3-2.4-3.1-4.5-2.8-1.6.2-2.4 1-2.4 2 0 1 .9 1.6 2 1.6 2.3 0 3-2.2 2.6-4.9" />,
  spotify: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M8 10c2.7-.8 5.7-.5 8 .8M8.6 12.9c2.1-.6 4.4-.3 6.2.7M9.2 15.6c1.6-.4 3.2-.2 4.5.5" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7L11.3 7" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.3-1.3" />
    </>
  ),
};

export default function SocialIcon({ kind }: { kind: Kind }) {
  return (
    <svg className="line-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[kind]}
    </svg>
  );
}
